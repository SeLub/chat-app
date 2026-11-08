import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';

describe('messageRepo', () => {
    let sessionId;

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => {
        closeDb();
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Test Session').id;
    });

    describe('addMessage', () => {
        it('should add user message with auto sort_order', () => {
            const msgId = messageRepo.addMessage(sessionId, {
                questionId: 'q_1',
                role: 'user',
                content: 'Hello',
                model: 'qwen2.5-coder'
            });

            assert.ok(msgId);

            const messages = messageRepo.getMessagesBySession(sessionId);
            assert.equal(messages.length, 1);
            assert.equal(messages[0].role, 'user');
            assert.equal(messages[0].content, 'Hello');
            assert.equal(messages[0].sort_order, 1);
        });

        it('should increment sort_order for each message', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'Q1'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'assistant', content: 'A1'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_2', role: 'user', content: 'Q2'
            });

            const messages = messageRepo.getMessagesBySession(sessionId);
            assert.equal(messages.length, 3);
            assert.equal(messages[0].sort_order, 1);
            assert.equal(messages[1].sort_order, 2);
            assert.equal(messages[2].sort_order, 3);
        });

        it('should update session message_count', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'Q1'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'assistant', content: 'A1'
            });

            const session = sessionRepo.getSession(sessionId);
            assert.equal(session.message_count, 2);
        });

        it('should store attachments_meta as JSON', () => {
            const attachments = [
                { fileId: 'abc', name: 'test.ts', size: 100, type: 'typescript' }
            ];

            messageRepo.addMessage(sessionId, {
                questionId: 'q_1',
                role: 'user',
                content: 'Review this',
                attachmentsMeta: attachments
            });

            const messages = messageRepo.getMessagesBySession(sessionId);
            const parsed = JSON.parse(messages[0].attachments_meta);
            assert.equal(parsed.length, 1);
            assert.equal(parsed[0].fileId, 'abc');
        });

        it('should store metrics as JSON', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1',
                role: 'assistant',
                content: 'Response',
                metrics: { tps: 45.2, ttft: 0.8, inputTokens: 100 }
            });

            const messages = messageRepo.getMessagesBySession(sessionId);
            const parsed = JSON.parse(messages[0].metrics);
            assert.equal(parsed.tps, 45.2);
            assert.equal(parsed.inputTokens, 100);
        });
    });

    describe('getMessagesBySession', () => {
        it('should return messages in sort_order', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'First'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'assistant', content: 'Second'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_2', role: 'user', content: 'Third'
            });

            const messages = messageRepo.getMessagesBySession(sessionId);
            assert.equal(messages[0].content, 'First');
            assert.equal(messages[1].content, 'Second');
            assert.equal(messages[2].content, 'Third');
        });

        it('should return empty array for non-existent session', () => {
            const messages = messageRepo.getMessagesBySession('non-existent');
            assert.deepEqual(messages, []);
        });

        it('should not return messages from other sessions', () => {
            const otherSessionId = sessionRepo.createSession('Other').id;
            
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'Mine'
            });
            messageRepo.addMessage(otherSessionId, {
                questionId: 'q_2', role: 'user', content: 'Theirs'
            });

            const messages = messageRepo.getMessagesBySession(sessionId);
            assert.equal(messages.length, 1);
            assert.equal(messages[0].content, 'Mine');
        });
    });

    describe('deleteMessagesByQuestionId', () => {
        it('should delete both user and assistant messages for a question', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'Q1'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'assistant', content: 'A1'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_2', role: 'user', content: 'Q2'
            });

            messageRepo.deleteMessagesByQuestionId('q_1');

            const messages = messageRepo.getMessagesBySession(sessionId);
            assert.equal(messages.length, 1);
            assert.equal(messages[0].question_id, 'q_2');
        });

        it('should update session message_count after delete', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'Q1'
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'assistant', content: 'A1'
            });

            assert.equal(sessionRepo.getSession(sessionId).message_count, 2);

            messageRepo.deleteMessagesByQuestionId('q_1');

            assert.equal(sessionRepo.getSession(sessionId).message_count, 0);
        });

        it('should handle non-existent questionId gracefully', () => {
            messageRepo.addMessage(sessionId, {
                questionId: 'q_1', role: 'user', content: 'Q1'
            });

            // Не должно выбросить ошибку
            messageRepo.deleteMessagesByQuestionId('non-existent');

            const messages = messageRepo.getMessagesBySession(sessionId);
            assert.equal(messages.length, 1);
        });
    });
});