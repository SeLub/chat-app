# ТЗ: Разделение Attached files на «previous» / «new» в ProjectPanel

**Версия:** 1.0
**Статус:** готово к реализации
**Область:** frontend (`ProjectPanel`, `projectStore`, `chat-area`/`sessionStore` — минимально), backend — **не трогаем** (накопительный принцип сохраняется, §«Что НЕ входит»)
**Оценка:** ~0.5–1 день
**Цель:** в `Attached files` (ProjectPanel) визуально **разделить** файлы на два блока:
- **New for this question** — файлы, прикреплённые **после** последнего отправленного запроса (ещё не ушли в модель — уйдут в **следующем** вопросе).
- **From previous answer** — файлы, которые были в пуле **на момент** последнего отправленного запроса (уже проанализированы в **предыдущем** ответе, но **остаются** в пуле — накопительный принцип).

Накопительный принцип **сохраняется** (файлы не удаляются, все идут в `[Материалы]` следующего вопроса) — меняется **только визуальное представление** (пользователь видит, что «это уже было», «это новое»).

---

## 1. Цель и границы

### 1.1. Что решаем

Сейчас `AttachList` в `ProjectPanel` показывает **все** reference-файлы сессии одним списком. Пользователь **не различает**:
- файлы, которые **уже** были проанализированы в предыдущем ответе (пул не очистился);
- файлы, которые **только что** прикреплены (новые, ещё не ушли).

**Следствие:** пользователь **думает**, что «все файлы в списке — привязаны к **текущему** вопросу», хотя часть — **из прошлого** ответа. Это **не баг** (накопительный принцип — **правильный**, файлы **должны** оставаться, чтобы «продолжи» работало), но **UX-неясность**.

**Решение:** **визуально** разделить на «New for this question» / «From previous answer» — **не** меняя накопительное поведение.

### 1.2. Что НЕ входит в scope

- **Очистка** после ответа — **не** делаем (ломает «продолжи»; по решению владельца — накопительный принцип **ОК**).
- **Чекбокс** «Clear after send» — **не** делаем (владелец: «накопительный принцип — ОК»).
- **Backend** — **не** трогаем (пул reference, `listSessionAttachments`, `buildLLMContext` — **как есть**).
- **`attachments_meta`** прошлых сообщений — **не** трогаем (снимок на момент отправки, иммутабельный).
- **Разделение в `[Материалах]`** промпта — **не** делаем (в промпте — все файлы, без разделения; разделение — **только** в UI).
- **Research mode** — **не** трогаем (там другой поток — multipart, не reference).

### 1.3. Ключевые принципы

1. **Накопительный принцип сохраняется** — все reference-файлы идут в `[Материалы]` следующего вопроса (back-end **не** меняется).
2. **Разделение — визуальное** (в UI), **не** в данных (в `attachments` нет поля «отправлен/новый» — **вычисляем** на фронте по `timestamp` последнего ответа).
3. **Источник истины для «from previous»** — `last_prompt.meta.currentAttachments` (из Last Prompt, PR только что смержен) — **что было** в пуле на момент последнего отправленного запроса.
4. **Источник истины для «new»** — `currentAttachments` **сейчас** − `last_prompt.meta.currentAttachments` (разница — новые).
5. **Fallback:** если `last_prompt` **нет** (новый чат, ни одного запроса) — все файлы = «New for this question».
6. **Не ломает** существующее — `ProjectPanel` **дополняется**, не переписывается.

---

## 2. Frontend

### 2.1. Вычисление «previous» / «new» — в `ProjectPanel` (или `projectStore`)

**Источник:** `last_prompt.meta.currentAttachments` (из `sessionsApi.getLastPrompt(sessionId)` — уже есть, PR Last Prompt). **Или** — **новый** лёгкий endpoint `GET /api/sessions/:id/attachments/snapshot`? **Нет** — `last_prompt` **уже** содержит снимок (`meta.currentAttachments`), **переиспользуем**.

**Логика (в `ProjectPanel`):**
```tsx
const [lastPromptAttachments, setLastPromptAttachments] = useState<Set<string>>(new Set());

useEffect(() => {
  if (!activeSessionId) return;
  apiGateway.sessions.getLastPrompt(activeSessionId)
    .then(lp => {
      const ids = new Set((lp?.meta?.currentAttachments || []).map(a => a.fileId).filter(Boolean));
      setLastPromptAttachments(ids);
    })
    .catch(() => setLastPromptAttachments(new Set()));  // 404 — нет промпта → все «new»
}, [activeSessionId, attachments]);  // attachments — чтобы обновить после нового запроса

// Разделение
const previousFiles = attachments.filter(a => lastPromptAttachments.has(a.fileId));
const newFiles = attachments.filter(a => !lastPromptAttachments.has(a.fileId));
```

**Почему `useEffect` зависит от `attachments`:**
- После **нового** запроса → `last_prompt` **обновляется** (`meta.currentAttachments` = **все** текущие) → `previousFiles` = **все**, `newFiles` = **пусто**.
- После **attach** нового файла → `attachments` **меняется** → `useEffect` **перезапрашивает** `last_prompt` → `newFiles` = новый файл. ✅

**Почему не в `projectStore`:**
- `last_prompt` — **не** часть `projectStore` (это `sessionsApi`, не `projectStore`).
- Вычисление — **локальное** (per `ProjectPanel`), **не** нужно глобально.

**Альтернатива:** **добавить** в `projectStore` поле `lastPromptAttachmentIds: Set<string>` — **обновлять** при `loadAttachments` (заодно с `getLastPrompt`). **Плюс:** одно место, **переиспользуется**, если понадобится в других компонентах. **Минус:** `projectStore` **знает** про `last_prompt` (не его ответственность). **Рекомендую** — **локально** в `ProjectPanel` (проще, **не** загрязняет store).

### 2.2. `ProjectPanel` — UI

**Сейчас (в `AttachList`):**
```tsx
<section aria-label="Attached project files">
  <h3>Attached files · {inContextCount}/{attachments.length} in context</h3>
  <ul>{attachments.map(a => <li>...</li>)}</ul>
</section>
```

**Стало:**
```tsx
<section aria-label="Attached project files">
  <h3>Attached files · {inContextCount}/{attachments.length} in context</h3>

  {/* New for this question */}
  {newFiles.length > 0 && (
    <>
      <h4 className="text-xs font-semibold text-primary">
        New for this question ({newFiles.length})
      </h4>
      <ul>{newFiles.map(a => <FileRow a={a} />)}</ul>
    </>
  )}

  {/* From previous answer */}
  {previousFiles.length > 0 && (
    <>
      <h4 className="text-xs font-semibold text-muted-foreground mt-3">
        From previous answer ({previousFiles.length})
      </h4>
      <ul>{previousFiles.map(a => <FileRow a={a} />)}</ul>
    </>
  )}

  {/* Edge: newFiles = 0, previousFiles = 0 — не рендерим (пусто) */}
  {newFiles.length === 0 && previousFiles.length === 0 && (
    <p className="text-xs text-muted-foreground italic py-2">No files attached</p>
  )}
</section>
```

**Стиль:**
- **New** — `text-primary` (акцент, «это пойдёт в следующий вопрос»).
- **Previous** — `text-muted-foreground` (приглушённый, «это уже было»).
- Файлы **внутри** — **те же** `FileRow` (бейджи missing/too-large/stale, `×` detach) — **не** меняются.
- **Порядок:** **New** — **сверху** (важнее, «новое»), **Previous** — **снизу**.

**Если `newFiles.length === 0` и `previousFiles.length === 0`** — «No files attached» (как сейчас).

**Если `last_prompt` нет** (новый чат) — `lastPromptAttachments` = `Set()`, **все** файлы → `newFiles`, **previousFiles** = `[]`. ✅

**Если `newFiles.length === 0`, `previousFiles.length > 0`** (только что ответили, новых не приложили) — показываем **только** «From previous answer (N)». Пользователь **видит**, что «это уже было, для **нового** вопроса — **ничего** не приложено».

**Если `newFiles.length > 0`, `previousFiles.length === 0`** (новый чат, приложили) — **только** «New for this question (N)».

### 2.3. Обновление `lastPromptAttachments` после отправки

**Ключевой момент:** после **отправки** запроса `last_prompt` **обновляется** (`meta.currentAttachments` = **все** текущие) → `previousFiles` = **все**, `newFiles` = **пусто**.

**Как это триггерить:** `useEffect` в `ProjectPanel` зависит от `attachments` — после **успешного** ответа `attachments` **не меняется** (файлы **остаются** в пуле). Но `last_prompt` **обновился**. **Нужно** перезапросить `last_prompt`.

**Решение:** в `chat-area.tsx` (или `sessionStore.sendMessage`) — **после** успешного ответа — триггерить **событие** (или **обновить** `projectStore` счётчик `lastPromptVersion`). **Проще:** `ProjectPanel` **слушает** `sessionStore.messages` (или `streaming.active` переход `true → false`) — **при** новом ответе — **перезапросить** `last_prompt`.

**Реализация:**
```tsx
const streamingActive = useSessionStore(s => s.streaming.active);
useEffect(() => {
  if (!activeSessionId || streamingActive) return;  // ждём завершения
  apiGateway.sessions.getLastPrompt(activeSessionId)
    .then(lp => setLastPromptAttachments(new Set((lp?.meta?.currentAttachments || []).map(a => a.fileId).filter(Boolean))))
    .catch(() => setLastPromptAttachments(new Set()));
}, [activeSessionId, streamingActive, attachments]);
```

**Почему `streamingActive` в deps:** когда стрим **завершается** (`true → false`), `last_prompt` **уже сохранён** (`persistLastPrompt` **до** `provider.chat`, `update` **после** `done`) → **перезапрос** актуален.

**Почему не `messages` в deps:** `messages` **меняется** на **каждый** чанк (если streaming) — **лишние** запросы. `streamingActive` — **только** переход `true → false` (один раз на ответ). ✅

### 2.4. Что **не** трогаем

- **`FileRow`** — **как есть** (бейджи, detach).
- **Backend** — **как есть**.
- **`buildLLMContext`** — **как есть** (все файлы в `[Материалах]`).
- **`attachments_meta`** — **как есть** (снимок).
- **Research mode** — **не** трогаем.

---

## 3. Тестирование

### 3.1. Frontend (unit)

1. **`ProjectPanel` с `last_prompt`** (мок `getLastPrompt` → `meta.currentAttachments = [A, B]`, `attachments = [A, B, C]`) → `newFiles = [C]`, `previousFiles = [A, B]`; **New** — сверху, **Previous** — снизу.
2. **`ProjectPanel` без `last_prompt`** (404) → `newFiles = [A, B, C]`, `previousFiles = []`.
3. **`ProjectPanel` после ответа** (мок `getLastPrompt` → `meta.currentAttachments = [A, B, C]`, `attachments = [A, B, C]`) → `newFiles = []`, `previousFiles = [A, B, C]` (показываем **только** «From previous answer»).
4. **`ProjectPanel` пустой** (`attachments = []`) → «No files attached».
5. **`lastPromptAttachments` перезапрашивается** при `streamingActive: true → false` (мок, проверить `getLastPrompt` вызван).

### 3.2. Сквозной ручной сценарий

1. **Новый чат** (PROJECT mode) → `AttachList` → «No files attached».
2. **Приложить A** → «New for this question (1)».
3. **Отправить Q1** → ответ R1 → **Last Prompt** → `meta.currentAttachments = [A]`.
4. **AttachList** → «From previous answer (1)» — A; **New** — пусто.
5. **Приложить B** → «New for this question (1)» (B), «From previous answer (1)» (A).
6. **Отправить Q2** (включить Q1) → ответ R2 → **Last Prompt** → `meta.currentAttachments = [A, B]`.
7. **AttachList** → «From previous answer (2)» — A, B; **New** — пусто. ✅
8. **Detach A** (× на A) → «From previous answer (1)» — B; A **удалён** из пула. ✅
9. **F5** → `last_prompt` **восстановлен** (`meta.currentAttachments = [A, B]`); AttachList → `previousFiles = [B]` (A **нет** в `attachments` — detach сработал). ✅

---

## 4. Крайние случаи

| Кейс | Решение |
|---|---|
| `last_prompt` нет (новый чат) | `newFiles` = все, `previousFiles` = `[]` |
| `last_prompt` есть, `attachments` **пуст** | «No files attached» |
| `last_prompt` есть, `attachments` = `last_prompt.meta.currentAttachments` | `newFiles = []`, `previousFiles` = все |
| `last_prompt` битый JSON | `getLastPrompt` → `null` (не падает); `newFiles` = все |
| **Файл detach** после ответа | `attachments` **уменьшился**; `last_prompt` **не** обновлён (detach **не** триггерит `last_prompt`) → `previousFiles` = `last_prompt.meta.currentAttachments ∩ attachments` (detach-файла **нет** в `attachments` — **не** показываем). ✅ |
| **Файл добавлен** после ответа | `newFiles` = новый; `previousFiles` = старые. ✅ |
| **Файл removed from disk** (missing) | `attachments` **есть** (строка), `last_prompt` **есть** (был) — **показываем** в **previousFiles** с бейджем `missing`. ✅ |
| **`streamingActive` не переключился** (ошибка) | `last_prompt` **обновлён** (catch) — **перезапрос** по `attachments` (fallback). ✅ |
| **Первый запрос** (нет Q1) | `last_prompt` **нет** → все = «New». ✅ |

---

## 5. Файлы к изменению

**Frontend:**
- `frontend/src/features/models/components/project-panel.tsx` — **изменить**: `lastPromptAttachments` state, `useEffect` (зависит от `activeSessionId`, `streamingActive`, `attachments`), разделение `previousFiles`/`newFiles`, рендер двух секций.
- `frontend/src/features/models/components/project-panel.tsx` — **опционально**: вынести `FileRow` в отдельный подкомпонент (если сейчас inline — **не** обязательно, но **читаемее**).
- Тесты: `project-panel.test.tsx` (новый или дополнить) — 5 кейсов из §3.1.

**Backend:** **не** трогаем.

**Документация:**
- `README.md` — §PROJECT mode: **уточнить** «AttachList делит файлы на "New for this question" / "From previous answer" — накопительный принцип (все идут в `[Материалы]` следующего вопроса) сохраняется».
- `WORKLOG.md` — запись.

---

## 6. Порядок реализации

**Один PR** (~1–2 файла, ~0.5–1 день):

1. **`project-panel.tsx`** — state + `useEffect` + разделение + рендер двух секций.
2. **Тесты** — 5 кейсов.
3. **README/WORKLOG** — уточнение.

**Без backend** — **только** frontend, **переиспользует** `last_prompt` (уже смержен).

---

## 7. Открытые вопросы (не блокирующие)

1. **Стиль заголовков:** «New for this question» / «From previous answer» — **текст** (рекомендую). Альтернативы: «New (N)» / «Sent (N)» / «Attached after last answer». **Рекомендую** «New for this question» / «From previous answer» — **явно**.
2. **Порядок:** New — сверху (рекомендую), Previous — снизу. **Альтернатива:** Previous — сверху (хронология: что было → что новое). **Рекомендую** New — сверху (важнее для пользователя «что **сейчас** пойдёт в модель»).
3. **`useEffect` зависит от `attachments`** — **каждый** attach/detach → **перезапрос** `last_prompt`. **Дёшево** (короткий JSON, без файлов). **ОК**.
4. **Detach файла из previousFiles** — `attachments` **уменьшился**, `last_prompt` **не** обновлён → `previousFiles` **не** покажет detach-файл (его **нет** в `attachments`). ✅ **Корректно** — пользователь **видит**, что файл **убран** из пула (в previousFiles его **нет**).

---

## 8. Оценка

| Блок | Время |
|---|---|
| `project-panel.tsx` (state + `useEffect` + разделение + рендер) | **~0.5 дня** |
| Тесты (5 кейсов) | **~0.25 дня** |
| README + WORKLOG | **~0.25 дня** |
| **Итого** | **~0.5–1 день** |

---

## 9. Итог

**Разделение Attached files** — **визуальное** (UI), **не** меняет накопительный принцип (back-end **не** трогается):
- **New for this question** (сверху, `text-primary`) — файлы, прикреплённые **после** последнего ответа.
- **From previous answer** (снизу, `text-muted-foreground`) — файлы, которые были в пуле на момент последнего ответа (уже проанализированы, но **остаются** — накопительный принцип).
- **Источник:** `last_prompt.meta.currentAttachments` (уже смержен, PR Last Prompt) — **что было**; `attachments` **сейчас** — **что есть**; разница — **New**.
- **~0.5–1 день**, дёшево, высокая UX-ценность.

**После имплементации:** пользователь **видит** — «это **новое** (пойдёт в следующий), это **из прошлого** (уже проанализировано)». **Ложное впечатление** «всё привязано к текущему» — **исчезает**.

**Готово к реализации.** Начинать с `project-panel.tsx`.