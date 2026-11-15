import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import sessionRoutes from '../../src/routes/sessionRoutes.js';

/**
 * ТЗ Last Prompt: GET /api/sessions/:id/last-prompt — 200 с {prompt, meta},
 * 404 если промпта нет, 404 если сессия не найдена.
 */
describe('sessionRoutes: GET /:id/last-prompt', () => {
    let app;
    let server;
    let baseUrl;
    let sessionId;

    before(async () => {
        setDbPath(':memory:');
        getDb();

        app = express();
        app.use(express.json());
        app.use('/api/sessions', sessionRoutes);
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
        closeDb();
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Last prompt test').id;
    });

    it('200 с {prompt, meta} после сохранения', async () => {
        const payload = {
            prompt: [
                { role: 'system', content: 'sys' },
                { role: 'user', content: '[Вопрос]\nhi' },
            ],
            meta: { mode: 'research', questionId: 'q_1', timestamp: 1730000000000 },
        };
        sessionRepo.setLastPrompt(sessionId, payload);

        const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/last-prompt`);

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body, payload);
    });

    it('404 если промпта ещё нет (новый чат)', async () => {
        const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/last-prompt`);

        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'No prompt yet for this session');
    });

    it('404 если сессия не найдена', async () => {
        const res = await fetch(`${baseUrl}/api/sessions/no-such-session/last-prompt`);

        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'Session not found');
    });
});
