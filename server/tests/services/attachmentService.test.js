import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as attachmentService from '../../src/services/attachmentService.js';
import { DATA_DIR, UPLOADS_DIR, THUMBS_DIR } from '../../src/config/paths.js';

// 1×1 прозрачный PNG (валидный вход для sharp)
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

/**
 * S.3: addImageAttachment — изображение попадает в реестр attachments
 * (kind='image', path_base='data') с файлом в server/data/uploads и миниатюрой в thumbs/.
 */
describe('attachmentService.addImageAttachment (S.3)', () => {
    let sessionId;
    const createdFiles = [];

    before(() => {
        setDbPath(':memory:');
        getDb();
    });

    after(async () => {
        closeDb();
        await Promise.all(createdFiles.map((f) => fs.rm(f, { force: true })));
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Image attach test').id;
    });

    it('пишет файл + миниатюру, создаёт строку реестра, возвращает meta с URL', async () => {
        const meta = await attachmentService.addImageAttachment({
            sessionId,
            questionId: 'q_1_100',
            buffer: PNG_1PX,
            originalName: 'paste.png',
            mimetype: 'image/png',
        });
        createdFiles.push(
            path.join(UPLOADS_DIR, `${sessionId}_q_1_100.png`),
            path.join(THUMBS_DIR, `${sessionId}_q_1_100_thumb.jpg`),
        );

        // 1. meta-форма
        assert.ok(meta.fileId);
        assert.equal(meta.name, 'paste.png');
        assert.equal(meta.kind, 'image');
        assert.equal(meta.type, 'image');
        assert.equal(meta.fullUrl, `/api/attachments/${meta.fileId}/raw`);
        assert.equal(meta.thumbnailUrl, `/api/attachments/${meta.fileId}/thumb`);
        assert.ok(meta.size > 0);

        // 2. физические файлы
        const original = path.join(UPLOADS_DIR, `${sessionId}_q_1_100.png`);
        const thumb = path.join(THUMBS_DIR, `${sessionId}_q_1_100_thumb.jpg`);
        const originalStats = await fs.stat(original);
        const thumbStats = await fs.stat(thumb);
        assert.ok(originalStats.size > 0);
        assert.ok(thumbStats.size > 0, 'миниатюра создана sharp-ом');

        // 3. строка реестра
        const row = attachmentService.getAttachment(meta.fileId);
        assert.equal(row.kind, 'image');
        assert.equal(row.path_base, 'data');
        assert.equal(row.file_path, `uploads/${sessionId}_q_1_100.png`);
        assert.equal(row.extracted_text, '');
        assert.equal(row.language, 'image');
        assert.equal(row.mime_type, 'image/png');
        assert.equal(row.session_id, sessionId);
    });

    it('разные questionId не перезаписывают файлы друг друга', async () => {
        const m1 = await attachmentService.addImageAttachment({
            sessionId, questionId: 'q_1_1', buffer: PNG_1PX, originalName: 'a.png', mimetype: 'image/png',
        });
        const m2 = await attachmentService.addImageAttachment({
            sessionId, questionId: 'q_2_2', buffer: PNG_1PX, originalName: 'b.png', mimetype: 'image/png',
        });
        const f1 = path.join(UPLOADS_DIR, `${sessionId}_q_1_1.png`);
        const f2 = path.join(UPLOADS_DIR, `${sessionId}_q_2_2.png`);
        createdFiles.push(f1, f2);

        assert.notEqual(m1.fileId, m2.fileId);

        // Разные физические файлы (имя = sessionId_questionId)
        await fs.access(f1);
        await fs.access(f2);
        const row1 = attachmentService.getAttachment(m1.fileId);
        const row2 = attachmentService.getAttachment(m2.fileId);
        assert.notEqual(row1.file_path, row2.file_path);
    });

    it('имя файла санитизируется от спецсимволов sessionId/questionId', async () => {
        const meta = await attachmentService.addImageAttachment({
            sessionId, questionId: 'q_3_3', buffer: PNG_1PX, originalName: 'x.jpeg', mimetype: 'image/jpeg',
        });
        createdFiles.push(path.join(UPLOADS_DIR, `${sessionId}_q_3_3.jpeg`));

        const row = attachmentService.getAttachment(meta.fileId);
        assert.match(row.file_path, /^uploads\/[a-zA-Z0-9_-]+\.jpeg$/);
    });

    it('DATA_DIR указывает на server/data (app-managed)', () => {
        assert.ok(DATA_DIR.endsWith(path.join('server', 'data')));
    });
});
