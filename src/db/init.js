// src/db/init.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT_DIR, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'chat.db');

let db;
let dbPath = DB_PATH; 

export function getDb(customPath = null) {
    const targetPath = customPath || dbPath;
    
    if (!db || db.name !== targetPath) {
        if (!fs.existsSync(path.dirname(targetPath))) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        }
        db = new Database(targetPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('synchronous = NORMAL');
        initializeSchema(db);
    }
    return db;
}

export function initializeSchema(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id              TEXT PRIMARY KEY,
            title           TEXT DEFAULT 'unsavedSession 1',
            category        TEXT DEFAULT 'General',
            mode            TEXT DEFAULT 'chat',
            project_id      TEXT REFERENCES projects(id),
            model           TEXT,
            provider        TEXT DEFAULT 'ollama',
            message_count   INTEGER DEFAULT 0,
            is_archived     INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            question_id     TEXT,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            model           TEXT,
            attachments_meta TEXT DEFAULT '[]',
            metrics         TEXT DEFAULT '{}',
            image_data      TEXT DEFAULT '{}',
            sort_order      INTEGER NOT NULL,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            filename        TEXT NOT NULL,
            file_path       TEXT,
            mime_type       TEXT,
            file_size       INTEGER,
            extracted_text  TEXT NOT NULL,
            language        TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS projects (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            path            TEXT NOT NULL UNIQUE,
            description     TEXT DEFAULT '',
            watch_enabled   INTEGER DEFAULT 0,
            last_indexed    TEXT,
            total_files     INTEGER DEFAULT 0,
            total_chunks    INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS project_files (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            file_path       TEXT NOT NULL,
            content_hash    TEXT NOT NULL,
            language        TEXT,
            file_size       INTEGER,
            chunk_count     INTEGER DEFAULT 0,
            qdrant_point_ids TEXT DEFAULT '[]',
            last_indexed    TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, file_path)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
        CREATE INDEX IF NOT EXISTS idx_sessions_title ON sessions(title);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_messages_question ON messages(question_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_path ON attachments(file_path);
        CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_files_hash ON project_files(content_hash);
    `);
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
