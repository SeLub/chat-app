import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
        setDbPath(':memory:');
        const db = getDb();

        const journalMode = db.pragma('journal_mode', { simple: true });
        const foreignKeys = db.pragma('foreign_keys', { simple: true });

        assert.equal(journalMode, 'wal');
        assert.equal(foreignKeys, 1);
    });

    it('should be idempotent (multiple calls safe)', () => {
        setDbPath(':memory:');
        
        const db1 = getDb();
        const db2 = getDb();
        
        assert.equal(db1, db2); // same instance
    });
});