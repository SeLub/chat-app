// src/services/contextBuilder.js
import { getDb } from '../db/init.js';

export async function buildLLMContext(sessionId, currentAttachments = []) {
    const db = getDb();

    const messages = db.prepare(
        'SELECT role, content, attachments_meta FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);

    const allFileIds = new Set();
    for (const msg of messages) {
        const meta = JSON.parse(msg.attachments_meta || '[]');
        meta.forEach(m => allFileIds.add(m.fileId));
    }
    currentAttachments.forEach(a => allFileIds.add(a.fileId));

    const fileContents = {};
    if (allFileIds.size > 0) {
        const placeholders = [...allFileIds].map(() => '?').join(',');
        const rows = db.prepare(
            `SELECT id, filename, extracted_text FROM attachments WHERE id IN (${placeholders})`
        ).all(...[...allFileIds]);
        rows.forEach(r => { fileContents[r.id] = { filename: r.filename, text: r.extracted_text }; });
    }

    const conversation = [];

    if (Object.keys(fileContents).length > 0) {
        let fileContext = 'The user has shared the following files:\n\n';
        for (const [fileId, file] of Object.entries(fileContents)) {
            fileContext += `--- FILE: ${file.filename} ---\n${file.text}\n\n`;
        }
        conversation.push({ role: 'system', content: fileContext });
    }

    for (const msg of messages) {
        conversation.push({ role: msg.role, content: msg.content });
    }

    return conversation;
}
