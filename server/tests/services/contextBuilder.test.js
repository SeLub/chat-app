import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';
import * as sessionService from '../../src/services/sessionService.js';

/**
 * TZ-B.2b (в редакции финального ТЗ): контракт GET /api/sessions/:id/messages (Q&A-пары)
 * включает attachments_meta и metrics. image_data ДЕМОНТИРОВАН — единственный источник
 * вложений это реестр attachments через attachments_meta (фронт строит превью из kind='image').
 * Формат — сырые JSON-строки из БД (фронтовый parseLoose понимает и строку, и объект).
 */
describe('getQAPairs (via sessionService.getGroupedMessages): TZ-B.2b contract', () => {
    let sessionId;

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(() => {
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('QA contract').id;

        messageRepo.addMessage(sessionId, {
            role: 'user',
            content: 'Вопрос по файлу',
            model: 'test-model',
            questionId: 'q_1_100',
            attachmentsMeta: [{ fileId: 'file-abc', name: 'doc.csv', size: 42, type: 'text' }],
        });
        messageRepo.addMessage(sessionId, {
            role: 'assistant',
            content: 'Ответ',
            model: 'test-model',
            questionId: 'q_1_100',
            metrics: { tps: 12.5, total_tokens: 77 },
        });
    });

    it('returns attachments_meta, metrics in QA pairs (image_data демонтирован)', () => {
        const pairs = sessionService.getGroupedMessages(sessionId);

        assert.equal(pairs.length, 1);
        const pair = pairs[0];

        const meta = typeof pair.attachments_meta === 'string'
            ? JSON.parse(pair.attachments_meta)
            : pair.attachments_meta;
        assert.equal(meta.length, 1);
        assert.equal(meta[0].fileId, 'file-abc');
        assert.equal(meta[0].name, 'doc.csv');

        const metrics = typeof pair.metrics === 'string' ? JSON.parse(pair.metrics) : pair.metrics;
        assert.equal(metrics.tps, 12.5);

        // Финальное ТЗ: image_data больше не возвращается
        assert.equal(pair.image_data, undefined);
        assert.equal(pair.imageData, undefined);
    });

    it('keeps base contract fields (questionId, questionText, answerText, model)', () => {
        const [pair] = sessionService.getGroupedMessages(sessionId);
        assert.equal(pair.questionId, 'q_1_100');
        assert.equal(pair.questionText, 'Вопрос по файлу');
        assert.equal(pair.answerText, 'Ответ');
        assert.equal(pair.model, 'test-model');
    });
});

describe('buildLLMContext: фильтр изображений из filesContext (финальное ТЗ)', () => {
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
        sessionId = sessionRepo.createSession('Image filter').id;
    });

    it('kind=image и пустой extracted_text не попадают в filesContext, документы — попадают', async () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, extracted_text, kind, path_base)
            VALUES ('img-1', ?, 'photo.png', '', 'image', 'data')
        `).run(sessionId);
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, extracted_text, kind, path_base)
            VALUES ('doc-1', ?, 'report.csv', 'apple;3', 'document', 'context')
        `).run(sessionId);

        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Q', model: 'm', questionId: 'q_1_1',
            attachmentsMeta: [{ fileId: 'img-1', name: 'photo.png' }, { fileId: 'doc-1', name: 'report.csv' }],
        });

        const { conversation } = await sessionService.buildContext(sessionId, [], 65536, 80, null);
        const filesMsg = conversation.find((m) => m.role === 'system' && m.content.includes('FILE:'));

        assert.ok(filesMsg, 'filesContext должен существовать (документ найден)');
        assert.ok(filesMsg.content.includes('report.csv'), 'документ инлайнится');
        assert.ok(!filesMsg.content.includes('photo.png'), 'изображение НЕ инлайнится в контекст');
    });
});
