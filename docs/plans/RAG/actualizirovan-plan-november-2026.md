# План: Vector Database for Repository Code Indexing & Semantic Search (Актуализированный под реальный PROJECT mode)

> **Статус:** актуализированная версия исходного плана (векторная БД + Qdrant) с учётом **уже реализованного** PROJECT mode (PR #16, §3.8) и решений D1/D2/D3.
>
> **Принципиальное отличие от исходного плана:** это **RAG-слой поверх существующего PROJECT mode**, а не «новый Project mode». Всё, что уже есть (`sessions.mode`, `projects`, `attachments`, `buildLLMContext`, `[Материалы]` / `[Ранее]` / `[Вопрос]`, `ModeToggle`, `ProjectPanel`, `CONTEXT_BASE_DIR`, traversal-protection) — **переиспользуется**. Новое — только то, чего нет: Qdrant, embedding-сервер, Tree-sitter, индексация, гибридный поиск, бюджет RAG.
>
> **Документ разделён на две части:**
> - **Часть 1 — План** (что реализуем сейчас): встроенный в PROJECT mode полный вариант, без дублей, с исправленными D1/D2/D3, но **без** watch/streaming/hybrid/called_by (отложены).
> - **Часть 2 — Дополнение к плану** (что отложили): на каждое отложенное решение — подпункт с описанием, обоснованием и условиями возврата.

---

# ЧАСТЬ 1. ПЛАН (к реализации)

## 1.1. Overview

Интегрировать Qdrant в chat-app для индексации локальных проектов и семантического поиска по коду. Это **не новый режим**, а **RAG-слой** внутри **существующего** PROJECT mode.

**Ключевые решения:**
- Embedding-модель (`mxbai-embed-large`, 335M) — **в RAM** через llama.cpp (порт 8081, CPU).
- Chat-модель (Qwen3.6-35B) — **в VRAM** через llama.cpp (порт 8080, GPU).
- **Tree-sitter** для AST-парсинга (JS/TS/Python/Go/Rust; для остальных — generic chunking).
- **Semantic search** (top-K) — в этой итерации; hybrid — отложен (Часть 2, §2.4).
- **Инкрементальная индексация** по `content_hash` (SHA-256).
- **Ручная переиндексация** (кнопка); watch — отложен (Часть 2, §2.5).
- **JSON-ответ** (`/api/project/query` возвращает JSON, как `/api/chat`); streaming — отложен (Часть 2, §2.6).
- **`RAG_BUDGET` — производная** от `contextLength × retainPercent` (не константа).

## 1.2. Что переиспользуется из существующего PROJECT mode

| Существующее | Где | Как используется |
|---|---|---|
| `sessions.mode = 'research' \| 'project'` | `sessions` (PR #16) | Без изменений. UI-надпись — «Research / Project» (алиас «Chat» → `research`). |
| `projects` таблица (`id`, `name`, `path` — **относительный** от `CONTEXT_BASE_DIR`) | `projectRepo.js` (PR #16) | Без изменений. **Не** создаём `projects.path` абсолютным (D2). |
| `POST /api/projects` (`createProject`, `bindSessionToProject`, `detachForeignReferences`) | `projectController.js` / `projectService.js` (PR #16) | **Переиспользуется как есть**. Не создаём `POST /api/project/setup`. |
| `POST /api/projects/:id/attach` (`attachReferenceFiles`) | `projectService.js` (PR #16) | **Переиспользуется как есть** для attach файлов. Не создаём `POST /api/project/attach-file`. |
| `attachments` (`kind='reference'`, `path_base='context'`) | `attachmentRepo.js` (PR #16) | **Источник** attached-файлов для `[Материалы]`. Qdrant — **отдельный** индекс, не смешивать. |
| `buildLLMContext(..., mode='project')` + mtime-кэш reference-файлов | `contextBuilder.js` (PR #16) | **Расширяем**: добавляем блок `[Релевантные фрагменты]` между `[Материалы]` и `[Ранее]`. Не меняем формат `[Материалы]` / `[Ранее]` / `[Вопрос]`. |
| `resolveAttachmentPath` + `getContextBaseDirStatus` (traversal-protection) | `paths.js` (PR #16) | **Переиспользуем** для резолва project path и путей файлов в Qdrant. |
| `ModeToggle`, `ProjectPanel` | `mode-toggle.tsx`, `project-panel.tsx` (PR #16) | **Расширяем** `ProjectPanel`: статус индексации, кнопка «Re-index», attached files (уже есть). |
| `providerMiddleware`, `getProvider` | `providerMiddleware.js` | Без изменений. RAG-запрос идёт через существующий `/api/chat`-провайдер. |

## 1.3. Архитектура (актуализированная)

```
┌─────────────────────────────────────────────────────────────┐
│  Chat App (Node)                                             │
│  ├─ /api/chat           (существующий, JSON)                 │
│  ├─ /api/projects/*     (существующий, PR #16)               │
│  ├─ /api/repos/*        (НОВЫЙ: index/search/collections)    │
│  └─ /api/project/query  (НОВЫЙ: RAG + chat, JSON)            │
└────────┬─────────────────────────┬──────────────────────────┘
         │                         │
┌────────▼────────┐      ┌─────────▼──────────┐      ┌────────────────┐
│ Qdrant          │      │ llama.cpp embedding│      │ llama.cpp chat │
│ Port 6333       │      │ Port 8081 (RAM/CPU)│      │ Port 8080 (VRAM)│
│ code_snippets   │      │ mxbai-embed-large  │      │ Qwen3.6-35B    │
└─────────────────┘      └────────────────────┘      └────────────────┘

Существующий PROJECT mode (PR #16) уже даёт:
  • projects.path (относительный от CONTEXT_BASE_DIR)
  • attachments kind='reference'
  • buildLLMContext с [Материалы] / [Ранее] / [Вопрос]
  • mtime-кэш reference-файлов

RAG-слой (этот план) добавляет:
  • Qdrant-индекс всего проекта (не только attached)
  • [Релевантные фрагменты] — между [Материалы] и [Ранее]
  • /api/repos/* для индексации/поиска
  • /api/project/query для RAG+chat (JSON)
```

## 1.4. Инфраструктура

### 1.4.1. Docker Compose — Qdrant

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

volumes:
  qdrant_data:
```

### 1.4.2. Зависимости (`package.json`)

```json
{
  "dependencies": {
    "@qdrant/js-client-rest": "^1.12.0",
    "web-tree-sitter": "^0.24.0",
    "globby": "^14.0.0",
    "node-cache": "^5.1.2",
    "p-limit": "^5.0.0"
  }
}
```

> `chokidar` **не добавляем** — watch отложен (Часть 2, §2.5).

### 1.4.3. Tree-sitter WASM

```bash
mkdir -p wasm
# JS/TS/Python/Go/Rust — 5 языков
wget https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm -O wasm/tree-sitter-javascript.wasm
wget https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm -O wasm/tree-sitter-typescript.wasm
wget https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm -O wasm/tree-sitter-python.wasm
wget https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm -O wasm/tree-sitter-go.wasm
wget https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm -O wasm/tree-sitter-rust.wasm
```

> Java/C++ — **не в MVP** (реже в целевых репо; добавляются по запросу — см. Часть 2, §2.7).

### 1.4.4. Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST API |
| `EMBEDDING_LLAMA_URL` | `http://localhost:8081` | llama.cpp embedding (RAM) |
| `EMBEDDING_VEC_SIZE` | `1024` | Размерность (mxbai-embed-large) |
| `MAX_CHUNKS_PER_BATCH` | `20` | Чанков на embedding-запрос |
| `MAX_FILE_SIZE_BYTES` | `1048576` (1MB) | Пропускать файлы больше |
| `RAG_BUDGET_RATIO` | `0.5` | Доля `retainPercent`-бюджета под RAG (остальное — история) |
| `CACHE_TTL_SECONDS` | `86400` | TTL embedding-кэша (24ч) |
| `MAX_CONTEXT_TOKENS` | *(удалено)* | **Не используется** — бюджет от `retainPercent` (D3) |

### 1.4.5. Запуск сервисов

```bash
# Qdrant
docker compose up -d qdrant

# Embedding llama.cpp (в RAM, CPU)
./build/bin/llama-server \
    --model mxbai-embed-large-q8_0.gguf \
    --port 8081 \
    --embedding \
    --n-gpu-layers 0 \
    --ctx-size 512 \
    --batch-size 256 \
    --threads 8 \
    --no-mmap

# Chat llama.cpp (в VRAM) — уже запущен для PROJECT mode, без изменений
./build/bin/llama-server \
    --model Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf \
    --port 8080 \
    --n-gpu-layers 99 \
    --n-cpu-moe 16 \
    --parallel 1 \
    --ctx-size 32768 \
    --cache-type-k q4_0 --cache-type-v q4_0 \
    --flash-attn on \
    --no-mmap --mlock \
    --temp 0.7 --top-p 0.8 --top-k 20 \
    --presence-penalty 1.5 --min-p 0.00 \
    --spec-type draft-mtp --spec-draft-n-max 2 \
    --reasoning off
```

## 1.5. Qdrant Collection Schema

**Collection:** `code_snippets` (одна, фильтр по `project_path`).
**Vector size:** 1024. **Distance:** Cosine.

### 1.5.1. Payload Schema

| Field | Type | Description |
|---|---|---|
| `file_path` | keyword | Относительный путь внутри проекта (`src/auth/jwt.ts`) |
| `project_path` | keyword | `projects.path` — **относительный** от `CONTEXT_BASE_DIR` (`my-repo`) |
| `language` | keyword | `javascript` / `typescript` / `python` / `go` / `rust` / `text` (fallback) |
| `type` | keyword | `function` / `class` / `method` / `import` / `chunk` |
| `name` | keyword (nullable) | Имя функции/класса/метода |
| `signature` | text (nullable) | Сигнатура функции |
| `line_start` | integer | Начальная строка |
| `line_end` | integer | Конечная строка |
| `chunk_index` | integer | Позиция чанка в файле |
| `total_chunks` | integer | Всего чанков в файле |
| `imports` | array of keywords | Импорты |
| `exports` | array of keywords | Экспорты |
| `calls` | array of keywords | Вызовы (только прямые, `called_by` — отложен, §2.3) |
| `content_hash` | keyword | SHA-256 (инкрементальная индексация) |
| `last_indexed` | datetime | Время индексации |
| `keywords` | array of keywords | Ключевые слова (для будущего hybrid, §2.4) |

### 1.5.2. Payload-индексы

```javascript
await qdrant.createPayloadIndex('code_snippets', 'project_path', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'language', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'file_path', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'type', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'name', 'keyword');
// text-индексы для keywords/name — добавить позже (hybrid, §2.4)
```

## 1.6. Новые/изменённые файлы (актуализировано)

```
src/
  services/
    vectorDbService.js        — NEW: Qdrant-обёртка (upsert/search/delete/list)
    embeddingService.js       — NEW: llama.cpp /v1/embeddings + node-cache + retry
    parserService.js          — NEW: Tree-sitter (5 языков) + generic fallback
    indexerService.js         — NEW: globby, hash, инкрементальная индексация
    contextManager.js         — NEW: RAG-бюджет от retainPercent + сборка фрагментов
  routes/
    repoRoutes.js             — NEW: /api/repos/* (index/search/collections/delete)
  controllers/
    repoController.js         — NEW: index/search/list/delete handlers
  services/
    projectService.js         — MODIFY: + getRagContext(projectId, query, budget) (вызов из projectController)
  controllers/
    projectController.js      — MODIFY: + queryProjectHandler (RAG + chat, JSON) — НЕ новый файл
  routes/
    projectRoutes.js          — MODIFY: + POST /api/projects/:id/query
  services/
    contextBuilder.js         — MODIFY: + [Релевантные фрагменты] между [Материалы] и [Ранее]
  app.js                      — MODIFY: mount /api/repos
wasm/
  tree-sitter-{javascript,typescript,python,go,rust}.wasm
```

> **Не создаём:** `projectModeService.js`, `projectController.js` (новый), `projectRoutes.js` (новый) — они уже есть (PR #16). Расширяем существующие.

## 1.7. API Endpoints (актуализировано)

### 1.7.1. Repository / Indexing (`/api/repos`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/repos/index` | Индексация проекта (body: `{ projectId }`) — full / incremental по `content_hash` |
| POST | `/api/repos/search` | Semantic search (body: `{ projectId, query, limit? }`) |
| GET | `/api/repos/collections` | Список проиндексированных проектов (по `project_path`) + stats |
| DELETE | `/api/repos/collections/:projectPath` | Удалить векторы проекта |

> `projectPath` — **относительный** (`my-repo`), не абсолютный. Валидация через `getContextBaseDirStatus` + `projects.path` (D2).

### 1.7.2. Project Mode (`/api/projects/*` — расширение существующего)

| Method | Path | Description |
|---|---|---|
| POST | `/api/projects/:id/query` | RAG + chat (JSON-ответ, как `/api/chat`) |

> `POST /api/projects` (create), `POST /api/projects/:id/attach`, `GET /api/projects/:id/files`, `DELETE /api/sessions/:id/project` — **уже есть** (PR #16), не трогаем.

## 1.8. Project Mode Query Flow (актуализировано)

### Request

```json
POST /api/projects/:id/query
{
  "message": "How does authentication work?",
  "sessionId": "...",
  "contextLength": 32768,
  "retainPercent": 80,
  "includeQuestionIds": null
}
```

`attachedFiles` **не передаются** отдельно — они берутся из `attachments` (`kind='reference'`) для `sessionId` (как в существующем `buildLLMContext(mode='project')`).

### Flow

```
1. projectId → projects.path (относительный), sessionId → session
2. Извлечь keywords из message (для будущего hybrid, §2.4; в MVP — не используется)
3. Embedding message через llama.cpp (порт 8081) + кэш
4. Semantic search в Qdrant:
   filter: { project_path: projects.path }
   limit: top-K (10)
5. Собрать RAG-фрагменты (без expand called_by — §2.3)
6. buildLLMContext(sessionId, mode='project', { ragSnippets, retainPercent, contextLength })
   ├─ system(sysprompt) — из P0.2 (fallback DEFAULT_SYSPROMPT)
   ├─ user[Материалы] — attached files (mtime-кэш, существующее) + RAG-фрагменты (новое)
   ├─ user[Ранее в этой сессии] — история (существующее)
   └─ user[Вопрос] — message
   Бюджет: RAG_BUDGET = contextLength × retainPercent × RAG_BUDGET_RATIO
           HISTORY_BUDGET = contextLength × retainPercent × (1 − RAG_BUDGET_RATIO)
7. req.provider.chat({ model, messages, stream: false, ...generationParams })
8. Сохранить user/assistant сообщения (существующий addMessage)
9. Вернуть JSON: { response, metrics, contextInfo, ragSources: [...] }
```

## 1.9. Ключевые сервисы

### 1.9.1. `parserService.js` — Tree-sitter (5 языков + fallback)

```javascript
import Parser from 'web-tree-sitter';

const parsers = {};  // javascript/typescript/python/go/rust

export async function initParsers() {
  await Parser.init();
  const languages = {
    javascript: 'tree-sitter-javascript.wasm',
    typescript: 'tree-sitter-typescript.wasm',
    python: 'tree-sitter-python.wasm',
    go: 'tree-sitter-go.wasm',
    rust: 'tree-sitter-rust.wasm',
  };
  for (const [lang, wasm] of Object.entries(languages)) {
    const Language = await Parser.Language.load(`./wasm/${wasm}`);
    parsers[lang] = new Parser();
    parsers[lang].setLanguage(Language);
  }
}

export function parseCode(content, language) {
  const parser = parsers[language];
  if (!parser) return genericChunk(content);  // fallback для Java/C++/PHP/...
  const tree = parser.parse(content);
  const structures = extractStructures(tree.rootNode, language);
  return structures.length > 0 ? structures : genericChunk(content);
}

function genericChunk(content) {
  // ~100 строк / ~500 токенов, с перекрытием 10 строк
  // type: 'chunk', name: null
  ...
}
```

> Java/C++ — **не в MVP**; PHP/Ruby/Swift — **fallback** `genericChunk`. Расширение языков — Часть 2, §2.7.

### 1.9.2. `embeddingService.js` — llama.cpp + кэш + retry

```javascript
import NodeCache from 'node-cache';

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 86400,
  checkperiod: 3600,
  useClones: false,
});

export async function getEmbedding(text, contentHash = null) {
  if (contentHash) {
    const hit = cache.get(contentHash);
    if (hit) return hit;
  }
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${process.env.EMBEDDING_LLAMA_URL}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, model: 'mxbai-embed-large' }),
      });
      if (!res.ok) throw new Error(`Embedding API ${res.status}`);
      const { data } = await res.json();
      const emb = data[0].embedding;
      if (contentHash) cache.set(contentHash, emb);
      return emb;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 2 ** i * 1000));
    }
  }
}

export async function getEmbeddingsBatch(texts, hashes = null) {
  const size = parseInt(process.env.MAX_CHUNKS_PER_BATCH) || 20;
  const out = [];
  for (let i = 0; i < texts.length; i += size) {
    const batch = texts.slice(i, i + size);
    const hb = hashes?.slice(i, i + size);
    const embs = await Promise.all(batch.map((t, j) => getEmbedding(t, hb?.[j])));
    out.push(...embs);
  }
  return out;
}
```

### 1.9.3. `indexerService.js` — инкрементальная индексация (без watch)

```javascript
import { globby } from 'globby';
import crypto from 'crypto';

const SUPPORTED_EXT = '.{js,jsx,ts,tsx,py,go,rs}';

export async function indexProject(projectPath, onProgress) {
  // projectPath — относительный от CONTEXT_BASE_DIR (D2)
  const absPath = resolveProjectAbsPath(projectPath);  // paths.js + traversal-check
  const files = await globby([`**/*${SUPPORTED_EXT}`,
    '!**/node_modules/**', '!**/.git/**', '!**/dist/**', '!**/build/**',
    '!**/.next/**', '!**/__pycache__/**', '!**/*.min.*', '!**/*.map',
  ], { cwd: absPath, absolute: true });

  let processed = 0;
  for (const file of files) {
    try {
      await indexFile(projectPath, absPath, file);
      processed++;
      onProgress?.({ current: processed, total: files.length, file: rel(projectPath, file) });
    } catch (e) {
      onProgress?.({ error: e.message, file: rel(projectPath, file) });
    }
  }
  return { indexed: processed, total: files.length };
}

async function indexFile(projectPath, absPath, filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const relPath = path.relative(absPath, filePath);
  // Инкрементальность: если все чанки файла уже с этим hash — skip
  const existing = await vectorDb.getFileByHash(projectPath, relPath, hash);
  if (existing) return { skipped: true };
  await vectorDb.deletePointsForFile(projectPath, relPath);
  const lang = getLanguage(filePath);
  const structures = parserService.parseCode(content, lang);
  const texts = structures.map(s => s.content);
  const hashes = structures.map(() => hash);
  const embs = await embedding.getEmbeddingsBatch(texts, hashes);
  const points = structures.map((s, idx) => ({
    id: generatePointId(projectPath, relPath, idx),
    vector: embs[idx],
    payload: {
      file_path: relPath,
      project_path: projectPath,
      language: lang,
      type: s.type,
      name: s.name ?? null,
      signature: s.signature ?? null,
      line_start: s.lineStart,
      line_end: s.lineEnd,
      chunk_index: idx,
      total_chunks: structures.length,
      imports: s.imports ?? [],
      exports: s.exports ?? [],
      calls: s.calls ?? [],            // called_by отложен — §2.3
      content_hash: hash,
      last_indexed: new Date().toISOString(),
      keywords: extractKeywords(s.content),  // для будущего hybrid — §2.4
    },
  }));
  await vectorDb.upsertPoints(points);
  return { indexed: structures.length };
}
```

> Watch mode **не реализуется** — отложен (§2.5). Переиндексация — **вручную** через `POST /api/repos/index`.

### 1.9.4. `contextManager.js` — RAG-бюджет от `retainPercent` (D3)

```javascript
// D3: бюджет — производная от contextLength × retainPercent,
// разделён между RAG и историей (RAG_BUDGET_RATIO).
export function computeRagBudget(contextLength, retainPercent) {
  const total = Math.floor(contextLength * (retainPercent / 100));
  const ragRatio = parseFloat(process.env.RAG_BUDGET_RATIO) || 0.5;
  return {
    rag: Math.floor(total * ragRatio),
    history: Math.floor(total * (1 - ragRatio)),
  };
}

export function buildRagContext(snippets, budgetTokens) {
  let context = '';
  let used = 0;
  for (const s of snippets) {
    const tokens = estimateTokens(s.content);   // ~3 chars/token для кода
    if (used + tokens > budgetTokens) break;
    context += `--- ${s.file_path}:${s.line_start}-${s.line_end} (${s.type} ${s.name ?? ''}) ---\n`;
    context += s.content + '\n\n';
    used += tokens;
  }
  return { context, usedTokens: used };
}
```

### 1.9.5. `contextBuilder.js` — встраивание `[Релевантные фрагменты]` (D1)

**Не меняем** формат `[Материалы]` / `[Ранее]` / `[Вопрос]`. **Добавляем** один user-блок:

```
system(sysprompt)
user[Материалы]
  --- FILE: my-repo/src/chat.ts (reference, mtime-кэш) ---
  <полный код>
  --- FILE: my-repo/src/store.ts (reference) ---
  <полный код>

user[Релевантные фрагменты]                          ← НОВЫЙ блок (если RAG дал результаты)
  --- src/auth/jwt.ts:45-62 (function validateToken) ---
  <фрагмент>
  --- src/middleware/auth.ts:12-30 (function authMiddleware) ---
  <фрагмент>

user[Ранее в этой сессии] + history
user[Вопрос]
```

**Правила:**
- Если `ragSnippets.length === 0` — блок **не добавляется** (поведение как сейчас).
- Если `[Материалы]` пуст (нет reference) — `[Релевантные фрагменты]` **всё равно** добавляется (RAG работает независимо от attach).
- Qdrant недоступен → `ragSnippets = []`, `[Релевантные фрагменты]` не добавляется, `[Материалы]` работает как раньше.

### 1.9.6. Semantic search (MVP)

```javascript
export async function semanticSearch(query, projectPath, limit = 10) {
  const emb = await embedding.getEmbedding(query);
  return await qdrant.search('code_snippets', {
    vector: emb,
    filter: { must: [{ key: 'project_path', match: { value: projectPath } }] },
    limit,
    with_payload: true,
  });
}
```

> Hybrid (keyword + semantic) — **отложен** (§2.4). `expandWithRelations` (`calls`/`called_by`) — **отложен** (§2.3).

## 1.10. Frontend UI (актуализировано под существующий `ProjectPanel`)

### 1.10.1. `ProjectPanel` — расширение (не новый компонент)

Существующий `project-panel.tsx` (PR #16) **дополняется**:

```
ProjectPanel (существующий)
├─ [CONTEXT_BASE_DIR banner]              (уже есть)
├─ [CurrentProject + Change/Remove]       (уже есть)
├─ [Attached files list + бейджи]         (уже есть)
├─ [Attach file(s) / Browse project files](уже есть)
│
├─ ─── НОВОЕ: Indexing section ───
│  ├─ Status: Not indexed / Indexing... / Indexed (N chunks)
│  ├─ Progress bar (polling GET /api/repos/collections?projectId)
│  └─ Button: [Re-index project]          (ручная, §2.5)
│
└─ ─── НОВОЕ: RAG toggle ───
   └─ [x] Use semantic search (RAG)      — выключатель; при off → /query без RAG
```

### 1.10.2. `ChatArea` — режим Project (query)

При `session.mode === 'project'` и `ProjectPanel` с активным проектом — `sendMessage` идёт на `POST /api/projects/:id/query` (вместо `/api/chat`), **но** только если RAG включён. Иначе — `/api/chat` как сейчас.

**Ответ (JSON)**: `{ response, metrics, contextInfo, ragSources: [{ file_path, line_start, line_end, name, type }] }`.

`ragSources` отображаются **под ответом** как чипсы: `src/auth/jwt.ts:45-62 (validateToken)`. Клик — `scrollToQuestion`-аналог? Нет, файл не открыт в UI; чипсы — **информационные** (пользователь видит, откуда взят контекст).

### 1.10.3. Mode selector

Уже есть (`ModeToggle`, PR #16): `Research / Project`. **Не меняем**. UI-надпись «Chat» — **алиас** `research` (не вводим новый режим).

## 1.11. Failure modes (актуализировано)

| Scenario | Handling |
|---|---|
| Embedding llama.cpp не запущен (8081) | `503 Embedding service unavailable` (при index/search) |
| Qdrant не запущен | `503 Vector DB unavailable` (при index/search) |
| Chat llama.cpp не запущен (8080) | `503` (существующий `providerMiddleware`-fallback) |
| Файл >1MB | Skip, `log.warn` |
| Невалидный синтаксис | Fallback `genericChunk` |
| Повторная индексация того же path | `deletePointsForFile` перед upsert (идемпотентно) |
| `projectId` не найден | `404 Project not found` |
| `projects.path` вне `CONTEXT_BASE_DIR` | `400 Path traversal detected` (D2, `resolveAttachmentPath`) |
| RAG-фрагменты не влезли в бюджет | Truncate по релевантности (top-K order) |
| Qdrant недоступен во время `/query` | RAG пропускается, `[Материалы]` работает, ответ без `ragSources` |

## 1.12. Performance targets

| Metric | Target |
|---|---|
| Индексация 1000 файлов (MVP, без watch) | < 5 мин |
| Semantic search latency | < 200 мс |
| Embedding cache hit rate | > 80% |
| `/api/project/query` (RAG + LLM, 35B) | ~2–5 с (без streaming) |

## 1.13. Фазы реализации (актуализировано, без watch/streaming/hybrid)

### Phase 1: Инфраструктура (1–1.5 дня)
- [ ] `docker-compose.yml` + `qdrant`
- [ ] `package.json` (без `chokidar`)
- [ ] Tree-sitter WASM (5 языков)
- [ ] `.env` (без `MAX_CONTEXT_TOKENS`)
- [ ] Запуск Qdrant + embedding llama.cpp, проверка `/v1/embeddings`

### Phase 2: Сервисы (4–5 дней)
- [ ] `vectorDbService.js`
- [ ] `embeddingService.js`
- [ ] `parserService.js` (5 языков + `genericChunk`)
- [ ] `indexerService.js` (без watch)
- [ ] `contextManager.js` (RAG-бюджет от `retainPercent`)

### Phase 3: Маршруты + интеграция (2–3 дня)
- [ ] `repoRoutes` + `repoController` (`/api/repos/*`)
- [ ] `projectController.js` **расширить** `queryProjectHandler` (JSON)
- [ ] `projectRoutes.js` **расширить** `POST /:id/query`
- [ ] `contextBuilder.js` **расширить** `[Релевантные фрагменты]`
- [ ] `app.js` mount `/api/repos`

### Phase 4: Frontend (2–3 дня)
- [ ] `ProjectPanel` — Indexing section + RAG toggle
- [ ] `ChatArea` — `sendMessage` → `/query` при Project+RAG
- [ ] `ragSources` чипсы под ответом

### Phase 5: Тесты + документация (2–3 дня)
- [ ] Unit: parser/embedding/indexer/contextManager
- [ ] Integration: index → search → query
- [ ] Performance: 1000 файлов
- [ ] Документация запуска (Qdrant, embedding llama.cpp, `.env`)

**Итого MVP: ~11–15 дней** (без watch/streaming/hybrid/called_by).

---

# ЧАСТЬ 2. ДОПОЛНЕНИЕ К ПЛАНУ (отложено)

> Каждый пункт — самостоятельное решение. Возврат к нему — **после** MVP, при появлении реальной потребности (метрики использования, жалобы, объём репо).

## 2.1. D1 (реализовано): встроено в существующий PROJECT mode

**Не отложено** — это **часть Плана** (Часть 1). Фиксируется здесь для протокола:
- `projectController.js` / `projectRoutes.js` / `projectModeService.js` — **не создаются**; расширяются существующие (PR #16).
- Формат промпта — `[Материалы]` / `[Релевантные фрагменты]` / `[Ранее]` / `[Вопрос]`, **не** `[RELEVANT_CODE_SNIPPETS]` / `[ATTACHED_FILES]` / `[USER_QUESTION]`.

## 2.2. D2 (реализовано): `projects.path` относительный от `CONTEXT_BASE_DIR`

**Часть Плана.** `POST /api/repos/index` принимает `projectId`, сервер резолвит `projects.path` (относительный) → `CONTEXT_BASE_DIR + '/' + path` через `getContextBaseDirStatus` + traversal-check. **Не** `/path/to/project`.

## 2.3. `called_by` (обратные связи) — отложено

**Что:** заполнение payload-поля `called_by` — список функций, которые вызывают данный чанк.

**Почему отложено:**
- Требует **второго прохода** по индексу (после индексации всех файлов — пройти и для каждого `calls` найти чанки-вызовы). Это **+1 проход** по Qdrant (дорого на 1000+ файлов).
- `calls` (прямые вызовы) — дёшево (в том же проходе, при парсинге AST).
- Для MVP достаточно `calls`: LLM видит «что вызывает эта функция», обратная связь «кто вызывает» — **реже** нужна.

**Условия возврата:** если пользователи жалуются «не находит, откуда вызывается X» — реализовать. Оценка: ~0.5–1 день (второй проход + тесты).

**Схема (когда вернёмся):**
```javascript
// После indexProject (все файлы проиндексированы):
// для каждого чанка с непустым calls — найти чанки с name ∈ calls
// и дописать их id в called_by целевого чанка (Qdrant setPayload).
```

## 2.4. Hybrid search (semantic + keyword) — отложено

**Что:** помимо semantic (top-K по вектору), — keyword search по `name`/`keywords` (точные совпадения), merge + dedupe.

**Почему отложено:**
- Semantic search **работает** и без keyword. На типичных запросах («как работает auth?») — находит `validateToken`, `authMiddleware` по смыслу.
- Keyword нужен для **точных имён** («где `validateToken`?») — но пользователь может **явно** спросить «найди функцию validateToken», и LLM semantic-поиск справится (имя в запросе → эмбеддинг близок к имени функции).
- Требует `text`-индексов в Qdrant (не `keyword` — `match: text` не работает на `keyword`; план исходно это **не учёл**). **+1 день** на переделку индексов.

**Условия возврата:** если метрики показывают «semantic не находит точные имена» (пользовательские жалобы, low recall на именах). Оценка: ~1–1.5 дня.

**Схема (когда вернёмся):**
```javascript
// 1. Semantic: qdrant.search(vector)
// 2. Keyword: qdrant.scroll(filter: { should: [{ key: 'name', match: { text: kw } }, ...] })
//    (требует createPayloadIndex(..., 'text') на name и keywords)
// 3. merge + dedupe by id, сортировка по score
```

## 2.5. Watch mode — отложено

**Что:** `chokidar` следит за изменениями файлов, при `change`/`add` — `indexFile`, при `unlink` — `deletePointsForFile`.

**Почему отложено:**
- **mtime-кэш** в `buildLLMContext(mode='project')` **уже** даёт актуальные reference-файлы при каждом вопросе (PR #16). Attached files — всегда свежие.
- Watch нужен **только** для **Qdrant-индекса** (re-embed при изменении). Но **ручная** переиндексация (`POST /api/repos/index`) на MVP достаточна: пользователь меняет код в VSCode, нажимает «Re-index» перед вопросом.
- chokidar edge-cases: `git checkout` (массовые изменения), VSCode autosave (много событий), rename (add+unlink). Требует debounce + тестов. **+1–1.5 дня**.
- Embedding на каждое изменение — **нагрузка на CPU** (RAM-модель); при активной разработке — постоянный re-embed.

**Условия возврата:** если пользователь жалуется «приходится жать Re-index после каждого изменения» (частый workflow). Оценка: ~1–1.5 дня (+chokidar, debounce, тесты).

**Схема (когда вернёмся):**
```javascript
// chokidar.watch(absPath, {
//   ignored: [...],
//   awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
// })
// .on('change', f => indexFile(projectPath, absPath, f))
// .on('add',    f => indexFile(projectPath, absPath, f))
// .on('unlink', f => vectorDb.deletePointsForFile(projectPath, rel(f)))
```

## 2.6. Streaming (`/api/project/query`) — отложено

**Что:** ответ `/api/project/query` — SSE/stream, как `/api/chat` **не** делает (сейчас `/api/chat` — JSON, §7.86 «Upgrade to stream — ОТЛОЖЕНО»).

**Почему отложено:**
- `/api/chat` **не streaming** — если делать `/api/project/query` streaming, получим **два разных** контракта (chat — JSON, project — stream). Это **несогласованность**.
- Streaming — **отдельный трек** для **обоих** режимов (`/api/chat` + `/api/project/query`), не часть «Project mode».
- MVP — JSON, как `/api/chat`: пользователь ждёт 2–5 с, получает ответ. Для 35B-модели на 1000-файловом репо — терпимо (TTFT без streaming = полное время генерации, ~3–5 с).

**Условия возврата:** когда решим делать streaming **для обоих** режимов (отдельное ТЗ). Оценка: ~1–2 дня (SSE-парсер, фронт-обработка, тесты).

**Схема (когда вернёмся):**
```javascript
// /api/project/query → res.writeHead(200, { 'Content-Type': 'text/event-stream' })
// провайдер.chat({ ..., stream: true }) → reader.read() → res.write(`data: ${token}\n\n`)
// фронт: fetch + ReadableStream → onToken
```

## 2.7. Java / C++ / другие языки — отложено

**Что:** Tree-sitter WASM для Java, C++, C#, PHP, Ruby, Swift, Kotlin.

**Почему отложено:**
- MVP — 5 языков (JS/TS/Python/Go/Rust) покрывают **большинство** современных репо.
- Java/C++ — реже в целевых проектах (если появятся — добавить WASM + `languages`-запись в `parserService`).
- PHP/Ruby/Swift — **fallback `genericChunk`** уже работает (хуже, но не падает).

**Условия возврата:** проект на Java/C++/PHP в реальной работе. Оценка: ~0.5 дня на язык (WASM + запись в `languages` + тест).

## 2.8. Frontend search preview (сниппеты кода в UI) — отложено

**Что:** под ответом — не только чипсы `file:line`, но и **раскрывающиеся** сниппеты кода (как в исходном плане `search-result`).

**Почему отложено:**
- MVP — чипсы `ragSources` (информационные) достаточно: пользователь видит, откуда взят контекст, и может **сам** открыть файл в VSCode.
- Сниппеты в UI — дублируют то, что уже есть в ответе LLM (он цитирует код) и в VSCode.

**Условия возврата:** жалобы «не вижу, что именно взято из файла». Оценка: ~1 день.

## 2.9. Reranker — отложено

**Что:** cross-encoder для переранжирования top-K результатов (точнее, чем cosine).

**Почему отложено:**
- Требует **отдельной** модели (cross-encoder) — ещё один llama.cpp-сервер. **+0.5–1 ГБ RAM**, +инфраструктура.
- Cosine (mxbai-embed-large) — **достаточно** для MVP; reranker — улучшение качества, не блокер.

**Условия возврата:** low precision на top-K (пользовательские жалобы). Оценка: ~1–1.5 дня (+ модель, + сервер).

## 2.10. Multi-project search — отложено

**Что:** поиск сразу по нескольким проектам (фильтр `project_path: { any: [...] }`).

**Почему отложено:**
- PROJECT mode — **один активный проект** на сессию (`sessions.project_id`). Multi-project — **новая** парадигма, не в scope.
- MVP — один проект, фильтр по `project_path` — корректен.

**Условия возврата:** запрос «искать по всем проектам». Оценка: ~0.5 дня (UI + фильтр).

## 2.11. Export/import индексов — отложено

**Что:** экспорт Qdrant-коллекции проекта в файл, импорт на другой машине.

**Почему отложено:**
- Qdrant snapshot API есть, но **не нужно** для MVP: индексация 1000 файлов — < 5 мин, повторно запустить проще, чем возиться с экспортом.
- Embedding-модель должна быть **той же** при импорте (размерность, версия) — иначе векторы несовместимы.

**Условия возврата:** жалобы «переиндексация долгая» на очень больших репо (>10k файлов). Оценка: ~1 день.

## 2.12. Webhook-уведомления — отложено

**Что:** уведомление (email/webhook) о завершении индексации / ошибке.

**Почему отложено:**
- MVP — индексация синхронная (HTTP-ответ после завершения) или progress через polling. Уведомления — для **фоновой** индексации (когда watch/async).
- Сейчас индексация — по кнопке, пользователь ждёт. Webhook — избыточно.

**Условия возврата:** фоновая индексация (async, без блокировки UI). Оценка: ~0.5 дня.

## 2.13. `MAX_CONTEXT_TOKENS=12000` — заменено на `RAG_BUDGET` от `retainPercent`

**Не отложено** — это **часть Плана** (D3, Часть 1 §1.9.4). Фиксируется для протокола:
- `MAX_CONTEXT_TOKENS` (жёсткая константа) **удалена** из `.env`.
- `RAG_BUDGET = contextLength × retainPercent × RAG_BUDGET_RATIO`, `HISTORY_BUDGET = ... × (1 − RAG_BUDGET_RATIO)`.

---

## Итог

- **Часть 1 (План)** — реализуется **сейчас**: RAG-слой поверх существующего PROJECT mode, 5 языков, semantic search, инкрементальная индексация, `RAG_BUDGET` от `retainPercent`, JSON-ответ, ручная переиндексация. **~11–15 дней.**
- **Часть 2 (Дополнение)** — **отложено**, каждый пункт с условиями возврата: `called_by` (§2.3), hybrid (§2.4), watch (§2.5), streaming (§2.6), Java/C++ (§2.7), frontend preview (§2.8), reranker (§2.9), multi-project (§2.10), export/import (§2.11), webhook (§2.12). D1/D2/D3 и удаление `MAX_CONTEXT_TOKENS` — **не отложены**, это часть Плана (§2.1, §2.2, §2.13).

**Главное отличие от исходного плана:** нет дублей с PR #16 (`projectController`/`projectRoutes`/`projectModeService` не создаются), `projects.path` относительный (traversal-protection переиспользована), промпт встроен в `[Материалы]`-архитектуру (`[Релевантные фрагменты]` — отдельный user-блок), бюджет — от `retainPercent`. Это **−3–4 дня** и **−техдолг** относительно исходного плана.