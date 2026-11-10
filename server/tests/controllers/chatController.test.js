import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import { chatHandler } from '../../src/controllers/chatController.js';
import { UPLOADS_DIR, THUMBS_DIR } from '../../src/config/paths.js';

// 1×1 PNG (валидный вход для sharp в addImageAttachment)
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

/**
 * Интеграционные тесты chatHandler для Фазы B (attachments в БД).
 * multer в тесте не участвует: req.files мокается в форме diskStorage —
 * у файлов есть path, буфера НЕТ (он появляется только после чтения с диска,
 * которое и является предметом TZ-B.1).
 */

function makeRes() {
    return {
        statusCode: 200, // express default
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

function makeProvider(response = 'mock answer') {
    return {
        name: 'mock',
        detectModelType: () => 'chat',
        chat: async () => ({ response, metrics: { prompt_tokens: 1, completion_tokens: 1 } }),
    };
}

describe('chatHandler: Phase B (attachments)', () => {
    let sessionId;
    let tempDir;

    before(async () => {
        setDbPath(':memory:');
        getDb();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-b-test-'));
    });

    after(async () => {
        closeDb();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Phase B Test').id;
    });

    describe('TZ-B.1: disk storage — файл обрабатывается по пути (buffer восстанавливается с диска)', () => {
        it('processes a document given only by path (no buffer, like multer.diskStorage)', async () => {
            const csvPath = path.join(tempDir, 'report_b1.csv');
            await fs.writeFile(csvPath, 'col1,col2\na,b\nc,d\n', 'utf-8');

            const req = {
                body: { message: 'Что в файле?', model: 'test-model', sessionId, questionId: 'q_1_1' },
                files: {
                    file: [{ path: csvPath, originalname: 'report_b1.csv', mimetype: 'text/csv', size: 22 }],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();

            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
            assert.equal(res.body.response, 'mock answer');
            // удаление tmp-файла — предмет TZ-B.3 (отдельные тесты)
        });
    });

    describe('TZ-B.2: вложения сохраняются в БД (attachments) и попадают в attachments_meta с fileId', () => {
        it('document file → row in attachments + attachments_meta {fileId,name,size,type}', async () => {
            const csvPath = path.join(tempDir, 'report_b2.csv');
            await fs.writeFile(csvPath, 'name,qty\napple,3\n', 'utf-8');

            const req = {
                body: { message: 'Вопрос по файлу', model: 'test-model', sessionId, questionId: 'q_2_1' },
                files: {
                    file: [{ path: csvPath, originalname: 'report_b2.csv', mimetype: 'text/csv', size: 20 }],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            // 1. В таблице attachments появилась строка
            const rows = getDb().prepare('SELECT * FROM attachments WHERE session_id = ?').all(sessionId);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].filename, 'report_b2.csv');
            assert.ok(rows[0].extracted_text.includes('apple'), 'extracted_text должен содержать содержимое файла');

            // 2. attachments_meta user-сообщения содержит fileId и не содержит путь
            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            const meta = JSON.parse(userMsg.attachments_meta);
            assert.equal(meta.length, 1);
            assert.equal(meta[0].fileId, rows[0].id);
            assert.equal(meta[0].name, 'report_b2.csv');
            assert.equal(typeof meta[0].size, 'number');
            assert.ok(meta[0].type);
            assert.equal(meta[0].path, undefined, 'server path не должен утекать в meta');
        });

        it('codeFiles (2 files) → 2 rows in attachments + 2 fileIds in meta', async () => {
            const p1 = path.join(tempDir, 'util_b2.ts');
            const p2 = path.join(tempDir, 'main_b2.js');
            await fs.writeFile(p1, 'export const one = 1;\n', 'utf-8');
            await fs.writeFile(p2, 'console.log("two");\n', 'utf-8');

            const req = {
                body: { message: 'Проверь код', model: 'test-model', sessionId, questionId: 'q_2_2' },
                files: {
                    codeFiles: [
                        { path: p1, originalname: 'util_b2.ts', mimetype: 'text/plain', size: 20 },
                        { path: p2, originalname: 'main_b2.js', mimetype: 'text/javascript', size: 20 },
                    ],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            const rows = getDb().prepare('SELECT * FROM attachments WHERE session_id = ?').all(sessionId);
            assert.equal(rows.length, 2);

            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            const meta = JSON.parse(userMsg.attachments_meta);
            assert.equal(meta.length, 2);
            assert.deepEqual(
                new Set(meta.map((m) => m.fileId)),
                new Set(rows.map((r) => r.id)),
            );
        });

        it('no files → attachments_meta = [] (baseline contract)', async () => {
            const req = {
                body: { message: 'Простой вопрос', model: 'test-model', sessionId, questionId: 'q_2_3' },
                files: {},
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            assert.deepEqual(JSON.parse(userMsg.attachments_meta), []);

            // Ошибки экстракции конкретного файла (errors из extractFromPaths) покрыты
            // в tests/db/attachmentRepo.test.js; ветка "log + continue" в контроллере —
            // та же точка возврата, что и базовая (meta = []), см. PR-описание.
        });
    });

    describe('TZ-B.3: cleanup временных файлов в finally', () => {
        it('tmp file deleted after successful handling', async () => {
            const csvPath = path.join(tempDir, 'report_b3_ok.csv');
            await fs.writeFile(csvPath, 'a,b\n1,2\n', 'utf-8');

            const req = {
                body: { message: 'Вопрос', model: 'test-model', sessionId, questionId: 'q_3_1' },
                files: {
                    file: [{ path: csvPath, originalname: 'report_b3_ok.csv', mimetype: 'text/csv', size: 9 }],
                },
                provider: makeProvider(),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
            await assert.rejects(() => fs.access(csvPath), 'tmp-файл должен быть удалён после обработки');
        });

        it('tmp files deleted even when provider.chat fails', async () => {
            const p1 = path.join(tempDir, 'cf_b3.ts');
            const p2 = path.join(tempDir, 'cf_b3.js');
            await fs.writeFile(p1, 'export const x = 1;\n', 'utf-8');
            await fs.writeFile(p2, 'const y = 2;\n', 'utf-8');

            const failingProvider = {
                name: 'mock-fail',
                detectModelType: () => 'chat',
                chat: async () => { throw new Error('provider down'); },
            };

            const req = {
                body: { message: 'Вопрос', model: 'test-model', sessionId, questionId: 'q_3_2' },
                files: {
                    codeFiles: [
                        { path: p1, originalname: 'cf_b3.ts', mimetype: 'text/plain', size: 19 },
                        { path: p2, originalname: 'cf_b3.js', mimetype: 'text/javascript', size: 13 },
                    ],
                },
                provider: failingProvider,
                providerName: 'mock-fail',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 500, 'ошибка провайдера должна вернуть 500');
            await assert.rejects(() => fs.access(p1), 'tmp-файл 1 должен быть удалён даже при ошибке провайдера');
            await assert.rejects(() => fs.access(p2), 'tmp-файл 2 должен быть удалён даже при ошибке провайдера');
        });
    });

    describe('Финальное ТЗ: три независимые ветки + реестр изображений', () => {
        /** provider с перехватом вызова chat */
        function makeCapturingProvider(modelType, response = 'mock answer') {
            const calls = [];
            return {
                calls,
                name: 'mock-vision',
                detectModelType: () => modelType,
                chat: async (payload) => {
                    calls.push(payload);
                    return { response, metrics: { prompt_tokens: 1, completion_tokens: 1 } };
                },
            };
        }

        beforeEach(() => {
            getDb().exec('DELETE FROM attachments');
        });

        it('2.0.1a: картинка + 2 codeFiles — vision-ветка НЕ теряет код (все три в реестре и meta)', async () => {
            const imgPath = path.join(tempDir, 'shot_tz.png');
            const c1 = path.join(tempDir, 'util_tz.ts');
            const c2 = path.join(tempDir, 'main_tz.js');
            await fs.writeFile(imgPath, PNG_1PX);
            await fs.writeFile(c1, 'export const one = 1;\n', 'utf-8');
            await fs.writeFile(c2, 'console.log("two");\n', 'utf-8');

            const provider = makeCapturingProvider('vision');
            const req = {
                body: { message: 'Что на картинке и в коде?', model: 'vision-model', sessionId, questionId: 'q_5_1' },
                files: {
                    file: [{ path: imgPath, originalname: 'shot_tz.png', mimetype: 'image/png', size: PNG_1PX.length }],
                    codeFiles: [
                        { path: c1, originalname: 'util_tz.ts', mimetype: 'text/plain', size: 20 },
                        { path: c2, originalname: 'main_tz.js', mimetype: 'text/javascript', size: 19 },
                    ],
                },
                provider,
                providerName: 'mock-vision',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            // 1. Все три вложения в реестре: 1 image + 2 code
            const rows = getDb().prepare('SELECT * FROM attachments WHERE session_id = ?').all(sessionId);
            assert.equal(rows.length, 3);
            const kinds = rows.map((r) => r.kind).sort();
            assert.deepEqual(kinds, ['code', 'code', 'image']);

            const imageRow = rows.find((r) => r.kind === 'image');
            assert.equal(imageRow.path_base, 'data');
            assert.equal(imageRow.extracted_text, '');
            assert.ok(imageRow.file_path.startsWith('uploads/'), 'file_path относительно server/data/');
            const originalPath = path.join(UPLOADS_DIR, path.basename(imageRow.file_path));
            const thumbPath = path.join(THUMBS_DIR, `${path.basename(imageRow.file_path, '.png')}_thumb.jpg`);
            await fs.access(originalPath); // оригинал на диске
            await fs.access(thumbPath);    // миниатюра на диске

            // 2. meta user-сообщения содержит все три с kind
            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            const meta = JSON.parse(userMsg.attachments_meta);
            assert.equal(meta.length, 3);
            assert.deepEqual(meta.map((m) => m.kind).sort(), ['code', 'code', 'image']);
            assert.ok(meta.every((m) => m.fileId));

            // 3. Vision-ветка использует buildLLMContext: один system + [Материалы] с кодом + [Вопрос] с images
            assert.equal(provider.calls.length, 1);
            const visionPayload = provider.calls[0];
            const vm = visionPayload.messages;
            assert.equal(vm.filter((m) => m.role === 'system').length, 1, 'ровно один system (sysprompt применён)');
            const vMaterials = vm.find((m) => m.role === 'user' && m.content.startsWith('[Материалы]'));
            assert.ok(vMaterials, '[Материалы] присутствует в vision-контексте');
            assert.ok(vMaterials.content.includes('console.log("two")'), 'текст кода вошёл в [Материалы]');
            const vLast = vm.at(-1);
            assert.equal(vLast.role, 'user');
            assert.ok(vLast.content.startsWith('[Вопрос]'), 'последнее сообщение — [Вопрос]');
            assert.ok(vLast.content.includes('Что на картинке и в коде?'), 'текст вопроса внутри [Вопрос]');
            assert.ok(Array.isArray(vLast.images) && vLast.images.length === 1, 'images крепятся к [Вопрос], а не к system');

            // 4. Ответ: imageData из meta (legacy-shape для фронта)
            assert.ok(res.body.imageData);
            assert.equal(res.body.imageData.fullUrl, `/api/attachments/${imageRow.id}/raw`);
            assert.equal(res.body.imageData.thumbnailUrl, `/api/attachments/${imageRow.id}/thumb`);
            assert.equal(res.body.imageData.filename, 'shot_tz.png');
            assert.ok(Array.isArray(res.body.attachmentsMeta));

            // Очистка app-managed файлов этого теста
            await fs.rm(originalPath, { force: true });
            await fs.rm(thumbPath, { force: true });
        });

        it('2.0.1b: документ + 2 codeFiles + текст — все обработаны, порядок документ → код → текст', async () => {
            const docPath = path.join(tempDir, 'report_tz.csv');
            const c1 = path.join(tempDir, 'a_tz.ts');
            const c2 = path.join(tempDir, 'b_tz.js');
            await fs.writeFile(docPath, 'col1,col2\na,b\n', 'utf-8');
            await fs.writeFile(c1, 'const alpha = 1;\n', 'utf-8');
            await fs.writeFile(c2, 'const beta = 2;\n', 'utf-8');

            const provider = makeCapturingProvider('chat');
            const req = {
                body: { message: 'СУПЕРТЕКСТ', model: 'chat-model', sessionId, questionId: 'q_5_2' },
                files: {
                    file: [{ path: docPath, originalname: 'report_tz.csv', mimetype: 'text/csv', size: 18 }],
                    codeFiles: [
                        { path: c1, originalname: 'a_tz.ts', mimetype: 'text/plain', size: 17 },
                        { path: c2, originalname: 'b_tz.js', mimetype: 'text/javascript', size: 16 },
                    ],
                },
                provider,
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

            // 1. Три записи в реестре: 1 document + 2 code
            const rows = getDb().prepare('SELECT * FROM attachments WHERE session_id = ?').all(sessionId);
            assert.equal(rows.length, 3);
            assert.deepEqual(rows.map((r) => r.kind).sort(), ['code', 'code', 'document']);

            // 2. ТЗ one-system: message без инлайна — [Материалы] содержит документ и код
            // (сырой extracted_text из реестра), [Вопрос] — ровно текст пользователя
            const cm = provider.calls[0].messages;
            const materials = cm.find((m) => m.role === 'user' && m.content.startsWith('[Материалы]'));
            assert.ok(materials, '[Материалы] присутствует');
            const matDoc = materials.content.indexOf('--- FILE: report_tz.csv ---');
            const matCode = materials.content.indexOf('--- FILE: a_tz.ts ---');
            assert.ok(matDoc !== -1, 'документ в [Материалы] (сырой extracted_text)');
            assert.ok(matCode !== -1, 'код в [Материалы]');
            const lastMsg = cm.at(-1);
            assert.equal(lastMsg.content, '[Вопрос]\nСУПЕРТЕКСТ', '[Вопрос] — только текст пользователя, без инлайна файлов');

            // 3. meta — 3 записи
            const userMsg = getDb()
                .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
                .get(sessionId);
            assert.equal(JSON.parse(userMsg.attachments_meta).length, 3);
        });

        it('картинка + не-vision модель → 400', async () => {
            const imgPath = path.join(tempDir, 'shot_400.png');
            await fs.writeFile(imgPath, PNG_1PX);

            const req = {
                body: { message: '?', model: 'chat-model', sessionId, questionId: 'q_5_3' },
                files: {
                    file: [{ path: imgPath, originalname: 'shot_400.png', mimetype: 'image/png', size: PNG_1PX.length }],
                },
                provider: makeCapturingProvider('chat'),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 400);
            assert.match(res.body.error, /vision/i);
        });

        it('imageData === undefined, когда картинки нет (обычный chat)', async () => {
            const req = {
                body: { message: 'Простой вопрос', model: 'chat-model', sessionId, questionId: 'q_5_4' },
                files: {},
                provider: makeCapturingProvider('chat'),
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.imageData, undefined);
        });

        it('2.0.3: chat-ветка — system + [Ранее] с историей + [Вопрос] с текстом', async () => {
            // сеем историю: одна Q&A пара
            const provider = makeCapturingProvider('chat');
            const firstReq = {
                body: { message: 'Первый вопрос сессии', model: 'chat-model', sessionId, questionId: 'q_5_5a' },
                files: {},
                provider,
                providerName: 'mock',
            };
            await chatHandler(firstReq, makeRes());

            const secondReq = {
                body: { message: 'Второй вопрос сессии', model: 'chat-model', sessionId, questionId: 'q_5_5b' },
                files: {},
                provider,
                providerName: 'mock',
            };
            const res = makeRes();
            await chatHandler(secondReq, res);

            assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
            const cm = provider.calls.at(-1).messages;
            assert.equal(cm.filter((m) => m.role === 'system').length, 1, 'ровно один system');
            assert.ok(cm.some((m) => m.role === 'user' && m.content === '[Ранее в этой сессии]'), 'маркер [Ранее] присутствует');
            assert.ok(cm.some((m) => m.role === 'user' && m.content === 'Первый вопрос сессии'), 'история предыдущих Q&A в контексте');
            assert.equal(cm.at(-1).content, '[Вопрос]\nВторой вопрос сессии', 'последнее сообщение — [Вопрос] с текстом');
        });
    });
});

// ============================================================
// ТЗ attachment-cascade: claim строк реестра сообщением + cleanup при провале
// ============================================================
describe('chatHandler: ТЗ attachment-cascade — claim строк реестра + cleanup при провале', () => {
    let sessionId;
    let tempDir;

    before(async () => {
        setDbPath(':memory:');
        getDb();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claim-test-'));
    });

    after(async () => {
        closeDb();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Claim Test').id;
    });

    it('успешная RESEARCH-отправка: message_id всех строк = id user-сообщения (каскад готов)', async () => {
        const csvPath = path.join(tempDir, 'report_claim.csv');
        await fs.writeFile(csvPath, 'name,qty\napple,3\n', 'utf-8');

        const req = {
            body: { message: 'Вопрос по файлу', model: 'test-model', sessionId, questionId: 'q_c1' },
            files: {
                file: [{ path: csvPath, originalname: 'report_claim.csv', mimetype: 'text/csv', size: 20 }],
            },
            provider: makeProvider(),
            providerName: 'mock',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

        const rows = getDb().prepare('SELECT id, message_id FROM attachments WHERE session_id = ?').all(sessionId);
        assert.equal(rows.length, 1);
        assert.ok(rows[0].message_id, 'message_id проставлен после отправки');

        const userMsg = getDb()
            .prepare("SELECT id FROM messages WHERE session_id = ? AND role = 'user'")
            .get(sessionId);
        assert.equal(rows[0].message_id, userMsg.id, 'строки клеймятся на user-сообщение');
    });

    it('провал провайдера: строк реестра не остаётся (реестр не копит балласт)', async () => {
        const csvPath = path.join(tempDir, 'report_fail.csv');
        await fs.writeFile(csvPath, 'a,b\n1,2\n', 'utf-8');

        const failingProvider = {
            name: 'mock-fail',
            detectModelType: () => 'chat',
            chat: async () => { throw new Error('provider down'); },
        };
        const req = {
            body: { message: 'Вопрос', model: 'test-model', sessionId, questionId: 'q_c2' },
            files: {
                file: [{ path: csvPath, originalname: 'report_fail.csv', mimetype: 'text/csv', size: 9 }],
            },
            provider: failingProvider,
            providerName: 'mock-fail',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 500, 'ошибка провайдера должна вернуть 500');
        const count = getDb().prepare('SELECT COUNT(*) AS c FROM attachments WHERE session_id = ?').get(sessionId);
        assert.equal(count.c, 0, 'незаклеймлённые строки текущей отправки удалены из реестра');
    });

    it('vision-успех: image-строка заклеймлена на user-сообщение, файлы остаются на диске', async () => {
        const imgPath = path.join(tempDir, 'shot_claim.png');
        await fs.writeFile(imgPath, PNG_1PX);

        const visionProvider = {
            name: 'mock-vision',
            detectModelType: () => 'vision',
            chat: async () => ({ response: 'mock answer', metrics: { prompt_tokens: 1, completion_tokens: 1 } }),
        };
        const req = {
            body: { message: 'Что на картинке?', model: 'vision-model', sessionId, questionId: 'q_c3' },
            files: {
                file: [{ path: imgPath, originalname: 'shot_claim.png', mimetype: 'image/png', size: PNG_1PX.length }],
            },
            provider: visionProvider,
            providerName: 'mock-vision',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

        const imageRow = getDb()
            .prepare("SELECT id, message_id, file_path FROM attachments WHERE session_id = ? AND kind = 'image'")
            .get(sessionId);
        assert.ok(imageRow, 'image-строка в реестре');
        const userMsg = getDb()
            .prepare("SELECT id FROM messages WHERE session_id = ? AND role = 'user'")
            .get(sessionId);
        assert.equal(imageRow.message_id, userMsg.id, 'image-строка заклеймлена на user-сообщение');

        // orphan-политика файлов: оригинал остаётся на диске
        const originalPath = path.join(UPLOADS_DIR, path.basename(imageRow.file_path));
        const thumbPath = path.join(THUMBS_DIR, `${path.basename(imageRow.file_path, '.png')}_thumb.jpg`);
        await fs.access(originalPath);
        await fs.access(thumbPath);

        // очистка app-managed файлов этого теста
        await fs.rm(originalPath, { force: true });
        await fs.rm(thumbPath, { force: true });
    });
});

// ============================================================
// ТЗ Project mode A (§3.8, §6.1): PROJECT-ветка chatHandler
// ============================================================
describe('chatHandler: PROJECT-ветка (ТЗ Project mode A)', () => {
    let sessionId;
    let baseDir;
    let projDir;
    let tempDir;

    /** provider с перехватом вызова chat */
    function makeCapturingProvider(response = 'mock answer') {
        const calls = [];
        return {
            calls,
            name: 'mock-project',
            detectModelType: () => 'chat',
            chat: async (payload) => {
                calls.push(payload);
                return { response, metrics: { prompt_tokens: 1, completion_tokens: 1 } };
            },
        };
    }

    before(async () => {
        const fsProm = (await import('fs/promises')).default;
        const os = (await import('os')).default;
        const path = (await import('path')).default;
        tempDir = await fsProm.mkdtemp(path.join(os.tmpdir(), 'proj-chat-tmp-'));
        baseDir = await fsProm.mkdtemp(path.join(os.tmpdir(), 'proj-chat-base-'));
        process.env.CONTEXT_BASE_DIR = baseDir;
        projDir = path.join(baseDir, 'app');
        await fsProm.mkdir(path.join(projDir, 'src'), { recursive: true });
        await fsProm.writeFile(path.join(projDir, 'src', 'chat.ts'), 'export function chat() {}\n', 'utf-8');
        await fsProm.writeFile(path.join(projDir, 'src', 'store.ts'), 'export const store = {};\n', 'utf-8');
        await fsProm.writeFile(path.join(projDir, 'README.md'), '# app\n', 'utf-8');
    });

    after(async () => {
        const fsProm = (await import('fs/promises')).default;
        await fsProm.rm(baseDir, { recursive: true, force: true });
        await fsProm.rm(tempDir, { recursive: true, force: true });
        delete process.env.CONTEXT_BASE_DIR;
    });

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(() => closeDb());

    beforeEach(async () => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        // PROJECT-сессия с 3 reference (фикстура §5.2 шагов 11-12)
        sessionId = sessionRepo.createSession('Proj chat', 'project').id;
        const db = getDb();
        const refs = [
            ['app/src/chat.ts', 'chat.ts', 'typescript'],
            ['app/src/store.ts', 'store.ts', 'typescript'],
            ['app/README.md', 'README.md', 'markdown'],
        ];
        for (const [filePath, filename, language] of refs) {
            db.prepare(`
                INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language, kind, path_base, extracted_mtime)
                VALUES (?, ?, ?, ?, 'text/plain', 25, '', ?, 'reference', 'context', NULL)
            `).run(`ref-${filename}`, sessionId, filename, filePath, language);
        }
    });

    it('PROJECT: currentAttachments = 3 reference → [Материалы] (актуальная версия, с диска) + meta + contextInfo (§5.2)', async () => {
        const provider = makeCapturingProvider();
        const req = {
            body: { message: 'Как устроен chat.ts?', model: 'test-model', sessionId, questionId: 'q_p1' },
            files: {},
            provider,
            providerName: 'mock-project',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

        // 1. промпт: один system + [Материалы] с диска + [Вопрос]
        const cm = provider.calls[0].messages;
        assert.equal(cm.filter((m) => m.role === 'system').length, 1);
        const materials = cm.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials, '[Материалы] присутствует');
        assert.ok(materials.content.includes('--- FILE: chat.ts (актуальная версия) ---'), 'project-суффикс');
        assert.ok(materials.content.includes('export function chat() {}'), 'контент прочитан с диска');
        assert.ok(materials.content.includes('--- FILE: README.md (актуальная версия) ---'), 'все 3 reference в [Материалы]');
        assert.equal(cm.at(-1).content, '[Вопрос]\nКак устроен chat.ts?');

        // 2. mtime-кэш обновлён
        const row = getDb().prepare("SELECT extracted_text, extracted_mtime FROM attachments WHERE id = 'ref-chat.ts'").get();
        assert.ok(row.extracted_text.includes('export function chat()'));
        assert.ok(row.extracted_mtime > 0);

        // 3. attachments_meta сообщения — 3 reference (снимок §3.8.4)
        const userMsg = getDb()
            .prepare("SELECT attachments_meta FROM messages WHERE session_id = ? AND role = 'user'")
            .get(sessionId);
        const meta = JSON.parse(userMsg.attachments_meta);
        assert.equal(meta.length, 3);
        assert.ok(meta.every((m) => m.kind === 'reference' && m.fileId));

        // 4. contextInfo: mode/filesAttached/filesMissing/filesTooLarge (§3.8.6)
        assert.equal(res.body.contextInfo.mode, 'project');
        assert.equal(res.body.contextInfo.filesAttached, 3);
        assert.deepEqual(res.body.contextInfo.filesMissing, []);
        assert.deepEqual(res.body.contextInfo.filesTooLarge, []);
        // контракт info.* не изменён
        assert.ok('excludedIndices' in res.body);
        assert.ok('totalQAPairs' in res.body.contextInfo);
    });

    it('ТЗ attachment-cascade: PROJECT-отправка не клеймит reference (message_id NULL — пул сессии)', async () => {
        const provider = makeCapturingProvider();
        const req = {
            body: { message: 'Как устроен chat.ts?', model: 'test-model', sessionId, questionId: 'q_pclaim' },
            files: {},
            provider,
            providerName: 'mock-project',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);

        const refs = getDb().prepare('SELECT id, message_id FROM attachments WHERE session_id = ?').all(sessionId);
        assert.equal(refs.length, 3);
        assert.ok(refs.every((r) => r.message_id === null),
            'reference — пул сессии: не клеймится, удаление сообщения их не каскадит');
    });

    it('PROJECT: file/codeFiles → 400 (§10.1)', async () => {
        const csvPath = path.join(tempDir, 'x.csv');
        await fs.writeFile(csvPath, 'a,b\n', 'utf-8');

        const provider = makeCapturingProvider();
        const req = {
            body: { message: '?', model: 'test-model', sessionId, questionId: 'q_p2' },
            files: {
                file: [{ path: csvPath, originalname: 'x.csv', mimetype: 'text/csv', size: 4 }],
            },
            provider,
            providerName: 'mock-project',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.error, /attach/i);
        assert.equal(provider.calls.length, 0, 'провайдер не вызывается');
        await assert.rejects(() => fs.access(csvPath), 'tmp-файл удалён в finally');
    });

    it('PROJECT: удалённый с диска reference → filesMissing в contextInfo (§5.4)', async () => {
        await fs.rm(path.join(projDir, 'src', 'store.ts'));

        const provider = makeCapturingProvider();
        const req = {
            body: { message: '?', model: 'test-model', sessionId, questionId: 'q_p3' },
            files: {},
            provider,
            providerName: 'mock-project',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.contextInfo.filesMissing, ['store.ts']);
        const cm = provider.calls[0].messages;
        const materials = cm.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials.content.includes('--- FILE: store.ts (MISSING) ---'));
    });

    it('RESEARCH: file/codeFiles по-прежнему работают (регрессия ветки)', async () => {
        const researchSession = sessionRepo.createSession('Research', 'research').id;
        const csvPath = path.join(tempDir, 'y.csv');
        await fs.writeFile(csvPath, 'col1,col2\na,b\n', 'utf-8');

        const provider = makeCapturingProvider();
        const req = {
            body: { message: 'Данные?', model: 'test-model', sessionId: researchSession, questionId: 'q_p4' },
            files: {
                file: [{ path: csvPath, originalname: 'y.csv', mimetype: 'text/csv', size: 18 }],
            },
            provider,
            providerName: 'mock-project',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.contextInfo.mode, 'research');
        const cm = provider.calls[0].messages;
        const materials = cm.find((m) => m.content.startsWith('[Материалы]'));
        assert.ok(materials, 'document инлайнится в research');
        assert.ok(!materials.content.includes('актуальная версия'), 'без project-суффикса');
    });

    it('legacy mode=chat трактуется как research (картинка-ветка недоступна, файлы работают)', async () => {
        const legacySession = sessionRepo.createSession('Legacy', 'chat').id;
        const csvPath = path.join(tempDir, 'z.csv');
        await fs.writeFile(csvPath, 'a,b\n', 'utf-8');

        const provider = makeCapturingProvider();
        const req = {
            body: { message: 'Q', model: 'test-model', sessionId: legacySession, questionId: 'q_p5' },
            files: {
                file: [{ path: csvPath, originalname: 'z.csv', mimetype: 'text/csv', size: 4 }],
            },
            provider,
            providerName: 'mock-project',
        };
        const res = makeRes();
        await chatHandler(req, res);

        assert.equal(res.statusCode, 200, 'legacy chat-сессия принимает multipart (research-поведение)');
        assert.equal(res.body.contextInfo.mode, 'research');
    });
});
