import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
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

    describe('S.2 реестр: kind / path_base / insertAttachment / getAttachmentPath', () => {
        it('extractFromPaths пишет kind (по умолчанию document), file_path=null и kind в results', async () => {
            const { results } = await attachmentRepo.extractFromPaths([testFilePath], sessionId, 'code');

            assert.equal(results[0].kind, 'code');

            const row = attachmentRepo.getAttachment(results[0].fileId);
            assert.equal(row.kind, 'code');
            assert.equal(row.path_base, 'context');
            assert.equal(row.file_path, null, 'RESEARCH: tmp-файл удаляется — путь не храним');
        });

        it('extractFromPaths без явного kind → document', async () => {
            const { results } = await attachmentRepo.extractFromPaths([testFilePath], sessionId);
            const row = attachmentRepo.getAttachment(results[0].fileId);
            assert.equal(row.kind, 'document');
        });

        it('insertAttachment сохраняет полный набор колонок (изображение)', () => {
            const id = crypto.randomUUID();
            attachmentRepo.insertAttachment({
                id,
                sessionId,
                filename: 'photo.png',
                filePath: 'uploads/s1_q1.png',
                mimeType: 'image/png',
                fileSize: 123,
                extractedText: '',
                language: 'image',
                kind: 'image',
                pathBase: 'data',
            });

            const row = attachmentRepo.getAttachment(id);
            assert.equal(row.kind, 'image');
            assert.equal(row.path_base, 'data');
            assert.equal(row.file_path, 'uploads/s1_q1.png');
            assert.equal(row.extracted_text, '');
            assert.equal(row.language, 'image');
        });

        it('getAttachmentPath: path_base=data резолвится внутрь server/data', () => {
            const id = crypto.randomUUID();
            attachmentRepo.insertAttachment({
                id, sessionId, filename: 'photo.png',
                filePath: 'uploads/x.png', extractedText: '',
                kind: 'image', pathBase: 'data',
            });

            const resolved = attachmentRepo.getAttachmentPath(id);
            assert.ok(path.isAbsolute(resolved));
            assert.ok(resolved.endsWith(path.join('data', 'uploads', 'x.png')));
        });

        it('getAttachmentPath: path_base=context резолвится от CONTEXT_BASE_DIR', async () => {
            const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctx-base-'));
            process.env.CONTEXT_BASE_DIR = baseDir;
            try {
                const id = crypto.randomUUID();
                attachmentRepo.insertAttachment({
                    id, sessionId, filename: 'proj.ts',
                    filePath: 'zoog/main.ts', extractedText: '',
                    kind: 'reference', pathBase: 'context',
                });

                const resolved = attachmentRepo.getAttachmentPath(id);
                assert.equal(resolved, path.resolve(baseDir, 'zoog/main.ts'));
            } finally {
                delete process.env.CONTEXT_BASE_DIR;
                await fs.rm(baseDir, { recursive: true, force: true });
            }
        });

        it('getAttachmentPath: traversal (../) отвергается', async () => {
            const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctx-base-'));
            process.env.CONTEXT_BASE_DIR = baseDir;
            try {
                const id = crypto.randomUUID();
                attachmentRepo.insertAttachment({
                    id, sessionId, filename: 'evil',
                    filePath: '../etc/passwd', extractedText: '',
                    kind: 'reference', pathBase: 'context',
                });

                assert.throws(
                    () => attachmentRepo.getAttachmentPath(id),
                    /Path traversal/,
                );
            } finally {
                delete process.env.CONTEXT_BASE_DIR;
                await fs.rm(baseDir, { recursive: true, force: true });
            }
        });

        it('getAttachmentPath: без CONTEXT_BASE_DIR → ошибка, не молчаливый null', () => {
            delete process.env.CONTEXT_BASE_DIR;
            const id = crypto.randomUUID();
            attachmentRepo.insertAttachment({
                id, sessionId, filename: 'proj.ts',
                filePath: 'zoog/main.ts', extractedText: '',
                kind: 'reference', pathBase: 'context',
            });

            assert.throws(
                () => attachmentRepo.getAttachmentPath(id),
                /CONTEXT_BASE_DIR/,
            );
        });

        it('getAttachmentPath: нет file_path (RESEARCH-документ) → null', async () => {
            const { results } = await attachmentRepo.extractFromPaths([testFilePath], sessionId);
            assert.equal(attachmentRepo.getAttachmentPath(results[0].fileId), null);
        });
    });
});