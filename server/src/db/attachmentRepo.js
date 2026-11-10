// src/db/attachmentRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { resolveAttachmentPath } from '../config/paths.js';
import { extractText } from '../utils/docExtract.js';

const languageMap = {
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.html': 'html', '.css': 'css', '.json': 'json',
    '.md': 'markdown', '.txt': 'text',
    '.csv': 'text', '.yml': 'text', '.yaml': 'text', '.sh': 'text',
    '.sql': 'text', '.toml': 'text', '.ini': 'text'
};

const mimeTypeMap = {
    '.js': 'text/javascript', '.jsx': 'text/javascript',
    '.ts': 'text/typescript', '.tsx': 'text/typescript',
    '.py': 'text/x-python', '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css',
    '.md': 'text/markdown', '.txt': 'text/plain',
    '.csv': 'text/csv', '.yml': 'text/plain', '.yaml': 'text/plain',
    '.go': 'text/x-go', '.rs': 'text/x-rust', '.java': 'text/x-java',
    '.c': 'text/x-csrc', '.cpp': 'text/x-c++src', '.h': 'text/x-csrc', '.hpp': 'text/x-c++src',
    '.sh': 'text/x-shellscript', '.sql': 'text/x-sql'
};

function detectLanguage(ext) {
    return languageMap[ext] || 'text';
}

function getMimeType(ext) {
    return mimeTypeMap[ext] || 'text/plain';
}

// ТЗ Project mode A (§3.4/§3.5): маппинги расширений переиспользуются
// проектным browse/attach — экспортируем.
export { detectLanguage, getMimeType };

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
            // BACKLOG #6: Buffer без encoding — extractText решает парсер по расширению
            // (.pdf → pdfjs, .doc/.docx → word-extractor, .xls/.xlsx/.csv → xlsx, прочее → utf-8).
            // Раньше (до демонтажа fileService в PR #16) здесь был utf-8: PDF в
            // extracted_text превращался в сырой байтовый поток и уходил в [Материалы].
            const buffer = await fs.readFile(filePath);
            const extracted = await extractText(buffer, path.basename(filePath));
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
                extractedText: extracted,
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

/**
 * ТЗ Project mode A (§3.6): detach — удаляется ТОЛЬКО строка реестра.
 * Файл на диске не трогается (orphan-политика); attachments_meta прошлых
 * сообщений — иммутабельный снимок, не пересчитывается.
 * @returns {boolean} true, если строка существовала и удалена
 */
export function deleteAttachment(fileId) {
    const res = getDb().prepare('DELETE FROM attachments WHERE id = ?').run(fileId);
    return res.changes > 0;
}

/**
 * ТЗ Project mode A (§3.7/§3.8): список вложений сессии по kind
 * (reference — текущий пул PROJECT-файлов).
 */
export function listBySessionAndKind(sessionId, kind = 'reference') {
    return getDb().prepare(
        "SELECT * FROM attachments WHERE session_id = ? AND kind = ? ORDER BY created_at ASC"
    ).all(sessionId, kind);
}

/**
 * ТЗ Project mode A (§3.5): идемпотентность attach — reference сессии по file_path.
 */
export function findReferenceByPath(sessionId, filePath) {
    return getDb().prepare(
        "SELECT id FROM attachments WHERE session_id = ? AND file_path = ? AND kind = 'reference'"
    ).get(sessionId, filePath);
}