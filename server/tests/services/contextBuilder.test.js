import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';
import * as sessionService from '../../src/services/sessionService.js';

/**
 * TZ-B.2b: контракт GET /api/sessions/:id/messages (Q&A-пары) должен включать
 * attachments_meta, metrics и image_data (ТЗ §API, конституция §3.3).
 * Формат — сырые JSON-строки из БД (паритет с эталоном public/script.js:156,
 * фронтовый parseLoose понимает и строку, и объект).
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
            imageData: { preview: '/uploads/images/x.png' },
        });
    });

    it('returns attachments_meta, metrics, image_data in QA pairs', () => {
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

        const imageData = typeof pair.image_data === 'string' ? JSON.parse(pair.image_data) : pair.image_data;
        assert.equal(imageData.preview, '/uploads/images/x.png');
    });

    it('keeps base contract fields (questionId, questionText, answerText, model)', () => {
        const [pair] = sessionService.getGroupedMessages(sessionId);
        assert.equal(pair.questionId, 'q_1_100');
        assert.equal(pair.questionText, 'Вопрос по файлу');
        assert.equal(pair.answerText, 'Ответ');
        assert.equal(pair.model, 'test-model');
    });
});
