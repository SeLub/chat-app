// src/config/paths.js — резолв физических путей вложений (S.1 плана context-data-storage).
//
// DATA_DIR — базовая директория app-managed файлов (server/data/): там живут
// clipboard-изображения (data/uploads) и SQLite (data/chat.db). Резолв от
// расположения модуля — cwd не важен (паттерн решения #117 для env.js).

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');

/**
 * Базовая директория пользовательских файлов (PROJECT-ссылки, path_base='context').
 * Задаётся в .env: CONTEXT_BASE_DIR=/home/selub/Documents/progs (решение D-B).
 * Для RESEARCH-режима (текущего) не требуется — отсутствие не фатально.
 */
export function getContextBaseDir() {
    return process.env.CONTEXT_BASE_DIR || '';
}

/**
 * Резолвит физический путь файла вложения по строке БД attachments.
 * - path_base='data'    → app-managed файл: DATA_DIR/file_path (clipboard-изображения);
 * - path_base='context' → файл пользователя: CONTEXT_BASE_DIR/file_path (S.7, PROJECT);
 * - прочее / отсутствие file_path → null (путь не хранится, например RESEARCH-документы).
 *
 * Защита от path traversal: итоговый путь обязан находиться СТРОГО внутри
 * базовой директории (path.resolve + startsWith), иначе бросается ошибка →
 * маршрут отвечает 400 (критерий приёмки ТЗ).
 *
 * @param {{ file_path?: string|null, path_base?: string|null }} row - строка attachments
 * @returns {string|null} абсолютный путь или null
 */
export function resolveAttachmentPath(row) {
    if (!row || !row.file_path) return null;

    if (row.path_base === 'data') {
        return path.resolve(DATA_DIR, row.file_path);
    }

    if (row.path_base === 'context') {
        const baseDir = getContextBaseDir();
        if (!baseDir) {
            throw new Error('CONTEXT_BASE_DIR is not configured');
        }
        const base = path.resolve(baseDir);
        const resolved = path.resolve(base, row.file_path);
        if (!resolved.startsWith(base + path.sep)) {
            throw new Error('Path traversal detected');
        }
        return resolved;
    }

    return null;
}
