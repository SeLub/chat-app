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
        message.model,
        JSON.stringify(message.attachmentsMeta || []),
        JSON.stringify(message.metrics || {}),
        max.max_order + 1
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

/**
 * Удалить Q&A pair из БД.
 *
 * ТЗ attachment-cascade (вердикт владельца 2026-11-11): строки attachments,
 * принадлежащие удаляемым сообщениям (FK message_id), удаляются КАСКАДОМ на
 * уровне БД. Orphan-политика строк отменена (реиспользование extracted_text
 * по fileId/path отменено владельцем). Файлы на диске не удаляются —
 * orphan-файлы (uploads/thumbs) — предмет будущего File Manager.
 * reference-строки (пул PROJECT-сессии, message_id NULL) каскадом не затрагиваются.
 *
 * @param {string} questionId - ID вопроса (q_1_1234567890)
 * @returns {{ deletedMessages: number, deletedAttachments: number }} deletedAttachments —
 *          реальное число удалённых строк реестра (снимается до DELETE)
 */
export function deleteMessagesByQuestionId(questionId) {
    const db = getDb();

    // 1. Найти все сообщения с этим questionId
    const msgs = db.prepare(
        'SELECT id, session_id FROM messages WHERE question_id = ?'
    ).all(questionId);

    if (msgs.length === 0) {
        return { deletedMessages: 0, deletedAttachments: 0 };
    }

    const sessionId = msgs[0].session_id;
    const msgIds = msgs.map((m) => m.id);

    // 2. Реальное число строк реестра, которые уйдут каскадом (до DELETE)
    const placeholders = msgIds.map(() => '?').join(',');
    const deletedAttachments = db.prepare(
        `SELECT COUNT(*) AS c FROM attachments WHERE message_id IN (${placeholders})`
    ).get(...msgIds).c;

    // 3. Удалить сообщения — строки attachments чистит FK ON DELETE CASCADE
    const msgResult = db.prepare(
        'DELETE FROM messages WHERE question_id = ?'
    ).run(questionId);

    // 4. Пересчитать message_count
    db.prepare(`
        UPDATE sessions
        SET message_count = (
            SELECT COUNT(*) FROM messages WHERE session_id = ?
        ), updated_at = datetime('now')
        WHERE id = ?
    `).run(sessionId, sessionId);

    return {
        deletedMessages: msgResult.changes,
        deletedAttachments
    };
}