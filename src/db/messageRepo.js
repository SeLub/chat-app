// src/db/messageRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';

export function addMessage(sessionId, message) {
    const db = getDb();
    const id = crypto.randomUUID();

    const max = db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM messages WHERE session_id = ?'
    ).get(sessionId);

    db.prepare(`
        INSERT INTO messages (id, session_id, question_id, role, content, model, attachments_meta, metrics, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, sessionId, message.questionId, message.role, message.content,
        message.model, JSON.stringify(message.attachmentsMeta || []),
        JSON.stringify(message.metrics || {}), max.max_order + 1
    );

    db.prepare(`
        UPDATE sessions SET message_count = message_count + 1, updated_at = datetime('now')
        WHERE id = ?
    `).run(sessionId);

    return id;
}

export function getMessagesBySession(sessionId) {
    return getDb().prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);
}

export function deleteMessagesByQuestionId(questionId) {
    const db = getDb();
    const msgs = db.prepare('SELECT session_id FROM messages WHERE question_id = ?').all(questionId);
    db.prepare('DELETE FROM messages WHERE question_id = ?').run(questionId);
    if (msgs.length > 0) {
        const sessionId = msgs[0].session_id;
        db.prepare(`
            UPDATE sessions SET message_count = (
                SELECT COUNT(*) FROM messages WHERE session_id = ?
            ), updated_at = datetime('now') WHERE id = ?
        `).run(sessionId, sessionId);
    }
}
