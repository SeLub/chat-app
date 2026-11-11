import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as messageRepo from '../../src/db/messageRepo.js';
import * as sessionService from '../../src/services/sessionService.js';
import { DEFAULT_SYSPROMPT, resolveCharsPerToken } from '../../src/services/contextBuilder.js';

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

// ============================================================
// ТЗ Project mode A (§3.9, §6.1): buildLLMContext mode='project'
// ============================================================
describe('buildLLMContext mode=project (ТЗ Project mode A)', () => {
    let sessionId;
    let baseDir;
    let projDir;

    before(async () => {
        const fsProm = (await import('fs/promises')).default;
        const os = (await import('os')).default;
        const path = (await import('path')).default;
        baseDir = await fsProm.mkdtemp(path.join(os.tmpdir(), 'ctx-project-'));
        process.env.CONTEXT_BASE_DIR = baseDir;
        projDir = path.join(baseDir, 'p');
        await fsProm.mkdir(path.join(projDir, 'src'), { recursive: true });
        await fsProm.writeFile(path.join(projDir, 'src', 'chat.ts'), 'export const v1 = 1;\n', 'utf-8');
        await fsProm.writeFile(path.join(projDir, 'src', 'store.ts'), 'export const s = 2;\n', 'utf-8');
    });

    after(async () => {
        const fsProm = (await import('fs/promises')).default;
        await fsProm.rm(baseDir, { recursive: true, force: true });
        delete process.env.CONTEXT_BASE_DIR;
    });

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Project ctx').id;
    });

    /** reference-строка реестра (как после POST /api/projects/:id/attach) */
    function insertRef(filePath, filename) {
        const db = getDb();
        const id = `ref-${filename}`;
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language, kind, path_base, extracted_mtime)
            VALUES (?, ?, ?, ?, 'text/plain', 20, '', 'typescript', 'reference', 'context', NULL)
        `).run(id, sessionId, filename, filePath);
        return id;
    }

    it('читает с диска (extracted_text пуст): content в [Материалы], extracted_text + extracted_mtime обновлены', async () => {
        const fsSync = (await import('fs')).default;
        const path = (await import('path')).default;
        const fileId = insertRef('p/src/chat.ts', 'chat.ts');
        const { conversation, info } = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');

        const materials = conversation.find((m) => m.role === 'user' && m.content.startsWith('[Материалы]'));
        assert.ok(materials, '[Материалы] присутствует');
        assert.ok(materials.content.includes('--- FILE: chat.ts (актуальная версия) ---'), 'суффикс (актуальная версия)');
        assert.ok(materials.content.includes('export const v1 = 1;'), 'содержимое с диска');

        const row = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);
        const stat = fsSync.statSync(path.join(baseDir, 'p/src/chat.ts'));
        assert.equal(row.extracted_text, 'export const v1 = 1;\n', 'extracted_text закэширован');
        assert.equal(row.extracted_mtime, stat.mtimeMs, 'extracted_mtime = stat.mtimeMs');
        assert.deepEqual(info.mode, 'project');
        assert.deepEqual(info.filesMissing, []);
        assert.deepEqual(info.filesTooLarge, []);
    });

    it('mtime-кэш: второй вызов не перечитывает (контент БД отдаётся как есть)', async () => {
        const path = (await import('path')).default;
        const fsSync = (await import('fs')).default;
        const fileId = insertRef('p/src/store.ts', 'store.ts');

        const first = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');
        const cached = getDb().prepare('SELECT extracted_text, extracted_mtime FROM attachments WHERE id = ?').get(fileId);
        const stat = fsSync.statSync(path.join(baseDir, 'p/src/store.ts'));
        assert.equal(cached.extracted_mtime, stat.mtimeMs);

        // «подменяем» содержимое БД без изменения mtime — второй вызов ДОЛЖЕН взять кэш
        getDb().prepare("UPDATE attachments SET extracted_text = 'CACHED-CONTENT' WHERE id = ?").run(fileId);
        const second = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');
        const materials2 = second.conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials2.content.includes('CACHED-CONTENT'), 'второй вызов использует кэш (fs не перечитан)');

        // первый вызов тоже вернул дисковый контент
        const materials1 = first.conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials1.content.includes('export const s = 2;'));
        assert.ok(path);
    });

    it('mtime изменился → перечитывает и обновляет кэш (§5.3)', async () => {
        const fsProm = (await import('fs/promises')).default;
        const path = (await import('path')).default;
        const fsSync = (await import('fs')).default;
        await fsProm.writeFile(path.join(projDir, 'src', 'chat.ts'), 'export const v2 = CHANGED;\n', 'utf-8');

        const fileId = insertRef('p/src/chat.ts', 'chat.ts');
        // сеем устаревший кэш
        getDb().prepare("UPDATE attachments SET extracted_text = 'OLD', extracted_mtime = 1000 WHERE id = ?").run(fileId);

        const { conversation } = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');
        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials.content.includes('export const v2 = CHANGED;'), 'актуальное содержимое с диска');

        const row = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);
        const stat = fsSync.statSync(path.join(baseDir, 'p/src/chat.ts'));
        assert.equal(row.extracted_mtime, stat.mtimeMs, 'extracted_mtime обновлён');
        assert.ok(row.extracted_text.includes('CHANGED'));
    });

    it('файл удалён с диска → filesMissing + блок (MISSING) в [Материалы] (§5.4)', async () => {
        const fileId = insertRef('p/src/gone.ts', 'gone.ts');
        const { conversation, info } = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');

        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials, '[Материалы] есть (MISSING-блок считается блоком)');
        assert.ok(materials.content.includes('--- FILE: gone.ts (MISSING) ---'), 'MISSING-маркер');
        assert.ok(materials.content.includes('[file not found on disk]'));
        assert.deepEqual(info.filesMissing, ['gone.ts']);
    });

    it('файл больше лимита → filesTooLarge + блок (TOO LARGE), не читается (§5.5/§3.9)', async () => {
        process.env.MAX_REFERENCE_FILE_SIZE = '10'; // chat.ts (22 байта) станет «слишком большим»
        try {
            const fileId = insertRef('p/src/chat.ts', 'chat.ts');
            const { conversation, info } = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');
            const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
            assert.ok(materials.content.includes('--- FILE: chat.ts (TOO LARGE) ---'));
            assert.deepEqual(info.filesTooLarge, ['chat.ts']);
            const row = getDb().prepare('SELECT extracted_text FROM attachments WHERE id = ?').get(fileId);
            assert.equal(row.extracted_text, '', 'содержимое не читалось и не кэшировалось');
        } finally {
            delete process.env.MAX_REFERENCE_FILE_SIZE;
        }
    });

    it('BACKLOG #6: reference .pdf → [Материалы] с ИЗВЛЕЧЁННЫМ текстом (pdfjs), не сырым utf-8; кэш обновлён', async () => {
        const fsProm = (await import('fs/promises')).default;
        const fsSync = (await import('fs')).default;
        const path = (await import('path')).default;
        const { buildMinimalPdf } = await import('../helpers/pdf-fixture.js');
        await fsProm.writeFile(path.join(projDir, 'src', 'doc.pdf'), buildMinimalPdf('Hello PDF extract'));

        const fileId = insertRef('p/src/doc.pdf', 'doc.pdf');
        const { conversation, info } = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');

        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials.content.includes('--- FILE: doc.pdf (актуальная версия) ---'), 'суффикс как у остальных reference');
        assert.ok(materials.content.includes('Hello PDF extract'), 'извлечённый текст текстового слоя');
        assert.ok(!materials.content.includes('%PDF-1.4'), 'сырой контейнер не попадает в [Материалы]');

        const row = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);
        const stat = fsSync.statSync(path.join(baseDir, 'p/src/doc.pdf'));
        assert.equal(row.extracted_mtime, stat.mtimeMs, 'mtime-кэш установлен');
        assert.ok(row.extracted_text.includes('Hello PDF extract'), 'extracted_text = извлечённый текст');
        assert.deepEqual(info.filesMissing, []);
        assert.deepEqual(info.filesTooLarge, []);
    });

    it('BACKLOG #6: reference .pdf с БИТЫМ содержимым → блок (MISSING), мусор не инлайнится', async () => {
        const fsProm = (await import('fs/promises')).default;
        const path = (await import('path')).default;
        await fsProm.writeFile(path.join(projDir, 'src', 'broken.pdf'), 'not a pdf at all');

        const fileId = insertRef('p/src/broken.pdf', 'broken.pdf');
        // сеем кэш со старым mtime, чтобы buildLLMContext пошел перечитывать с диска
        getDb().prepare("UPDATE attachments SET extracted_text = 'OLD', extracted_mtime = 1000 WHERE id = ?").run(fileId);

        const { conversation } = await sessionService.buildContext(sessionId, [{ fileId }], 65536, 80, null, 'project');
        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials.content.includes('--- FILE: broken.pdf (MISSING) ---'), 'ошибка парсинга = файл недоступен');
        assert.ok(!materials.content.includes('not a pdf'), 'сырое содержимое не инлайнится');
    });

    it('§5.7: PROJECT НЕ включает kind=document из attachments_meta прошлых Q&A', async () => {
        const fsProm = (await import('fs/promises')).default;
        const path = (await import('path')).default;
        await fsProm.writeFile(path.join(projDir, 'src', 'chat.ts'), 'export const v3 = 3;\n', 'utf-8');

        // старый RESEARCH Q&A с документом в meta (документ в реестре тоже есть)
        const db = getDb();
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, file_path, extracted_text, kind, path_base)
            VALUES ('old-doc', ?, 'old.csv', NULL, 'old,inline,content', 'document', 'context')
        `).run(sessionId);
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'старый вопрос', model: 'm', questionId: 'q_old',
            attachmentsMeta: [{ fileId: 'old-doc', name: 'old.csv' }],
        });
        messageRepo.addMessage(sessionId, {
            role: 'assistant', content: 'старый ответ', model: 'm', questionId: 'q_old',
        });

        const refId = insertRef('p/src/chat.ts', 'chat.ts');
        const { conversation } = await sessionService.buildContext(sessionId, [{ fileId: refId }], 65536, 80, null, 'project');
        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials, '[Материалы] есть (reference)');
        assert.ok(materials.content.includes('chat.ts'), 'reference включён');
        assert.ok(!materials.content.includes('old.csv'), 'старый RESEARCH-документ НЕ включён в [Материалы]');
    });

    it('RESEARCH-режим: старые document из meta по-прежнему включаются (регрессия §5.7)', async () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, file_path, extracted_text, kind, path_base)
            VALUES ('old-doc2', ?, 'old.csv', NULL, 'old,inline,content', 'document', 'context')
        `).run(sessionId);
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'вопрос', model: 'm', questionId: 'q_old2',
            attachmentsMeta: [{ fileId: 'old-doc2', name: 'old.csv' }],
        });
        messageRepo.addMessage(sessionId, {
            role: 'assistant', content: 'ответ', model: 'm', questionId: 'q_old2',
        });

        const { conversation } = await sessionService.buildContext(sessionId, [], 65536, 80, null, 'research');
        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials, '[Материалы] в research');
        assert.ok(materials.content.includes('old,inline,content'), 'document из meta инлайнится (как раньше)');
        assert.ok(!materials.content.includes('актуальная версия'), 'без project-суффикса');
    });

    it('RESEARCH: пустой extracted_text документа не порождает пустой [Материалы] (регрессия SQL-фильтра в JS)', async () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, extracted_text, kind, path_base)
            VALUES ('empty-doc', ?, 'empty.csv', '', 'document', 'context')
        `).run(sessionId);
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'в', model: 'm', questionId: 'q_e',
            attachmentsMeta: [{ fileId: 'empty-doc', name: 'empty.csv' }],
        });

        const { conversation } = await sessionService.buildContext(sessionId, [], 65536, 80, null, 'research');
        const materials = conversation.find((m) => m.content.startsWith('[Материалы]'));
        assert.equal(materials, undefined, 'пустой файл → [Материалы] не отправляется вовсе');
    });

    it('info.mode по умолчанию research (регрессия сигнатуры)', async () => {
        const { info } = await sessionService.buildContext(sessionId, [], 65536, 80, null);
        assert.equal(info.mode, 'research');
        assert.deepEqual(info.filesMissing, []);
        assert.deepEqual(info.filesTooLarge, []);
    });
});

// ============================================================
// ТЗ adaptive-context-budget (№3): адаптивный char-бюджет.
// Плотность chars/токен измеряется по последнему текстовому ответу
// (metrics.promptChars / metrics.inputTokens — пишутся с этого ТЗ),
// бюджет = ctx * density * 0.9. Фолбэк — эвристика 4 БЕЗ запаса.
// ============================================================
describe('resolveCharsPerToken: измеренная плотность (№3)', () => {
    it('нет валидных метрик → фолбэк { 4, default }', () => {
        assert.deepEqual(resolveCharsPerToken([]), { charsPerToken: 4, source: 'default' });
        assert.deepEqual(resolveCharsPerToken(null), { charsPerToken: 4, source: 'default' });
        assert.deepEqual(
            resolveCharsPerToken([{ role: 'assistant', metrics: '{}' }]),
            { charsPerToken: 4, source: 'default' },
        );
    });

    it('кириллическая метрика (2000 симв / 1000 ток) → { 2, measured }', () => {
        const messages = [
            { role: 'user', content: 'Вопрос' },
            { role: 'assistant', metrics: JSON.stringify({ promptChars: 2000, inputTokens: 1000 }) },
        ];
        assert.deepEqual(resolveCharsPerToken(messages), { charsPerToken: 2, source: 'measured' });
    });

    it('последний ход вне полосы (плотность 8) → берётся предыдущий валидный', () => {
        const messages = [
            { role: 'assistant', metrics: JSON.stringify({ promptChars: 4000, inputTokens: 1000 }) }, // 4.0 ✓
            { role: 'assistant', metrics: JSON.stringify({ promptChars: 8000, inputTokens: 1000 }) }, // 8.0 ✗
        ];
        const r = resolveCharsPerToken(messages);
        assert.equal(r.source, 'measured');
        assert.equal(r.charsPerToken, 4);
    });

    it('мусор в metrics / promptChars<=0 / inputTokens<64 — кандидаты пропускаются', () => {
        const messages = [
            { role: 'assistant', metrics: 'not-json{{' },
            { role: 'assistant', metrics: JSON.stringify({ promptChars: 0, inputTokens: 500 }) },
            { role: 'assistant', metrics: JSON.stringify({ promptChars: 2000, inputTokens: 10 }) },
            { role: 'assistant', metrics: null },
        ];
        assert.deepEqual(resolveCharsPerToken(messages), { charsPerToken: 4, source: 'default' });
    });

    it('vision-ход (без promptChars, токенизирует mmproj) пропускается — берётся текстовая метрика', () => {
        const messages = [
            { role: 'assistant', metrics: JSON.stringify({ promptChars: 2000, inputTokens: 1000 }) }, // текст
            { role: 'assistant', metrics: JSON.stringify({ inputTokens: 900, outputTokens: 50 }) },   // vision
        ];
        const r = resolveCharsPerToken(messages);
        assert.equal(r.source, 'measured');
        assert.equal(r.charsPerToken, 2);
    });
});

describe('buildLLMContext: адаптивный бюджет истории (№3)', () => {
    let sessionId;

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(() => {
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Adaptive budget').id;
    });

    function addQAPair(questionId, chars, metrics) {
        messageRepo.addMessage(sessionId, {
            role: 'user', content: 'в'.repeat(chars), model: 'm', questionId,
        });
        messageRepo.addMessage(sessionId, {
            role: 'assistant', content: 'о'.repeat(chars), model: 'm', questionId,
            ...(metrics ? { metrics } : {}),
        });
    }

    it('измеренная плотность 2 (кириллица) → бюджет ctx*2*0.9, история режется раньше чем по chars/4', async () => {
        // 4 пары по 4000 симв = 16000 симв истории; sysprompt ~700 симв.
        // measured: maxChars = 4000*2*0.9 = 7200 → target ≈ (7200-~700)*1.0
        //   (retainPercent 100) ≈ 6400 → 1 пара (8000 симв > 6400 не влезает… стоп:
        //   пара = 8000 симв > target) — 0 пар; с фолбэком 4: maxChars = 16000,
        //   target ≈ 15300 → 1 пара (8000 ≤ 15300), вторая (16000 > 15300) — нет.
        for (let i = 1; i <= 4; i++) {
            addQAPair(`q_${i}`, 4000, i === 4
                ? { promptChars: 6000, inputTokens: 3000 } // плотность 2 (repo стрингифицирует сам)
                : undefined);
        }

        const { info } = await sessionService.buildContext(sessionId, [], 4000, 100, null);
        assert.equal(info.charsPerTokenSource, 'measured');
        assert.equal(info.charsPerToken, 2);
        assert.equal(info.maxChars, Math.floor(4000 * 2 * 0.9), 'бюджет = ctx * density * 0.9');
        assert.equal(info.includedQAPairs, 0, 'при плотности 2 ни одна пара 8К симв не влезает');
    });

    it('без метрик — фолбэк 4 без запаса: maxChars = ctx*4 (поведение до ТЗ)', async () => {
        addQAPair('q_1', 100, undefined);

        const { info } = await sessionService.buildContext(sessionId, [], 4000, 100, null);
        assert.equal(info.charsPerTokenSource, 'default');
        assert.equal(info.charsPerToken, 4);
        assert.equal(info.maxChars, 16000);
        assert.equal(info.includedQAPairs, 1);
    });
});
