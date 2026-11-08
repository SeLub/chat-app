import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import * as attachmentRepo from '../../src/db/attachmentRepo.js';

describe('attachmentRepo', () => {
    let sessionId;
    let tempDir;
    let testFilePath;

    before(async () => {
        setDbPath(':memory:');
        getDb();

        // Создаём временную директорию с тестовыми файлами
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-test-'));
        testFilePath = path.join(tempDir, 'sample.ts');
        await fs.writeFile(testFilePath, `
export function greet(name: string): string {
    return \`Hello, \${name}!\`;
}

export class UserService {
    private users: string[] = [];
    
    addUser(name: string): void {
        this.users.push(name);
    }
}
        `.trim());
    });

    after(async () => {
        closeDb();
        // Удаляем временные файлы
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM sessions');
        sessionId = sessionRepo.createSession('Test Session').id;
    });

    describe('extractFromPaths', () => {
        it('should extract text from file and save to DB', async () => {
            const { results, errors } = await attachmentRepo.extractFromPaths(
                [testFilePath], sessionId
            );

            assert.equal(errors.length, 0);
            assert.equal(results.length, 1);
            assert.equal(results[0].name, 'sample.ts');
            assert.equal(results[0].type, 'typescript');
            assert.ok(results[0].fileId);
            assert.ok(results[0].size > 0);

            // Проверяем что текст сохранён в БД
            const attachment = attachmentRepo.getAttachment(results[0].fileId);
            assert.ok(attachment);
            assert.ok(attachment.extracted_text.includes('greet'));
            assert.ok(attachment.extracted_text.includes('UserService'));
        });

        it('should handle multiple files', async () => {
            const secondFile = path.join(tempDir, 'utils.js');
            await fs.writeFile(secondFile, 'export const add = (a, b) => a + b;');

            const { results, errors } = await attachmentRepo.extractFromPaths(
                [testFilePath, secondFile], sessionId
            );

            assert.equal(errors.length, 0);
            assert.equal(results.length, 2);
            assert.equal(results[0].type, 'typescript');
            assert.equal(results[1].type, 'javascript');
        });

        it('should return error for non-existent file', async () => {
            const { results, errors } = await attachmentRepo.extractFromPaths(
                ['/non/existent/file.ts'], sessionId
            );

            assert.equal(results.length, 0);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].error.includes('ENOENT') || errors[0].error.length > 0);
        });

        it('should handle mix of valid and invalid files', async () => {
            const { results, errors } = await attachmentRepo.extractFromPaths(
                [testFilePath, '/non/existent.ts'], sessionId
            );

            assert.equal(results.length, 1);
            assert.equal(errors.length, 1);
        });

        it('should detect language from extension', async () => {
            const files = {
                'test.py': 'python',
                'test.go': 'go',
                'test.rs': 'rust',
                'test.java': 'java',
                'test.c': 'c',
                'test.cpp': 'cpp',
                'test.html': 'html',
                'test.css': 'css',
                'test.json': 'json',
                'test.md': 'markdown',
                'test.txt': 'text'
            };

            const paths = [];
            for (const [filename, _] of Object.entries(files)) {
                const filePath = path.join(tempDir, filename);
                await fs.writeFile(filePath, 'content');
                paths.push(filePath);
            }

            const { results } = await attachmentRepo.extractFromPaths(paths, sessionId);
            
            for (const result of results) {
                const expectedLang = files[result.name];
                assert.equal(result.type, expectedLang, 
                    `Expected ${expectedLang} for ${result.name}`);
            }
        });
    });

    describe('getAttachment', () => {
        it('should return attachment by fileId', async () => {
            const { results } = await attachmentRepo.extractFromPaths(
                [testFilePath], sessionId
            );

            const attachment = attachmentRepo.getAttachment(results[0].fileId);
            
            assert.ok(attachment);
            assert.equal(attachment.id, results[0].fileId);
            assert.equal(attachment.session_id, sessionId);
            assert.equal(attachment.filename, 'sample.ts');
            assert.ok(attachment.extracted_text.length > 0);
        });

        it('should return undefined for non-existent fileId', () => {
            const attachment = attachmentRepo.getAttachment('non-existent');
            assert.equal(attachment, undefined);
        });
    });

    describe('getAttachmentsByIds', () => {
        it('should return multiple attachments', async () => {
            const secondFile = path.join(tempDir, 'second.js');
            await fs.writeFile(secondFile, 'const x = 1;');

            const { results } = await attachmentRepo.extractFromPaths(
                [testFilePath, secondFile], sessionId
            );

            const fileIds = results.map(r => r.fileId);
            const attachments = attachmentRepo.getAttachmentsByIds(fileIds);

            assert.equal(attachments.length, 2);
        });

        it('should return empty array for empty input', () => {
            const attachments = attachmentRepo.getAttachmentsByIds([]);
            assert.deepEqual(attachments, []);
        });

        it('should return only existing attachments', async () => {
            const { results } = await attachmentRepo.extractFromPaths(
                [testFilePath], sessionId
            );

            const attachments = attachmentRepo.getAttachmentsByIds([
                results[0].fileId,
                'non-existent'
            ]);

            assert.equal(attachments.length, 1);
        });
    });
});