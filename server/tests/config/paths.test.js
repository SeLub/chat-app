// tests/config/paths.test.js — ТЗ Project mode A (§3.1, §10.2, §6.1).
//
// getContextBaseDirStatus: ok=false при отсутствии/несуществовании/не-директории,
// ok=true при существующей директории. getMaxReferenceFileSize: env → 1 MB default.
// resolveAttachmentPath (traversal-guard) покрыт в attachmentRepo.test.js.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getContextBaseDirStatus, getMaxReferenceFileSize } from '../../src/config/paths.js';

describe('getContextBaseDirStatus (ТЗ Project mode A §3.1)', () => {
    after(() => {
        delete process.env.CONTEXT_BASE_DIR;
        delete process.env.MAX_REFERENCE_FILE_SIZE;
    });

    it('CONTEXT_BASE_DIR не задан → ok=false, path=null, error="not configured"', () => {
        delete process.env.CONTEXT_BASE_DIR;
        const status = getContextBaseDirStatus();
        assert.equal(status.ok, false);
        assert.equal(status.path, null);
        assert.match(status.error, /not configured/);
    });

    it('CONTEXT_BASE_DIR пустая строка/пробелы → ok=false', () => {
        process.env.CONTEXT_BASE_DIR = '   ';
        const status = getContextBaseDirStatus();
        assert.equal(status.ok, false);
        assert.match(status.error, /not configured/);
    });

    it('CONTEXT_BASE_DIR не существует → ok=false, path — абсолютный путь', () => {
        process.env.CONTEXT_BASE_DIR = path.join(os.tmpdir(), `no-such-dir-${Date.now()}`);
        const status = getContextBaseDirStatus();
        assert.equal(status.ok, false);
        assert.ok(path.isAbsolute(status.path));
        assert.match(status.error, /does not exist/);
    });

    it('CONTEXT_BASE_DIR — файл, не директория → ok=false "not a directory"', () => {
        const file = path.join(os.tmpdir(), `ctx-file-${Date.now()}.txt`);
        fs.writeFileSync(file, 'x');
        try {
            process.env.CONTEXT_BASE_DIR = file;
            const status = getContextBaseDirStatus();
            assert.equal(status.ok, false);
            assert.match(status.error, /not a directory/);
        } finally {
            fs.unlinkSync(file);
        }
    });

    it('CONTEXT_BASE_DIR — существующая директория → ok=true, path абсолютный, error=null', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ok-'));
        try {
            process.env.CONTEXT_BASE_DIR = dir;
            const status = getContextBaseDirStatus();
            assert.equal(status.ok, true);
            assert.equal(status.path, path.resolve(dir));
            assert.equal(status.error, null);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('getMaxReferenceFileSize (ТЗ Project mode A §10.2)', () => {
    it('по умолчанию 1 MB (1048576)', () => {
        delete process.env.MAX_REFERENCE_FILE_SIZE;
        assert.equal(getMaxReferenceFileSize(), 1048576);
    });

    it('читает MAX_REFERENCE_FILE_SIZE из env', () => {
        process.env.MAX_REFERENCE_FILE_SIZE = '2048';
        assert.equal(getMaxReferenceFileSize(), 2048);
    });

    it('некорректное значение env → fallback 1 MB', () => {
        process.env.MAX_REFERENCE_FILE_SIZE = 'abc';
        assert.equal(getMaxReferenceFileSize(), 1048576);
        process.env.MAX_REFERENCE_FILE_SIZE = '-5';
        assert.equal(getMaxReferenceFileSize(), 1048576);
    });
});
