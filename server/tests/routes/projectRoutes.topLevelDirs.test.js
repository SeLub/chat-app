// ТЗ attach-files-for-project-mode §4.1: GET /api/projects/:id/top-level-dirs.
// Интеграционные тесты через реальный express (как projectController.test.js).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import projectRoutes from '../../src/routes/projectRoutes.js';

describe('GET /api/projects/:id/top-level-dirs', () => {
  let app, server, baseUrl, baseDir, sessionId;
  const originalEnv = {};

  before(async () => {
    originalEnv.BASE = process.env.CONTEXT_BASE_DIR;
    setDbPath(':memory:');
    getDb();
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tld-base-'));
    process.env.CONTEXT_BASE_DIR = baseDir;

    app = express();
    app.use(express.json());
    app.use('/api/projects', projectRoutes);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    closeDb();
    if (originalEnv.BASE === undefined) delete process.env.CONTEXT_BASE_DIR;
    else process.env.CONTEXT_BASE_DIR = originalEnv.BASE;
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    getDb().exec('DELETE FROM attachments');
    getDb().exec('DELETE FROM messages');
    getDb().exec('DELETE FROM sessions');
    getDb().exec('DELETE FROM projects');
    sessionId = sessionRepo.createSession('TLD test').id;
  });

  function req(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlPath, baseUrl);
      const data = body ? JSON.stringify(body) : null;
      const r = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null }));
        },
      );
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }

  it('200 with sorted dirs, ignoring IGNORED_DIRS', async () => {
    const projDir = path.join(baseDir, 'tld-proj');
    await fs.mkdir(path.join(projDir, 'server'), { recursive: true });
    await fs.mkdir(path.join(projDir, 'frontend'), { recursive: true });
    await fs.mkdir(path.join(projDir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(projDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(projDir, '.git'), { recursive: true });
    await fs.mkdir(path.join(projDir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(projDir, 'package.json'), '{}');

    const createRes = await req('POST', '/api/projects', { sessionId, relativePath: 'tld-proj' });
    assert.equal(createRes.status, 200);
    const projectId = createRes.body.id;

    const res = await req('GET', `/api/projects/${projectId}/top-level-dirs`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.dirs, ['docs', 'frontend', 'server']);
  });

  it('empty project — dirs: []', async () => {
    const projDir = path.join(baseDir, 'tld-empty');
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(path.join(projDir, 'README.md'), '# empty');

    const createRes = await req('POST', '/api/projects', { sessionId, relativePath: 'tld-empty' });
    assert.equal(createRes.status, 200);
    const projectId = createRes.body.id;

    const res = await req('GET', `/api/projects/${projectId}/top-level-dirs`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.dirs, []);
  });

  it('404 for nonexistent project', async () => {
    const res = await req('GET', '/api/projects/nonexistent-xyz/top-level-dirs');
    assert.equal(res.status, 404);
  });
});
