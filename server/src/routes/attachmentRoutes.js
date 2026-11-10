// src/routes/attachmentRoutes.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import * as attachmentService from '../services/attachmentService.js';
import { DATA_DIR } from '../config/paths.js';

const router = Router();

// ТЗ attachment-cascade (2026-11-11): POST /extract демонтирован — мёртвый роут
// (не вызывался ни фронтендом, ни тестами) и создавал строки-сироты без владельца.
// Извлечение при отправке — chatHandler → attachmentService.extractFiles.

// GET /api/attachments/:fileId - Get extracted text for a file
router.get('/:fileId', (req, res) => {
    try {
        const attachment = attachmentService.getAttachment(req.params.fileId);

        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        res.json(attachment);
    } catch (error) {
        console.error('Error in GET /api/attachments/:fileId:', error);
        res.status(500).json({ error: error.message });
    }
});

// ТЗ Project mode A (§3.6): detach — удаляется ТОЛЬКО строка реестра.
// Файл на диске НЕ трогаем (orphan-политика); attachments_meta прошлых сообщений —
// иммутабельный снимок (каскада на messages нет, §3.6).
router.delete('/:fileId', (req, res) => {
    try {
        const row = attachmentService.getAttachment(req.params.fileId);
        if (!row) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        attachmentService.deleteAttachment(req.params.fileId);
        res.json({ ok: true, deletedId: req.params.fileId });
    } catch (error) {
        console.error('Error in DELETE /api/attachments/:fileId:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * S.4: раздача файла вложения по потоку (оригинал).
 * path_base='data' → server/data/<file_path>; 'context' → CONTEXT_BASE_DIR
 * (traversal-попытка → 400, отсутствие файла → 404).
 */
router.get('/:fileId/raw', (req, res) => {
    try {
        const row = attachmentService.getAttachment(req.params.fileId);
        if (!row) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        let filePath;
        try {
            filePath = attachmentService.getAttachmentPath(req.params.fileId);
        } catch (error) {
            // Path traversal / не настроен CONTEXT_BASE_DIR
            return res.status(400).json({ error: error.message });
        }

        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        fs.createReadStream(filePath).pipe(res);
    } catch (error) {
        console.error('Error in GET /api/attachments/:fileId/raw:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * S.4: раздача миниатюры изображения (только kind='image').
 * Имя миниатюры выводится из file_path: uploads/<base>.<ext> → uploads/thumbs/<base>_thumb.jpg
 */
router.get('/:fileId/thumb', (req, res) => {
    try {
        const row = attachmentService.getAttachment(req.params.fileId);
        if (!row || row.kind !== 'image' || !row.file_path) {
            return res.status(404).json({ error: 'Not an image' });
        }

        const base = path.basename(row.file_path, path.extname(row.file_path));
        const thumbPath = path.join(DATA_DIR, 'uploads', 'thumbs', `${base}_thumb.jpg`);
        if (!fs.existsSync(thumbPath)) {
            return res.status(404).json({ error: 'Thumbnail not found' });
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        fs.createReadStream(thumbPath).pipe(res);
    } catch (error) {
        console.error('Error in GET /api/attachments/:fileId/thumb:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
