// src/services/attachmentService.js
import sharp from 'sharp';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import * as attachmentRepo from '../db/attachmentRepo.js';
import { UPLOADS_DIR, THUMBS_DIR } from '../config/paths.js';

export async function extractFiles(paths, sessionId, kind = 'document') {
    return await attachmentRepo.extractFromPaths(paths, sessionId, kind);
}

export function getAttachment(fileId) {
    return attachmentRepo.getAttachment(fileId);
}

export function getAttachmentsByIds(fileIds) {
    return attachmentRepo.getAttachmentsByIds(fileIds);
}

export function getAttachmentPath(fileId) {
    return attachmentRepo.getAttachmentPath(fileId);
}

// ТЗ Project mode A (§3.6): detach — только строка реестра, файл на диске не трогаем.
export function deleteAttachment(fileId) {
    return attachmentRepo.deleteAttachment(fileId);
}

// ТЗ Project mode A (§3.8): список вложений сессии по kind (reference — пул PROJECT).
export function listSessionAttachments(sessionId, kind = 'reference') {
    return attachmentRepo.listBySessionAndKind(sessionId, kind);
}

/**
 * S.3: сохранить clipboard/загруженное изображение в единый реестр.
 *
 * Файл пишется в server/data/uploads/<sessionId>_<questionId>.<ext> (path_base='data'),
 * миниатюра — в server/data/uploads/thumbs/<...>_thumb.jpg (sharp, 150×150 — как раньше).
 * Строка в attachments: kind='image', extracted_text='' (контент не инлайнится в LLM-контекст).
 * Vision-модель по-прежнему получает base64 из буфера (логика модели не меняется).
 *
 * @returns {Promise<{fileId, name, size, type, kind, fullUrl, thumbnailUrl}>} — форма для attachments_meta
 */
export async function addImageAttachment({ sessionId, questionId, buffer, originalName, mimetype }) {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(THUMBS_DIR, { recursive: true });

    const ext = (path.extname(originalName || '').toLowerCase()) || '.png';
    const base = `${sessionId}_${questionId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${base}${ext}`;
    const thumbName = `${base}_thumb.jpg`;

    const fullPath = path.join(UPLOADS_DIR, fileName);
    const thumbPath = path.join(THUMBS_DIR, thumbName);

    await fs.writeFile(fullPath, buffer);
    await sharp(buffer)
        .resize(150, 150, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

    const fileId = crypto.randomUUID();
    const stats = await fs.stat(fullPath);

    attachmentRepo.insertAttachment({
        id: fileId,
        sessionId,
        filename: originalName,
        filePath: `uploads/${fileName}`,
        mimeType: mimetype,
        fileSize: stats.size,
        extractedText: '',
        language: 'image',
        kind: 'image',
        pathBase: 'data',
    });

    return {
        fileId,
        name: originalName,
        size: stats.size,
        type: 'image',
        kind: 'image',
        fullUrl: `/api/attachments/${fileId}/raw`,
        thumbnailUrl: `/api/attachments/${fileId}/thumb`,
    };
}
