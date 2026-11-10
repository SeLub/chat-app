// tests/controllers/projectController.test.js — ТЗ Project mode A (§6.1).
//
// Интеграционные тесты PROJECT-эндпоинтов через реальный express на эфемерном
// порту: POST /api/projects (валидный/traversal/без base/несуществующий/
// идемпотентность), GET /api/projects/:id/files (список/игнор-паттерны/фильтр/
// лимит 500), POST /api/projects/:id/attach (attach/идемпотентность/лимит
// размера/traversal), GET /api/sessions/:id/attachments (missing/mtimeStale),
// DELETE /api/sessions/:id/project (unlink + detach), PATCH /api/sessions/:id
// (mode валидация), GET /api/projects/:id.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { getDb, setDbPath, closeDb } from '../../src/db/init.js';
import * as sessionRepo from '../../src/db/sessionRepo.js';
import sessionRoutes from '../../src/routes/sessionRoutes.js';
import projectRoutes from '../../src/routes/projectRoutes.js';
import attachmentRoutes from '../../src/routes/attachmentRoutes.js';

describe('PROJECT API (ТЗ Project mode A)', () => {
    let app;
    let server;
    let baseUrl;
    let baseDir;       // CONTEXT_BASE_DIR
    let sessionId;
    const originalEnv = {};

    function saveEnv() {
        originalEnv.BASE = process.env.CONTEXT_BASE_DIR;
        originalEnv.MAX = process.env.MAX_REFERENCE_FILE_SIZE;
    }
    function restoreEnv() {
        if (originalEnv.BASE === undefined) delete process.env.CONTEXT_BASE_DIR;
        else process.env.CONTEXT_BASE_DIR = originalEnv.BASE;
        if (originalEnv.MAX === undefined) delete process.env.MAX_REFERENCE_FILE_SIZE;
        else process.env.MAX_REFERENCE_FILE_SIZE = originalEnv.MAX;
    }

    before(async () => {
        saveEnv();
        setDbPath(':memory:');
        getDb();

        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-base-'));
        process.env.CONTEXT_BASE_DIR = baseDir;

        app = express();
        app.use(express.json());
        app.use('/api/sessions', sessionRoutes);
        app.use('/api/projects', projectRoutes);
        app.use('/api/attachments', attachmentRoutes);
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
        closeDb();
        restoreEnv();
        await fs.rm(baseDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        getDb().exec('DELETE FROM attachments');
        getDb().exec('DELETE FROM messages');
        getDb().exec('DELETE FROM sessions');
        getDb().exec('DELETE FROM projects');
        delete process.env.MAX_REFERENCE_FILE_SIZE;
        sessionId = sessionRepo.createSession('Proj test').id;
    });

    /** Фикстура проекта в baseDir: валидные файлы + игнорируемые артефакты */
    async function makeProjectDir(name = 'my-repo') {
        const abs = path.join(baseDir, name);
        await fs.mkdir(path.join(abs, 'src'), { recursive: true });
        await fs.writeFile(path.join(abs, 'src', 'chat.ts'), 'export function chat() { return 1; }\n');
        await fs.writeFile(path.join(abs, 'src', 'store.ts'), 'export const store = {};\n');
        await fs.writeFile(path.join(abs, 'README.md'), '# my-repo\n');
        // игнор-паттерны §10.4 — не должны попасть в totalFiles/browse
        await fs.mkdir(path.join(abs, 'node_modules', 'lib'), { recursive: true });
        await fs.mkdir(path.join(abs, '.git'), { recursive: true });
        await fs.mkdir(path.join(abs, 'dist'), { recursive: true });
        await fs.mkdir(path.join(abs, 'build'), { recursive: true });
        await fs.mkdir(path.join(abs, '.next'), { recursive: true });
        await fs.mkdir(path.join(abs, '__pycache__'), { recursive: true });
        await fs.writeFile(path.join(abs, 'node_modules', 'lib', 'x.js'), 'x');
        await fs.writeFile(path.join(abs, '.git', 'config'), '[core]');
        await fs.writeFile(path.join(abs, 'dist', 'a.js'), 'a');
        await fs.writeFile(path.join(abs, 'build', 'b.js'), 'b');
        await fs.writeFile(path.join(abs, '.next', 'c.js'), 'c');
        await fs.writeFile(path.join(abs, '__pycache__', 'd.pyc'), 'd');
        await fs.writeFile(path.join(abs, 'bundle.min.js'), 'min');
        await fs.writeFile(path.join(abs, 'app.map'), 'map');
        await fs.writeFile(path.join(abs, '.DS_Store'), 'ds');
        await fs.writeFile(path.join(abs, 'Thumbs.db'), 'th');
        return abs;
    }

    describe('POST /api/projects (§3.3)', () => {
        it('валидный relativePath → projects row + sessions.project_id + mode=project + totalFiles (игнор-паттерны)', async () => {
            await makeProjectDir('my-repo');

            const res = await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'my-repo' }),
            });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.created, true);
            assert.equal(body.name, 'my-repo');
            assert.equal(body.path, 'my-repo');
            // только 3 валидных файла; node_modules/.git/dist/build/.next/__pycache__/
            // *.min.*/*.map/.DS_Store/Thumbs.db — исключены
            assert.equal(body.totalFiles, 3);

            const projectRow = getDb().prepare('SELECT * FROM projects WHERE path = ?').get('my-repo');
            assert.ok(projectRow, 'projects row создана');
            assert.equal(body.id, projectRow.id);

            const session = sessionRepo.getSession(sessionId);
            assert.equal(session.project_id, projectRow.id, 'sessions.project_id привязан');
            assert.equal(session.mode, 'project', 'sessions.mode = project');
        });

        it('relativePath "../etc" → 400 Path traversal detected', async () => {
            const res = await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: '../etc' }),
            });
            assert.equal(res.status, 400);
            assert.match((await res.json()).error, /traversal/i);
        });

        it('absolute relativePath "/etc" → 400 (вне CONTEXT_BASE_DIR)', async () => {
            const res = await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: '/etc' }),
            });
            assert.equal(res.status, 400);
            assert.match((await res.json()).error, /traversal/i);
        });

        it('без CONTEXT_BASE_DIR → 400', async () => {
            delete process.env.CONTEXT_BASE_DIR;
            try {
                const res = await fetch(`${baseUrl}/api/projects`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, relativePath: 'my-repo' }),
                });
                assert.equal(res.status, 400);
                assert.match((await res.json()).error, /CONTEXT_BASE_DIR/);
            } finally {
                process.env.CONTEXT_BASE_DIR = baseDir;
            }
        });

        it('несуществующая директория → 400 Project directory not found', async () => {
            const res = await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'no-such-repo' }),
            });
            assert.equal(res.status, 400);
            assert.match((await res.json()).error, /not found/i);
        });

        it('идемпотентность: повторный POST того же relativePath → created:false, та же строка', async () => {
            await makeProjectDir('idem-repo');

            const first = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'idem-repo' }),
            })).json();
            assert.equal(first.created, true);

            const second = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'idem-repo' }),
            })).json();
            assert.equal(second.created, false);
            assert.equal(second.id, first.id);

            const count = getDb().prepare('SELECT COUNT(*) AS n FROM projects WHERE path = ?').get('idem-repo').n;
            assert.equal(count, 1, 'дубль projects не создан');
        });

        it('§10.7 смена проекта: reference чужого проекта авто-detach', async () => {
            await makeProjectDir('proj-a');
            await makeProjectDir('proj-b');

            const a = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'proj-a' }),
            })).json();

            // attach файл из proj-a
            await fetch(`${baseUrl}/api/projects/${a.id}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['README.md'] }),
            });
            let refs = getDb().prepare("SELECT COUNT(*) AS n FROM attachments WHERE session_id = ? AND kind = 'reference'").get(sessionId).n;
            assert.equal(refs, 1);

            // переключаемся на proj-b
            const b = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'proj-b' }),
            })).json();
            assert.equal(b.created, true);

            refs = getDb().prepare("SELECT COUNT(*) AS n FROM attachments WHERE session_id = ? AND kind = 'reference'").get(sessionId).n;
            assert.equal(refs, 0, 'reference proj-a удалены при смене проекта');
            const session = sessionRepo.getSession(sessionId);
            assert.equal(session.project_id, b.id);
        });
    });

    describe('GET /api/projects/:id/files (§3.4)', () => {
        let projectId;

        beforeEach(async () => {
            await makeProjectDir('files-repo');
            const body = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'files-repo' }),
            })).json();
            projectId = body.id;
        });

        it('список файлов: путь/размер/language, total, только stat', async () => {
            const res = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.total, 3);
            assert.equal(body.truncated, false);
            const paths = body.files.map((f) => f.path).sort();
            assert.deepEqual(paths, ['README.md', 'src/chat.ts', 'src/store.ts']);
            const chat = body.files.find((f) => f.path === 'src/chat.ts');
            assert.equal(chat.language, 'typescript');
            assert.ok(chat.size > 0);
            assert.equal(chat.content, undefined, 'содержимое не читается');
        });

        it('фильтр по подстроке (регистронезависимо)', async () => {
            const body = await (await fetch(`${baseUrl}/api/projects/${projectId}/files?filter=READ`)).json();
            assert.equal(body.total, 1);
            assert.equal(body.files[0].path, 'README.md');
        });

        it('лимит 500: 505 файлов → files=500, total=505, truncated=true', async () => {
            const abs = path.join(baseDir, 'big-repo');
            await fs.mkdir(abs, { recursive: true });
            for (let i = 0; i < 505; i++) {
                await fs.writeFile(path.join(abs, `f_${String(i).padStart(3, '0')}.txt`), String(i));
            }
            const created = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'big-repo' }),
            })).json();

            const body = await (await fetch(`${baseUrl}/api/projects/${created.id}/files`)).json();
            assert.equal(body.total, 505);
            assert.equal(body.files.length, 500);
            assert.equal(body.truncated, true);
        });

        it('несуществующий projectId → 404', async () => {
            const res = await fetch(`${baseUrl}/api/projects/no-such-id/files`);
            assert.equal(res.status, 404);
        });
    });

    describe('POST /api/projects/:id/attach (§3.5)', () => {
        let projectId;
        let projectAbs;

        beforeEach(async () => {
            projectAbs = await makeProjectDir('attach-repo');
            const body = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'attach-repo' }),
            })).json();
            projectId = body.id;
        });

        it('attach 3 файлов → 3 reference-строки в attachments + attached в ответе', async () => {
            const res = await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['src/chat.ts', 'src/store.ts', 'README.md'] }),
            });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.errors.length, 0);
            assert.equal(body.attached.length, 3);
            assert.ok(body.attached.every((a) => a.kind === 'reference' && a.fileId));
            assert.equal(body.attached.find((a) => a.name === 'chat.ts').language, 'typescript');

            const rows = getDb().prepare("SELECT * FROM attachments WHERE session_id = ? AND kind = 'reference'").all(sessionId);
            assert.equal(rows.length, 3);
            for (const r of rows) {
                assert.equal(r.path_base, 'context');
                assert.equal(r.extracted_text, '', 'extracted_text пуст до первого чтения');
                assert.equal(r.extracted_mtime, null, 'extracted_mtime NULL до первого чтения');
                assert.ok(r.file_path.startsWith('attach-repo/'), 'file_path = <projectPath>/<rel>');
                assert.ok(fsSync.existsSync(path.join(baseDir, r.file_path)), 'реальный файл на диске');
            }
        });

        it('идемпотентность: повторный attach → existing fileId (skipped), без дублей', async () => {
            const payload = { sessionId, relativePaths: ['src/chat.ts', 'README.md'] };
            const first = await (await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            })).json();
            assert.equal(first.attached.length, 2);
            assert.ok(first.attached.every((a) => !a.skipped));

            const second = await (await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            })).json();
            assert.equal(second.attached.length, 2);
            assert.ok(second.attached.every((a) => a.skipped), 'повторный attach → skipped:true');
            assert.deepEqual(
                second.attached.map((a) => a.fileId).sort(),
                first.attached.map((a) => a.fileId).sort(),
            );

            const rows = getDb().prepare("SELECT COUNT(*) AS n FROM attachments WHERE session_id = ? AND kind = 'reference'").get(sessionId).n;
            assert.equal(rows, 2, 'дублей в БД нет');
        });

        it('большой файл → errors (attach не добавляет в БД, §5.5)', async () => {
            process.env.MAX_REFERENCE_FILE_SIZE = '5'; // README.md — ровно 10 байт
            const res = await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['README.md'] }),
            });
            const body = await res.json();
            assert.equal(body.attached.length, 0);
            assert.equal(body.errors.length, 1);
            assert.match(body.errors[0].error, /too large/i);
            const rows = getDb().prepare("SELECT COUNT(*) AS n FROM attachments WHERE session_id = ?").get(sessionId).n;
            assert.equal(rows, 0, 'файл НЕ добавлен в attachments');
        });

        it('traversal "../../etc/passwd" → errors', async () => {
            const body = await (await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['../../etc/passwd'] }),
            })).json();
            assert.equal(body.attached.length, 0);
            assert.match(body.errors[0].error, /traversal/i);
        });

        it('несуществующий файл → errors "File not found"; директория → errors', async () => {
            const body = await (await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['src/gone.ts', 'src'] }),
            })).json();
            assert.equal(body.errors.length, 2);
            assert.match(body.errors.find((e) => e.path === 'src/gone.ts').error, /not found/i);
            assert.match(body.errors.find((e) => e.path === 'src').error, /not a file/i);
        });

        it('§10.3: лимит 100 reference на сессию', async () => {
            const abs = path.join(baseDir, 'many-repo');
            await fs.mkdir(abs, { recursive: true });
            for (let i = 0; i < 105; i++) {
                await fs.writeFile(path.join(abs, `m_${String(i).padStart(3, '0')}.txt`), 'x');
            }
            const created = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'many-repo' }),
            })).json();

            const body = await (await fetch(`${baseUrl}/api/projects/${created.id}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: Array.from({ length: 105 }, (_, i) => `m_${String(i).padStart(3, '0')}.txt`) }),
            })).json();
            assert.equal(body.attached.length, 100, 'ровно 100 аттачится');
            assert.equal(body.errors.length, 5);
            assert.match(body.errors[0].error, /Max 100 reference files/);
        });
    });

    describe('GET /api/sessions/:id/attachments (§3.7) + DELETE detach (§3.6)', () => {
        let projectId;

        beforeEach(async () => {
            await makeProjectDir('list-repo');
            const body = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'list-repo' }),
            })).json();
            projectId = body.id;
            await fetch(`${baseUrl}/api/projects/${projectId}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['src/chat.ts'] }),
            });
        });

        it('список reference: filePath, missing=false; свежий attach → mtimeStale=true (кэш ещё пуст, §3.7)', async () => {
            const body = await (await fetch(`${baseUrl}/api/sessions/${sessionId}/attachments?kind=reference`)).json();
            assert.equal(body.attachments.length, 1);
            const a = body.attachments[0];
            assert.equal(a.name, 'chat.ts');
            assert.equal(a.kind, 'reference');
            assert.equal(a.language, 'typescript');
            assert.equal(a.filePath, 'list-repo/src/chat.ts');
            assert.equal(a.missing, false);
            assert.equal(a.mtimeStale, true, 'extracted_mtime=NULL !== mtimeMs → кэш считается устаревшим (обновится при сборке контекста)');
        });

        it('mtimeStale=true после искусственного устаревания extracted_mtime', async () => {
            const row = getDb().prepare("SELECT id FROM attachments WHERE session_id = ? AND kind = 'reference'").get(sessionId);
            getDb().prepare('UPDATE attachments SET extracted_mtime = 1000 WHERE id = ?').run(row.id);
            const body = await (await fetch(`${baseUrl}/api/sessions/${sessionId}/attachments`)).json();
            assert.equal(body.attachments[0].mtimeStale, true);
        });

        it('missing=true после удаления файла с диска', async () => {
            await fs.rm(path.join(baseDir, 'list-repo', 'src', 'chat.ts'));
            const body = await (await fetch(`${baseUrl}/api/sessions/${sessionId}/attachments`)).json();
            assert.equal(body.attachments[0].missing, true);
        });

        it('DELETE /api/attachments/:fileId → 200, строка удалена, файл на диске НЕ тронут (§3.6)', async () => {
            const row = getDb().prepare("SELECT id, file_path FROM attachments WHERE session_id = ? AND kind = 'reference'").get(sessionId);
            const diskPath = path.join(baseDir, row.file_path);
            assert.ok(fsSync.existsSync(diskPath));

            const res = await fetch(`${baseUrl}/api/attachments/${row.id}`, { method: 'DELETE' });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.ok, true);

            const count = getDb().prepare('SELECT COUNT(*) AS n FROM attachments WHERE id = ?').get(row.id).n;
            assert.equal(count, 0, 'строка реестра удалена');
            assert.ok(fsSync.existsSync(diskPath), 'файл на диске сохранён (orphan-политика)');

            // повторный DELETE → 404
            const again = await fetch(`${baseUrl}/api/attachments/${row.id}`, { method: 'DELETE' });
            assert.equal(again.status, 404);
        });
    });

    describe('PATCH /api/sessions/:id mode (§3.2)', () => {
        it('mode=project → 200, mode в БД; mode=research → project_id сохраняется', async () => {
            await makeProjectDir('mode-repo');
            const proj = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'mode-repo' }),
            })).json();

            const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'research' }),
            });
            assert.equal(res.status, 200);

            const session = sessionRepo.getSession(sessionId);
            assert.equal(session.mode, 'research');
            assert.equal(session.project_id, proj.id, 'project_id НЕ сбрасывается (правило §3.2)');

            const back = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'project' }),
            });
            assert.equal(back.status, 200);
            assert.equal(sessionRepo.getSession(sessionId).mode, 'project');
        });

        it('mode="chat" → 400 (валидация research|project)', async () => {
            const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'chat' }),
            });
            assert.equal(res.status, 400);
            assert.match((await res.json()).error, /research/);
        });
    });

    describe('GET /api/projects/:id + DELETE /api/sessions/:id/project (§10.8)', () => {
        it('GET /api/projects/:id → id/name/path (восстановление CurrentProject)', async () => {
            await makeProjectDir('info-repo');
            const proj = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'info-repo' }),
            })).json();

            const body = await (await fetch(`${baseUrl}/api/projects/${proj.id}`)).json();
            assert.equal(body.id, proj.id);
            assert.equal(body.name, 'info-repo');
            assert.equal(body.path, 'info-repo');
        });

        it('Remove project: project_id=NULL, mode=research, reference detach; файлы на диске целы', async () => {
            await makeProjectDir('rm-repo');
            const proj = await (await fetch(`${baseUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePath: 'rm-repo' }),
            })).json();
            await fetch(`${baseUrl}/api/projects/${proj.id}/attach`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, relativePaths: ['README.md'] }),
            });

            const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/project`, { method: 'DELETE' });
            assert.equal(res.status, 200);

            const session = sessionRepo.getSession(sessionId);
            assert.equal(session.project_id, null);
            assert.equal(session.mode, 'research');
            const refs = getDb().prepare("SELECT COUNT(*) AS n FROM attachments WHERE session_id = ? AND kind = 'reference'").get(sessionId).n;
            assert.equal(refs, 0, 'reference авто-detach при Remove');
            assert.ok(fsSync.existsSync(path.join(baseDir, 'rm-repo', 'README.md')), 'файл на диске не тронут');
            const projRow = getDb().prepare('SELECT COUNT(*) AS n FROM projects WHERE id = ?').get(proj.id).n;
            assert.equal(projRow, 1, 'строка projects сохранена (идемпотентность повторного POST)');
        });
    });
});
