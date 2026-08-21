// src/db/aiHelperRepo.js
import { getDb } from './init.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AIHelperRepo');

/**
 * Инициализирует БД (создает таблицы и индексы, если их нет)
 * Использует существующий инстанс БД из init.js
 * @returns {Promise<import('better-sqlite3').Database>}
 */
export async function initDb() {
    try {
        const db = getDb();
        
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_helper_sessions (
                id TEXT PRIMARY KEY,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE TABLE IF NOT EXISTS ai_helper_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES ai_helper_sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ai_helper_messages_session ON ai_helper_messages(session_id, timestamp);
        `);

        log.info('AI Helper DB tables initialized');
        return db;
    } catch (error) {
        log.error('Failed to initialize AI Helper DB', { error: error.message });
        throw error;
    }
}

/**
 * Создает новую сессию AI Helper
 * @param {string} sessionId - UUID сессии
 */
export async function createSession(sessionId) {
    try {
        const db = getDb();
        const now = Math.floor(Date.now() / 1000);
        
        db.prepare(`
            INSERT INTO ai_helper_sessions (id, created_at, updated_at)
            VALUES (?, ?, ?)
        `).run(sessionId, now, now);

        log.info('AI Helper session created', { sessionId: sessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to create session', { sessionId: sessionId.slice(0, 8), error: error.message });
        throw error;
    }
}

/**
 * Добавляет сообщение в сессию
 * @param {string} sessionId
 * @param {string} role - 'user' | 'interlocutor'
 * @param {string} text - распознанный текст
 * @param {number} timestampMs - Unix timestamp в миллисекундах (от клиента)
 */
export async function addMessage(sessionId, role, text, timestampMs) {
    try {
        const db = getDb();
        // Конвертируем мс в секунды для согласованности с SQLite strftime
        const timestampSec = Math.floor(timestampMs / 1000);

        db.prepare(`
            INSERT INTO ai_helper_messages (session_id, role, text, timestamp)
            VALUES (?, ?, ?, ?)
        `).run(sessionId, role, text, timestampSec);

        db.prepare(`
            UPDATE ai_helper_sessions SET updated_at = strftime('%s', 'now') WHERE id = ?
        `).run(sessionId);

        log.debug('Message added', { sessionId: sessionId.slice(0, 8), role, textLength: text.length });
    } catch (error) {
        log.error('Failed to add message', { sessionId: sessionId.slice(0, 8), error: error.message });
        throw error;
    }
}

/**
 * Получает последние N сообщений сессии (в хронологическом порядке)
 * @param {string} sessionId
 * @param {number} limit - по умолчанию 10
 * @returns {Promise<Array<{role: string, text: string, timestamp: number}>>}
 */
export async function getRecentMessages(sessionId, limit = 10) {
    try {
        const db = getDb();
        
        const rows = db.prepare(`
            SELECT role, text, timestamp 
            FROM ai_helper_messages
            WHERE session_id = ?
            ORDER BY timestamp ASC
            LIMIT ?
        `).all(sessionId, limit);

        // Конвертируем секунды обратно в миллисекунды для фронтенда
        const messages = rows.map(row => ({
            role: row.role,
            text: row.text,
            timestamp: row.timestamp * 1000
        }));

        log.debug('Messages retrieved', { sessionId: sessionId.slice(0, 8), count: messages.length });
        return messages;
    } catch (error) {
        log.error('Failed to get messages', { sessionId: sessionId.slice(0, 8), error: error.message });
        throw error;
    }
}

/**
 * Удаляет сессию и все её сообщения (в транзакции)
 * @param {string} sessionId
 */
export async function clearSession(sessionId) {
    try {
        const db = getDb();
        
        db.transaction(() => {
            db.prepare('DELETE FROM ai_helper_messages WHERE session_id = ?').run(sessionId);
            db.prepare('DELETE FROM ai_helper_sessions WHERE id = ?').run(sessionId);
        })();

        log.info('AI Helper session cleared', { sessionId: sessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to clear session', { sessionId: sessionId.slice(0, 8), error: error.message });
        throw error;
    }
}