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
            // файл ещё существует здесь — его удаление это TZ-B.3
            await fs.access(csvPath);
        });
    });
});
