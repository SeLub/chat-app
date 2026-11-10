// src/db/projectRepo.js — ТЗ Project mode A (§3.3): репозиторий проектов.
//
// Таблица projects существует с Фазы 0 (watch_enabled / last_indexed / total_files /
// total_chunks — НЕ используются в этом ТЗ, future: RAG / git).
// Один активный проект на сессию: sessions.project_id → projects.id;
// переключение режима/проекта — через bind/unbind (mode остаётся свойством сессии).

import { getDb } from './init.js';
import crypto from 'crypto';

export function getProject(id) {
    return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

export function getProjectByPath(projectPath) {
    return getDb().prepare('SELECT id, name, path FROM projects WHERE path = ?').get(projectPath);
}

export function insertProject({ name, projectPath, description = '' }) {
    const id = crypto.randomUUID();
    getDb().prepare(
        "INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)"
    ).run(id, name, projectPath, description);
    return getProject(id);
}

/**
 * Привязать проект к сессии (и поставить mode='project', §3.3 шаг 7).
 */
export function bindSessionToProject(sessionId, projectId) {
    getDb().prepare(`
        UPDATE sessions
        SET project_id = ?, mode = 'project', updated_at = datetime('now')
        WHERE id = ?
    `).run(projectId, sessionId);
}

/**
 * Отвязать проект от сессии (§10.8): project_id = NULL, mode = 'research'.
 */
export function unbindSessionProject(sessionId) {
    getDb().prepare(`
        UPDATE sessions
        SET project_id = NULL, mode = 'research', updated_at = datetime('now')
        WHERE id = ?
    `).run(sessionId);
}

/**
 * §10.7: авто-detach reference-файлов чужих проектов при смене проекта.
 * Удаляются строки attachments (не файлы на диске), чей file_path НЕ внутри
 * нового проекта. Файлы нового проекта ('<projectPath>/...') остаются.
 */
export function detachForeignReferences(sessionId, projectPath) {
    getDb().prepare(`
        DELETE FROM attachments
        WHERE session_id = ? AND kind = 'reference'
          AND (file_path IS NULL OR file_path NOT LIKE ?)
    `).run(sessionId, `${projectPath}/%`);
}

/**
 * §10.8: при Remove project — detach ВСЕХ reference сессии (файлы на диске не трогаем).
 */
export function detachSessionReferences(sessionId) {
    getDb().prepare(
        "DELETE FROM attachments WHERE session_id = ? AND kind = 'reference'"
    ).run(sessionId);
}

/**
 * §10.3: лимит reference-файлов на сессию — текущее количество.
 */
export function countSessionReferences(sessionId) {
    return getDb().prepare(
        "SELECT COUNT(*) AS n FROM attachments WHERE session_id = ? AND kind = 'reference'"
    ).get(sessionId).n;
}
