import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractLlamaCppMetrics, extractMetrics } from '../../src/services/metricsService.js';

/**
 * ТЗ adaptive-context-budget (№3): inputTokens = ПОЛНЫЙ размер промпта.
 * README llama-server: timings.prompt_n — «number of prompt tokens being
 * processed» (без кэш-хитов), кэш-хиты — cache_n; полный промпт —
 * usage.prompt_tokens (slot.n_prompt_tokens, то же поле, что в 400-ошибке).
 * По неполному prompt_n плотность chars/токен (promptChars/inputTokens в
 * contextBuilder) завышалась бы на порядки на каждом кэш-ходе.
 */

describe('extractLlamaCppMetrics: inputTokens — полный промпт (№3)', () => {
    it('usage.prompt_tokens — приоритетный источник (полный промпт при кэш-хитах)', () => {
        const m = extractLlamaCppMetrics({
            usage: { prompt_tokens: 5000, completion_tokens: 120 },
            timings: {
                cache_n: 4880,       // большая часть промпта из кэша
                prompt_n: 120,       // обработан только хвост
                prompt_ms: 60,
                predicted_n: 120,
                predicted_ms: 2400,
            },
        });

        assert.equal(m.inputTokens, 5000, 'inputTokens — полный промпт, а не обработанный хвост');
        assert.equal(m.cachedTokens, 4880);
        assert.equal(m.outputTokens, 120);
        // скоростные метрики остаются на timings (обработанные токены)
        assert.equal(m.promptTps, parseFloat((120 / 0.06).toFixed(2)));
        assert.equal(m.tps, parseFloat((120 / 2.4).toFixed(2)));
    });

    it('нет usage → фолбэк prompt_n + cache_n', () => {
        const m = extractLlamaCppMetrics({
            timings: { cache_n: 900, prompt_n: 100, prompt_ms: 50, predicted_n: 40, predicted_ms: 800 },
        });
        assert.equal(m.inputTokens, 1000);
        assert.equal(m.cachedTokens, 900);
    });

    it('сборка без usage/cache_n (старая) → timings.prompt_n как есть', () => {
        const m = extractLlamaCppMetrics({
            timings: { prompt_n: 777, prompt_ms: 100, predicted_n: 50, predicted_ms: 500 },
        });
        assert.equal(m.inputTokens, 777);
        assert.equal(m.cachedTokens, 0);
    });

    it('usage с мусором (0/строка) → фолбэк, а не 0', () => {
        const m1 = extractLlamaCppMetrics({
            usage: { prompt_tokens: 0 },
            timings: { prompt_n: 42, predicted_n: 5 },
        });
        assert.equal(m1.inputTokens, 42);

        const m2 = extractLlamaCppMetrics({
            usage: { prompt_tokens: 'abc' },
            timings: { prompt_n: 42, predicted_n: 5 },
        });
        assert.equal(m2.inputTokens, 42);
    });

    it('пустой ответ без timings/usage → нули без исключений', () => {
        const m = extractLlamaCppMetrics({});
        assert.equal(m.inputTokens, 0);
        assert.equal(m.cachedTokens, 0);
        assert.equal(m.outputTokens, 0);
        assert.equal(m.tps, 0);
        assert.equal(m.promptTps, 0);
    });
});

describe('extractMetrics (Ollama): контракт не изменён', () => {
    it('prompt_eval_count → inputTokens (у Ollama счётчик полный не отдаётся — плотность фильтруется полосой в contextBuilder)', () => {
        const m = extractMetrics({
            eval_duration: 2e9,
            eval_count: 100,
            prompt_eval_duration: 0.5e9,
            prompt_eval_count: 300,
            total_duration: 3e9,
            load_duration: 0.2e9,
        });
        assert.equal(m.inputTokens, 300);
        assert.equal(m.outputTokens, 100);
        assert.equal(m.cachedTokens, undefined, 'у Ollama нет cache_n — поле не добавляется');
    });
});

// ============================================================
// ТЗ answer-loss-diagnostics (2026-11-12): finish_reason/truncated.
// Инцидент: промпт 6482 + 9901 токенов reasoning = 16383 из 16384,
// finish_reason=length терялся — приложение сохраняло пустой ответ
// без признака обрыва.
// ============================================================
describe('extractLlamaCppMetrics: finish_reason / truncated (answer-loss-diagnostics)', () => {
    it('OAI-ответ с finish_reason=length → truncated=true (обрыв по контексту)', () => {
        const m = extractLlamaCppMetrics({
            choices: [{ finish_reason: 'length' }],
            usage: { prompt_tokens: 6482, completion_tokens: 9901 },
            timings: { prompt_n: 6482, prompt_ms: 59560, predicted_n: 9901, predicted_ms: 513631 },
        });
        assert.equal(m.finishReason, 'length');
        assert.equal(m.truncated, true);
        assert.equal(m.inputTokens, 6482);
        assert.equal(m.outputTokens, 9901);
    });

    it('finish_reason=stop → truncated=false', () => {
        const m = extractLlamaCppMetrics({
            choices: [{ finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
            timings: { prompt_n: 100, prompt_ms: 100, predicted_n: 50, predicted_ms: 500 },
        });
        assert.equal(m.finishReason, 'stop');
        assert.equal(m.truncated, false);
    });

    it('streaming: у финального usage-чанка choices пуст → finishReason приходит через extra', () => {
        // OpenAI-протокол: finish_reason уходит в предпоследнем чанке, usage —
        // в финальном с choices: []; провайдер передаёт его как extra.finishReason
        const m = extractLlamaCppMetrics(
            {
                choices: [],
                usage: { prompt_tokens: 6482, completion_tokens: 9901 },
                timings: { prompt_n: 6482, prompt_ms: 59560, predicted_n: 9901, predicted_ms: 513631 },
            },
            { finishReason: 'length' },
        );
        assert.equal(m.finishReason, 'length');
        assert.equal(m.truncated, true);
    });

    it('нативный /completion: stopped_limit=true → length; stop_type="end_of_text" → не обрыв', () => {
        const truncated = extractLlamaCppMetrics({ stopped_limit: true, timings: { prompt_n: 10, predicted_n: 5 } });
        assert.equal(truncated.finishReason, 'length');
        assert.equal(truncated.truncated, true);

        const eos = extractLlamaCppMetrics({ stop_type: 'end_of_text', timings: { prompt_n: 10, predicted_n: 5 } });
        assert.equal(eos.finishReason, null);
        assert.equal(eos.truncated, false);
    });

    it('нет finish_reason ни в теле, ни в extra → finishReason=null, truncated=false (обратная совместимость)', () => {
        const m = extractLlamaCppMetrics({ usage: { prompt_tokens: 10, completion_tokens: 5 }, timings: {} });
        assert.equal(m.finishReason, null);
        assert.equal(m.truncated, false);
    });

    it('outputTokens: нет timings.predicted_n → фолбэк usage.completion_tokens', () => {
        const m = extractLlamaCppMetrics({
            choices: [{ finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 777 },
            timings: { prompt_n: 100, prompt_ms: 100 },
        });
        assert.equal(m.outputTokens, 777);
    });

    it('пустой ответ → finishReason=null, truncated=false, нули (старые ассерты не ломаются)', () => {
        const m = extractLlamaCppMetrics({});
        assert.equal(m.inputTokens, 0);
        assert.equal(m.outputTokens, 0);
        assert.equal(m.finishReason, null);
        assert.equal(m.truncated, false);
    });
});
