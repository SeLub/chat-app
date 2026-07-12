// src/db/sessionRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';

export function createSession(title = null, mode = 'chat', projectId = null) {
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

export function archiveSession(id, newTitle) {
    getDb().prepare(`
        UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newTitle, id);
}
