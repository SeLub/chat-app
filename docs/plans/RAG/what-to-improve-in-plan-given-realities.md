## Часть 3. Что доработать в плане с учётом реалий

Если владелец решит делать **B** (сразу или после A) — план нужно доработать:

### 3.1. 🔴 `projects.path` и `CONTEXT_BASE_DIR` — **не упомянуты**

План пишет: `Project path` = `/path/to/project`. Но у нас есть **`CONTEXT_BASE_DIR`** (решение D-B, #120). `projects.path` **должен** быть **относительным** от `CONTEXT_BASE_DIR` (`my-repo`), не абсолютным. Иначе:
- Безопасность (traversal) — плана **не покрывает**.
- `attachments.path_base='context'` — резолв от `CONTEXT_BASE_DIR`, а `projects.path` — от `/`? **Конфликт.**

**Доработка:** `POST /api/project/setup` принимает **относительный** `projectPath` (например, `my-repo`), сервер резолвит `CONTEXT_BASE_DIR + '/' + projectPath`, canonicalize, проверяет `startsWith`. `projects.path` = `my-repo`.

### 3.2. 🔴 `[Материалы]` vs `[RELEVANT_CODE_SNIPPETS]` — **два формата, конфликт**

План:
```
[RELEVANT_CODE_SNIPPETS]
[ATTACHED_FILES]
[USER_QUESTION]
```

Наш:
```
system(sysprompt) + user[Материалы] + user[Ранее] + user[Вопрос]
```

**Доработка:** **встроить** RAG-фрагменты **в** `[Материалы]`, **не** отдельным блоком:

```
system(sysprompt)
user[Материалы]
  --- FILE: my-repo/src/chat.ts (полный, attached) ---
  <код>

  --- FILE: my-repo/src/store.ts (attached) ---
  <код>

  [Релевантные фрагменты — из Qdrant]
  --- src/auth/jwt.ts:45-62 (function validateToken) ---
  <фрагмент>

  --- src/middleware/auth.ts:12-30 (function authMiddleware) ---
  <фрагмент>

user[Ранее в этой сессии] + history
user[Вопрос]
```

**Или** — **отдельным** user-блоком `[Релевантные фрагменты]` **между** `[Материалы]` и `[Ранее]`:

```
system
user[Материалы]          ← attached files (полные)
user[Релевантные фрагменты]  ← chunks из Qdrant
user[Ранее]
user[Вопрос]
```

**Второй вариант — чище** (семантика «attached — явное», «relevant — найденное»), но **добавляет** ещё один блок. **Рекомендую** второй — **но** с **явным** правилом: если `attached files` пуст — `[Релевантные фрагменты]` всё равно работает (search по проекту). Если Qdrant недоступен — `[Материалы]` работает (attached), RAG просто не добавляется.

### 3.3. 🟠 `mode: 'chat' | 'project'` — **нейминг**

План: `Chat / Project`. Конституция: `research / project` (решение D-A). **Доработка:** везде — `research / project`, а UI-надпись «Chat» — **алиас** для `research` (для обратной совместимости с эталоном). Или — `research` в UI, «Research» (не «Chat»). **Рекомендую** — `Research / Project` в UI (консистентно с `mode`).

### 3.4. 🟠 `attachments` vs Qdrant — **два источника**

План пишет `attachedFiles: ["src/middleware/auth.ts"]` — но **не** говорит, **где** они хранятся. У нас — в `attachments` (`kind='reference'`). **Доработка:** `POST /api/project/attach-file` → `attachments`-строка, `attachedFiles` = `attachments.file_path` для этой сессии.

**Qdrant** — **отдельный** индекс (`code_snippets`), не связан с `attachments` 1:1. `attached` — «пользователь выбрал», `Qdrant` — «всё проиндексировано».

**Не** смешивать: `attached` живут в `attachments`, `Qdrant` — в `code_snippets` collection. Они **дополняют** друг друга в промпте.

### 3.5. 🟠 Streaming — **отдельный трек**

План: `streaming responses` в `/api/project/query`. Но у нас `POST /api/chat` — **не** streaming, и §7.86 `PROJECT_CONTEXT` — «Upgrade to stream — ОТЛОЖЕНО в отдельную фазу». **Доработка:** либо:
- **A (project без streaming):** `/api/project/query` — обычный JSON (как `/api/chat`). Streaming — **потом** (отдельный трек).
- **B (project со streaming):** но **тогда** и `/api/chat` → streaming (консистентность).

**Рекомендую A** — не смешивать «Project mode» и «Streaming». Project mode — **сначала** без streaming, как `/api/chat`. Streaming — отдельный трек, для **обоих** режимов.

### 3.6. 🟠 `MAX_CONTEXT_TOKENS=12000` — **не учитывает `retainPercent`**

План: `MAX_CONTEXT_TOKENS=12000` (жёстко). У нас — `retainPercent` (80% от окна модели), `contextLength` из модели. **Доработка:** `MAX_CONTEXT_TOKENS` = **производная** от `contextLength × retainPercent`. Или — **два** бюджета: `RAG_BUDGET` (для фрагментов) + `HISTORY_BUDGET` (для Q&A), оба — из `retainPercent`.

### 3.7. 🟠 `Tree-sitter` — **только JS/TS/Python/Go/Rust/Java/C++**

План: 7 языков. Что если репо на PHP/Ruby/Swift/Kotlin? **Fallback** — text chunking (в плане есть). **Доработка:** **явно** перечислить, что для остальных — **generic chunking** (по 100 строк / 500 токенов). **Или** — `attached files` (полные) как fallback, если Qdrant не дал результатов.

### 3.8. 🟢 `progress indicators` — **UI-деталь**

План: progress bar + status. Моё видение: **не описывал**, потому что **A** (plain) — быстрый (10–100 файлов), не нужен progress. **B** — нужен. **Доработка:** progress — только для B (индексация Qdrant).

### 3.9. 🟢 `Watch mode` — **B-only**

Моё видение — **без watch**. План — `Live Watch` toggle. **Доработка:** watch — только для B. В A — **ручной** re-attach (если файл изменился — пользователь сам обновит). **mtime-кэш** в A уже даёт «актуальную версию» при каждом вопросе, без watch. **Watch** — для **индексации** Qdrant (там `mtime` не поможет — нужно re-embed).

