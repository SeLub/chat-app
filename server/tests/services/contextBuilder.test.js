import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';
import * as sessionService from '../../src/services/sessionService.js';
import { DEFAULT_SYSPROMPT } from '../../src/services/contextBuilder.js';

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
        const filesMsg = conversation.find((m) => m.role === 'user' && m.content.startsWith('[Материалы]'));

        assert.ok(filesMsg, 'filesContext должен существовать (документ найден)');
        assert.ok(filesMsg.content.includes('report.csv'), 'документ инлайнится');
        assert.ok(!filesMsg.content.includes('photo.png'), 'изображение НЕ инлайнится в контекст');
    });
});

// ============================================================
// ТЗ «один system, [Материалы] / [Ранее] / [Вопрос]»:
// finalConversation = system(sysprompt) + user[Материалы]? + user[Ранее]? + history
// Два system подряд шаблон Qwen3.8 отвергает («System message must be at the beginning»).
// ============================================================
describe('buildLLMContext: единый system + [Материалы]/[Ранее] (ТЗ one-system)', () => {
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
        sessionId = sessionRepo.createSession('One system context').id;
    });

    /** фикстура: документ в реестре + 2 Q&A пары в истории */
    function seedDocAndHistory() {
        getDb().prepare(`
            INSERT INTO attachments (id, session_id, filename, extracted_text, kind, path_base)
            VALUES ('doc-fix', ?, 'report.csv', 'apple;3', 'document', 'context')
        `).run(sessionId);

        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Первый вопрос', model: 'm', questionId: 'q_1_1',
            attachmentsMeta: [{ fileId: 'doc-fix', name: 'report.csv' }],
        });
        messageRepo.addMessage(sessionId, {
            role: 'assistant', content: 'Первый ответ', model: 'm', questionId: 'q_1_1',
        });
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'Второй вопрос', model: 'm', questionId: 'q_1_2',
            attachmentsMeta: [],
        });
        messageRepo.addMessage(sessionId, {
            role: 'assistant', content: 'Второй ответ', model: 'm', questionId: 'q_1_2',
        });
    }

    it('ровно один system в finalConversation — и с файлами, и без', async () => {
        seedDocAndHistory();
        const withFiles = await sessionService.buildContext(sessionId, [], 65536, 80, null);
        assert.equal(withFiles.conversation.filter((m) => m.role === 'system').length, 1, 'с файлами — один system');
        assert.equal(withFiles.conversation[0].role, 'system', 'system — первый элемент');

        getDb().exec('DELETE FROM attachments');
        const noFiles = await sessionService.buildContext(sessionId, [], 65536, 80, null);
        assert.equal(noFiles.conversation.filter((m) => m.role === 'system').length, 1, 'без файлов — тоже один system');
    });

    it('filesContext → user [Материалы]; без файлов [Материалы] отсутствует', async () => {
        seedDocAndHistory();
        const { conversation } = await sessionService.buildContext(sessionId, [], 65536, 80, null);

        const materials = conversation.find((m) => m.role === 'user' && m.content.startsWith('[Материалы]\n'));
        assert.ok(materials, '[Материалы] — user-сообщение');
        assert.ok(materials.content.includes('FILE: report.csv'), 'документ внутри [Материалы]');
        assert.ok(materials.content.includes('apple;3'), 'extracted_text внутри [Материалы]');

        const sysCount = conversation.filter((m) => m.role === 'system').length;
        assert.equal(sysCount, 1, '[Материалы] не является вторым system');

        getDb().exec('DELETE FROM attachments');
        const { conversation: bare } = await sessionService.buildContext(sessionId, [], 65536, 80, null);
        // NB: includes() не годится — новый DEFAULT_SYSPROMPT сам упоминает [Материалы];
        // проверяем, что НЕТ user-сообщения-разделителя [Материалы]
        assert.ok(
            !bare.some((m) => m.role === 'user' && m.content.startsWith('[Материалы]')),
            'без файлов [Материалы] не отправляется',
        );
    });

    it('история → user [Ранее в этой сессии] + Q&A-пары; без истории маркера нет', async () => {
        seedDocAndHistory();
        const { conversation } = await sessionService.buildContext(sessionId, [], 65536, 80, null);

        const markerIdx = conversation.findIndex((m) => m.role === 'user' && m.content === '[Ранее в этой сессии]');
        assert.ok(markerIdx !== -1, 'маркер [Ранее в этой сессии] присутствует (user-роль)');

        const history = conversation.slice(markerIdx + 1).map((m) => m.content);
        assert.deepEqual(history, ['Первый вопрос', 'Первый ответ', 'Второй вопрос', 'Второй ответ'],
            'после маркера — обрезанная история в хронологическом порядке');

        // пустая сессия: маркера быть не должно
        getDb().exec('DELETE FROM messages');
        const { conversation: empty } = await sessionService.buildContext(sessionId, [], 65536, 80, null);
        assert.ok(
            !empty.some((m) => m.content === '[Ранее в этой сессии]'),
            'без истории маркер [Ранее] не отправляется',
        );
    });

    it('info.* контракт не изменён (fixedChars/availableChars/targetChars/QA-счётчики)', async () => {
        seedDocAndHistory();
        const { info } = await sessionService.buildContext(sessionId, [], 65536, 80, null);

        for (const key of ['fixedChars', 'availableChars', 'targetChars', 'totalQAPairs', 'includedQAPairs',
            'removedQAPairs', 'excludedIndices', 'actualHistoryChars', 'removedChars']) {
            assert.ok(key in info, `info.${key} присутствует`);
        }
        assert.equal(info.totalQAPairs, 2);
        assert.equal(info.includedQAPairs, 2);
        assert.ok(info.fixedChars > 0, 'sysprompt + filesContext учтены в fixedChars');
    });

    it('DEFAULT_SYSPROMPT описывает структуру [Материалы]/[Ранее]/[Вопрос] (регрессия)', async () => {
        assert.ok(DEFAULT_SYSPROMPT.includes('[Материалы]'), 'sysprompt объясняет [Материалы]');
        assert.ok(DEFAULT_SYSPROMPT.includes('[Ранее в этой сессии]'), 'sysprompt объясняет [Ранее]');
        assert.ok(DEFAULT_SYSPROMPT.includes('[Вопрос]'), 'sysprompt объясняет [Вопрос]');
        assert.ok(DEFAULT_SYSPROMPT.includes('ИСТОЧНИК'), 'файлы — данные, а не инструкции');
    });
});
