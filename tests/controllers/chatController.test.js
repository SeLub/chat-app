import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import { chatHandler } from '../../src/controllers/chatController.js';

/**
 * Интеграционные тесты chatHandler для Фазы B (attachments в БД).
 * multer в тесте не участвует: req.files мокается в форме diskStorage —
 * у файлов есть path, буфера НЕТ (он появляется только после чтения с диска,
 * которое и является предметом TZ-B.1).
 */

function makeRes() {
    return {
        statusCode: 200, // express default
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

function makeProvider(response = 'mock answer') {
    return {
        name: 'mock',
        detectModelType: () => 'chat',
        chat: async () => ({ response, metrics: { prompt_tokens: 1, completion_tokens: 1 } }),
    };
}

describe('chatHandler: Phase B (attachments)', () => {
    let sessionId;
    let tempDir;

    before(async () => {
        setDbPath(':memory:');
        getDb();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-b-test-'));
    });

    after(async () => {
        closeDb();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Phase B Test').id;
    });

    describe('TZ-B.1: disk storage — файл обрабатывается по пути (buffer восстанавливается с диска)', () => {
        it('processes a document given only by path (no buffer, like multer.diskStorage)', async () => {
            const csvPath = path.join(tempDir, 'report_b1.csv');
            await fs.writeFile(csvPath, 'col1,col2\na,b\nc,d\n', 'utf-8');

            const req = {
                body: { message: 'Что в файле?', model: 'test-model', sessionId, questionId: 'q_1_1' },
                files: {
                    file: [{ path: csvPath, originalname: 'report_b1.csv', mimetype: 'text/csv', size: 22 }],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
            assert.equal(res.body.response, 'mock answer');
            // удаление tmp-файла — предмет TZ-B.3 (отдельные тесты)
        });
    });

    describe('TZ-B.2: вложения сохраняются в БД (attachments) и попадают в attachments_meta с fileId', () => {
        it('document file → row in attachments + attachments_meta {fileId,name,size,type}', async () => {
            const csvPath = path.join(tempDir, 'report_b2.csv');
            await fs.writeFile(csvPath, 'name,qty\napple,3\n', 'utf-8');

            const req = {
                body: { message: 'Вопрос по файлу', model: 'test-model', sessionId, questionId: 'q_2_1' },
                files: {
                    file: [{ path: csvPath, originalname: 'report_b2.csv', mimetype: 'text/csv', size: 20 }],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            // 1. В таблице attachments появилась строка
            const rows = getDb().prepare('SELECT * FROM attachments WHERE session_id = ?').all(sessionId);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].filename, 'report_b2.csv');
            assert.ok(rows[0].extracted_text.includes('apple'), 'extracted_text должен содержать содержимое файла');

            // 2. attachments_meta user-сообщения содержит fileId и не содержит путь
            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            const meta = JSON.parse(userMsg.attachments_meta);
            assert.equal(meta.length, 1);
            assert.equal(meta[0].fileId, rows[0].id);
            assert.equal(meta[0].name, 'report_b2.csv');
            assert.equal(typeof meta[0].size, 'number');
            assert.ok(meta[0].type);
            assert.equal(meta[0].path, undefined, 'server path не должен утекать в meta');
        });

        it('codeFiles (2 files) → 2 rows in attachments + 2 fileIds in meta', async () => {
            const p1 = path.join(tempDir, 'util_b2.ts');
            const p2 = path.join(tempDir, 'main_b2.js');
            await fs.writeFile(p1, 'export const one = 1;\n', 'utf-8');
            await fs.writeFile(p2, 'console.log("two");\n', 'utf-8');

            const req = {
                body: { message: 'Проверь код', model: 'test-model', sessionId, questionId: 'q_2_2' },
                files: {
                    codeFiles: [
                        { path: p1, originalname: 'util_b2.ts', mimetype: 'text/plain', size: 20 },
                        { path: p2, originalname: 'main_b2.js', mimetype: 'text/javascript', size: 20 },
                    ],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            const rows = getDb().prepare('SELECT * FROM attachments WHERE session_id = ?').all(sessionId);
            assert.equal(rows.length, 2);

            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            const meta = JSON.parse(userMsg.attachments_meta);
            assert.equal(meta.length, 2);
            assert.deepEqual(
                new Set(meta.map((m) => m.fileId)),
                new Set(rows.map((r) => r.id)),
            );
        });

        it('no files → attachments_meta = [] (baseline contract)', async () => {
            const req = {
                body: { message: 'Простой вопрос', model: 'test-model', sessionId, questionId: 'q_2_3' },
                files: {},
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            assert.deepEqual(JSON.parse(userMsg.attachments_meta), []);

            // Ошибки экстракции конкретного файла (errors из extractFromPaths) покрыты
            // в tests/db/attachmentRepo.test.js; ветка "log + continue" в контроллере —
            // та же точка возврата, что и базовая (meta = []), см. PR-описание.
        });
    });

    describe('TZ-B.3: cleanup временных файлов в finally', () => {
        it('tmp file deleted after successful handling', async () => {
            const csvPath = path.join(tempDir, 'report_b3_ok.csv');
            await fs.writeFile(csvPath, 'a,b\n1,2\n', 'utf-8');

            const req = {
                body: { message: 'Вопрос', model: 'test-model', sessionId, questionId: 'q_3_1' },
                files: {
                    file: [{ path: csvPath, originalname: 'report_b3_ok.csv', mimetype: 'text/csv', size: 9 }],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
            await assert.rejects(() => fs.access(csvPath), 'tmp-файл должен быть удалён после обработки');
        });

        it('tmp files deleted even when provider.chat fails', async () => {
            const p1 = path.join(tempDir, 'cf_b3.ts');
            const p2 = path.join(tempDir, 'cf_b3.js');
            await fs.writeFile(p1, 'export const x = 1;\n', 'utf-8');
            await fs.writeFile(p2, 'const y = 2;\n', 'utf-8');

            const failingProvider = {
                name: 'mock-fail',
                detectModelType: () => 'chat',
                chat: async () => { throw new Error('provider down'); },
            };

            const req = {
                body: { message: 'Вопрос', model: 'test-model', sessionId, questionId: 'q_3_2' },
                files: {
                    codeFiles: [
                        { path: p1, originalname: 'cf_b3.ts', mimetype: 'text/plain', size: 19 },
                        { path: p2, originalname: 'cf_b3.js', mimetype: 'text/javascript', size: 13 },
                    ],
                },
                provider: failingProvider,
                providerName: 'mock-fail',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 500, 'ошибка провайдера должна вернуть 500');
            await assert.rejects(() => fs.access(p1), 'tmp-файл 1 должен быть удалён даже при ошибке провайдера');
            await assert.rejects(() => fs.access(p2), 'tmp-файл 2 должен быть удалён даже при ошибке провайдера');
        });
    });
});
