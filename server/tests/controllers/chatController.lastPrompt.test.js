import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import { chatHandler } from '../../src/controllers/chatController.js';

// 1×1 PNG (валидный вход для sharp в addImageAttachment)
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        writableEnded: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

function makeReq(body, provider, providerName) {
    return {
        headers: { accept: 'application/json' },
        body,
        files: {},
        provider,
        providerName,
    };
}

function makeProvider(response = 'mock answer', finishReason = 'stop') {
    return {
        name: 'mock',
        detectModelType: () => 'chat',
        chat: async () => ({
            response,
            finishReason,
            metrics: { inputTokens: 10, outputTokens: 5 },
        }),
    };
}

function makeVisionProvider() {
    return {
        name: 'mock-vision',
        detectModelType: () => 'vision',
        chat: async () => ({
            response: 'vision answer',
            finishReason: 'stop',
            metrics: { inputTokens: 20, outputTokens: 8 },
        }),
    };
}

/**
 * ТЗ Last Prompt: last_prompt сохраняется ПОСЛЕ buildLLMContext, ДО provider.chat;
 * после done — meta обновляется (finishReason/usage); провал ДО buildLLMContext —
 * last_prompt не сохраняется; vision — images без base64.
 */
describe('chatHandler: Last Prompt persist', () => {
    let sessionId;
    let tempDir;

    before(async () => {
        setDbPath(':memory:');
        getDb();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'last-prompt-test-'));
    });

    after(async () => {
        closeDb();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Last prompt test').id;
    });

    describe('non-stream', () => {
        it('после buildLLMContext → last_prompt сохранён (system + [Вопрос], meta)', async () => {
            const req = makeReq({ message: 'Привет', model: 'test-model', sessionId, questionId: 'q_lp_1' }, makeProvider(), 'mock');
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.ok(lp, 'last_prompt должен быть сохранён');
            assert.ok(Array.isArray(lp.prompt));

            // system-сообщение (DEFAULT_SYSPROMPT fallback)
            const sys = lp.prompt.find((m) => m.role === 'system');
            assert.ok(sys, 'system-сообщение есть в промпте');
            assert.ok(typeof sys.content === 'string' && sys.content.length > 0);

            // [Вопрос]
            const question = lp.prompt.find((m) => m.role === 'user' && m.content.startsWith('[Вопрос]'));
            assert.ok(question, '[Вопрос] есть в промпте');
            assert.ok(question.content.includes('Привет'));

            // meta
            assert.equal(lp.meta.mode, 'research');
            assert.equal(lp.meta.questionId, 'q_lp_1');
            assert.equal(lp.meta.model, 'test-model');
            assert.equal(lp.meta.provider, 'mock');
            assert.ok(typeof lp.meta.timestamp === 'number');
            // после provider.chat — finishReason/usage
            assert.equal(lp.meta.finishReason, 'stop');
            assert.deepEqual(lp.meta.usage, { inputTokens: 10, outputTokens: 5 });
        });

        it('meta.currentAttachments — список файлов', async () => {
            const csvPath = path.join(tempDir, 'lp_report.csv');
            await fs.writeFile(csvPath, 'a,b\n1,2\n', 'utf-8');

            const req = makeReq(
                { message: 'Что в файле?', model: 'test-model', sessionId, questionId: 'q_lp_2' },
                makeProvider(), 'mock');
            req.files = {
                file: [{ path: csvPath, originalname: 'lp_report.csv', mimetype: 'text/csv', size: 8 }],
            };
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 200);
            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.ok(lp.meta.currentAttachments.length >= 1);
            const att = lp.meta.currentAttachments[0];
            assert.equal(att.name, 'lp_report.csv');
            assert.ok(att.fileId);
            // [Материалы] в промпте
            const materials = lp.prompt.find((m) => m.role === 'user' && m.content.startsWith('[Материалы]'));
            assert.ok(materials, '[Материалы] есть в промпте');
        });

        it('ошибка ДО buildLLMContext (model not specified) → last_prompt НЕ сохранён', async () => {
            const req = makeReq({ message: 'Привет', model: null, sessionId, questionId: 'q_lp_3' }, makeProvider(), 'mock');
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 400);
            assert.equal(sessionRepo.getLastPrompt(sessionId), null);
        });

        it('провал провайдера ПОСЛЕ buildLLMContext → last_prompt сохранён (что ушло видно)', async () => {
            const failingProvider = {
                name: 'mock-fail',
                detectModelType: () => 'chat',
                chat: async () => { throw new Error('provider down'); },
            };

            const req = makeReq({ message: 'Привет', model: 'test-model', sessionId, questionId: 'q_lp_4' }, failingProvider, 'mock-fail');
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 500);
            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.ok(lp, 'last_prompt сохранён даже при провале провайдера');
            assert.ok(lp.prompt.some((m) => m.role === 'user' && m.content.startsWith('[Вопрос]')));
        });

        it('перезапись при новом запросе (per session)', async () => {
            const req1 = makeReq({ message: 'Первый вопрос', model: 'test-model', sessionId, questionId: 'q_lp_5a' }, makeProvider(), 'mock');
            await chatHandler(req1, makeRes());

            const req2 = makeReq({ message: 'Второй вопрос', model: 'test-model', sessionId, questionId: 'q_lp_5b' }, makeProvider(), 'mock');
            await chatHandler(req2, makeRes());

            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.equal(lp.meta.questionId, 'q_lp_5b');
            const question = lp.prompt.find((m) => m.role === 'user' && m.content.startsWith('[Вопрос]'));
            assert.ok(question.content.includes('Второй вопрос'));
        });
    });

    describe('stream', () => {
        it('после done → last_prompt сохранён с finishReason/usage', async () => {
            const chunks = [];
            const res = {
                statusCode: 200,
                writableEnded: false,
                writeHead() {},
                write(chunk) { chunks.push(chunk); return true; },
                end() { this.writableEnded = true; },
            };

            const req = {
                headers: { accept: 'text/event-stream' },
                body: { message: 'Stream question', model: 'test-model', sessionId, questionId: 'q_lp_6' },
                files: {},
                provider: makeProvider('streamed answer'),
                providerName: 'mock',
            };

            await chatHandler(req, res);

            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.ok(lp, 'last_prompt сохранён для stream');
            assert.equal(lp.meta.finishReason, 'stop');
            assert.deepEqual(lp.meta.usage, { inputTokens: 10, outputTokens: 5 });
            // done-чанк отправлен
            assert.ok(chunks.some((c) => c.includes('"done"')), 'done-чанк в SSE');
        });

        it('ошибка mid-stream → meta.finishReason = "error"', async () => {
            const chunks = [];
            const res = {
                statusCode: 200,
                writableEnded: false,
                writeHead() {},
                write(chunk) { chunks.push(chunk); return true; },
                end() { this.writableEnded = true; },
            };

            const failingProvider = {
                name: 'mock-fail',
                detectModelType: () => 'chat',
                chat: async () => { throw new Error('stream broke'); },
            };

            const req = {
                headers: { accept: 'text/event-stream' },
                body: { message: 'Stream fail', model: 'test-model', sessionId, questionId: 'q_lp_7' },
                files: {},
                provider: failingProvider,
                providerName: 'mock-fail',
            };

            await chatHandler(req, res);

            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.ok(lp, 'last_prompt сохранён при ошибке stream');
            assert.equal(lp.meta.finishReason, 'error');
        });
    });

    describe('vision', () => {
        it('prompt содержит images: [{ size, type }] (без base64)', async () => {
            const pngPath = path.join(tempDir, 'lp_test.png');
            await fs.writeFile(pngPath, PNG_1PX);

            const req = makeReq({ message: 'Что на картинке?', model: 'vision-model', sessionId, questionId: 'q_lp_8' }, makeVisionProvider(), 'mock-vision');
            req.files = {
                file: [{ path: pngPath, originalname: 'lp_test.png', mimetype: 'image/png', size: PNG_1PX.length }],
            };
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
            const lp = sessionRepo.getLastPrompt(sessionId);
            assert.ok(lp, 'last_prompt сохранён для vision');

            const withImages = lp.prompt.find((m) => m.images && m.images.length > 0);
            assert.ok(withImages, 'сообщение с images есть');
            assert.ok(withImages.content.startsWith('[Вопрос]'));
            assert.equal(withImages.images.length, 1);
            assert.equal(withImages.images[0].type, 'base64');
            assert.ok(typeof withImages.images[0].size === 'number' && withImages.images[0].size > 0);
            // base64 НЕ храним — только size
            assert.ok(!JSON.stringify(lp).includes('iVBORw0KGgo'), 'base64 в last_prompt отсутствует');

            assert.equal(lp.meta.finishReason, 'stop');
            assert.deepEqual(lp.meta.usage, { inputTokens: 20, outputTokens: 8 });
        });
    });
});
