// tests/routes/configRoutes.test.js — ТЗ Project mode A (§3.1, §6.1).
//
// GET /api/config → { contextBaseDir: { ok, path, error } }.
// Реальный express на эфемерном порту + fetch (паттерн attachmentRoutes.test.js).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import configRoutes from '../../src/routes/configRoutes.js';

describe('GET /api/config (ТЗ Project mode A §3.1)', () => {
    let app;
    let server;
    let baseUrl;

    before(async () => {
        app = express();
        app.use('/api/config', configRoutes);
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
        delete process.env.CONTEXT_BASE_DIR;
    });

    it('CONTEXT_BASE_DIR не настроен → contextBaseDir.ok=false с error', async () => {
        delete process.env.CONTEXT_BASE_DIR;
        const res = await fetch(`${baseUrl}/api/config`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.contextBaseDir.ok, false);
        assert.equal(body.contextBaseDir.path, null);
        assert.match(body.contextBaseDir.error, /not configured/);
    });

    it('CONTEXT_BASE_DIR — существующая директория → ok=true, path абсолютный', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfg-routes-'));
        process.env.CONTEXT_BASE_DIR = dir;
        try {
            const res = await fetch(`${baseUrl}/api/config`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.contextBaseDir.ok, true);
            assert.equal(body.contextBaseDir.path, path.resolve(dir));
            assert.equal(body.contextBaseDir.error, null);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
            delete process.env.CONTEXT_BASE_DIR;
        }
    });

    it('CONTEXT_BASE_DIR не существует → ok=false "does not exist"', async () => {
        process.env.CONTEXT_BASE_DIR = path.join(os.tmpdir(), `ghost-${Date.now()}`);
        const res = await fetch(`${baseUrl}/api/config`);
        const body = await res.json();
        assert.equal(body.contextBaseDir.ok, false);
        assert.match(body.contextBaseDir.error, /does not exist/);
        delete process.env.CONTEXT_BASE_DIR;
    });
});
