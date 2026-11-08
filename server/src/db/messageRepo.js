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
        INSERT INTO messages (id, session_id, question_id, role, content, model, attachments_meta, metrics, image_data, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, sessionId, message.questionId, message.role, message.content,
        message.model,
        JSON.stringify(message.attachmentsMeta || []),
        JSON.stringify(message.metrics || {}),
        JSON.stringify(message.imageData || {}),
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
 * Удалить Q&A pair из БД + связанные attachments
 * @param {string} questionId - ID вопроса (q_1_1234567890)
 * @returns {{ deletedMessages: number, deletedAttachments: number }}
 */
export function deleteMessagesByQuestionId(questionId) {
    const db = getDb();

    // 1. Найти все сообщения с этим questionId
    const msgs = db.prepare(
        'SELECT id, session_id, attachments_meta FROM messages WHERE question_id = ?'
    ).all(questionId);

    if (msgs.length === 0) {
        return { deletedMessages: 0, deletedAttachments: 0 };
    }

    const sessionId = msgs[0].session_id;

    // 2. Собрать все fileId из attachments_meta
    const fileIds = new Set();
    for (const msg of msgs) {
        try {
            const meta = JSON.parse(msg.attachments_meta || '[]');
            for (const item of meta) {
                if (item.fileId) fileIds.add(item.fileId);
            }
        } catch (error) {
            // Игнорируем невалидный JSON
        }
    }

    // 3. Удалить attachments (если есть)
    let deletedAttachments = 0;
    if (fileIds.size > 0) {
        const placeholders = [...fileIds].map(() => '?').join(',');
        const result = db.prepare(
            `DELETE FROM attachments WHERE id IN (${placeholders})`
        ).run(...fileIds);
        deletedAttachments = result.changes;
    }

    // 4. Удалить сообщения
    const msgResult = db.prepare(
        'DELETE FROM messages WHERE question_id = ?'
    ).run(questionId);

    // 5. Пересчитать message_count
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