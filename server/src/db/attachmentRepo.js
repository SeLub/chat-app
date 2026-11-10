// src/db/attachmentRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { resolveAttachmentPath } from '../config/paths.js';

const languageMap = {
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.html': 'html', '.css': 'css', '.json': 'json',
    '.md': 'markdown', '.txt': 'text'
};

const mimeTypeMap = {
    '.js': 'text/javascript', '.ts': 'text/typescript',
    '.py': 'text/x-python', '.json': 'application/json'
};

function detectLanguage(ext) {
    return languageMap[ext] || 'text';
}

function getMimeType(ext) {
    return mimeTypeMap[ext] || 'text/plain';
}

/**
 * Вставить строку вложения с полным набором колонок (S.2 реестра).
 * Изображения: kind='image', pathBase='data', filePath='uploads/<имя>' (относительно server/data/),
 * extractedText='' (контент не инлайнится — contextBuilder фильтрует).
 * Документы/код (RESEARCH): kind='document'|'code', filePath=null (tmp-файл удаляется после extract).
 */
export function insertAttachment({ id, sessionId, filename, filePath = null, mimeType = null, fileSize = null, extractedText, language = null, kind = 'document', pathBase = 'context' }) {
    getDb().prepare(`
        INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language, kind, path_base)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, filename, filePath, mimeType, fileSize, extractedText, language, kind, pathBase);
}

export async function extractFromPaths(paths, sessionId, kind = 'document') {
    const db = getDb();
    const results = [];
    const errors = [];

    for (const filePath of paths) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const fileId = crypto.randomUUID();
            const filename = path.basename(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const language = detectLanguage(ext);
            const stats = await fs.stat(filePath);

            insertAttachment({
                id: fileId,
                sessionId,
                filename,
                filePath: null, // RESEARCH: файл временный, удаляется после extract — путь не храним
                mimeType: getMimeType(ext),
                fileSize: stats.size,
                extractedText: content,
                language,
                kind,
                pathBase: 'context',
            });

            results.push({
                fileId,
                name: filename,
                size: stats.size,
                type: language,
                kind,
                path: filePath
            });
        } catch (error) {
            errors.push({
                path: filePath,
                error: error.message
            });
        }
    }

    return { results, errors };
}

export function getAttachment(fileId) {
    return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);
}

/**
 * Резолв физического пути файла вложения (S.4: раздача /raw).
 * path_base='data' → server/data/<file_path>; 'context' → CONTEXT_BASE_DIR (traversal → throw).
 * @returns {string|null} абсолютный путь или null
 */
export function getAttachmentPath(fileId) {
    const row = getAttachment(fileId);
    if (!row) return null;
    return resolveAttachmentPath(row);
}

export function getAttachmentsByIds(fileIds) {
    if (fileIds.length === 0) return [];
    const placeholders = fileIds.map(() => '?').join(',');
    return getDb().prepare(
        `SELECT * FROM attachments WHERE id IN (${placeholders})`
    ).all(...fileIds);
}