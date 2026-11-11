// src/db/sessionRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';

export function createSession(title = null, mode = 'research', projectId = null) {
    // ТЗ Project mode A (§2.3): default 'research' ('chat' legacy-БД трактуется как research в коде).
    const id = crypto.randomUUID();
    const db = getDb();

    if (!title) {
        const count = db.prepare(
            "SELECT COUNT(*) as count FROM sessions WHERE title LIKE 'unsavedSession%'"
        ).get().count;
        title = `unsavedSession ${count + 1}`;
    }

    db.prepare(`
        INSERT INTO sessions (id, title, mode, project_id)
        VALUES (?, ?, ?, ?)
    `).run(id, title, mode, projectId);

    return { id, title };
}

export function getSession(id) {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function listSessions(options = {}) {
    const { mode, limit = 100, offset = 0, search } = options;
    let sql = 'SELECT * FROM sessions WHERE is_archived = 0';
    const params = [];
    if (mode) { sql += ' AND mode = ?'; params.push(mode); }
    if (search) { sql += ' AND (title LIKE ? OR category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return getDb().prepare(sql).all(...params);
}

export function updateSession(id, updates) {
    const fields = Object.keys(updates);
    if (fields.length === 0) return;
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);
    getDb().prepare(`
        UPDATE sessions SET ${sets}, updated_at = datetime('now') WHERE id = ?
    `).run(...values);
}

export function deleteSession(id) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

/* ТЗ send-error-persist (№3 context-overflow-ux): JSON последней провальной
   отправки на сессии. Пишется chatController'ом на каждом известном серверу
   провале (пре-флайт, catch провайдера), чистится на успешной отправке и по
   явному dismiss (DELETE /api/sessions/:id/send-error). updated_at НЕ трогаем:
   провал — не повод поднимать сессию наверх списка. payload = объект или null. */
export function setSendError(id, payload) {
    const json = payload == null ? null : JSON.stringify(payload);
    getDb().prepare('UPDATE sessions SET last_send_error = ? WHERE id = ?').run(json, id);
}

export function getSendError(id) {
    const row = getDb().prepare('SELECT last_send_error FROM sessions WHERE id = ?').get(id);
    if (!row || !row.last_send_error) return null;
    try {
        const parsed = JSON.parse(row.last_send_error);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function archiveSession(id, newTitle) {
    getDb().prepare(`
        UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newTitle, id);
}
