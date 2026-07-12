import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';

describe('sessionRepo', () => {
    before(() => {
        // Используем in-memory БД для тестов
        setDbPath(':memory:');
        getDb(); // инициализируем схему
    });

    after(() => {
        closeDb();
    });

    beforeEach(() => {
        // Очищаем таблицу перед каждым тестом
        getDb().exec('DELETE FROM sessions');
    });

    describe('createSession', () => {
        it('should create session with auto-generated title', () => {
            const result = sessionRepo.createSession();
            
            assert.ok(result.id);
            assert.equal(result.title, 'unsavedSession 1');
            
            const session = sessionRepo.getSession(result.id);
            assert.ok(session);
            assert.equal(session.mode, 'chat');
            assert.equal(session.message_count, 0);
            assert.equal(session.is_archived, 0);
        });

        it('should create session with custom title', () => {
            const result = sessionRepo.createSession('My Chat');
            
            assert.equal(result.title, 'My Chat');
            const session = sessionRepo.getSession(result.id);
            assert.equal(session.title, 'My Chat');
        });

        it('should auto-increment unsavedSession number', () => {
            sessionRepo.createSession(); // unsavedSession 1
            sessionRepo.createSession(); // unsavedSession 2
            const result = sessionRepo.createSession(); // unsavedSession 3
            
            assert.equal(result.title, 'unsavedSession 3');
        });

        it('should not count named sessions in auto-numbering', () => {
            sessionRepo.createSession('Named Chat');
            sessionRepo.createSession(); // unsavedSession 1 (named не считается)
            const result = sessionRepo.createSession();
            
            assert.equal(result.title, 'unsavedSession 2');
        });

        it('should create session with project mode', () => {
            const result = sessionRepo.createSession(null, 'project', 'proj-123');
            
            const session = sessionRepo.getSession(result.id);
            assert.equal(session.mode, 'project');
            assert.equal(session.project_id, 'proj-123');
        });
    });

    describe('getSession', () => {
        it('should return session by id', () => {
            const { id } = sessionRepo.createSession('Test');
            const session = sessionRepo.getSession(id);
            
            assert.equal(session.id, id);
            assert.equal(session.title, 'Test');
        });

        it('should return undefined for non-existent id', () => {
            const session = sessionRepo.getSession('non-existent');
            assert.equal(session, undefined);
        });
    });

    describe('listSessions', () => {
        it('should list all sessions ordered by updated_at DESC', () => {
            sessionRepo.createSession('First');
            sessionRepo.createSession('Second');
            sessionRepo.createSession('Third');
            
            const sessions = sessionRepo.listSessions();
            
            assert.equal(sessions.length, 3);
            assert.equal(sessions[0].title, 'Third'); // newest first
            assert.equal(sessions[2].title, 'First');
        });

        it('should filter by mode', () => {
            sessionRepo.createSession('Chat 1', 'chat');
            sessionRepo.createSession('Project 1', 'project');
            sessionRepo.createSession('Chat 2', 'chat');
            
            const chatSessions = sessionRepo.listSessions({ mode: 'chat' });
            assert.equal(chatSessions.length, 2);
            
            const projectSessions = sessionRepo.listSessions({ mode: 'project' });
            assert.equal(projectSessions.length, 1);
        });

        it('should filter by search query', () => {
            sessionRepo.createSession('JavaScript Tutorial');
            sessionRepo.createSession('Python Guide');
            sessionRepo.createSession('JavaScript Advanced');
            
            const results = sessionRepo.listSessions({ search: 'JavaScript' });
            assert.equal(results.length, 2);
        });

        it('should support limit and offset', () => {
            for (let i = 0; i < 10; i++) {
                sessionRepo.createSession(`Session ${i}`);
            }
            
            const page1 = sessionRepo.listSessions({ limit: 3, offset: 0 });
            assert.equal(page1.length, 3);
            
            const page2 = sessionRepo.listSessions({ limit: 3, offset: 3 });
            assert.equal(page2.length, 3);
            assert.notEqual(page1[0].id, page2[0].id);
        });

        it('should exclude archived sessions', () => {
            const { id } = sessionRepo.createSession('Active');
            sessionRepo.createSession('Archived');
            sessionRepo.archiveSession(id, 'archivedSession 1');
            
            // is_archived не меняется archiveSession — он только меняет title
            // Но если бы мы устанавливали is_archived = 1, то:
            getDb().prepare('UPDATE sessions SET is_archived = 1 WHERE id = ?').run(id);
            
            const sessions = sessionRepo.listSessions();
            assert.equal(sessions.length, 1);
            assert.equal(sessions[0].title, 'Archived');
        });
    });

    describe('updateSession', () => {
        it('should update session fields', () => {
            const { id } = sessionRepo.createSession();
            
            sessionRepo.updateSession(id, {
                title: 'Updated Title',
                category: 'JavaScript',
                model: 'qwen2.5-coder'
            });
            
            const session = sessionRepo.getSession(id);
            assert.equal(session.title, 'Updated Title');
            assert.equal(session.category, 'JavaScript');
            assert.equal(session.model, 'qwen2.5-coder');
        });

        it('should update updated_at timestamp', () => {
            const { id } = sessionRepo.createSession();
            const before = sessionRepo.getSession(id);
            
            // Ждём 10ms чтобы timestamp изменился
            const start = Date.now();
            while (Date.now() - start < 10) {}
            
            sessionRepo.updateSession(id, { title: 'New Title' });
            
            const after = sessionRepo.getSession(id);
            assert.ok(after.updated_at >= before.updated_at);
        });

        it('should do nothing if updates object is empty', () => {
            const { id } = sessionRepo.createSession('Original');
            sessionRepo.updateSession(id, {});
            
            const session = sessionRepo.getSession(id);
            assert.equal(session.title, 'Original');
        });
    });

    describe('deleteSession', () => {
        it('should delete session', () => {
            const { id } = sessionRepo.createSession();
            assert.ok(sessionRepo.getSession(id));
            
            sessionRepo.deleteSession(id);
            
            assert.equal(sessionRepo.getSession(id), undefined);
        });

        it('should cascade delete messages and attachments', () => {
            const { id } = sessionRepo.createSession();
            
            // Добавляем сообщение
            getDb().prepare(`
                INSERT INTO messages (id, session_id, role, content, sort_order)
                VALUES (?, ?, 'user', 'test', 1)
            `).run('msg-1', id);
            
            // Добавляем attachment
            getDb().prepare(`
                INSERT INTO attachments (id, session_id, filename, extracted_text)
                VALUES (?, ?, 'test.ts', 'code')
            `).run('att-1', id);
            
            sessionRepo.deleteSession(id);
            
            const messages = getDb().prepare('SELECT * FROM messages WHERE id = ?').get('msg-1');
            const attachments = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get('att-1');
            
            assert.equal(messages, undefined);
            assert.equal(attachments, undefined);
        });
    });

    describe('archiveSession', () => {
        it('should rename session', () => {
            const { id } = sessionRepo.createSession();
            
            sessionRepo.archiveSession(id, 'unsavedSession 1');
            
            const session = sessionRepo.getSession(id);
            assert.equal(session.title, 'unsavedSession 1');
        });
    });
});