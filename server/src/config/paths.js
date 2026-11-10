// src/config/paths.js — резолв физических путей вложений (S.1 плана context-data-storage).
//
// DATA_DIR — базовая директория app-managed файлов (server/data/): там живут
// clipboard-изображения (data/uploads) и SQLite (data/chat.db). Резолв от
// расположения модуля — cwd не важен (паттерн решения #117 для env.js).

import path from 'path';
import fs from 'fs';
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
 * Статус CONTEXT_BASE_DIR для GET /api/config (ТЗ Project mode A, §3.1).
 * Проверяется при каждом запросе (fs.existsSync дешёвый; .env меняется только
 * рестартом, но проверка существования на лету даёт честный статус).
 * @returns {{ ok: boolean, path: string|null, error: string|null }}
 */
export function getContextBaseDirStatus() {
    const raw = process.env.CONTEXT_BASE_DIR;
    if (!raw || raw.trim() === '') {
        return { ok: false, path: null, error: 'CONTEXT_BASE_DIR is not configured' };
    }
    const abs = path.resolve(raw);
    if (!fs.existsSync(abs)) {
        return { ok: false, path: abs, error: 'CONTEXT_BASE_DIR does not exist' };
    }
    if (!fs.statSync(abs).isDirectory()) {
        return { ok: false, path: abs, error: 'CONTEXT_BASE_DIR is not a directory' };
    }
    return { ok: true, path: abs, error: null };
}

/**
 * Лимит размера reference-файла (ТЗ Project mode A, §10.2): 1 MB по умолчанию.
 * Читается из env при каждом вызове (attach и buildLLMContext — одинаково).
 */
export function getMaxReferenceFileSize() {
    const v = parseInt(process.env.MAX_REFERENCE_FILE_SIZE, 10);
    return Number.isFinite(v) && v > 0 ? v : 1048576;
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
