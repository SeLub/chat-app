// src/db/attachmentRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

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

export async function extractFromPaths(paths, sessionId) {
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

            db.prepare(`
                INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(fileId, sessionId, filename, filePath, getMimeType(ext), stats.size, content, language);

            results.push({
                fileId,
                name: filename,
                size: stats.size,
                type: language,
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

export function getAttachmentsByIds(fileIds) {
    if (fileIds.length === 0) return [];
    const placeholders = fileIds.map(() => '?').join(',');
    return getDb().prepare(
        `SELECT * FROM attachments WHERE id IN (${placeholders})`
    ).all(...fileIds);
}