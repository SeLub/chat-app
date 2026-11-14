import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';
import * as promptRepo from '../../src/db/promptRepo.js';
import * as sessionService from '../../src/services/sessionService.js';

describe('buildContext with promptSelection (P0.2)', () => {
    let sessionId;

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        getDb().exec('DELETE FROM prompts');
        sessionId = sessionRepo.createSession('Test').id;
    });

    it('without promptSelection → default system prompt', async () => {
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Hello', model: 'test', questionId: 'q1',
        });
        const result = await sessionService.buildContext(sessionId, [], 65536, 80);
        const systemMsg = result.conversation.find(m => m.role === 'system');
        assert.ok(systemMsg.content.includes('Senior Developer'));
    });

    it('with syspromptId → uses prompt content as system', async () => {
        const sys = promptRepo.createPrompt({ name: 'Custom', type: 'system', content: 'You are a custom bot' });
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Hello', model: 'test', questionId: 'q1',
        });
        const result = await sessionService.buildContext(sessionId, [], 65536, 80, null, 'research', {
            syspromptId: sys.id,
            selectedTemplateIds: [],
        });
        const systemMsg = result.conversation.find(m => m.role === 'system');
        assert.equal(systemMsg.content, 'You are a custom bot');
    });

    it('with selectedTemplateIds → [Инструкции] block present', async () => {
        const t1 = promptRepo.createPrompt({ name: 'T1', type: 'user_template', content: 'Instruction one' });
        const t2 = promptRepo.createPrompt({ name: 'T2', type: 'user_template', content: 'Instruction two' });
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Hello', model: 'test', questionId: 'q1',
        });
        const result = await sessionService.buildContext(sessionId, [], 65536, 80, null, 'research', {
            syspromptId: null,
            selectedTemplateIds: [t1.id, t2.id],
        });
        const instrMsg = result.conversation.find(m => m.role === 'user' && m.content.includes('[Инструкции]'));
        assert.ok(instrMsg, 'Instructions block should exist');
        assert.ok(instrMsg.content.includes('Instruction one'));
        assert.ok(instrMsg.content.includes('Instruction two'));
    });

    it('with nonexistent syspromptId → falls back to default', async () => {
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Hello', model: 'test', questionId: 'q1',
        });
        const result = await sessionService.buildContext(sessionId, [], 65536, 80, null, 'research', {
            syspromptId: 'nonexistent-id',
            selectedTemplateIds: [],
        });
        const systemMsg = result.conversation.find(m => m.role === 'system');
        assert.ok(systemMsg.content.includes('Senior Developer'));
    });

    it('multiple templates all appear in [Инструкции]', async () => {
        const t1 = promptRepo.createPrompt({ name: 'T1', type: 'user_template', content: 'alpha instruction' });
        const t2 = promptRepo.createPrompt({ name: 'T2', type: 'user_template', content: 'beta instruction' });
        const t3 = promptRepo.createPrompt({ name: 'T3', type: 'user_template', content: 'gamma instruction' });
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Hello', model: 'test', questionId: 'q1',
        });
        const result = await sessionService.buildContext(sessionId, [], 65536, 80, null, 'research', {
            syspromptId: null,
            selectedTemplateIds: [t1.id, t2.id, t3.id],
        });
        const instrMsg = result.conversation.find(m => m.role === 'user' && m.content.includes('[Инструкции]'));
        assert.ok(instrMsg);
        assert.ok(instrMsg.content.includes('alpha instruction'));
        assert.ok(instrMsg.content.includes('beta instruction'));
        assert.ok(instrMsg.content.includes('gamma instruction'));
    });
});
