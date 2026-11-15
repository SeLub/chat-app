# ТЗ: PROJECT mode UX-фиксы + Browse project files (директории верхнего уровня)

**Версия:** 1.0 (самодостаточное)
**Статус:** готово к реализации
**Область:** backend (`projectController`/`projectService` — новый endpoint `top-level-dirs`), frontend (`chat-area`, `project-panel`, `browse-dialog`, `apiGateway`, `sessionStore`)
**Оценка:** ~1–1.5 дня
**Цель:** устранить **4 UX-проблемы** PROJECT mode (баг-репорт пользователя):
1. Скрепка «Attach files» в PROJECT mode → 400 (backend правильно отвергает, но UI **не** скрывает кнопку).
2. `last-prompt` 404 спамит консоль (ProjectPanel перезапрашивает без кэша).
3. После «Новая сессия» (из send-error banner) композер **не** сбрасывается — файлы + вопрос остаются.
4. `BrowseDialog` не позволяет **сузить** поиск до папок проекта — плоский список 500 файлов.

**Плюс:** **улучшение** `BrowseDialog` — плашки **директорий верхнего уровня** (checkbox, фильтрация файлов **в** выбранных) + filter по имени/пути. **Без breadcrumbs** (решение владельца: типичный проект — 5–15 верхних папок, достаточно).

---

## 1. Принятые решения (сводка)

| # | Решение |
|---|---|
| 1.1 | **«Attach files» (скрепка)** — **только в RESEARCH mode**. В **PROJECT** — **скрыть** (`display: none` или `{mode !== 'project' && ...}`), **не** disable (чтобы **не** было «почему серая»). |
| 1.2 | **«Browse project files»** — **остаётся**, **улучшается**: плашки **верхнего уровня** (5–15), **без breadcrumbs**. |
| 1.3 | **Filter files** — **по имени** (как сейчас) **+ по пути** (если строка содержит `/` → поиск по `file.path`, не только `file.name`). **Обе** фильтрации — **в рамках** выбранных папок. |
| 1.4 | **Выбор папок** — **persist** в `localStorage` (per project: `browse_dirs_<projectId>`), чтобы при переоткрытии — **не** сбрасывался. |
| 1.5 | **`last-prompt` 404** — **не** `logger.error` (только `logger.warn` или **ничего**); ProjectPanel — **кэшировать** 404-результат (`useRef` `lastPrompt404` → **не** перезапрашивать **до** `streamingActive: true → false`). |
| 1.6 | **UI-сброс** после «Новая сессия» — `useEffect` в `ChatArea` на `activeSessionId` → `setInputValue('')` + `clearAttachments()`. **Плюс** — в `sendError`-banner кнопка «Новая сессия» — **явно** сбросить composer **перед** `clearChat()`. |
| 1.7 | **Backend** — **новый** endpoint `GET /api/projects/:id/top-level-dirs` (список **непосредственных** детей-директорий `projectPath`, без рекурсии, с игнор-паттернами). **Не** трогает существующие endpoints. |

---

## 2. Backend

### 2.1. Новый endpoint: `GET /api/projects/:id/top-level-dirs`

**Назначение:** список **верхних** папок проекта (для плашек в `BrowseDialog`). **Без** рекурсии, **с** игнор-паттернами (`IGNORED_DIRS` — уже есть в `projectService.walkProjectFiles`).

**`projectService.js`** — новая функция:
```js
/**
 * Список непосредственных дочерних директорий проекта (top-level).
 * Без рекурсии, с игнор-паттернами (IGNORED_DIRS из walkProjectFiles).
 * @returns {{ status: number, body: Object }}
 */
export function listTopLevelDirs(projectId) {
    const project = projectRepo.getProject(projectId);
    if (!project) return { status: 404, body: { error: 'Project not found' } };

    const baseStatus = getContextBaseDirStatus();
    if (!baseStatus.ok) return { status: 400, body: { error: baseStatus.error } };

    const absDir = path.resolve(baseStatus.path, project.path);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
        return { status: 400, body: { error: 'Project directory not found' } };
    }

    let entries;
    try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return { status: 400, body: { error: 'Cannot read project directory' } };
    }

    const dirs = entries
        .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

    return { status: 200, body: { dirs } };
}
```

**`IGNORED_DIRS`** — **уже** объявлен в `projectService.js` (`node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`) — **переиспользуем** (не создавать новый).

**`projectController.js`** — новый handler:
```js
export function listTopLevelDirsHandler(req, res) {
    try {
        const { status, body } = projectService.listTopLevelDirs(req.params.id);
        return res.status(status).json(body);
    } catch (error) {
        console.error('Error in GET /api/projects/:id/top-level-dirs:', error);
        return res.status(500).json({ error: error.message });
    }
}
```

**`projectRoutes.js`** — новый роут:
```js
router.get('/:id/top-level-dirs', listTopLevelDirsHandler);
```

**Контракт ответа:**
```json
{ "dirs": ["docs", "frontend", "packages", "server", "specs"] }
```
**404** — project not found; **400** — `CONTEXT_BASE_DIR` не настроен / директория не существует / не читается.

**Порядок:** `dirs` — **алфавитный** (`localeCompare`), **стабильный** (не зависит от ФС).

**Тесты:**
- 200: проект с `server/`, `frontend/`, `docs/` → `dirs = ['docs', 'frontend', 'server']`.
- 200: `node_modules/` **игнорируется**.
- 200: пустой проект → `dirs = []`.
- 404: project not found.
- 400: `CONTEXT_BASE_DIR` не настроен.

---

## 3. Frontend

### 3.1. `apiGateway.ts` — `projectsApi.listTopLevelDirs`

```ts
listTopLevelDirs(projectId: string): Promise<{ dirs: string[] } | null> {
  return request<{ dirs: string[] }>('GET', `/api/projects/${projectId}/top-level-dirs`);
}
```

**404/400** — `request` бросит `ApiError` → `BrowseDialog` **ловит** → `dirs = []` (fallback: **нет** плашек, **все** файлы, **как** сейчас).

### 3.2. `BrowseDialog` — улучшение

**Сейчас (`browse-dialog.tsx`):**
- Строка «Filter files» (подстрока по `f.path.toLowerCase()` — **уже** по пути! **Проверить** — в текущем коде `loadBrowseFiles(debouncedSearch)` — **серверный** фильтр (`filter` в `listProjectFiles`) — **по** `relPaths.filter(p => p.toLowerCase().includes(needle))` — **по пути**, **не** только имени. ✅ **Значит**, п.1.3 «filter по пути» — **уже** есть. **Оставить**).
- Плоский список (500 файлов).
- Чекбоксы → «Attach selected».

**Стало:**
- **Загрузка** `dirs` при `open` (`useEffect`) — `apiGateway.projects.listTopLevelDirs(currentProject.id)`.
- **Плашки** директорий (под строкой Filter, над списком):
  ```tsx
  {dirs.length > 0 && (
    <div className="flex flex-wrap gap-1.5 mb-2">
      <button
        type="button"
        onClick={() => setSelectedDirs(new Set())}
        className={cn(
          'text-xs px-2 py-0.5 rounded-md border transition-colors',
          selectedDirs.size === 0
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-secondary border-border text-muted-foreground hover:bg-accent',
        )}
      >
        All
      </button>
      {dirs.map((dir) => (
        <button
          key={dir}
          type="button"
          onClick={() => toggleDir(dir)}
          className={cn(
            'text-xs px-2 py-0.5 rounded-md border transition-colors',
            selectedDirs.has(dir)
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-secondary border-border text-muted-foreground hover:bg-accent',
          )}
          aria-pressed={selectedDirs.has(dir)}
        >
          {dir}
        </button>
      ))}
    </div>
  )}
  ```
- **Фильтрация** файлов — **двухуровневая**:
  ```ts
  const visibleFiles = browseFiles.filter((f) => {
    // 1. По выбранным директориям (если ни одна не выбрана — все)
    if (selectedDirs.size > 0) {
      const topDir = f.path.split('/')[0];
      if (!selectedDirs.has(topDir)) return false;
    }
    // 2. По строке Filter (серверный filter уже применил; клиентский — на случай race)
    // (оставляем серверный, чтобы не дублировать)
    return true;
  });
  ```
- **`toggleDir`** — add/remove в `Set`. **«All»** — `setSelectedDirs(new Set())` (сброс).
- **Persist:** `localStorage.setItem('browse_dirs_' + projectId, JSON.stringify([...selectedDirs]))` при изменении; **загрузка** при `open` (`JSON.parse(localStorage.getItem(...) || '[]')`).
- **Счётчик** в заголовке: `«N files, M selected»` — **как** сейчас, **плюс** — **если** `selectedDirs.size > 0` → **добавить** `(в N папках)`.

**Стиль:** **как** `PromptsTab` (radio/checkbox плашки) — **тот же** `bg-primary/15 border-primary/40` при выборе. **Переиспользуем** паттерн.

**Empty state:** если `dirs.length === 0` (fallback) — **не** показываем плашки, **все** файлы, **как** сейчас.

**Race condition:** `selectedDirs` **сбрасывается** в `localStorage` при detach/unmount? **Нет** — persist **до** следующего `open`. **Не** трогаем `selectedDirs` при `onAttach`/`onOpenChange(false)` — **пользователь** мог случайно закрыть → **не** хочется сбрасывать.

**Если `browseFiles` **пуст** (фильтр ничего не нашёл) — «No files match the filter» (как сейчас) + **если** `selectedDirs.size > 0` → **подсказка** «Try clearing directory filters» (дёшево, **помогает**).

### 3.3. `ProjectPanel` — `last-prompt` 404 — не спамить

**Сейчас (`project-panel.tsx`, из PR Attached-files-split):**
```tsx
useEffect(() => {
  if (mode !== 'project' || !activeSessionId || streamingActive) return;
  apiGateway.sessions.getLastPrompt(activeSessionId).then(...).catch(...);
}, [activeSessionId, mode, streamingActive, attachments]);
```

**Проблема:** **каждый** `attachments` **изменяется** (attach/detach) → **перезапрос** → `404` (нет промпта) → **`logger.error`** (`apiGateway` **логирует** `error` на любой `!response.ok`) → **спам** в консоли.

**Фикс:**
1. **`project-panel.tsx`** — **`useRef`** `lastPrompt404Ref`:
   ```tsx
   const lastPrompt404Ref = useRef(false);
   useEffect(() => {
     if (mode !== 'project' || !activeSessionId || streamingActive) return;
     if (lastPrompt404Ref.current) return;  // уже 404 — не спамить
     let cancelled = false;
     apiGateway.sessions.getLastPrompt(activeSessionId).then((lp) => {
       if (cancelled) return;
       lastPrompt404Ref.current = false;  // был ответ — сбросить флаг
       ...
     }).catch((err) => {
       if (cancelled) return;
       if (err instanceof ApiError && err.status === 404) {
         lastPrompt404Ref.current = true;  // кэш 404 — не перезапрашивать
       }
       setLastPromptAttachmentIds(new Set());
     });
     return () => { cancelled = true; };
   }, [activeSessionId, mode, streamingActive, attachments]);
   ```
2. **`apiGateway`** — **опционально:** `getLastPrompt` **не** логирует 404 как `error` (только `warn`). **Или** — **`request`** **принимает** `options.silent404` → не логирует. **Но** — **проще** — **`apiGateway`** **не** трогать, **в** `project-panel` **ловить** 404 (выше).
3. **Сброс** `lastPrompt404Ref` при `streamingActive: true → false` (после нового ответа — `last_prompt` **есть** → **надо** перезапросить):
   ```tsx
   useEffect(() => {
     if (streamingActive) lastPrompt404Ref.current = false;
   }, [streamingActive]);
   ```
   **Или** — **в** основном `useEffect` — **если** `streamingActive` **был** `true` → **сброс**. **Проще:** **отдельный** `useEffect` на `streamingActive` (только **при** `false` — **сброс**; **при** `true` — **ничего**). **См. выше.**

**Поведение:**
- **Первый** запрос → 404 → `lastPrompt404Ref = true` → **не** перезапрашивать.
- **Пользователь** отправил **новый** вопрос → `streamingActive: true → false` → **сброс** → **перезапрос** → 200 (last_prompt есть) → `lastPrompt404Ref = false`.
- **Пользователь** attach/detach → `attachments` **меняется** → `useEffect` **срабатывает** → `lastPrompt404Ref.current === true` → **не** перезапрашивать. ✅

### 3.4. `ChatArea` — скрыть «Attach files» (скрепка) в PROJECT mode

**Сейчас (`chat-area.tsx`):**
```tsx
<button onClick={() => fileInputRef.current?.click()} aria-label="Attach files">
  <Paperclip className="w-4 h-4" />
</button>
```

**Стало:**
```tsx
{mode !== 'project' && (
  <button onClick={() => fileInputRef.current?.click()} aria-label="Attach files">
    <Paperclip className="w-4 h-4" />
  </button>
)}
```

**Почему `mode !== 'project'`:** RESEARCH (по умолчанию) — **скрепка видна** (multipart). PROJECT — **скрыта** (пользователь **не** может ошибиться → 400). ✅

**`mode`** — **из** `useSessionStore((s) => s.mode)`. **В** `ChatArea` **есть** `mode`? **Проверить:** `const mode = useSessionStore((s) => s.mode)` — **добавить**, если **нет**.

**Tooltip** (опционально) — **не** нужен (скрыта — нет вопроса «почему»). **Или** — **на** кнопке **«Browse project files»** (в `ProjectPanel`) — **tooltip** «В PROJECT mode используй эту кнопку для attach» — **не** обязательно.

### 3.5. `ChatArea` — сброс composer после «Новая сессия» / `clearChat`

**Сейчас:** `inputValue` + `fileSlot` + `codeFiles` — **локальный** `useState` в `ChatArea`. `clearChat` (`sessionStore`) **не** трогает их.

**Фикс:**
```tsx
useEffect(() => {
  setInputValue('');
  clearAttachments();
}, [activeSessionId]);  // сброс при смене сессии
```

**Плюс** — **в** `sendError`-banner **«Новая сессия»**:
```tsx
<Button onClick={() => { setInputValue(''); clearAttachments(); void clearChat(); }}>
  Новая сессия
</Button>
```
**Почему `void`:** `clearChat` — **async** (архивация + create) → **`void`** — **не** ждать (fire-and-forget), **но** **сброс** composer — **сразу** (до `clearChat`). **Или** — `await clearChat()` + **потом** `setInputValue('')` — **порядок** **не** важен (composer — **локальный**, **не** зависит от store).

**`activeSessionId`** — **из** `sessionStore`. **При** `clearChat` → **новый** `activeSessionId` → **`useEffect`** **срабатывает** → **сброс**. ✅

**Риск:** `useEffect` **на** `activeSessionId` — **срабатывает** **и** при **F5** (init → `activeSessionId` **с** localStorage) → **сброс** composer (пусто → пусто). **Ок** (composer **не** персистится).

**Проверить:** `clearAttachments` — **не** трогает `inputValue` (только `fileSlot`/`codeFiles`). **Вызывать** **оба**: `setInputValue('')` + `clearAttachments()`.

---

## 4. Тестирование

### 4.1. Backend

1. `GET /api/projects/:id/top-level-dirs` — 200 с `{ dirs: ['docs', 'frontend', 'server'] }` (для проекта с этими папками).
2. `node_modules/`, `.git/` — **игнорируются** (не в `dirs`).
3. Пустой проект — `{ dirs: [] }`.
4. Несуществующий `projectId` — 404.
5. `CONTEXT_BASE_DIR` не настроен — 400.
6. Алфавитный порядок — `['docs', 'frontend', 'server']` (не `['server', 'docs', 'frontend']`).

### 4.2. Frontend

1. **`BrowseDialog`:** `dirs = ['server', 'frontend']` → **две** плашки + «All». Клик `server` → `selectedDirs = {server}` → **список** только `server/*`. Клик `frontend` (дополнительно) → `{server, frontend}` → **оба**. Клик «All» → `selectedDirs = {}` → **все**.
2. **`BrowseDialog`:** filter «auth» + `selectedDirs = {server}` → **файлы** в `server/`, **путь** содержит «auth» (уже **есть** — серверный filter по пути). ✅
3. **`BrowseDialog`:** `dirs = []` (fallback 404/400) → **нет** плашек, **все** файлы (как сейчас).
4. **`BrowseDialog`:** persist — выбрал `server`, закрыл, открыл → `server` **выбран**.
5. **`ChatArea`:** `mode = 'project'` → скрепка **не** видна. `mode = 'research'` → скрепка **видна**.
6. **`ChatArea`:** после `clearChat` (или «Новая сессия» в send-error) → `inputValue = ''`, `fileSlot = null`, `codeFiles = []`.
7. **`ProjectPanel`:** первый `getLastPrompt` → 404 → **не** спамит (повторный attach/detach → **не** перезапрашивает). После ответа (`streamingActive: true → false`) → **перезапрашивает** (200).

### 4.3. Сквозной ручной сценарий

1. **PROJECT mode** → `ChatArea` — **скрепки нет**. ✅
2. `ProjectPanel` → «Browse project files» → **плашки** `server`, `frontend`, `docs` + «All». ✅
3. Клик `server` → **список** только `server/*`. Filter «provider» → `LlamaCppProvider.js`, `OllamaProvider.js`, `providerManager.js`, `BaseProvider.js` — **быстро**. ✅
4. Attach 4 файла → **плашки** исчезают (модалка закрывается). ✅
5. Send → 200 (нет 400 multipart). ✅
6. **Новая сессия** (из send-error) → composer **пуст**, файлов **нет**. ✅
7. **404 `last-prompt`** — **не** спамит в консоли. ✅

---

## 5. Крайние случаи

| Кейс | Решение |
|---|---|
| `dirs = []` (пустой проект) | Плашки **не** рендерятся, **все** файлы (fallback) |
| `top-level-dirs` 404/400 | `dirs = []`, плашки **не** рендерятся, **все** файлы |
| `last_prompt` 404 | `lastPrompt404Ref = true`, **не** спамит |
| `last_prompt` **есть** (200) | `lastPromptAttachmentIds` **заполнен**, `lastPrompt404Ref = false` |
| `mode = 'research'` | Скрепка **видна**, плашки **не** показываются (`BrowseDialog` **только** в PROJECT) |
| `mode = 'project'` | Скрепка **скрыта**, `BrowseDialog` **с** плашками |
| **Persist** `selectedDirs` | При `projectId` **меняется** — **новый** ключ (`browse_dirs_<newId>`), **старый** — **не** трогаем |
| **Detach** файла после attach | `attachments` **меняется** → `useEffect` — `lastPrompt404Ref.current === true` → **не** перезапрашивает |
| **F5** | `activeSessionId` **восстанавливается** → `useEffect` **сброс** composer (пусто → пусто, **не** ломает) |
| **Первый** вопрос (нет `last_prompt`) | `last_prompt` 404 → `lastPrompt404Ref = true` → **не** спамит |

---

## 6. Файлы к изменению/созданию

**Backend:**
- `server/src/services/projectService.js` — **новая** функция `listTopLevelDirs(projectId)` (переиспользует `IGNORED_DIRS`).
- `server/src/controllers/projectController.js` — **новый** `listTopLevelDirsHandler`.
- `server/src/routes/projectRoutes.js` — **новый** роут `GET /:id/top-level-dirs`.
- Тесты: `server/tests/services/projectService.topLevelDirs.test.js`, `server/tests/routes/projectRoutes.topLevelDirs.test.js`.

**Frontend:**
- `frontend/src/lib/apiGateway.ts` — `projectsApi.listTopLevelDirs(projectId)`.
- `frontend/src/features/models/components/browse-dialog.tsx` — `dirs` state, `selectedDirs` state (+ persist), `useEffect` на `open`, плашки, фильтрация `visibleFiles`, «All», empty-state подсказка.
- `frontend/src/features/models/components/project-panel.tsx` — `lastPrompt404Ref` + сброс при `streamingActive: true → false`.
- `frontend/src/features/chat/components/chat-area.tsx` — `mode !== 'project'` для скрепки; `useEffect` на `activeSessionId` → сброс composer; `setInputValue('')` + `clearAttachments()` в «Новая сессия» banner.
- Тесты: `browse-dialog.test.tsx` (плашки, выбор, persist, filter), `chat-area.projectMode.test.tsx` (скрепка скрыта), `chat-area.newSession.test.tsx` (composer сброс), `project-panel.lastPrompt404.test.tsx` (404 не спамит).

**Документация:**
- `README.md` — §PROJECT mode: **«Attach files»** — только RESEARCH; **Browse project files** — с **фильтром по папкам верхнего уровня**.
- `WORKLOG.md` — запись о фиксе.

---

## 7. Порядок реализации

**Один PR** (~10 файлов, ~1–1.5 дня):

1. **PR-1 (backend):** `projectService.listTopLevelDirs` + `projectController` + `projectRoutes` + тесты. **Приёмка:** `GET /api/projects/:id/top-level-dirs` → 200/404/400.
2. **PR-2 (frontend):** `apiGateway` + `BrowseDialog` (плашки, persist, фильтрация) + тесты. **Приёмка:** плашки, выбор, фильтрация.
3. **PR-3 (frontend фиксы):** `ChatArea` (скрепка скрыта в PROJECT, сброс composer) + `ProjectPanel` (404 не спамит) + тесты. **Приёмка:** скрепка скрыта, composer сбрасывается, 404 не спамит.

**Один коммит** (можно объединить PR-1/2/3 — «фикс PROJECT mode UX + BrowseDialog»).

---

## 8. Принятые решения (сводка)

| # | Решение |
|---|---|
| 8.1 | Скрепка «Attach files» — **только в RESEARCH**; в **PROJECT** — **скрыть** (`{mode !== 'project' && ...}`) |
| 8.2 | «Browse project files» — **остаётся**, **улучшение**: плашки **верхнего уровня** (5–15), **без breadcrumbs** |
| 8.3 | Filter files — **по имени/пути** (уже есть — серверный `listProjectFiles` фильтрует по `relPath.toLowerCase().includes(needle)`), **в рамках** выбранных папок |
| 8.4 | Выбор папок — **persist** в `localStorage` (`browse_dirs_<projectId>`), per project |
| 8.5 | `last-prompt` 404 — **кэш** (`lastPrompt404Ref`) + **не** спамит; сброс при `streamingActive: true → false` |
| 8.6 | UI-сброс после «Новая сессия» — `useEffect` на `activeSessionId` + **явный** сброс в banner-кнопке |
| 8.7 | Backend — **один** новый endpoint (`top-level-dirs`), **без** изменения существующих |
| 8.8 | **Без breadcrumbs** — типичный проект 5–15 верхних папок, filter справляется; breadcrumbs — **overkill** для 90% случаев |

---

## 9. Оценка

| Блок | Время |
|---|---|
| Backend: `listTopLevelDirs` + controller + route + тесты | **~0.25 дня** |
| Frontend: `BrowseDialog` (плашки + persist + фильтрация) + тесты | **~0.5 дня** |
| Frontend: `ChatArea` (скрепка, сброс composer) + `ProjectPanel` (404 кэш) + тесты | **~0.5 дня** |
| README + WORKLOG | **~0.25 дня** |
| **Итого** | **~1–1.5 дня** |

---

## 10. Итог

**4 UX-фикса PROJECT mode + улучшение BrowseDialog** — **~1–1.5 дня**:

1. **Скрепка «Attach files»** — **только в RESEARCH** (в PROJECT — скрыта → **нет** 400 multipart). ✅
2. **`last-prompt` 404** — **кэш** (не спамит). ✅
3. **UI-сброс** после «Новая сессия» — composer + файлы. ✅
4. **`BrowseDialog`** — **плашки верхнего уровня** (5–15 папок: `server`, `frontend`, `docs`, `specs`, `packages` …) + **фильтр** по имени/пути **в** выбранных. **Без breadcrumbs** (5–15 папок достаточно). **Persist** выбора. ✅

**Выгода:** PROJECT mode **работает** без путаницы (нет 400, нет спама, composer сбрасывается, browse **сужается** до папок). **UX** — **очевидно** лучше (5–15 плашек vs 500 файлов). **Вложения** — **~1–1.5 дня**, **−1.5–2 дня** vs breadcrumbs (overkill для типичных проектов).

**Готово к реализации.** Начинать с PR-1 (backend). **После merge** — ручной DoD по §4.3.