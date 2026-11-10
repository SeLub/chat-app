import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { getDb, setDbPath, closeDb, initializeSchema } from '../../src/db/init.js';

describe('Database Initialization', () => {
    let tempDbPath;

    after(() => {
        closeDb();
        if (tempDbPath && fs.existsSync(tempDbPath)) {
            fs.unlinkSync(tempDbPath);
        }
    });

    it('should create database file if not exists', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
        tempDbPath = path.join(tempDir, 'test.db');

        setDbPath(tempDbPath);
        const db = getDb();

        assert.ok(db);
        assert.ok(fs.existsSync(tempDbPath));

        // Cleanup
        closeDb();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create all required tables', () => {
        setDbPath(':memory:');
        const db = getDb();

        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all().map(r => r.name);

        assert.ok(tables.includes('sessions'));
        assert.ok(tables.includes('messages'));
        assert.ok(tables.includes('attachments'));
        assert.ok(tables.includes('projects'));
        assert.ok(tables.includes('project_files'));
    });

    it('should create all required indexes', () => {
        setDbPath(':memory:');
        const db = getDb();

        const indexes = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='index'
        `).all().map(r => r.name);

        assert.ok(indexes.includes('idx_sessions_mode'));
        assert.ok(indexes.includes('idx_sessions_updated'));
        assert.ok(indexes.includes('idx_messages_session'));
        assert.ok(indexes.includes('idx_attachments_session'));
    });

    it('should set correct pragmas', () => {
        // WAL физически неприменим к ':memory:'-БД (SQLite возвращает 'memory'),
        // поэтому проверяем на временном файле — намерение теста (инициализация
        // включает journal_mode=WAL и foreign_keys=ON) сохранено.
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-pragma-'));
        const tempDbPath = path.join(tempDir, 'pragma.db');
        try {
            setDbPath(tempDbPath);
            const db = getDb();

            const journalMode = db.pragma('journal_mode', { simple: true });
            const foreignKeys = db.pragma('foreign_keys', { simple: true });

            assert.equal(journalMode, 'wal');
            assert.equal(foreignKeys, 1);
        } finally {
            closeDb();
            fs.rmSync(tempDir, { recursive: true, force: true });
            setDbPath(':memory:');
        }
    });

    it('should be idempotent (multiple calls safe)', () => {
        setDbPath(':memory:');
        
        const db1 = getDb();
        const db2 = getDb();
        
        assert.equal(db1, db2); // same instance
    });

    it('should upgrade legacy DB: attachments += kind/path_base, messages -= image_data (guarded ALTER)', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-legacy-'));
        const legacyDbPath = path.join(tempDir, 'legacy.db');

        // Строим БД со СТАРОЙ схемой (до финального ТЗ): attachments без kind/path_base,
        // messages с image_data.
        const legacy = new Database(legacyDbPath);
        legacy.exec(`
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                title TEXT DEFAULT 'unsavedSession 1',
                category TEXT DEFAULT 'General',
                mode TEXT DEFAULT 'chat',
                project_id TEXT REFERENCES projects(id),
                model TEXT,
                provider TEXT DEFAULT 'ollama',
                sysprompt TEXT,
                message_count INTEGER DEFAULT 0,
                is_archived INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                watch_enabled INTEGER DEFAULT 0,
                last_indexed TEXT,
                total_files INTEGER DEFAULT 0,
                total_chunks INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                question_id TEXT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model TEXT,
                attachments_meta TEXT DEFAULT '[]',
                metrics TEXT DEFAULT '{}',
                image_data TEXT DEFAULT '{}',
                sort_order INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                file_path TEXT,
                mime_type TEXT,
                file_size INTEGER,
                extracted_text TEXT NOT NULL,
                language TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO sessions (id) VALUES ('s-legacy');
            INSERT INTO messages (id, session_id, role, content, sort_order) VALUES ('m-legacy', 's-legacy', 'user', 'old', 1);
            INSERT INTO attachments (id, session_id, filename, extracted_text) VALUES ('a-legacy', 's-legacy', 'old.csv', 'x');
        `);
        legacy.close();

        try {
            setDbPath(legacyDbPath);
            const db = getDb(); // initializeSchema + ensureColumns

            const attachCols = db.pragma('table_info(attachments)').map((c) => c.name);
            assert.ok(attachCols.includes('kind'), 'kind добавлен guarded ALTER-ом');
            assert.ok(attachCols.includes('path_base'), 'path_base добавлен guarded ALTER-ом');
            assert.ok(attachCols.includes('extracted_mtime'), 'ТЗ Project mode A: extracted_mtime добавлен guarded ALTER-ом');
            const legacyRef = db.prepare("SELECT extracted_mtime FROM attachments WHERE id = 'a-legacy'").get();
            assert.equal(legacyRef.extracted_mtime, null, 'default NULL');

            const msgCols = db.pragma('table_info(messages)').map((c) => c.name);
            assert.ok(!msgCols.includes('image_data'), 'image_data демонтирован');

            // Данные уцелели; default'ы проставлены
            const legacyRow = db.prepare("SELECT kind, path_base FROM attachments WHERE id = 'a-legacy'").get();
            assert.equal(legacyRow.kind, 'document');
            assert.equal(legacyRow.path_base, 'context');
            const legacyMsg = db.prepare("SELECT content FROM messages WHERE id = 'm-legacy'").get();
            assert.equal(legacyMsg.content, 'old');
        } finally {
            closeDb();
            fs.rmSync(tempDir, { recursive: true, force: true });
            setDbPath(':memory:');
        }
    });

    it('fresh schema: attachments имеет kind/path_base/extracted_mtime, messages без image_data', () => {
        setDbPath(':memory:');
        const db = getDb();

        const attachCols = db.pragma('table_info(attachments)').map((c) => c.name);
        assert.ok(attachCols.includes('kind'));
        assert.ok(attachCols.includes('path_base'));
        assert.ok(attachCols.includes('extracted_mtime'), 'ТЗ Project mode A: extracted_mtime в CREATE');

        const msgCols = db.pragma('table_info(messages)').map((c) => c.name);
        assert.ok(!msgCols.includes('image_data'));
    });
});