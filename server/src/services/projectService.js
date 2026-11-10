// src/services/projectService.js — ТЗ Project mode A (вариант A: plain fs.readFile).
//
// Scope: регистрация проекта (внутри CONTEXT_BASE_DIR), browse файлов,
// attach reference-файлов (не копируются — только строки реестра attachments),
// unlink, список reference сессии с missing/stale-бейджами.
// НЕ входит (отдельные треки): RAG, vector DB, watch, multi-project, git, vision.

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import * as projectRepo from '../db/projectRepo.js';
import * as attachmentRepo from '../db/attachmentRepo.js';
import * as sessionRepo from '../db/sessionRepo.js';
import { getContextBaseDirStatus, getMaxReferenceFileSize, resolveAttachmentPath } from '../config/paths.js';

// §10.4: игнор-паттерны при обходе проекта (createProject + listFiles).
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
const IGNORED_FILES = [/\.min\./, /\.map$/, /^\.DS_Store$/, /^Thumbs\.db$/];

// §10.3: лимит reference-файлов на сессию.
export const MAX_REFERENCE_FILES = 100;

// §10.5: contextInfo.modeChangedAtQuestion — НЕ реализуем (mode в info достаточно).

function isIgnoredFileName(name) {
    return IGNORED_FILES.some((p) => p.test(name));
}

/**
 * Рекурсивный обход файлов проекта (относительные posix-пути).
 * Игнор-директории пропускаются целиком (ранний выход — node_modules не обходится).
 * @param {string} absDir - абсолютный путь корня проекта
 * @param {string} relBase - накопленный относительный путь ('' для корня)
 * @returns {string[]} список относительных путей файлов
 */
export function walkProjectFiles(absDir, relBase = '') {
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            out.push(...walkProjectFiles(path.join(absDir, entry.name), rel));
        } else if (entry.isFile()) {
            if (isIgnoredFileName(entry.name)) continue;
            out.push(rel);
        }
    }
    return out;
}

/**
 * §3.3: регистрация проекта (идемпотентно по path) + привязка к сессии.
 * При смене проекта — авто-detach reference чужих проектов (§10.7).
 * @returns {{ status: number, body: Object }}
 */
export function createProject(sessionId, relativePath) {
    if (!sessionId) return { status: 400, body: { error: 'sessionId is required' } };
    if (!relativePath || typeof relativePath !== 'string' || relativePath.trim() === '') {
        return { status: 400, body: { error: 'relativePath is required' } };
    }

    const baseStatus = getContextBaseDirStatus();
    if (!baseStatus.ok) {
        return { status: 400, body: { error: baseStatus.error } };
    }

    // Проверка существования сессии
    if (!sessionRepo.getSession(sessionId)) {
        return { status: 404, body: { error: 'Session not found' } };
    }

    // Нормализация: posix-сегменты, без './'; traversal-check относительно CONTEXT_BASE_DIR
    const absPath = path.resolve(baseStatus.path, relativePath);
    if (!absPath.startsWith(path.resolve(baseStatus.path) + path.sep)) {
        return { status: 400, body: { error: 'Path traversal detected' } };
    }
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        return { status: 400, body: { error: 'Project directory not found' } };
    }

    // Нормализованный относительный путь проекта (без '.'/'..', posix-сепараторы)
    const projectPath = path.relative(baseStatus.path, absPath).split(path.sep).join('/');

    let project = projectRepo.getProjectByPath(projectPath);
    let created;
    if (project) {
        created = false;
    } else {
        const name = path.basename(projectPath) || projectPath;
        project = projectRepo.insertProject({ name, projectPath });
        created = true;
    }

    // §10.7: авто-detach reference НЕ из нового проекта (смена проекта не смешивает [Материалы])
    projectRepo.detachForeignReferences(sessionId, projectPath);
    projectRepo.bindSessionToProject(sessionId, project.id);

    const totalFiles = walkProjectFiles(absPath).length;
    return {
        status: 200,
        body: {
            id: project.id,
            name: project.name,
            path: project.path,
            totalFiles,
            created,
        },
    };
}

/**
 * §3.4: список файлов проекта для BrowseDialog (только stat, без чтения содержимого).
 * @returns {{ status: number, body: Object }}
 */
export function listProjectFiles(projectId, filter = '') {
    const project = projectRepo.getProject(projectId);
    if (!project) return { status: 404, body: { error: 'Project not found' } };

    const baseStatus = getContextBaseDirStatus();
    if (!baseStatus.ok) return { status: 400, body: { error: baseStatus.error } };

    const absDir = path.resolve(baseStatus.path, project.path);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
        return { status: 400, body: { error: 'Project directory not found' } };
    }

    let relPaths = walkProjectFiles(absDir).sort((a, b) => a.localeCompare(b));

    if (filter && filter.trim() !== '') {
        const needle = filter.toLowerCase();
        relPaths = relPaths.filter((p) => p.toLowerCase().includes(needle));
    }

    const total = relPaths.length;
    const LIMIT = 500;
    const files = relPaths.slice(0, LIMIT).map((rel) => {
        const abs = path.join(absDir, rel);
        let size = 0;
        try {
            size = fs.statSync(abs).size;
        } catch {
            size = 0;
        }
        const ext = path.extname(rel).toLowerCase();
        return { path: rel, size, language: attachmentRepo.detectLanguage(ext) };
    });

    return {
        status: 200,
        body: { files, total, truncated: total > LIMIT },
    };
}

/**
 * §3.5: attach reference-файлов (идемпотентно по session_id + file_path).
 * Файлы НЕ копируются: строка attachments (kind='reference', path_base='context',
 * file_path='<projectPath>/<rel>', extracted_text='', extracted_mtime=NULL).
 * @returns {{ status: number, body: Object }}
 */
export function attachReferenceFiles(projectId, sessionId, relativePaths) {
    const project = projectRepo.getProject(projectId);
    if (!project) return { status: 404, body: { error: 'Project not found' } };
    if (!sessionId) return { status: 400, body: { error: 'sessionId is required' } };
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
        return { status: 400, body: { error: 'relativePaths array is required' } };
    }

    const baseStatus = getContextBaseDirStatus();
    if (!baseStatus.ok) return { status: 400, body: { error: baseStatus.error } };

    if (!sessionRepo.getSession(sessionId)) {
        return { status: 404, body: { error: 'Session not found' } };
    }

    const baseAbs = path.resolve(baseStatus.path, project.path);
    if (!fs.existsSync(baseAbs) || !fs.statSync(baseAbs).isDirectory()) {
        return { status: 400, body: { error: 'Project directory not found' } };
    }

    const maxFileSize = getMaxReferenceFileSize();
    const attached = [];
    const errors = [];
    let insertedCount = projectRepo.countSessionReferences(sessionId);

    for (const rawRel of relativePaths) {
        const rel = path.posix.normalize(String(rawRel || '').split(path.sep).join('/'));
        if (!rel || rel === '.' || rel.startsWith('../') || rel === '..' || rel.startsWith('/')) {
            errors.push({ path: rawRel, error: 'Path traversal detected' });
            continue;
        }

        const absPath = path.resolve(baseAbs, rel);
        // Traversal относительно КОРНЯ ПРОЕКТА (файл должен быть внутри проекта)
        if (!absPath.startsWith(baseAbs + path.sep)) {
            errors.push({ path: rawRel, error: 'Path traversal detected' });
            continue;
        }
        if (!fs.existsSync(absPath)) {
            errors.push({ path: rawRel, error: 'File not found' });
            continue;
        }
        let stat;
        try {
            stat = fs.statSync(absPath);
        } catch {
            errors.push({ path: rawRel, error: 'File not found' });
            continue;
        }
        if (!stat.isFile()) {
            errors.push({ path: rawRel, error: 'Not a file' });
            continue;
        }
        if (stat.size > maxFileSize) {
            errors.push({ path: rawRel, error: `File too large (${stat.size} bytes, max ${maxFileSize})` });
            continue;
        }

        const filePath = `${project.path}/${rel}`;
        const ext = path.extname(absPath).toLowerCase();
        const language = attachmentRepo.detectLanguage(ext);
        const filename = path.basename(rel);

        // Идемпотентность: та же сессия + тот же file_path → не дублируем
        const existing = attachmentRepo.findReferenceByPath(sessionId, filePath);
        if (existing) {
            attached.push({ fileId: existing.id, name: filename, size: stat.size, kind: 'reference', language, skipped: true });
            continue;
        }

        // §10.3: лимит reference на сессию (считаем только реально добавляемые)
        if (insertedCount >= MAX_REFERENCE_FILES) {
            errors.push({ path: rawRel, error: `Max ${MAX_REFERENCE_FILES} reference files per session` });
            continue;
        }

        const fileId = crypto.randomUUID();
        attachmentRepo.insertAttachment({
            id: fileId,
            sessionId,
            filename,
            filePath,
            mimeType: attachmentRepo.getMimeType(ext),
            fileSize: stat.size,
            extractedText: '',
            language,
            kind: 'reference',
            pathBase: 'context',
        });
        insertedCount += 1;
        attached.push({ fileId, name: filename, size: stat.size, kind: 'reference', language });
    }

    return { status: 200, body: { attached, errors } };
}

/**
 * §10.8: Remove project — отвязать сессию (project_id=NULL, mode='research'),
 * авто-detach всех reference сессии (строки реестра; файлы на диске не трогаем).
 * @returns {{ status: number, body: Object }}
 */
export function unlinkProject(sessionId) {
    if (!sessionId) return { status: 400, body: { error: 'sessionId is required' } };
    if (!sessionRepo.getSession(sessionId)) {
        return { status: 404, body: { error: 'Session not found' } };
    }

    projectRepo.unbindSessionProject(sessionId);
    projectRepo.detachSessionReferences(sessionId);
    return { status: 200, body: { ok: true } };
}

/**
 * GET /api/projects/:id — информация о проекте (форма эндпоинта — моё микрорешение,
 * согласовано с владельцем в анализе ТЗ): восстановление CurrentProject в UI
 * после перезагрузки (session.project_id → имя/путь проекта).
 * @returns {{ status: number, body: Object }}
 */
export function getProjectInfo(projectId) {
    const project = projectRepo.getProject(projectId);
    if (!project) return { status: 404, body: { error: 'Project not found' } };
    return { status: 200, body: { id: project.id, name: project.name, path: project.path } };
}

/**
 * §3.7: список reference-файлов сессии с бейджами missing / mtimeStale / tooLarge.
 * Стат файла — на лету; обновление extracted_text здесь НЕ делается
 * (обновление — при сборке контекста, buildLLMContext).
 *
 * Бейджи:
 * - missing   — файла нет на диске (или traversal / CONTEXT_BASE_DIR не настроен);
 * - mtimeStale — «кэш был прочитан и устарел». extracted_mtime=NULL — это НЕ stale,
 *   а «кэш ещё не инициализирован» (свежий attach): файл будет прочитан при первой
 *   сборке контекста (приёмка PR #17, 3.1 — ложный «stale» сразу после attach);
 * - tooLarge  — файл разросся сверх MAX_REFERENCE_FILE_SIZE ПОСЛЕ attach
 *   (attach такое отклоняет; разрастание после — ловится здесь и при сборке
 *   контекста TOO LARGE-блоком; приёмка PR #17, 3.4 — наблюдаемость в панели).
 */
export function getSessionReferenceAttachments(sessionId) {
    const rows = attachmentRepo.listBySessionAndKind(sessionId, 'reference');
    const maxSize = getMaxReferenceFileSize();
    return rows.map((r) => {
        let missing = false;
        let mtimeStale = false;
        let tooLarge = false;
        let abs = null;
        try {
            abs = resolveAttachmentPath(r);
        } catch {
            missing = true; // traversal / CONTEXT_BASE_DIR не настроен
        }
        if (!abs || !fs.existsSync(abs)) {
            missing = true;
        } else {
            try {
                const stat = fs.statSync(abs);
                mtimeStale = r.extracted_mtime !== null && r.extracted_mtime !== stat.mtimeMs;
                tooLarge = stat.size > maxSize;
            } catch {
                missing = true;
            }
        }
        return {
            fileId: r.id,
            name: r.filename,
            size: r.file_size,
            kind: r.kind,
            language: r.language,
            filePath: r.file_path,
            missing,
            tooLarge: missing ? false : tooLarge,
            mtimeStale: missing ? false : mtimeStale,
        };
    });
}
