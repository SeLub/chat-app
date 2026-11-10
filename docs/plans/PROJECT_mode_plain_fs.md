# ТЗ: PROJECT mode — вариант A (plain fs.readFile + `[Материалы]`)

> **Для агента-исполнителя.** Это ТЗ самодостаточно. Прочитай `PROJECT_CONTEXT.md` — это конституция. Если противоречит — остановись.
>
> **Стек:** Node 20+ (Express 5), better-sqlite3, sharp, React 18, TypeScript 5.8 (strict), Vite 6, Zustand 5, Tailwind 4, Radix (dropdown-menu, dialog, tooltip), sonner, lucide-react, vitest.
>
> **Scope:** PROJECT-режим **без** Qdrant / Tree-sitter / embedding-сервера / streaming / watch mode. Только: переключение режима, выбор папки (внутри `CONTEXT_BASE_DIR`), attach reference-файлов, чтение по `file_path` при сборке контекста (mtime-кэш), предупреждения о missing/too-large, правая панель.
>
> **Не входит:** RAG, vector DB, multi-project, git-интеграция, vision в PROJECT, editing файлов из UI, streaming. Всё — отдельные треки.

---

## 1. Принципы

1. **Один источник правды для attach:** `attachments` (`kind='reference'`, `path_base='context'`, `file_path='<rel>'`, `extracted_text=''`). Файлы **не** копируются.
2. **`CONTEXT_BASE_DIR` обязателен** для PROJECT. Отсутствие → `GET /api/config` отдаёт `{ contextBaseDir: { ok: false, error } }`, UI: красный баннер + disabled Projects. RESEARCH работает.
3. **Все пути — относительно `CONTEXT_BASE_DIR`.** `projects.path` = `my-repo`. `attachments.file_path` = `my-repo/src/chat.ts`. Резолв — `resolveAttachmentPath(row)` (уже есть, S.1). Traversal → 400.
4. **mtime-кэш.** В `attachments` добавляется `extracted_mtime INTEGER`. При сборке контекста: если `extracted_mtime === fs.stat.mtimeMs` — используем `extracted_text` (кэш); иначе — перечитываем и обновляем.
5. **Файлы не удаляются** (orphan-политика). Detach — `DELETE FROM attachments` (только строка; файл на диске — нет).
6. **Один активный проект на сессию.** `sessions.project_id` → `projects.id`. Переключение проекта — новая сессия.
7. **Переключение режима в существующей сессии разрешено** (вариант B из §6.1). Старые Q&A остаются; `[Материалы]` собирается из **текущего** пула `attachments` сессии. `contextInfo.mode` = `research | project` + `modeChangedAtQuestion: N` (предупреждение в UI).
8. **UI — правая панель (SettingsPanel).** Левая (Questions/Prompts) и центр (ChatArea) — без изменений. Переключатель режима — в шапке правой панели.
9. **Без streaming.** `POST /api/chat` — обычный JSON, как сейчас. Ветка PROJECT — в том же контроллере (`chatHandler`).
10. **`[Материалы]`** в `buildLLMContext` — общий формат для RESEARCH и PROJECT. Разница — в источнике: RESEARCH — `extracted_text` (снапшот), PROJECT — чтение с диска (mtime-кэш). Для PROJECT в `[Материалы]` — суффикс `(актуальная версия)`.

---

## 2. Схема БД (без миграционного фреймворка, guarded ALTER)

### 2.1. `attachments` — новая колонка

В `server/src/db/init.js`:

**CREATE (свежие БД):**
```sql
CREATE TABLE IF NOT EXISTS attachments (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    file_path       TEXT,
    mime_type       TEXT,
    file_size       INTEGER,
    extracted_text  TEXT NOT NULL,
    language        TEXT,
    kind            TEXT DEFAULT 'document',
    path_base       TEXT DEFAULT 'context',
    extracted_mtime INTEGER DEFAULT NULL,     -- ← новое
    created_at      TEXT DEFAULT (datetime('now'))
);
```

**Guarded ALTER (в `ensureColumns`):**
```js
if (attachmentCols.length > 0 && !attachmentCols.includes('extracted_mtime')) {
    database.exec('ALTER TABLE attachments ADD COLUMN extracted_mtime INTEGER DEFAULT NULL');
}
```

### 2.2. `sessions.project_id` — уже в схеме

Колонка `project_id TEXT REFERENCES projects(id)` **уже есть** (`init.js`). Ничего не менять.

### 2.3. `sessions.mode` — уже в схеме

Колонка `mode TEXT DEFAULT 'chat'` **уже есть**. Backfill **не делать** — трактовать `'chat'` как `'research'` в коде. `POST /api/sessions` — default `'research'` (изменить в `sessionRepo.createSession` параметр с `'chat'` на `'research'`).

### 2.4. `projects` — уже в схеме

Колонки: `id, name, path (UNIQUE), description, watch_enabled, last_indexed, total_files, total_chunks, created_at, updated_at`. **Не трогать.** Поле `watch_enabled` / `last_indexed` / `total_files` / `total_chunks` — **не использовать** в этом ТЗ (future: RAG / git).

---

## 3. Сервер — эндпоинты

### 3.1. `GET /api/config` — статус `CONTEXT_BASE_DIR`

**Файл:** `server/src/app.js` (или новый `server/src/routes/configRoutes.js`).

```js
GET /api/config → {
  contextBaseDir: {
    ok: boolean,                  // true если CONTEXT_BASE_DIR задан И существует И директория
    path: string | null,          // абсолютный путь (для отладки) или null
    error: string | null          // "CONTEXT_BASE_DIR is not configured" | "not found" | "not a directory"
  }
}
```

**Проверка** (при каждом запросе, не кэшировать — `.env` может измениться только рестартом, но проверка `fs.existsSync` дешёвая):
```js
function getContextBaseDirStatus() {
    const raw = process.env.CONTEXT_BASE_DIR;
    if (!raw || raw.trim() === '') {
        return { ok: false, path: null, error: 'CONTEXT_BASE_DIR is not configured' };
    }
    const abs = path.resolve(raw);
    if (!fs.existsSync(abs)) {
        return { ok: false, path: abs, error: 'CONTEXT_BASE_DIR does not exist' };
    }
    if (!fs.statSync(abs).isDirectory()) {
        return { ok: false, path: abs, error: 'CONTEXT_BASE_DIR is not a directory' };
    }
    return { ok: true, path: abs, error: null };
}
```

**Frontend:** `apiGateway.config.get()` → `useUIStore` или новый `configStore` — fetch при `init()`. При `ok: false` — баннер + disabled Projects.

### 3.2. `PATCH /api/sessions/:id` — расширить `mode`

**Файл:** `server/src/routes/sessionRoutes.js`.

Сейчас PATCH принимает `title/category/model/provider/sysprompt`. **Добавить:**

```js
if (req.body.mode !== undefined) {
    if (!['research', 'project'].includes(req.body.mode)) {
        return res.status(400).json({ error: 'mode must be "research" or "project"' });
    }
    updates.mode = req.body.mode;
}
```

`sessionRepo.updateSession(id, updates)` — уже умеет произвольные поля (SQL-строитель). **Проверить**, что `mode` не в whitelist-ограничении — если есть, добавить.

**Правило:** при переключении в `project` — `sessions.project_id` **не** сбрасывается (пользователь может вернуться в research и обратно). При переключении в `research` — `project_id` тоже остаётся (но не используется в research-ветке).

### 3.3. `POST /api/projects` — регистрация проекта

**Новый файл:** `server/src/routes/projectRoutes.js`, `server/src/controllers/projectController.js`, `server/src/services/projectService.js`, `server/src/db/projectRepo.js`.

**Запрос:**
```json
{
  "sessionId": "uuid",
  "relativePath": "my-repo"     // относительно CONTEXT_BASE_DIR
}
```

**Ответ:**
```json
{
  "id": "project-uuid",
  "name": "my-repo",
  "path": "my-repo",
  "totalFiles": 42,             // количество файлов, найденных рекурсивно (для информации)
  "created": true
}
```

**Логика:**
1. `getContextBaseDirStatus()` — если `!ok` → **400** `{ error: 'CONTEXT_BASE_DIR is not configured' }`.
2. `absPath = path.resolve(CONTEXT_BASE_DIR, relativePath)`. **Traversal-check**: `absPath.startsWith(path.resolve(CONTEXT_BASE_DIR) + path.sep)` — иначе **400** `{ error: 'Path traversal detected' }`.
3. `fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()` — иначе **400** `{ error: 'Project directory not found' }`.
4. `SELECT id, name, path FROM projects WHERE path = ?` (`relativePath`). Если есть — **200** `{ id, name, path, created: false }` (идемпотентно).
5. Иначе — `INSERT INTO projects (id, name, path, description) VALUES (uuid, basename(relativePath), relativePath, '')`. `name` = `path.basename(relativePath)` (или `relativePath` целиком, если basename пустой).
6. **Считать файлы** рекурсивно: `fs.readdir(absPath, { recursive: true, withFileTypes: true })` → отфильтровать директории + игнорировать `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `__pycache__/`, `*.min.*`, `*.map`. `totalFiles` — количество.
7. `UPDATE sessions SET project_id = ?, mode = 'project' WHERE id = ?` — привязать проект к сессии.
8. Вернуть `{ id, name, path, totalFiles, created }`.

**Не** создавать `attachments` — это отдельный шаг (attach).

### 3.4. `GET /api/projects/:id/files` — список файлов проекта (для browse)

**Запрос:** `GET /api/projects/:id/files?filter=<substring>`

**Ответ:**
```json
{
  "files": [
    { "path": "src/chat.ts", "size": 1234, "language": "typescript" },
    { "path": "README.md", "size": 567, "language": "markdown" }
  ],
  "total": 42
}
```

**Логика:**
1. `SELECT path FROM projects WHERE id = ?` — если нет → **404**.
2. `absPath = path.resolve(CONTEXT_BASE_DIR, project.path)`.
3. Рекурсивный обход (те же игнорируемые паттерны, что в 3.3).
4. **Фильтр**: `file.path.includes(filter)` (регистронезависимо).
5. **Лимит**: 500 файлов (если больше — `{ files: [...первые 500], total: N, truncated: true }`).
6. `language` — из расширения (переиспользовать `languageMap` из `attachmentRepo`; для не-кода — `'text'` / `'markdown'` / `'unknown'`).
7. **Не читать содержимое** — только stat.

**Зачем:** UI «Browse project files» — пользователь видит список, отмечает галочками.

### 3.5. `POST /api/projects/:id/attach` — attach reference-файлов

**Запрос:**
```json
{
  "sessionId": "uuid",
  "relativePaths": ["src/chat.ts", "src/store.ts", "README.md"]
}
```

**Ответ:**
```json
{
  "attached": [
    { "fileId": "uuid", "name": "src/chat.ts", "size": 1234, "kind": "reference", "language": "typescript" }
  ],
  "errors": [
    { "path": "src/gone.ts", "error": "File not found" }
  ]
}
```

**Логика:**
1. `SELECT path FROM projects WHERE id = ?` → `project.path` (например, `my-repo`).
2. `baseAbs = path.resolve(CONTEXT_BASE_DIR, project.path)`.
3. Для каждого `relativePath`:
   - `absPath = path.resolve(baseAbs, relativePath)`. **Traversal-check** относительно `baseAbs` (не только `CONTEXT_BASE_DIR` — файл должен быть **внутри проекта**).
   - `fs.existsSync` — иначе `errors.push`.
   - `stat = fs.statSync(absPath)` — если **не файл** (директория) — `errors.push`.
   - **Размер**: если `stat.size > MAX_REFERENCE_SIZE` (1 MB, из `process.env.MAX_REFERENCE_FILE_SIZE` или дефолт) — `errors.push({ path, error: 'File too large (N bytes, max M)' })`.
   - **MIME**: из расширения (переиспользовать `getMimeType`-подобный маппинг из `attachmentRepo`, расширить для `.ts/.tsx/.py/...` → `text/plain` / `text/typescript` / ...).
   - **INSERT в `attachments`**: `id=uuid`, `session_id=sessionId`, `filename=basename(relativePath)`, `file_path=<projectPath>/<relativePath>` (например, `my-repo/src/chat.ts`), `mime_type`, `file_size=stat.size`, `extracted_text=''`, `language`, `kind='reference'`, `path_base='context'`, `extracted_mtime=null`.
   - `attached.push({ fileId, name: basename(relativePath), size, kind: 'reference', language })`.
4. Вернуть `{ attached, errors }`.

**Идемпотентность:** если `attachments` уже содержит строку с тем же `session_id` + `file_path` — **не дублировать**, вернуть существующую `fileId` (или `skipped: true`). **Проще:** `SELECT id FROM attachments WHERE session_id=? AND file_path=?` — если есть, `attached.push(existing)`.

**Detach** (см. 3.6) — `DELETE /api/attachments/:fileId` (только строка; файл на диске не трогаем).

### 3.6. `DELETE /api/attachments/:fileId` — detach

**Файл:** `server/src/routes/attachmentRoutes.js` (уже есть, расширить).

**Логика:**
1. `SELECT * FROM attachments WHERE id = ?` — если нет → **404**.
2. `DELETE FROM attachments WHERE id = ?`. **Файл на диске не трогаем** (orphan-политика).
3. **Пересчитать `messages.attachments_meta`?** — **Нет.** `attachments_meta` — снимок на момент отправки. Если файл был в прошлых Q&A — бейдж остаётся. Если в будущих — пользователь пересоберёт пул вручную. Это **осознанно**.

**Не** делать каскад на `messages`. `messages.attachments_meta` — иммутабельный снимок.

### 3.7. `GET /api/sessions/:id/attachments` — список reference-файлов сессии

**Новый эндпоинт** (или расширить `GET /api/sessions/:id`).

**Запрос:** `GET /api/sessions/:id/attachments?kind=reference`

**Ответ:**
```json
{
  "attachments": [
    { "fileId": "uuid", "name": "src/chat.ts", "size": 1234, "kind": "reference",
      "language": "typescript", "filePath": "my-repo/src/chat.ts",
      "mtimeStale": false }
  ]
}
```

**Логика:**
1. `SELECT a.* FROM attachments a WHERE a.session_id = ? AND a.kind = 'reference' ORDER BY a.created_at`.
2. Для каждого — `stat = fs.statSync(absPath)` (через `resolveAttachmentPath`). Если файла нет — `missing: true`. Если `extracted_mtime !== stat.mtimeMs` — `mtimeStale: true` (но **не** обновляем здесь; обновление — при сборке контекста).
3. Вернуть.

**Зачем:** правая панель — список reference-файлов с бейджами `missing` / `stale`.

### 3.8. `POST /api/chat` — PROJECT-ветка в `chatHandler`

**Файл:** `server/src/controllers/chatController.js`.

Сейчас `chatHandler` работает в RESEARCH. **Добавить** ветку по `session.mode`:

```js
const mode = session.mode === 'project' ? 'project' : 'research';
```

**Что меняется для PROJECT:**

1. **Attached files** — из `attachments` (kind='reference', session_id) → `currentAttachments` **не** из `req.files` (в PROJECT форма файлов — только clipboard-картинки, если будут; в этом ТЗ — **не будет**, картинки остаются RESEARCH-only).
   - `SELECT * FROM attachments WHERE session_id=? AND kind='reference' ORDER BY created_at`.
   - Собрать `attachments_meta` = `[{ fileId, name, size, kind: 'reference', language }]` (без URL).
2. **`buildLLMContext`** — получает `currentAttachments` (reference-файлы) + `mode='project'`.
3. **`message`** — только текст пользователя (как сейчас).
4. **`attachments_meta` сообщения** — `currentAttachments` (reference-файлы, **снимок на момент отправки**). Если пользователь потом detach'ит — старые Q&A не меняются.
5. **`imageData`** — не применимо (нет clipboard-картинок в PROJECT).
6. **`contextInfo`** — добавляются `filesAttached: N`, `filesMissing: ['src/gone.ts']`, `filesTooLarge: ['data.csv']`, `mode: 'project'`.

**Никаких** изменений в RESEARCH-ветке (`mode === 'research'`) — она работает как сейчас.

**Форма запроса:** `POST /api/chat` — как сейчас (multipart/form-data, `file`/`codeFiles` **не** передаются; в PROJECT их **нет**).

### 3.9. `buildLLMContext` — PROJECT-ветка

**Файл:** `server/src/services/contextBuilder.js`.

**Логика:**

```js
export async function buildLLMContext(sessionId, currentAttachments = [], contextSize = 65536, retainPercent = 80, includeQuestionIds = null, mode = 'research') {
    // ... sysprompt (как сейчас) ...
    // ... messages (как сейчас) ...

    // 3. Собираем файлы
    const allFileIds = new Set();
    for (const msg of messages) { /* как сейчас */ }
    currentAttachments.forEach(a => { if (a.fileId) allFileIds.add(a.fileId); });

    let filesContext = '';
    const filesMissing = [];
    const filesTooLarge = [];

    if (allFileIds.size > 0) {
        const rows = db.prepare(`
            SELECT * FROM attachments
            WHERE id IN (${placeholders}) AND kind != 'image' AND extracted_text != '' OR kind = 'reference'
        `).all(...ids);

        for (const r of rows) {
            if (mode === 'project' && r.kind === 'reference') {
                // Читаем с диска (mtime-кэш)
                let content = r.extracted_text;
                try {
                    const abs = resolveAttachmentPath(r);
                    if (!abs || !fs.existsSync(abs)) {
                        filesMissing.push(r.filename);
                        continue;
                    }
                    const stat = fs.statSync(abs);
                    if (stat.size > MAX_REFERENCE_FILE_SIZE) {
                        filesTooLarge.push(r.filename);
                        continue;
                    }
                    if (r.extracted_mtime !== stat.mtimeMs || !content) {
                        // Перечитываем
                        content = fs.readFileSync(abs, 'utf-8');
                        db.prepare('UPDATE attachments SET extracted_text = ?, extracted_mtime = ? WHERE id = ?')
                            .run(content, stat.mtimeMs, r.id);
                    }
                } catch (e) {
                    filesMissing.push(r.filename);
                    continue;
                }
                filesContext += `--- FILE: ${r.filename} (актуальная версия) ---\n${content}\n\n`;
            } else {
                // RESEARCH: как сейчас
                filesContext += `--- FILE: ${r.filename} ---\n${r.extracted_text}\n\n`;
            }
        }
    }

    // ... [Материалы] (как сейчас) ...
    // ... info: { ...как сейчас, filesMissing, filesTooLarge, mode } ...
}
```

**Важно:**
- Для PROJECT — `extracted_text != ''` **не** фильтруем (reference может быть пустым до первого чтения).
- SQL-фильтр: `kind != 'image' AND extracted_text != ''` **или** `kind = 'reference'` — **либо** через `WHERE kind != 'image'` (упростить, оставить `extracted_text` как есть).
- **mtime-кэш**: `r.extracted_mtime === stat.mtimeMs` → не читаем; иначе — читаем + `UPDATE`.
- **MAX_REFERENCE_FILE_SIZE** — `process.env.MAX_REFERENCE_FILE_SIZE || 1048576` (1 MB).
- **`filesContext`** — заголовок `The user has shared the following files:` — **оставить** (как сейчас), но для reference — суффикс `(актуальная версия)`.
- **`info`** — добавить `mode`, `filesMissing`, `filesTooLarge`. Фронт уже читает `info.*`, новые поля — опциональны.

**`getQAPairs`** — **не меняется** (reference-файлы в `attachments_meta` уже есть).

### 3.10. `chatController` — передача `mode` в `buildContext`

```js
const contextResult = await sessionService.buildContext(
    sessionId, currentAttachments, contextLength, retainPercent, parsedIncludeIds, mode
);
```

`sessionService.buildContext` — добавить параметр `mode` (прокинуть в `buildLLMContext`).

**`contextResult.info`** — добавить `mode`, `filesMissing`, `filesTooLarge` в ответ `res.json` (`contextInfo`).

---

## 4. Фронтенд — правая панель (SettingsPanel)

**Файл:** `frontend/src/features/models/components/settings-panel.tsx` (сейчас — заглушка).

**Новая структура:**

```
┌─────────────────────────────────────┐
│ 📁 Project                          │
├─────────────────────────────────────┤
│ [🔘 Research] [⚫ Project]           │  ← mode toggle (PATCH sessions.mode)
├─────────────────────────────────────┤
│ ⚠️ CONTEXT_BASE_DIR не настроен     │  ← banner (если config.contextBaseDir.ok === false)
│    Установите в server/.env         │
│    [disabled] Open Folder           │
├─────────────────────────────────────┤
│ 📂 Current project: my-repo         │
│    /home/selub/Documents/progs/my-repo │
│    [Change Folder] [✕ Remove]       │
├─────────────────────────────────────┤
│ 🔍 Filter files...                  │
├─────────────────────────────────────┤
│ 📄 src/chat.ts             [×]      │  ← reference-файлы (attach list)
│ 📄 src/store.ts            [×]      │
│ 📄 README.md               [×]      │
│ (пусто — «No files attached»)       │
├─────────────────────────────────────┤
│ [📎 Attach file(s)]                 │  ← file picker (одиночные или multiple)
│ [📂 Browse project files]           │  ← диалог со списком (3.4)
└─────────────────────────────────────┘
```

**Если режим `research`:**
- Секция Project — **скрыта** (или disabled + текст «Переключитесь в Project, чтобы работать с репозиторием»).
- Mode toggle — в шапке правой панели.
- Остальное (SettingsPanel) — **как сейчас** (`⚙ Settings`, «Reserved for Project mode»). **NB:** сейчас там «Reserved for Project mode» — **заменить** на реальный контент.

**Компоненты (новые):**
- `ProjectPanel` — главный компонент (внутри `SettingsPanel` или вместо).
- `ModeToggle` — `Research / Project`.
- `ContextBaseDirBanner` — красный, если `!config.ok`.
- `CurrentProject` — название + путь + Change/Remove.
- `AttachList` — список reference-файлов с × (detach).
- `BrowseDialog` — модалка со списком файлов (Radix Dialog, как `LoadModal`).

**Store:** новый `projectStore.ts` (Zustand):
```ts
interface ProjectStore {
  config: { contextBaseDir: { ok: boolean; path: string | null; error: string | null } } | null;
  currentProject: { id: string; name: string; path: string; totalFiles: number } | null;
  attachments: Array<{ fileId: string; name: string; size: number; kind: 'reference'; language: string; filePath: string; missing?: boolean; mtimeStale?: boolean }>;
  filter: string;
  isLoading: boolean;
  // actions: init, loadConfig, createProject, loadAttachments, attach, detach, setMode
}
```

**`sessionStore`** — добавить `mode: 'research' | 'project'` (читать из `session.mode`, обновлять через PATCH). **Не** дублировать в `projectStore`.

**`apiGateway`** — новые методы:
```ts
configApi.get()                          // GET /api/config
projectsApi.create(sessionId, relativePath)  // POST /api/projects
projectsApi.listFiles(projectId, filter)     // GET /api/projects/:id/files
projectsApi.attach(projectId, sessionId, relativePaths)  // POST /api/projects/:id/attach
attachmentsApi.listBySession(sessionId)      // GET /api/sessions/:id/attachments
attachmentsApi.detach(fileId)                // DELETE /api/attachments/:fileId
sessionsApi.update(id, { mode })             // уже есть PATCH
```

**`chat-area.tsx`** — **не меняется** (в PROJECT нет `file`/`codeFiles`; `[Вопрос]` работает). Только `contextInfo` — добавить `filesAttached`/`filesMissing`/`filesTooLarge` в бейджи (опционально, можно в S.7.6).

---

## 5. UX-сценарии (для тестов)

### 5.1. Первый запуск, `CONTEXT_BASE_DIR` не настроен

1. `GET /api/config` → `{ ok: false }`.
2. Правая панель: красный баннер, `[Open Folder]` disabled, `[Attach file(s)]` disabled.
3. Переключение в Project: **разрешено** (mode toggle), но функции Project disabled.
4. Тост: «CONTEXT_BASE_DIR не настроен. Установите в `server/.env` и перезапустите сервер».
5. RESEARCH работает (файлы через форму).

### 5.2. `CONTEXT_BASE_DIR` настроен, новая сессия

1. `GET /api/config` → `{ ok: true, path: '/home/selub/Documents/progs' }`.
2. Новая сессия — `mode = 'research'` (по умолчанию).
3. Пользователь в правой панели нажимает `[⚫ Project]` → `PATCH /api/sessions/:id` `{ mode: 'project' }`.
4. Правая панель показывает `[Open Folder]` (enabled).
5. `[Open Folder]` → `<input webkitdirectory>` → пользователь выбирает `my-repo`.
6. Фронт отправляет `POST /api/projects` `{ sessionId, relativePath: 'my-repo' }`.
7. Сервер: `projects` row, `sessions.project_id` → `project.id`, `sessions.mode` → `project` (повторно). `totalFiles: 42`.
8. UI: `Current project: my-repo`, `[Change Folder] [✕ Remove]`, `[📂 Browse project files]` (enabled).
9. `[📂 Browse project files]` → модалка со списком 42 файлов.
10. Пользователь отмечает `src/chat.ts`, `src/store.ts`, `README.md` → `[Attach selected]`.
11. Фронт отправляет `POST /api/projects/:id/attach` `{ sessionId, relativePaths: [...] }`.
12. Сервер: 3 строки в `attachments` (`kind='reference'`, `path_base='context'`). Возвращает `{ attached: [...] }`.
13. UI: `AttachList` обновляется — 3 файла с ×.
14. Вопрос: «Как устроен `chat.ts`?».
15. `POST /api/chat` → `chatHandler` (mode=project) → `currentAttachments` = 3 reference → `buildLLMContext` (project) → читает файлы с диска (mtime-кэш пуст → читает), `[Материалы]` = 3 файла с суффиксом `(актуальная версия)` → `[Ранее]` (пусто) → `[Вопрос]`.
16. Модель отвечает.
17. `attachments_meta` в ответе — 3 reference. `contextInfo` — `mode: 'project'`, `filesAttached: 3`, `filesMissing: []`, `filesTooLarge: []`.

### 5.3. Пользователь изменил файл, спрашивает снова

1. Пользователь изменил `src/chat.ts` в редакторе (mtime изменился).
2. Вопрос: «Что изменилось в `chat.ts`?».
3. `buildLLMContext` (project) → `r.extracted_mtime !== stat.mtimeMs` → перечитывает `chat.ts` → обновляет `extracted_text` + `extracted_mtime` → `[Материалы]` = актуальная версия.
4. Модель видит новое содержимое.

### 5.4. Файл удалён с диска

1. Файл был в `attachments` (reference), пользователь удалил его.
2. Вопрос: «…».
3. `buildLLMContext` → `!fs.existsSync(abs)` → `filesMissing.push('src/gone.ts')` → в `[Материалы]` файла нет.
4. UI: `AttachList` — бейдж `⚠️ src/gone.ts (missing)`. `contextInfo.filesMissing = ['src/gone.ts']`. Тост.
5. Модель видит «N файлов приложено (1 missing)» — **если** добавим в `[Материалы]` строку `[MISSING: src/gone.ts]`. **Опционально**, но полезно. **Рекомендую** добавить в `filesContext`:
   ```
   --- FILE: src/gone.ts (MISSING) ---
   [file not found on disk]
   ```
   — чтобы модель **знала**, что файл был, но пропал.

### 5.5. Файл слишком большой

1. `data.csv` 10 MB attach'ится (пользователь выбрал).
2. `POST /api/projects/:id/attach` → `stat.size > MAX_REFERENCE_FILE_SIZE` → **400** `{ errors: [{ path, error: 'File too large (10 MB, max 1 MB)' }] }`.
3. UI: тост «Файл data.csv слишком большой (10 MB, max 1 MB)».
4. Файл **не** в `attachments`.

**Отличие от 3.9:** attach отбрасывает большие файлы **сразу** (не добавляет в БД). `buildLLMContext` тоже проверяет на случай, если размер изменился после attach.

### 5.6. Detach

1. `AttachList` → × у `src/store.ts`.
2. `DELETE /api/attachments/:fileId` → строка удалена из `attachments`. Файл на диске **не** тронут.
3. Следующий вопрос — `currentAttachments` = 2 reference (без `store.ts`).
4. **Прошлые** Q&A — `attachments_meta` содержит `store.ts` (снимок) → бейдж виден в истории. **Это ок.**

### 5.7. Переключение Research ↔ Project в существующей сессии

1. RESEARCH-сессия с 2 Q&A (документы inline).
2. Пользователь переключает в `Project`. `PATCH /api/sessions/:id` `{ mode: 'project' }`.
3. `session.mode = 'project'`. `sessions.project_id` — null (нет проекта).
4. UI: `Current project: (none)` + `[Open Folder]`.
5. Пользователь выбирает `my-repo`, attach'ит 2 файла.
6. Вопрос: «…».
7. `[Материалы]` — **только** reference-файлы (2 шт). **Старые** Q&A — в `[Ранее]`. **Старые** inline-документы (из RESEARCH) — **не** в `[Материалы]` (они были в `[Материалы]` **на момент отправки**, в `attachments_meta` старых Q&A, но `attachments.kind='document'` — не reference). **`buildLLMContext`** собирает `[Материалы]` из **текущего** пула `attachments` (`kind='reference'`), **плюс** `attachments_meta` прошлых Q&A (kind='document'/'code' — если были в RESEARCH). **Проверить:** текущий `buildLLMContext` собирает `allFileIds` из `messages.attachments_meta` **всех** сообщений + `currentAttachments`. Значит, **старые** `kind='document'` попадут в `[Материалы]` (inline). **Это ок** — они «материалы» из прошлых сообщений. Но для PROJECT — **странно** видеть inline-документ из RESEARCH в `[Материалы]`. **Решение:** для PROJECT — **не** включать `kind='document'` из `messages.attachments_meta`, только `kind='reference'` из `currentAttachments`. **Уточнить в 3.9:** для `mode === 'project'` — `allFileIds` = только `currentAttachments.fileId` (reference). Старые RESEARCH-документы — **не** в `[Материалы]`.

**Это важное уточнение.** RESEARCH-ветка — как сейчас (все `attachments_meta` всех сообщений). PROJECT-ветка — только текущий пул reference.

---

## 6. Тесты (red-first)

### 6.1. Backend

**`server/tests/config/paths.test.js`** (расширить):
- `getContextBaseDirStatus` — `ok: false` при отсутствии; `ok: true` при существующей директории.
- Traversal для PROJECT-пути (`projects.path` через `POST /api/projects` с `../etc`) → 400.

**`server/tests/routes/configRoutes.test.js`** (новый):
- `GET /api/config` → `{ contextBaseDir: { ok, path, error } }`.

**`server/tests/controllers/projectController.test.js`** (новый):
- `POST /api/projects` с валидным `relativePath` → `projects` row + `sessions.project_id` + `mode='project'`.
- `POST /api/projects` с `relativePath='../etc'` → 400 traversal.
- `POST /api/projects` без `CONTEXT_BASE_DIR` → 400.
- `POST /api/projects` с несуществующей директорией → 400.
- Идемпотентность: повторный `POST` того же `relativePath` → `created: false`.
- `GET /api/projects/:id/files` → список файлов; фильтр; лимит 500.
- `POST /api/projects/:id/attach` → 3 reference в `attachments`, `attached` в ответе; идемпотентность (повторный attach — `skipped`/existing fileId).
- `POST /api/projects/:id/attach` с большим файлом → `errors: [{ path, error: 'too large' }]`.
- `POST /api/projects/:id/attach` с traversal (`../../etc/passwd`) → `errors`.

**`server/tests/routes/attachmentRoutes.test.js`** (расширить):
- `DELETE /api/attachments/:fileId` → 200, строка удалена, файл на диске **не** удалён.
- `GET /api/sessions/:id/attachments` → список reference; `missing`/`mtimeStale` в ответе.

**`server/tests/services/contextBuilder.test.js`** (расширить):
- `buildLLMContext` mode='project' с reference-файлами:
  - читает с диска (`extracted_text` пуст → `fs.readFile` → `extracted_text` обновлён, `extracted_mtime` обновлён).
  - mtime-кэш: второй вызов **не** перечитывает (мок `fs.readFileSync`).
  - `filesMissing` при удалённом файле.
  - `filesTooLarge` при размере > лимита.
  - `[Материалы]` — с суффиксом `(актуальная версия)`.
  - `info.mode === 'project'`, `info.filesMissing`, `info.filesTooLarge`.
- **PROJECT не включает** `kind='document'` из прошлых Q&A (только reference из `currentAttachments`).
- RESEARCH — без изменений (регрессия).

**`server/tests/controllers/chatController.test.js`** (расширить):
- `POST /api/chat` в PROJECT-сессии с 3 reference-файлами:
  - `currentAttachments` = 3 reference.
  - `buildLLMContext` вызван с `mode='project'`.
  - `attachments_meta` сообщения — 3 reference.
  - `contextInfo.mode === 'project'`, `filesAttached === 3`.
- `POST /api/chat` в PROJECT-сессии с `file`/`codeFiles` — **игнорируются**? **Решение:** в PROJECT `file`/`codeFiles` **не поддерживаются** (только reference через attach). Если переданы — **400** `{ error: 'Use /api/projects/:id/attach for files in Project mode' }`. **Уточнить в 3.8.**

**`server/tests/db/init.test.js`** (расширить):
- Guarded ALTER: `attachments` += `extracted_mtime` на legacy-БД.
- CREATE: свежая БД содержит `extracted_mtime`.

### 6.2. Frontend

**`frontend/src/stores/projectStore.test.ts`** (новый):
- `init()` → fetch `/api/config` → `config.contextBaseDir.ok`.
- `createProject('my-repo')` → `POST /api/projects` → `currentProject` set.
- `attach(['src/chat.ts'])` → `POST /api/projects/:id/attach` → `attachments` += 1.
- `detach(fileId)` → `DELETE /api/attachments/:fileId` → `attachments` -= 1.
- `setMode('project')` → `PATCH /api/sessions/:id` `{ mode: 'project' }` → `session.mode` обновлён.

**`frontend/src/stores/sessionStore.test.ts`** (расширить):
- `mode` читается из сессии; `PATCH` при переключении.

**`frontend/src/lib/apiGateway.test.ts`** (расширить):
- `configApi.get()` → `GET /api/config`.
- `projectsApi.create/attach/listFiles`.
- `attachmentsApi.listBySession/detach`.
- `sessionsApi.update(id, { mode })` — `mode` в body.

**`frontend/src/features/models/components/settings-panel.test.tsx`** (новый, если есть тесты компонентов; иначе — ручной смоук):
- Рендер `ProjectPanel` при `config.contextBaseDir.ok = false` → баннер + disabled.
- `ok = true` → `[Open Folder]` enabled.
- Список `attachments` — с × (detach вызывает `detach`).

---

## 7. Definition of Done

- [ ] `GET /api/config` → `{ contextBaseDir: { ok, path, error } }`; тест.
- [ ] `PATCH /api/sessions/:id` принимает `mode` (`research`/`project`), валидация; тест.
- [ ] `POST /api/projects` — создаёт/находит `projects`, привязывает к сессии, ставит `mode='project'`, считает `totalFiles`; traversal → 400; без `CONTEXT_BASE_DIR` → 400; идемпотентность; тест.
- [ ] `GET /api/projects/:id/files` — список файлов (игнор: `node_modules/.git/dist/build/.next/__pycache__/*.min.*/*.map`), фильтр, лимит 500; тест.
- [ ] `POST /api/projects/:id/attach` — reference в `attachments`, traversal → errors, большие файлы → errors, идемпотентность; тест.
- [ ] `DELETE /api/attachments/:fileId` — detach (строка, файл не трогаем); тест.
- [ ] `GET /api/sessions/:id/attachments` — reference + `missing`/`mtimeStale`; тест.
- [ ] `buildLLMContext` (mode='project') — читает reference с диска, mtime-кэш, `(актуальная версия)` в `[Материалы]`, `filesMissing`/`filesTooLarge`; тест.
- [ ] `buildLLMContext` (mode='project') — **не** включает `kind='document'` из прошлых Q&A; тест.
- [ ] `chatHandler` (mode='project') — `currentAttachments` из reference, `attachments_meta` сообщения, `contextInfo.mode`/`filesAttached`/`filesMissing`/`filesTooLarge`; тест.
- [ ] `chatHandler` (mode='project') — `file`/`codeFiles` **не принимаются** (400 или игнор — **уточнить**, рекомендую 400); тест.
- [ ] `attachments.extracted_mtime` — guarded ALTER + CREATE; тест.
- [ ] `sessions.mode` default `'research'` в `sessionRepo.createSession`; тест.
- [ ] Frontend: `projectStore` (config, currentProject, attachments, filter, isLoading, init/createProject/attach/detach/setMode); тесты.
- [ ] Frontend: `apiGateway` — config/projects/attachments/listBySession/detach; тесты.
- [ ] Frontend: `SettingsPanel` → `ProjectPanel` с mode toggle, banner (если `!ok`), currentProject, attach list, browse dialog; ручной смоук.
- [ ] `contextInfo` — фронт показывает бейджи `filesAttached`/`filesMissing`/`filesTooLarge` в context-bar (опционально, S.7.6).
- [ ] Все сценарии 5.1–5.7 — ручной смоук.
- [ ] `pnpm run build`, `pnpm run lint`, `test:run`, `test:backend` — зелёные.
- [ ] `PROJECT_CONTEXT.md §7` — новые решения (см. §9); §1 — `Study → Research`; §10 — `projects`/`project_files` в карте.
- [ ] README — `CONTEXT_BASE_DIR`, endpoints `/api/config`, `/api/projects/*`, `/api/sessions/:id/attachments`.
- [ ] WORKLOG — запись.

---

## 8. Оценка

- **S.7.1** — `GET /api/config` + banner: 1 ч.
- **S.7.2** — `PATCH /api/sessions/:id` mode + mode toggle: 1 ч.
- **S.7.3** — `POST /api/projects` + `Open Folder` + `CurrentProject`: 3 ч.
- **S.7.4** — `GET /api/projects/:id/files` + `POST /api/projects/:id/attach` + `BrowseDialog` + `AttachList`: 4 ч.
- **S.7.5** — `DELETE /api/attachments/:fileId` + detach: 1 ч.
- **S.7.6** — `buildLLMContext` PROJECT-ветка (mtime-кэш, `filesMissing`/`filesTooLarge`): 3 ч.
- **S.7.7** — `chatHandler` PROJECT-ветка + `contextInfo`: 2 ч.
- **S.7.8** — `GET /api/sessions/:id/attachments`: 1 ч.
- **S.7.9** — Frontend `projectStore` + `apiGateway` + `ProjectPanel`: 4 ч.
- **S.7.10** — Тесты (unit + integration): 4 ч.
- **S.7.11** — Docs (README, PROJECT_CONTEXT, WORKLOG): 1 ч.
- **Итого: ~25 часов (3–4 дня).**

**Не входит:** RAG (Qdrant), Tree-sitter, streaming, watch, multi-project, git, vision в PROJECT, editing, File Manager.

---

## 9. Что добавить в `PROJECT_CONTEXT.md §7`

```markdown
| 125 | PROJECT mode (вариант A, без RAG): `sessions.mode` — `research`/`project` (default `research`, `'chat'` трактуется как `research`); переключение через `PATCH /api/sessions/:id`; `sessions.project_id` → `projects.id`. Файлы — `attachments` (`kind='reference'`, `path_base='context'`, `file_path='<projectPath>/<rel>'`), `extracted_text=''`, `extracted_mtime` (mtime-кэш). Чтение при сборке контекста (`buildLLMContext` mode='project'), `(актуальная версия)` в `[Материалы]`. `filesMissing`/`filesTooLarge` в `contextInfo`. Переключение в существующей сессии разрешено; старые Q&A (RESEARCH) в `[Материалы]` PROJECT **не** попадают (только reference из `currentAttachments`). `DELETE /api/attachments/:fileId` — detach (файл на диске не трогаем). | ТЗ Project mode A, 2026-11-10 |
| 126 | `CONTEXT_BASE_DIR` — обязателен для PROJECT. `GET /api/config` → `{ contextBaseDir: { ok, path, error } }`. Отсутствие/несуществование → UI: красный баннер + disabled Projects; RESEARCH работает. `POST /api/projects` / `POST /api/projects/:id/attach` — traversal → 400/errors; размер > `MAX_REFERENCE_FILE_SIZE` (1 MB) → errors. | ТЗ Project mode A, 2026-11-10 |
| 127 | PROJECT не принимает `file`/`codeFiles` в `POST /api/chat` (только reference через attach). Clipboard-картинки — RESEARCH-only (в этом ТЗ). | ТЗ Project mode A, 2026-11-10 |
```

---

## 10. Открытые вопросы (агент решает по умолчанию, если не уточнено)

1. **`file`/`codeFiles` в PROJECT `POST /api/chat`** — 400 или игнор? **По умолчанию:** 400 `{ error: 'Use /api/projects/:id/attach' }` — явная ошибка лучше тихого игнора.
2. **`MAX_REFERENCE_FILE_SIZE`** — 1 MB. Env: `process.env.MAX_REFERENCE_FILE_SIZE || 1048576`.
3. **`MAX_REFERENCE_FILES`** — 100 (лимит на сессию). Если превышен — `POST /api/projects/:id/attach` → `errors: [{ error: 'Max 100 reference files per session' }]`.
4. **Игнор-паттерны при обходе** — `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `__pycache__/`, `*.min.*`, `*.map`, `.DS_Store`, `Thumbs.db`.
5. **`modeChangedAtQuestion`** — **не** реализуем (не нужен; `contextInfo.mode` достаточно).
6. **Фильтр в BrowseDialog** — по подстроке имени; лимит 500 (если больше — показать «уточните фильтр»).
7. **`Change Folder`** — открывает `[Open Folder]` заново; при смене проекта — `attachments` **не** чистятся (orphan-политика); `sessions.project_id` → новый `projects.id`. **Уточнить:** старые reference-файлы от старого проекта — **остаются** в `attachments` (пользователь может detach вручную). Или — при смене проекта **все** reference старого проекта **detach**'ятся автоматически? **Рекомендую:** detach автоматически при смене проекта (иначе `[Материалы]` смешает 2 проекта). **Реализация:** при `POST /api/projects` (смена) — `DELETE FROM attachments WHERE session_id=? AND kind='reference' AND file_path NOT LIKE '<newProjectPath>/%'`. **Включить в 3.3.**
8. **`Remove project`** — `sessions.project_id = null`, `mode` **не** меняется (research? project?). **Рекомендую:** `mode = 'research'` при remove. `attachments` (reference) — detach автоматически (как в 7). **Включить в 3.3.**