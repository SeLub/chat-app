import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, envPaths } from '../../src/config/env.js';

/**
 * Фикс после R.2: `import 'dotenv/config'` искал .env от process.cwd().
 * До R.2 cwd был корнем репо (там жил .env), после переезда бэкенда в server/
 * корневой .env перестал находиться → дефолты (llama_cpp disabled) →
 * /api/models 503 «All providers are currently unavailable».
 * Регрессия: .env резолвится от __dirname модуля, cwd не важен.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..', '..');  // server/
const repoRoot = path.resolve(serverDir, '..');          // корень репо

describe('config/env — .env независимо от cwd (фикс R.2)', () => {
    it('пути поиска: server/.env основной, корневой .env — legacy-fallback', () => {
        assert.equal(envPaths[0], path.join(serverDir, '.env'));
        assert.equal(envPaths[1], path.join(repoRoot, '.env'));
    });

    it('loadEnv: первый файл приоритетен (dotenv не переопределяет уже заданные)', () => {
        const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'env-server-'));
        const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'env-root-'));
        fs.writeFileSync(path.join(dirA, '.env'), 'TZ_ENV_TEST_KEY=from_server\n');
        fs.writeFileSync(path.join(dirB, '.env'), 'TZ_ENV_TEST_KEY=from_root\nTZ_ENV_TEST_ONLY_ROOT=ok\n');
        try {
            const loaded = loadEnv([path.join(dirA, '.env'), path.join(dirB, '.env')]);
            assert.equal(loaded.length, 2);
            // ключ задан в обоих: побеждает первый (server/.env)
            assert.equal(process.env.TZ_ENV_TEST_KEY, 'from_server');
            // ключ только в fallback: подхватывается из второго
            assert.equal(process.env.TZ_ENV_TEST_ONLY_ROOT, 'ok');
        } finally {
            delete process.env.TZ_ENV_TEST_KEY;
            delete process.env.TZ_ENV_TEST_ONLY_ROOT;
            fs.rmSync(dirA, { recursive: true, force: true });
            fs.rmSync(dirB, { recursive: true, force: true });
        }
    });

    it('loadEnv: отсутствующий .env не бросает ошибку и не загружается', () => {
        const loaded = loadEnv([path.join(os.tmpdir(), 'no-such-dir-tz-env', '.env')]);
        assert.deepEqual(loaded, []);
    });
});
