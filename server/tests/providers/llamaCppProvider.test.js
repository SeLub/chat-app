import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSystemMessages } from '../../src/providers/LlamaCppProvider.js';

/**
 * ТЗ «один system, [Материалы] / [Ранее] / [Вопрос]», п.6:
 * склейка system в LlamaCppProvider.chat — СТРАХОВКА. В норме messages уже
 * содержат ровно один system (гарантия buildLLMContext), склейка — no-op.
 * Если в будущем кто-то вернёт второй system — шаблон Qwen3.8 отвергнет
 * запрос («System message must be at the beginning»), склейка это спасает.
 */
describe('LlamaCppProvider: mergeSystemMessages (страховка one-system)', () => {
    it('один system — messages возвращаются как есть (no-op, та же ссылка)', () => {
        const messages = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: '[Материалы]\nfiles' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: '[Вопрос]\nq' },
        ];
        assert.equal(mergeSystemMessages(messages), messages, 'нормальный контекст не пересобирается');
    });

    it('два system — склеиваются в один в начале, порядок остальных сохраняется', () => {
        const merged = mergeSystemMessages([
            { role: 'system', content: 'sys-A' },
            { role: 'user', content: 'q1' },
            { role: 'system', content: 'sys-B' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
        ]);
        assert.equal(merged.filter((m) => m.role === 'system').length, 1);
        assert.equal(merged[0].role, 'system');
        assert.equal(merged[0].content, 'sys-A\n\nsys-B');
        assert.deepEqual(merged.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
        assert.deepEqual(merged.slice(1).map((m) => m.content), ['q1', 'a1', 'q2']);
    });

    it('без system — messages возвращаются как есть', () => {
        const messages = [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a' },
        ];
        assert.equal(mergeSystemMessages(messages), messages);
    });
});
