// src/db/aiHelperRepo.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(PROJECT_ROOT, 'ai_helper.db');

const log = createLogger('AIHelperRepo');

let db = null;

/**
 * Инициализирует БД (создает таблицы, если их нет)
 * @returns {Promise<Database>}
 */
export async function initDb() {
    try {
        if (!fs.existsSync(path.dirname(DB_PATH))) {
            fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        }

        if (!db) {
            db = new Database(DB_PATH);
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');

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

            log.info('AI Helper DB initialized', { path: DB_PATH });
        }

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
        const database = db || await initDb();

        database.prepare(`
            INSERT INTO ai_helper_sessions (id, created_at, updated_at)
            VALUES (@id, strftime('%s', 'now'), strftime('%s', 'now'))
        `).run({ id: sessionId });

        log.info('Session created', { sessionId: sessionId.slice(0, 8) });
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
 * @param {number} timestamp - Unix timestamp в миллисекундах
 */
export async function addMessage(sessionId, role, text, timestamp) {
    try {
        const database = db || await initDb();

        const timestampSeconds = Math.floor(timestamp / 1000);

        database.prepare(`
            INSERT INTO ai_helper_messages (session_id, role, text, timestamp)
            VALUES (@session_id, @role, @text, @timestamp)
        `).run({
            session_id: sessionId,
            role: role,
            text: text,
            timestamp: timestampSeconds
        });

        database.prepare(`
            UPDATE ai_helper_sessions SET updated_at = strftime('%s', 'now') WHERE id = @id
        `).run({ id: sessionId });

        log.info('Message added', {
            sessionId: sessionId.slice(0, 8),
            role,
            textLength: text.length
        });
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
        const database = db || await initDb();

        const rows = database.prepare(`
            SELECT role, text, timestamp
            FROM ai_helper_messages
            WHERE session_id = @session_id
            ORDER BY timestamp ASC
            LIMIT @limit
        `).all({ session_id: sessionId, limit });

        const messages = rows.map(row => ({
            role: row.role,
            text: row.text,
            timestamp: row.timestamp * 1000
        }));

        log.debug('Messages retrieved', {
            sessionId: sessionId.slice(0, 8),
            count: messages.length
        });

        return messages;
    } catch (error) {
        log.error('Failed to get messages', { sessionId: sessionId.slice(0, 8), error: error.message });
        throw error;
    }
}

/**
 * Удаляет сессию и все её сообщения
 * @param {string} sessionId
 */
export async function clearSession(sessionId) {
    try {
        const database = db || await initDb();

        database.transaction(() => {
            database.prepare('DELETE FROM ai_helper_messages WHERE session_id = @id').run({ id: sessionId });
            database.prepare('DELETE FROM ai_helper_sessions WHERE id = @id').run({ id: sessionId });
        })();

        log.info('Session cleared', { sessionId: sessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to clear session', { sessionId: sessionId.slice(0, 8), error: error.message });
        throw error;
    }
}

/**
 * Закрывает подключение к БД
 */
export function closeDb() {
    if (db) {
        db.close();
        db = null;
        log.info('AI Helper DB closed');
    }
}
