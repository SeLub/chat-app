import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as attachmentRepo from '../../src/db/attachmentRepo.js';
import attachmentRoutes from '../../src/routes/attachmentRoutes.js';
import { UPLOADS_DIR, THUMBS_DIR } from '../../src/config/paths.js';

/**
 * S.4: раздача файлов реестра — GET /api/attachments/:fileId/raw|thumb.
 * Реальный express-сервер на эфемерном порту + fetch (глобален в Node 18+).
 */
describe('attachmentRoutes: /raw и /thumb (S.4)', () => {
    let app;
    let server;
    let baseUrl;
    let sessionId;
    const createdFiles = [];

    before(async () => {
        setDbPath(':memory:');
        getDb();

        app = express();
        app.use('/api/attachments', attachmentRoutes);
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
        closeDb();
        await Promise.all(createdFiles.map((f) => fs.rm(f, { force: true })));
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Routes test').id;
    });

    async function createImageAttachment() {
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
        );
        await fs.mkdir(UPLOADS_DIR, { recursive: true });
        await fs.mkdir(THUMBS_DIR, { recursive: true });

        const fileId = crypto.randomUUID();
        const fileName = `${fileId}.png`;
        const thumbName = `${fileId}_thumb.jpg`;
        await fs.writeFile(path.join(UPLOADS_DIR, fileName), png);
        await fs.writeFile(path.join(THUMBS_DIR, thumbName), Buffer.from('fake-jpeg'));
        createdFiles.push(path.join(UPLOADS_DIR, fileName), path.join(THUMBS_DIR, thumbName));

        attachmentRepo.insertAttachment({
            id: fileId,
            sessionId,
            filename: 'paste.png',
            filePath: `uploads/${fileName}`,
            mimeType: 'image/png',
            fileSize: png.length,
            extractedText: '',
            language: 'image',
            kind: 'image',
            pathBase: 'data',
        });
        return fileId;
    }

    it('raw отдаёт оригинал с mime_type и Cache-Control', async () => {
        const fileId = await createImageAttachment();

        const res = await fetch(`${baseUrl}/api/attachments/${fileId}/raw`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/png');
        assert.ok(res.headers.get('cache-control').includes('max-age=31536000'));
        const body = Buffer.from(await res.arrayBuffer());
        assert.equal(body[0], 0x89, 'PNG-сигнатура (байты отдаются как есть)');
    });

    it('thumb отдаёт миниатюру изображения как image/jpeg', async () => {
        const fileId = await createImageAttachment();

        const res = await fetch(`${baseUrl}/api/attachments/${fileId}/thumb`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'fake-jpeg');
    });

    it('thumb для не-изображения → 404', async () => {
        const docId = crypto.randomUUID();
        attachmentRepo.insertAttachment({
            id: docId, sessionId, filename: 'doc.csv',
            filePath: null, extractedText: 'a,b', kind: 'document', pathBase: 'context',
        });

        const res = await fetch(`${baseUrl}/api/attachments/${docId}/thumb`);
        assert.equal(res.status, 404);
    });

    it('raw несуществующего fileId → 404', async () => {
        const res = await fetch(`${baseUrl}/api/attachments/nonexistent/raw`);
        assert.equal(res.status, 404);
    });

    it('raw отсутствующего физического файла → 404', async () => {
        const fileId = crypto.randomUUID();
        attachmentRepo.insertAttachment({
            id: fileId, sessionId, filename: 'lost.png',
            filePath: 'uploads/ghost.png', extractedText: '',
            kind: 'image', pathBase: 'data',
        });

        const res = await fetch(`${baseUrl}/api/attachments/${fileId}/raw`);
        assert.equal(res.status, 404);
    });

    it('traversal в path_base=context → 400 (критерий приёмки)', async () => {
        const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctx-routes-'));
        process.env.CONTEXT_BASE_DIR = baseDir;
        try {
            const fileId = crypto.randomUUID();
            attachmentRepo.insertAttachment({
                id: fileId, sessionId, filename: 'evil',
                filePath: '../etc/passwd', extractedText: '',
                kind: 'reference', pathBase: 'context',
            });

            const res = await fetch(`${baseUrl}/api/attachments/${fileId}/raw`);
            assert.equal(res.status, 400);
            const body = await res.json();
            assert.match(body.error, /traversal/i);
        } finally {
            delete process.env.CONTEXT_BASE_DIR;
            await fs.rm(baseDir, { recursive: true, force: true });
        }
    });

    it('path_base=context без CONTEXT_BASE_DIR → 400', async () => {
        delete process.env.CONTEXT_BASE_DIR;
        const fileId = crypto.randomUUID();
        attachmentRepo.insertAttachment({
            id: fileId, sessionId, filename: 'proj.ts',
            filePath: 'zoog/main.ts', extractedText: '',
            kind: 'reference', pathBase: 'context',
        });

        const res = await fetch(`${baseUrl}/api/attachments/${fileId}/raw`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.match(body.error, /CONTEXT_BASE_DIR/);
    });

    it('ТЗ attachment-cascade: мёртвый POST /extract демонтирован → 404 (строки-сироты больше не создаются)', async () => {
        const res = await fetch(`${baseUrl}/api/attachments/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: ['/tmp/x.csv'], sessionId }),
        });
        assert.equal(res.status, 404);
        const count = getDb().prepare('SELECT COUNT(*) AS c FROM attachments WHERE session_id = ?').get(sessionId);
        assert.equal(count.c, 0);
    });
});
