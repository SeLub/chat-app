// src/providers/LlamaCppProvider.js
// Реализация провайдера llama.cpp
//
// P0.1: chat() — динамические generation params (temperature/top_p/top_k/
// min_p/n_predict→max_tokens/presence_penalty/repeat_penalty). Контракт:
// «не прислано — не передаём» — только присутствующие ключи в body.

import fetch from 'node-fetch';
import { stat } from 'node:fs/promises';
import { BaseProvider } from './BaseProvider.js';
import { extractLlamaCppMetrics } from '../services/metricsService.js';
import { createLogger } from '../utils/logger.js';
import { GENERATION_PARAM_KEYS } from '../utils/generationParams.js';

const log = createLogger('LlamaCppProvider');

/**
 * ТЗ context-overflow-ux: парсинг тела ошибки llama.cpp (в т.ч. 400
 * exceed_context_size_error с n_prompt_tokens/n_ctx) в структуру для
 * проброса на фронт — баннер показывает РЕАЛЬНЫЕ числа токенизатора,
 * а не «Chat error: Bad Request». Обёртка {error:{…}} (b4xxx–b6xxx) и
 * плоский JSON разбираются одинаково; не-JSON/пусто → null (фронт
 * покажет общий текст ошибки, числа просто не появятся).
 * @param {string} bodyText - сырое тело ответа
 * @returns {{ message?: string, type?: string, n_prompt_tokens?: number, n_ctx?: number } | null}
 */
export function parseLlamaCppErrorResponse(bodyText) {
    if (typeof bodyText !== 'string' || bodyText === '') return null;
    let body = null;
    try {
        body = JSON.parse(bodyText);
    } catch {
        return null;
    }
    const err = body && typeof body.error === 'object' && body.error !== null ? body.error : body;
    if (!err || typeof err !== 'object') return null;
    const out = {};
    if (typeof err.message === 'string') out.message = err.message;
    if (typeof err.type === 'string') out.type = err.type;
    if (Number.isFinite(err.n_prompt_tokens)) out.n_prompt_tokens = err.n_prompt_tokens;
    if (Number.isFinite(err.n_ctx)) out.n_ctx = err.n_ctx;
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * ТЗ stats-size: разрешение размера файла модели (в байтах) из данных llama.cpp.
 * Проблема: футер «Size: – GB» — фронту нужен размер, но разные сборки
 * llama-server отдают его в разных местах, а некоторые — нигде:
 *   1) meta.size   — /v1/models meta.size (сборки b4xxx–b6xxx: llama_model_size,
 *      реальный размер файла). Master-ветка (router-сборки) его не отдаёт.
 *   2) props.model_path — GET /props возвращает путь к GGUF; если llama-server
 *      на той же машине (штатная схема проекта) — fs.stat даёт точный размер.
 * @param {object} modelMeta - meta из /v1/models (data[i].meta), может быть {}
 * @param {object} props     - ответ GET /props, может быть {}
 * @returns {Promise<number>} размер в байтах; 0 — ни один источник не сработал
 *   (фронт тогда падает на фолбэк — размер из списка моделей, иначе «–»)
 */
export async function resolveModelSize(modelMeta = {}, props = {}) {
    const metaSize = Number(modelMeta.size) || 0;
    if (metaSize > 0) return metaSize;

    const modelPath = typeof props.model_path === 'string' ? props.model_path : '';
    if (!modelPath) return 0;
    try {
        const st = await stat(modelPath);
        return st.isFile() ? st.size : 0;
    } catch {
        // удалённый llama-server / недоступный путь — молча отдаём 0,
        // это некритичная деградация (UI покажет «–»)
        return 0;
    }
}

/**
 * ТЗ «один system, [Материалы] / [Ранее] / [Вопрос]», п.6 — СТРАХОВКА.
 * В норме buildLLMContext гарантирует РОВНО один system — функция no-op
 * (возвращает ту же ссылку). Если в будущем кто-то вернёт второй system,
 * шаблон Qwen3.8 отвергнет запрос («System message must be at the beginning»)
 * — здесь мы склеиваем все system в один в начале списка.
 * @param {Array} messages - [{ role, content, images? }]
 * @returns {Array} те же messages (no-op) либо новая версия со склеенным system
 */
export function mergeSystemMessages(messages) {
    const systems = messages.filter((m) => m?.role === 'system');
    if (systems.length <= 1) return messages;

    const merged = {
        role: 'system',
        content: systems.map((m) => m.content).filter(Boolean).join('\n\n'),
    };
    return [merged, ...messages.filter((m) => m?.role !== 'system')];
}

export class LlamaCppProvider extends BaseProvider {
    constructor(name, config) {
        super(name, config);
    }

    /**
     * Получает список моделей через /v1/models (OpenAI-совместимый API)
     * Возвращает РЕАЛЬНОЕ имя модели + размер + контекст
     */
    async getModels() {
        try {
            log.info('Checking llama.cpp connection...');

            // Основной источник — /v1/models (OpenAI-совместимый)
            const modelsResponse = await fetch(`${this.url}/v1/models`);

            if (!modelsResponse.ok) {
                log.warn(`/v1/models unavailable (${modelsResponse.status}), trying /props`);
                return await this._getModelsFallback();
            }

            const data = await modelsResponse.json();
            const modelsList = data.data || data.models || [];

            if (modelsList.length === 0) {
                log.warn('No models returned from /v1/models');
                return await this._getModelsFallback();
            }

            // Получаем статус слотов (для определения running/available)
            let slots = [];
            try {
                const slotsResponse = await fetch(`${this.url}/slots`);
                if (slotsResponse.ok) {
                    slots = await slotsResponse.json();
                }
            } catch (e) {
                log.debug('Could not fetch /slots', { error: e.message });
            }

            const models = modelsList.map((m, index) => {
                // Реальное имя модели из /v1/models
                const realName = m.id || m.name || m.model || `llama-cpp-model-${index}`;
                
                // Метаданные из /v1/models
                const meta = m.meta || {};
                
                // Размер в байтах (если есть)
                const size = meta.size || 0;
                
                // Контекст: n_ctx из meta, иначе из default_generation_settings
                const contextLength = meta.n_ctx || null;
                
                // Обучающий контекст (максимальный, для которого модель обучалась)
                const trainContext = meta.n_ctx_train || null;
                
                // Количество параметров
                const nParams = meta.n_params || null;
                
                // Определяем статус: если есть слоты и они обрабатывают — running
                const slot = slots[index];
                const status = slot?.is_processing ? 'running' : 'available';

                return {
                    name: realName,
                    size: size,
                    status: status,
                    type: this.detectModelType(realName),
                    contextLength: contextLength,
                    // Дополнительная полезная информация для UI
                    meta: {
                        trainContext: trainContext,
                        nParams: nParams,
                        nVocab: meta.n_vocab || null,
                        nEmbd: meta.n_embd || null,
                        format: m.format || meta.format || 'gguf',
                        quantization: meta.quantization || null,
                        family: meta.family || null,
                        aliases: m.aliases || [],
                        capabilities: m.capabilities || [],
                    }
                };
            });

            log.info(`Found ${models.length} model(s) in llama.cpp`, {
                models: models.map(m => m.name)
            });

            return { models, connected: true };
        } catch (error) {
            log.error('llama.cpp models API error', { error: error.message });
            return { models: [], connected: false };
        }
    }

    /**
     * Fallback: если /v1/models недоступен, используем /props
     */
    async _getModelsFallback() {
        try {
            const propsResponse = await fetch(`${this.url}/props`);
            if (!propsResponse.ok) {
                throw new Error('llama.cpp server not responding');
            }

            const props = await propsResponse.json();
            const modelName = props.model || 'llama-cpp-model';
            const contextLength = props.n_ctx || null;

            return {
                models: [{
                    name: modelName,
                    size: 0,
                    status: 'running',
                    type: this.detectModelType(modelName),
                    contextLength: contextLength,
                    meta: {}
                }],
                connected: true
            };
        } catch (error) {
            log.error('llama.cpp fallback failed', { error: error.message });
            return { models: [], connected: false };
        }
    }

    /**
     * Получает детальную информацию о модели
     * Комбинирует данные из /props и /v1/models
     */
    async showModel(name) {
        try {
            // Параллельно запрашиваем /props и /v1/models
            const [propsResponse, modelsResponse] = await Promise.all([
                fetch(`${this.url}/props`).catch(() => null),
                fetch(`${this.url}/v1/models`).catch(() => null)
            ]);

            let props = {};
            let modelMeta = {};

            if (propsResponse && propsResponse.ok) {
                props = await propsResponse.json();
            }

            if (modelsResponse && modelsResponse.ok) {
                const modelsData = await modelsResponse.json();
                const modelsList = modelsData.data || modelsData.models || [];
                const found = modelsList.find(m => m.id === name || m.name === name) || modelsList[0];
                if (found) {
                    modelMeta = found.meta || {};
                }
            }

            const contextLength = modelMeta.n_ctx || props.n_ctx || null;
            const trainContext = modelMeta.n_ctx_train || null;
            const nParams = modelMeta.n_params || null;
            const size = await resolveModelSize(modelMeta, props);

            return {
                model: name,
                size: size,
                parameters: {
                    context_length: contextLength,
                    train_context: trainContext,
                    n_params: nParams,
                    n_gpu_layers: props.n_gpu_layers || 0,
                    n_batch: props.n_batch || 512,
                    n_vocab: modelMeta.n_vocab || null,
                    n_embd: modelMeta.n_embd || null,
                },
                template: props.chat_template || '',
                generation_settings: props.default_generation_settings?.params || {},
                modelfile: `# llama.cpp model\n${name}`
            };
        } catch (error) {
            log.error('Show model error', { error: error.message });
            throw error;
        }
    }

    /**
     * Генерирует ответ на промпт через /completion
     */
    async generate({ model, prompt, stream = false }) {
        try {
            log.info('Sending request to llama.cpp', { model });

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 900000); // 15min timeout

            // ТЗ answer-loss-diagnostics (2026-11-12): n_predict: -1 БОЛЬШЕ НЕ
            // ШЛЁТСЯ — он перекрывал --n-predict llama-server и позволял
            // генерации заполнить контекст до отказа (promпт 6482 + ответ
            // 9901 = 16383 из 16384, truncated=1). Не шлём поле вовсе —
            // действует серверный --n-predict; промпт не занижаем, а бюджет
            // ответа решает владелец llama-server, не приложение.
            // P0.1: generate() вне scope — dynamic generation params не
            // применяются к /completion (только chat()).
            const response = await fetch(`${this.url}/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    stream,
                    temperature: 0.7,
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                log.error('llama.cpp returned error', { status: response.status, body: errorText });
                throw new Error(`llama.cpp server error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            return {
                response: data.content,
                metrics: extractLlamaCppMetrics(data)
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request to llama.cpp timed out after 15 minutes');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to llama.cpp at ${this.url}. Is the server running?`);
            }
            throw error;
        }
    }

    /**
     * Отправляет чат-сообщение через /v1/chat/completions (OpenAI-совместимый API)
     *
     * TODO(vision): поле images на message (base64) — формат Ollama /api/chat.
     * /v1/chat/completions его не стандартизует (там — content-части image_url);
     * конкретный сервер llama.cpp может игнорировать неизвестные поля → vision
     * через llama.cpp не гарантирован. По ТЗ — не блокер, оставлено как есть.
     */
    async chat({ model, messages, stream = false, maxTokens, cache_prompt, n_keep, generationParams = {} } = {}) {
        try {
            // P0.1: generationParams — динамические параметры генерации.
            // Контракт: «не прислано — не передаём» — только присутствующие
            // ключи попадают в body; остальные использует default llama-server
            // (из bash-скрипта). n_predict маппится в max_tokens (native имя
            // llama.cpp) и имеет приоритет над legacy-аргументом maxTokens.
            const effectiveMaxTokens = Number.isFinite(generationParams.n_predict)
                ? generationParams.n_predict
                : (Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null);

            log.info('Sending chat request to llama.cpp', {
                model,
                maxTokens: effectiveMaxTokens ?? 'server default (--n-predict)',
                // P0.1: какие generation params уходят в body (пустые = server default).
                generationParams
            });

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 900000); // 15min timeout

            // ТЗ answer-loss-diagnostics (2026-11-12): max_tokens: -1 снят.
            // Он перекрывал серверный --n-predict (пользователь выставил 8192,
            // приложение молча расширило до «до заполнения контекста») —
            // генерация шла до края ctx и гарантированно обрывалась
            // (truncated=1) на каждом reasoning-ответе. Теперь поле не шлётся:
            // действует --n-predict llama-server. maxTokens — явный override
            // от вызывающего (опционально), cache_prompt/n_keep — прокидывание
            // параметров chatController (раньше игнорировались молча).
            //
            // P0.1: temperature: 0.7 УБРАН — только generationParams.temperature
            // (если прислан) попадает в body; иначе default llama-server.
            const body = {
                model: model,
                messages: mergeSystemMessages(messages),
                stream: stream,
            };
            if (effectiveMaxTokens !== null) body.max_tokens = effectiveMaxTokens;
            if (cache_prompt !== undefined) body.cache_prompt = Boolean(cache_prompt);
            if (n_keep !== undefined) body.n_keep = n_keep;

            // P0.1: динамические generation params — только присутствующие ключи.
            for (const key of GENERATION_PARAM_KEYS) {
                if (key === 'n_predict') continue; // уже обработан как max_tokens выше
                const value = generationParams[key];
                if (value !== undefined) body[key] = value;
            }

            const response = await fetch(`${this.url}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                log.error('llama.cpp chat response not ok', { status: response.status, body: errorText });
                // ТЗ context-overflow-ux: тело 400 (exceed_context_size_error) содержит
                // n_prompt_tokens/n_ctx — парсим и вешаем на err.details; chatController
                // пробрасывает их на фронт верхним уровнем JSON-ответа.
                const parsed = parseLlamaCppErrorResponse(errorText);
                const err = new Error(parsed?.message || `Chat error: ${response.statusText}`);
                if (parsed) err.details = parsed;
                throw err;
            }

            if (stream && response.body) {
                // ТЗ answer-loss-diagnostics (2026-11-12): парсер SSE переписан.
                // (а) Буферизация строк: раньше chunk.split('\n') выбрасывал
                //     событие, разрезанное границей чанка TCP — JSON.parse
                //     падал, и контент ТИХО терялся (log.debug). Теперь хвост
                //     без '\n' дожидается следующего чанка.
                // (б) reasoning_content: reasoning-модели (Qwen3.8 и т.п.)
                //     отдают размышления в delta.reasoning_content — раньше
                //     они выбрасывались молча.
                // (в) finish_reason: у финального usage-чанка choices пуст,
                //     он приходит в отдельном чанке — запоминаем последний.
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let done = false;
                let buffer = '';
                let fullResponse = '';
                let fullReasoning = '';
                let finishReason = null;
                let lastMetrics = null;

                while (!done) {
                    const { value, done: readDone } = await reader.read();
                    done = readDone;

                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                    }
                    if (!value && buffer === '') continue;

                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';
                    if (done && buffer !== '') {
                        lines.push(buffer); // финальная строка без завершающего \n
                        buffer = '';
                    }

                    for (const rawLine of lines) {
                        const line = rawLine.trim();
                        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                        try {
                            const data = JSON.parse(line.slice(6));
                            const delta = data.choices?.[0]?.delta || {};
                            if (delta.content) {
                                fullResponse += delta.content;
                            }
                            if (delta.reasoning_content) {
                                fullReasoning += delta.reasoning_content;
                            }
                            if (data.choices?.[0]?.finish_reason) {
                                finishReason = data.choices[0].finish_reason;
                            }
                            if (data.usage) {
                                lastMetrics = extractLlamaCppMetrics(data, { finishReason });
                            }
                        } catch (e) {
                            log.debug('Failed to parse SSE chunk', { line: line.slice(0, 120) });
                        }
                    }
                }

                if (fullResponse === '' && fullReasoning) {
                    log.warn('llama.cpp stream: reasoning_content received, content empty', {
                        finishReason,
                        reasoningChars: fullReasoning.length,
                        reasoningPreview: fullReasoning.slice(0, 400),
                    });
                }

                const metrics = lastMetrics || { finishReason, truncated: finishReason === 'length' };
                return {
                    response: fullResponse,
                    reasoning: fullReasoning,
                    finishReason,
                    metrics
                };
            }

            // ТЗ answer-loss-diagnostics (2026-11-12): раньше читался ТОЛЬКО
            // message.content. У reasoning-модели весь ход может уйти в
            // reasoning_content (llama.cpp кладёт размышления туда), а при
            // исчерпании контекста — content вообще пуст: приложение
            // сохраняло пустой ответ без объяснений (инцидент 2026-11-12:
            // промпт 6482 + 9901 токенов размышлений = 16383 из 16384,
            // в чате — тишина). Теперь reasoning и finish_reason возвращаются
            // вызывающему (chatController строит статусный ответ).
            const data = await response.json();
            const choice = data.choices?.[0] || {};
            const message = choice.message || {};
            const content = message.content || '';
            const reasoning = message.reasoning_content || message.reasoning || '';
            const finishReason = choice.finish_reason || null;

            if (content === '' && reasoning) {
                log.warn('llama.cpp: reasoning_content received, content empty', {
                    finishReason,
                    reasoningChars: reasoning.length,
                    reasoningPreview: reasoning.slice(0, 400),
                });
            }
            if (finishReason === 'length') {
                log.warn('llama.cpp: response truncated by context limit (finish_reason=length)', {
                    contentChars: content.length,
                    reasoningChars: reasoning.length,
                    inputTokens: data.usage?.prompt_tokens,
                    outputTokens: data.usage?.completion_tokens,
                });
            }

            return {
                response: content,
                reasoning,
                finishReason,
                metrics: extractLlamaCppMetrics(data)
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request to llama.cpp timed out after 15 minutes');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to llama.cpp at ${this.url}. Is the server running?`);
            }
            throw error;
        }
    }

    /**
     * Проверяет доступность через /health
     */
    async healthCheck() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${this.url}/health`, {
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            return response.ok;
        } catch (error) {
            log.debug(`Health check failed for ${this.name}`, { error: error.message });
            return false;
        }
    }

    /**
     * Определяет тип модели по имени
     */
    detectModelType(modelName) {
        const lower = modelName.toLowerCase();
        const embedModels = ['embed', 'embedding'];
        const visionModels = ['vision', 'llava', 'gemma3-vision'];

        if (embedModels.some(t => lower.includes(t))) return 'embedding';
        if (visionModels.some(t => lower.includes(t))) return 'vision';
        return 'text';
    }

    normalizeMetrics(raw) {
        return extractLlamaCppMetrics(raw);
    }
}