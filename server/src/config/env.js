// src/config/env.js — загрузка .env независимо от cwd (фикс после R.2).
//
// Проблема: `import 'dotenv/config'` в server.js искал .env от process.cwd().
// До R.2 cwd был корнем репо (там и жил .env владельца). После переезда бэкенда
// в server/ cwd стал server/ — корневой .env перестал находиться, все переменные
// откатились на дефолты кода (DEFAULT_PROVIDER=ollama, LLAMA_CPP_ENABLED=false
// из-за строгого `=== 'true'`): работающий llama-server игнорировался,
// /api/models → 503 «All providers are currently unavailable».
//
// Решение: путь к .env резолвится от __dirname модуля — cwd больше не важен
// (`node src/server.js` можно запускать из любого каталога).
//
// NB: этот модуль ДОЛЖЕН импортироваться в server.js ПЕРВЫМ — до app.js
// (config/providers.js читает process.env в момент импорта).

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Пути поиска .env по приоритету:
// 1) server/.env — основное расположение (рядом с package.json бэкенда);
// 2) <repo-root>/.env — legacy-fallback на время миграции (R.2): dotenv не
//    переопределяет уже установленные переменные, поэтому server/.env всегда
//    выигрывает; переменные, заданные только в корневом .env, подхватываются.
export const envPaths = [
    path.resolve(__dirname, '..', '..', '.env'),       // server/.env
    path.resolve(__dirname, '..', '..', '..', '.env'), // <repo-root>/.env (legacy)
];

/**
 * Загружает .env-файлы по списку путей (по порядку, без переопределения).
 * @param {string[]} paths
 * @returns {string[]} пути файлов, которые реально существовали и загрузились
 */
export function loadEnv(paths = envPaths) {
    const loaded = [];
    for (const p of paths) {
        const res = dotenv.config({ path: p });
        if (!res.error) loaded.push(p);
    }
    return loaded;
}

loadEnv();
