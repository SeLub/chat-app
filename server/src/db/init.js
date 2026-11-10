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
            sysprompt       TEXT, /* === НОВОЕ: Системный промпт сессии === */
            message_count   INTEGER DEFAULT 0,
            is_archived     INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        /* Финальное ТЗ «vision-картинки в истории»: image_data демонтирован —
           единый реестр вложений это attachments (kind='image') + attachments_meta. */
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            question_id     TEXT,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            model           TEXT,
            attachments_meta TEXT DEFAULT '[]',
            metrics         TEXT DEFAULT '{}',
            sort_order      INTEGER NOT NULL,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        /* S.2: реестр вложений с kind (document|code|image|reference) и path_base
           (context = относительно CONTEXT_BASE_DIR; data = относительно server/data/).
           ТЗ Project mode A: extracted_mtime — mtime-кэш чтения reference-файла с диска
           (NULL = ещё не читался; при сборке контекста сверяется с fs.stat.mtimeMs).
           ТЗ attachment-cascade (2026-11-11): message_id — владелец строки среди
           document/code/image (reference — пул сессии, message_id NULL); удаление
           сообщения каскадом чистит его строки на уровне БД. */
        CREATE TABLE IF NOT EXISTS attachments (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            filename        TEXT NOT NULL,
            file_path       TEXT,
            mime_type       TEXT,
            file_size       INTEGER,
            extracted_text  TEXT NOT NULL,
            language        TEXT,
            kind            TEXT DEFAULT 'document',
            path_base       TEXT DEFAULT 'context',
            message_id      TEXT REFERENCES messages(id) ON DELETE CASCADE,
            extracted_mtime INTEGER DEFAULT NULL,
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

        CREATE TABLE IF NOT EXISTS context_config (
            session_id      TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            mode            TEXT DEFAULT 'standard',
            retain_percent  INTEGER DEFAULT 100,
            manual_include  TEXT DEFAULT '[]',
            updated_at      TEXT DEFAULT (datetime('now'))
        );
    `);

    ensureColumns(database);

    /* Индекс под каскад/count по message_id (ТЗ attachment-cascade).
       После ensureColumns: на legacy-БД колонка появляется только там. */
    database.exec(
        'CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)'
    );
}

/**
 * Guarded-ALTER для БД, созданных до появления новых колонок (dev-среда владельца).
 * Свежие БД получают колонки сразу из CREATE TABLE — здесь они пропускаются.
 * Миграционного фреймворка нет и не нужно: проверка PRAGMA table_info идемпотентна.
 */
function ensureColumns(database) {
    const columnNames = (table) => database.pragma(`table_info(${table})`).map((c) => c.name);

    const attachmentCols = columnNames('attachments');
    if (attachmentCols.length > 0 && !attachmentCols.includes('kind')) {
        database.exec("ALTER TABLE attachments ADD COLUMN kind TEXT DEFAULT 'document'");
    }
    if (attachmentCols.length > 0 && !attachmentCols.includes('path_base')) {
        database.exec("ALTER TABLE attachments ADD COLUMN path_base TEXT DEFAULT 'context'");
    }
    // ТЗ Project mode A: mtime-кэш чтения reference-файлов (legacy-БД без колонки).
    if (attachmentCols.length > 0 && !attachmentCols.includes('extracted_mtime')) {
        database.exec('ALTER TABLE attachments ADD COLUMN extracted_mtime INTEGER DEFAULT NULL');
    }

    /* ТЗ attachment-cascade (вердикт владельца 2026-11-11): строки document/code/image
       живут не дольше своего сообщения — FK message_id ON DELETE CASCADE. Миграция
       legacy-БД: (1) guarded ALTER; (2) backfill — клейм по attachments_meta живых
       сообщений; (3) однократная очистка накопленного балласта (не-reference без
       message_id после backfill). reference не клеймится и не purge-ится никогда. */
    if (attachmentCols.length > 0 && !attachmentCols.includes('message_id')) {
        database.exec(
            'ALTER TABLE attachments ADD COLUMN message_id TEXT REFERENCES messages(id) ON DELETE CASCADE'
        );
        database.prepare(`
            UPDATE attachments SET message_id = (
                SELECT m.id FROM messages m, json_each(
                    CASE WHEN json_valid(m.attachments_meta) THEN m.attachments_meta ELSE '[]' END
                ) je
                WHERE json_extract(je.value, '$.fileId') = attachments.id
                LIMIT 1
            )
            WHERE kind IN ('document', 'code', 'image') AND message_id IS NULL
        `).run();
        const claimed = database.prepare(
            'SELECT COUNT(*) AS c FROM attachments WHERE message_id IS NOT NULL'
        ).get().c;
        const purged = database.prepare(
            "DELETE FROM attachments WHERE kind != 'reference' AND message_id IS NULL"
        ).run().changes;
        console.log(`[init] attachments.message_id миграция: заклеймлено ${claimed}, балласт удалён ${purged}`);
    }

    // image_data демонтирован (финальное ТЗ): на существующей БД колонка удаляется.
    // Обратной совместимости нет — старые URL /api/images/* мертвы вместе с uploads/.
    const messageCols = columnNames('messages');
    if (messageCols.length > 0 && messageCols.includes('image_data')) {
        try {
            database.exec('ALTER TABLE messages DROP COLUMN image_data');
        } catch (error) {
            // SQLite < 3.35 не умеет DROP COLUMN — колонка останется, код её не читает.
            console.warn('[init] DROP COLUMN messages.image_data failed:', error.message);
        }
    }
}

export function setDbPath(customPath) {
    // Переключает путь БД (для тестов: ':memory:'). Закрывает открытое соединение при смене пути.
    if (db && db.name !== customPath) {
        db.close();
        db = null;
    }
    dbPath = customPath;
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
