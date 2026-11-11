import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSystemMessages, resolveModelSize, parseLlamaCppErrorResponse } from '../../src/providers/LlamaCppProvider.js';

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

/**
 * ТЗ stats-size: размер файла модели для футера «Size: X.X GB».
 * Сборки llama.cpp отдают размер по-разному (meta.size есть только в
 * b4xxx–b6xxx; master-сборки — только props.model_path), поэтому
 * resolveModelSize пробует источники по порядку и молча отдаёт 0.
 */
describe('LlamaCppProvider: resolveModelSize (ТЗ stats-size)', () => {
    it('meta.size > 0 — берётся сразу, props/model_path не трогаются', async () => {
        const size = await resolveModelSize({ size: 16_000_000_000 }, { model_path: '/nonexistent/qwen.gguf' });
        assert.equal(size, 16_000_000_000);
    });

    it('meta.size отсутствует → fs.stat по props.model_path (master-сборки)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'llama-size-'));
        try {
            const gguf = join(dir, 'model.gguf');
            await writeFile(gguf, Buffer.alloc(1234));
            const size = await resolveModelSize({}, { model_path: gguf });
            assert.equal(size, 1234);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('model_path указывает на каталог (не файл) → 0', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'llama-size-'));
        try {
            const size = await resolveModelSize({}, { model_path: dir });
            assert.equal(size, 0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('model_path недоступен (удалённый llama-server) → молча 0, без throw', async () => {
        const size = await resolveModelSize({}, { model_path: '/nonexistent/path/qwen.gguf' });
        assert.equal(size, 0);
    });

    it('нет ни meta.size, ни model_path → 0', async () => {
        assert.equal(await resolveModelSize({}, {}), 0);
        assert.equal(await resolveModelSize(), 0);
    });

    it('meta.size как строка («» из ollama-совместимого слоя b6000) → 0, не NaN', async () => {
        const size = await resolveModelSize({ size: '' }, {});
        assert.equal(size, 0);
    });
});

// ============================================================
// ТЗ context-overflow-ux: парсинг тела ошибки llama.cpp
// ============================================================
// 400 exceed_context_size_error несёт n_prompt_tokens/n_ctx — раньше тело
// уходило только в лог, фронт получал голый «Chat error: Bad Request».
// parseLlamaCppErrorResponse достаёт структуру для проброса на фронт.
describe('LlamaCppProvider: parseLlamaCppErrorResponse (ТЗ context-overflow-ux)', () => {
    it('реальное тело 400 (обёртка {error:{…}}) → message/type/n_prompt_tokens/n_ctx', () => {
        const body = JSON.stringify({
            error: {
                code: 400,
                message: 'request (3937667 tokens) exceeds the available context size (98304 tokens), try increasing it',
                type: 'exceed_context_size_error',
                n_prompt_tokens: 3937667,
                n_ctx: 98304,
            },
        });
        const parsed = parseLlamaCppErrorResponse(body);
        assert.ok(parsed, 'должен распарсить');
        assert.equal(parsed.type, 'exceed_context_size_error');
        assert.equal(parsed.n_prompt_tokens, 3937667);
        assert.equal(parsed.n_ctx, 98304);
        assert.match(parsed.message, /exceeds the available context size/);
    });

    it('плоский JSON без обёртки error → те же поля', () => {
        const parsed = parseLlamaCppErrorResponse(
            JSON.stringify({ type: 'exceed_context_size_error', n_prompt_tokens: 10, n_ctx: 5 }),
        );
        assert.ok(parsed);
        assert.equal(parsed.type, 'exceed_context_size_error');
        assert.equal(parsed.n_prompt_tokens, 10);
        assert.equal(parsed.n_ctx, 5);
    });

    it('не-JSON тело → null (фронт покажет общий текст ошибки)', () => {
        assert.equal(parseLlamaCppErrorResponse('<html>Bad Request</html>'), null);
        assert.equal(parseLlamaCppErrorResponse(''), null);
        assert.equal(parseLlamaCppErrorResponse(undefined), null);
    });

    it('JSON без известных полей → null', () => {
        assert.equal(parseLlamaCppErrorResponse(JSON.stringify({ error: { code: 400 } })), null);
        assert.equal(parseLlamaCppErrorResponse('{}'), null);
    });

    it('строковые n_prompt_tokens (нечисловые) отбрасываются — только честные числа', () => {
        const parsed = parseLlamaCppErrorResponse(
            JSON.stringify({ error: { type: 'exceed_context_size_error', n_prompt_tokens: '3937667' } }),
        );
        assert.ok(parsed);
        assert.equal(parsed.type, 'exceed_context_size_error');
        assert.equal(parsed.n_prompt_tokens, undefined);
    });
});
