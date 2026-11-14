import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as promptRepo from '../../src/db/promptRepo.js';
import * as promptController from '../../src/controllers/promptController.js';

function makeReq(body = {}, params = {}) {
    const res = {
        statusCode: 200,
        _body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this._body = data; return this; },
    };
    const req = { body, params, res };
    return { req, res };
}

describe('promptController (P0.2)', () => {
    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(() => {
        getDb().exec('DELETE FROM prompts');
    });

    it('listPrompts returns array of prompts', () => {
        promptRepo.createPrompt({ name: 'A', type: 'system', content: 'a' });
        promptRepo.createPrompt({ name: 'B', type: 'user_template', content: 'b' });
        const { req, res } = makeReq();
        promptController.listPrompts(req, res);
        assert.equal(res.statusCode, 200);
        assert.ok(Array.isArray(res._body));
        assert.equal(res._body.length, 2);
    });

    it('getPrompt returns 404 for missing', () => {
        const { req, res } = makeReq({}, { id: 'nonexistent' });
        promptController.getPrompt(req, res);
        assert.equal(res.statusCode, 404);
    });

    it('createPrompt validates empty name', () => {
        const { req, res } = makeReq({ name: '', type: 'system', content: 'x' });
        promptController.createPrompt(req, res);
        assert.equal(res.statusCode, 400);
    });

    it('createPrompt validates empty content', () => {
        const { req, res } = makeReq({ name: 'X', type: 'system', content: '' });
        promptController.createPrompt(req, res);
        assert.equal(res.statusCode, 400);
    });

    it('createPrompt validates invalid type', () => {
        const { req, res } = makeReq({ name: 'X', type: 'invalid', content: 'x' });
        promptController.createPrompt(req, res);
        assert.equal(res.statusCode, 400);
    });

    it('createPrompt success returns 201', () => {
        const { req, res } = makeReq({ name: 'New', type: 'user_template', content: 'hello' });
        promptController.createPrompt(req, res);
        assert.equal(res.statusCode, 201);
        assert.ok(res._body.id);
    });

    it('updatePrompt returns 404 for missing', () => {
        const { req, res } = makeReq({ name: 'X' }, { id: 'nonexistent' });
        promptController.updatePrompt(req, res);
        assert.equal(res.statusCode, 404);
    });

    it('deletePrompt returns 400 for last default', () => {
        const def = promptRepo.createPrompt({ name: 'Def', type: 'system', content: 'd', is_default: 1 });
        const { req, res } = makeReq({}, { id: def.id });
        promptController.deletePrompt(req, res);
        assert.equal(res.statusCode, 400);
    });

    it('deletePrompt success for non-default', () => {
        const row = promptRepo.createPrompt({ name: 'Del', type: 'user_template', content: 'd' });
        const { req, res } = makeReq({}, { id: row.id });
        promptController.deletePrompt(req, res);
        assert.equal(res.statusCode, 200);
    });
});
