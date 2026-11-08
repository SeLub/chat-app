import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setDbPath, getDb, closeDb } from '../../src/db/init.js';

/**
 * Фаза F (TZ-F.1/F.2): статика из webq98/dist + SPA-fallback.
 * Приложение поднимается на ephemeral-порту; БД — :memory: (setDbPath ДО
 * импорта app.js). dist/ в .gitignore — если сборки нет, создаём минимальную
 * фикстуру index.html (реальная сборка владельца не затрагивается).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'webq98', 'dist');
const distIndex = path.join(distDir, 'index.html');

function ensureDistFixture() {
    if (!fs.existsSync(distIndex)) {
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(
            distIndex,
            '<!doctype html><html><head><title>fixture</title></head><body><div id="root"></div><!-- tz-f-fixture --></body></html>',
        );
    }
    return fs.readFileSync(distIndex, 'utf8');
}

let app;
let server;
let base;
let indexHtml;

before(async () => {
    setDbPath(':memory:');
    getDb();
    indexHtml = ensureDistFixture();

    ({ default: app } = await import('../../src/app.js'));

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server?.close();
    closeDb();
});

async function get(urlPath) {
    const res = await fetch(`${base}${urlPath}`);
    return { status: res.status, headers: res.headers, body: await res.text() };
}

describe('Phase F: static from webq98/dist + SPA-fallback', () => {
    it('F.1.1: GET / отдаёт index.html из webq98/dist (не legacy public/index.html)', async () => {
        const res = await get('/');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') || '', /text\/html/);
        assert.equal(res.body, indexHtml);
    });

    it('F.1.2: SPA-fallback — глубокий маршрут /dashboard отдаёт index.html (React Router), не legacy dashboard.html', async () => {
        const res = await get('/dashboard');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') || '', /text\/html/);
        assert.equal(res.body, indexHtml);
    });

    it('F.1.3: GET /api/<miss> → 404 JSON { error: "Not found" } (не HTML)', async () => {
        const res = await get('/api/definitely-missing-endpoint');
        assert.equal(res.status, 404);
        assert.match(res.headers.get('content-type') || '', /application\/json/);
        assert.deepEqual(JSON.parse(res.body), { error: 'Not found' });
    });

    it('F.1.4: GET /ws/ai-helper (plain, без upgrade) → 404 JSON { error: "Not found" }', async () => {
        const res = await get('/ws/ai-helper');
        assert.equal(res.status, 404);
        assert.match(res.headers.get('content-type') || '', /application\/json/);
        assert.deepEqual(JSON.parse(res.body), { error: 'Not found' });
    });

    it('F.2.1: GET /vad-assets/vad.worklet.bundle.min.js → 200 + COOP/COEP (явная статика после переключения корня)', async () => {
        const res = await get('/vad-assets/vad.worklet.bundle.min.js');
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
        assert.equal(res.headers.get('cross-origin-embedder-policy'), 'credentialless');
    });

    it('F.2.2: GET /vad-assets/<miss> → 404 JSON { error: "Not found" }', async () => {
        const res = await get('/vad-assets/__definitely_missing__.js');
        assert.equal(res.status, 404);
        assert.match(res.headers.get('content-type') || '', /application\/json/);
        assert.deepEqual(JSON.parse(res.body), { error: 'Not found' });
    });

    it('F.1.5: GET /ai-helper-overlay.html — выделенного роута больше нет, отдаётся SPA (index.html)', async () => {
        const res = await get('/ai-helper-overlay.html');
        assert.equal(res.status, 200);
        assert.equal(res.body, indexHtml);
    });
});
