import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';
import * as attachmentRepo from '../../src/db/attachmentRepo.js';

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

        it('ТЗ attachment-cascade: заклеймлённые строки удаляются каскадом, deletedAttachments реальный', () => {
            const fileId = 'file-cascade-1';
            attachmentRepo.insertAttachment({
                id: fileId,
                sessionId,
                filename: 'report.pdf',
                filePath: null, // document: tmp удалён при отправке
                mimeType: 'application/pdf',
                fileSize: 123,
                extractedText: 'moment-in-time text',
                language: 'text',
                kind: 'document',
                pathBase: 'context',
            });
            const msgId = messageRepo.addMessage(sessionId, {
                questionId: 'q_10_1', role: 'user', content: 'Q',
                attachmentsMeta: [{ fileId, name: 'report.pdf', kind: 'document' }],
            });
            attachmentRepo.claimAttachments([fileId], msgId);

            const result = messageRepo.deleteMessagesByQuestionId('q_10_1');

            assert.equal(result.deletedMessages, 1);
            assert.equal(result.deletedAttachments, 1, 'реальное число удалённых строк реестра');
            assert.ok(!getDb().prepare('SELECT 1 FROM attachments WHERE id = ?').get(fileId),
                'строка attachments удалена каскадом БД (orphan-политика строк отменена)');
        });

        it('ТЗ attachment-cascade: незаклеймлённая reference-строка переживает удаление Q&A', () => {
            const refId = 'ref-cascade-2';
            attachmentRepo.insertAttachment({
                id: refId,
                sessionId,
                filename: 'app.py',
                filePath: 'proj/app.py', // reference: живой файл в CONTEXT_BASE_DIR
                mimeType: 'text/x-python',
                fileSize: 10,
                extractedText: 'pool text',
                language: 'python',
                kind: 'reference',
                pathBase: 'context',
            });
            messageRepo.addMessage(sessionId, {
                questionId: 'q_10_2', role: 'user', content: 'Q',
                attachmentsMeta: [{ fileId: refId, name: 'app.py', kind: 'reference' }],
            });

            const result = messageRepo.deleteMessagesByQuestionId('q_10_2');

            assert.equal(result.deletedMessages, 1);
            assert.equal(result.deletedAttachments, 0, 'reference не принадлежит сообщению');
            assert.ok(getDb().prepare('SELECT 1 FROM attachments WHERE id = ?').get(refId),
                'reference-строка — пул сессии, каскадом не затронута');
        });

        it('ТЗ attachment-cascade: удаление одного Q&A не трогает строки соседнего сообщения', () => {
            const f1 = 'file-pair-a';
            const f2 = 'file-pair-b';
            attachmentRepo.insertAttachment({
                id: f1, sessionId, filename: 'a.csv', filePath: null, mimeType: 'text/csv',
                fileSize: 4, extractedText: 'a', language: 'text', kind: 'document', pathBase: 'context',
            });
            const msgId1 = messageRepo.addMessage(sessionId, {
                questionId: 'q_11_1', role: 'user', content: 'Q1',
                attachmentsMeta: [{ fileId: f1, name: 'a.csv', kind: 'document' }],
            });
            attachmentRepo.claimAttachments([f1], msgId1);
            attachmentRepo.insertAttachment({
                id: f2, sessionId, filename: 'b.csv', filePath: null, mimeType: 'text/csv',
                fileSize: 4, extractedText: 'b', language: 'text', kind: 'document', pathBase: 'context',
            });
            const msgId2 = messageRepo.addMessage(sessionId, {
                questionId: 'q_11_2', role: 'user', content: 'Q2',
                attachmentsMeta: [{ fileId: f2, name: 'b.csv', kind: 'document' }],
            });
            attachmentRepo.claimAttachments([f2], msgId2);

            const result = messageRepo.deleteMessagesByQuestionId('q_11_1');

            assert.equal(result.deletedAttachments, 1);
            assert.ok(!getDb().prepare('SELECT 1 FROM attachments WHERE id = ?').get(f1), 'своя строка удалена');
            assert.ok(getDb().prepare('SELECT 1 FROM attachments WHERE id = ?').get(f2), 'строка соседнего сообщения уцелела');
            assert.equal(getDb().prepare('SELECT message_id FROM attachments WHERE id = ?').get(f2).message_id, msgId2);
        });
    });
});