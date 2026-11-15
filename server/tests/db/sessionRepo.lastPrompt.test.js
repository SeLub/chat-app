import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';

/**
 * ТЗ Last Prompt: sessions.last_prompt — запись/чтение JSON, null при
 * отсутствии, битый JSON → null. updated_at НЕ трогаем.
 */
describe('sessionRepo: setLastPrompt / getLastPrompt', () => {
    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => {
        closeDb();
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM sessions');
    });

    it('getLastPrompt → null для новой сессии (промпта ещё нет)', () => {
        const { id } = sessionRepo.createSession('Fresh');
        assert.equal(sessionRepo.getLastPrompt(id), null);
    });

    it('setLastPrompt/getLastPrompt — запись и чтение JSON', () => {
        const { id } = sessionRepo.createSession('With prompt');
        const payload = {
            prompt: [
                { role: 'system', content: 'sys' },
                { role: 'user', content: '[Вопрос]\nhi' },
            ],
            meta: { mode: 'research', questionId: 'q_1', timestamp: 1730000000000 },
        };

        sessionRepo.setLastPrompt(id, payload);

        const got = sessionRepo.getLastPrompt(id);
        assert.deepEqual(got, payload);
    });

    it('setLastPrompt(null) — очистка (getLastPrompt → null)', () => {
        const { id } = sessionRepo.createSession('Clear');
        sessionRepo.setLastPrompt(id, { prompt: [], meta: {} });
        sessionRepo.setLastPrompt(id, null);
        assert.equal(sessionRepo.getLastPrompt(id), null);
    });

    it('битый JSON в last_prompt → null (не падает)', () => {
        const { id } = sessionRepo.createSession('Corrupt');
        getDb().prepare('UPDATE sessions SET last_prompt = ? WHERE id = ?').run('{not-json', id);
        assert.equal(sessionRepo.getLastPrompt(id), null);
    });

    it('перезапись при новом запросе (per session)', () => {
        const { id } = sessionRepo.createSession('Rewrite');
        sessionRepo.setLastPrompt(id, { prompt: [{ role: 'user', content: 'Q1' }], meta: {} });
        sessionRepo.setLastPrompt(id, { prompt: [{ role: 'user', content: 'Q2' }], meta: {} });

        const got = sessionRepo.getLastPrompt(id);
        assert.equal(got.prompt[0].content, 'Q2');
    });

    it('не трогает updated_at (как setSendError)', () => {
        const { id } = sessionRepo.createSession('No touch');
        const before = sessionRepo.getSession(id).updated_at;
        // даём время, чтобы datetime('now') отличался
        sessionRepo.setLastPrompt(id, { prompt: [], meta: {} });
        const after = sessionRepo.getSession(id).updated_at;
        assert.equal(after, before);
    });

    it('deleteSession — last_prompt удалён (строка сессии исчезает)', () => {
        const { id } = sessionRepo.createSession('Cascade');
        sessionRepo.setLastPrompt(id, { prompt: [], meta: {} });
        sessionRepo.deleteSession(id);
        assert.equal(sessionRepo.getSession(id), undefined);
        assert.equal(sessionRepo.getLastPrompt(id), null);
    });
});
