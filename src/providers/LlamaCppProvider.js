// src/providers/LlamaCppProvider.js
// Реализация провайдера llama.cpp

import fetch from 'node-fetch';
import { BaseProvider } from './BaseProvider.js';
import { extractLlamaCppMetrics } from '../services/metricsService.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LlamaCppProvider');

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
            const size = modelMeta.size || 0;

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
            const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

            const response = await fetch(`${this.url}/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    n_predict: -1,
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
                throw new Error('Request to llama.cpp timed out after 120 seconds');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to llama.cpp at ${this.url}. Is the server running?`);
            }
            throw error;
        }
    }

    /**
     * Отправляет чат-сообщение через /v1/chat/completions (OpenAI-совместимый API)
     */
    async chat({ model, messages, stream = false }) {
        try {
            log.info('Sending chat request to llama.cpp', { model });

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);

            const response = await fetch(`${this.url}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: stream,
                    temperature: 0.7,
                    max_tokens: -1
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                log.error('llama.cpp chat response not ok', { status: response.status, body: errorText });
                throw new Error(`Chat error: ${response.statusText}`);
            }

            if (stream && response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let done = false;
                let fullResponse = '';
                let lastMetrics = null;

                while (!done) {
                    const { value, done: readDone } = await reader.read();
                    done = readDone;

                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]');

                        for (const line of lines) {
                            try {
                                const dataStr = line.slice(6);
                                const data = JSON.parse(dataStr);
                                const delta = data.choices?.[0]?.delta?.content;
                                if (delta) {
                                    fullResponse += delta;
                                }
                                if (data.usage) {
                                    lastMetrics = extractLlamaCppMetrics(data);
                                }
                            } catch (e) {
                                log.debug('Failed to parse SSE chunk', { line });
                            }
                        }
                    }
                }

                return {
                    response: fullResponse,
                    metrics: lastMetrics || {}
                };
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            return {
                response: content,
                metrics: extractLlamaCppMetrics(data)
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request to llama.cpp timed out after 120 seconds');
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