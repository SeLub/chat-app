import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import sessionRoutes from '../../src/routes/sessionRoutes.js';

/**
 * ТЗ send-error-persist (№3 context-overflow-ux): явный dismiss персистентной
 * плашки — DELETE /api/sessions/:id/send-error. Реальный express на эфемерном
 * порту + fetch (паттерн attachmentRoutes.test.js).
 */
describe('sessionRoutes: DELETE /:id/send-error (dismiss плашки)', () => {
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
        sessionId = sessionRepo.createSession('Dismiss test').id;
    });

    it('dismiss чистит sessions.last_send_error', async () => {
        sessionRepo.setSendError(sessionId, { kind: 'context_overflow', failedText: 'Вопрос' });

        const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/send-error`, { method: 'DELETE' });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(sessionRepo.getSendError(sessionId), null);
    });

    it('dismiss на неизвестной сессии → 404', async () => {
        const res = await fetch(`${baseUrl}/api/sessions/no-such-session/send-error`, { method: 'DELETE' });

        assert.equal(res.status, 404);
    });

    it('GET /:id отдаёт last_send_error (SELECT * — колонка доступна фронту)', async () => {
        sessionRepo.setSendError(sessionId, { kind: 'server', failedText: 'Вопрос', message: 'boom' });

        const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`);

        assert.equal(res.status, 200);
        const session = await res.json();
        assert.ok(session.last_send_error, 'last_send_error в ответе GET /:id');
        const parsed = JSON.parse(session.last_send_error);
        assert.equal(parsed.kind, 'server');
        assert.equal(parsed.failedText, 'Вопрос');
    });
});
