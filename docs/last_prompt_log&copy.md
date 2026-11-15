# ТЗ: Last Prompt — просмотр последнего финального промпта (обновлённое)

**Версия:** 1.1 (учтены решения §8.1–8.4)
**Статус:** готово к реализации
**Область:** backend (`chatController`, `init.js`, `sessionRepo`, `sessionService`, `sessionRoutes`), frontend (`chat-area`, `apiGateway`, `types`, `LastPromptModal`)
**Оценка:** ~2–2.5 дня
**Цель:** пользователь **всегда** может открыть и посмотреть **финальный** промпт, который ушёл в модель при **последнем** запросе в сессии. **Стандартная** функция (не debug). Помогает понять «почему модель ответила так / не видит файлы / какой system реально ушёл».

---

## 1. Цель и границы

### 1.1. Что решаем

Пользователь **не видит**, что **фактически** ушло в LLM: `buildLLMContext` собирает `system` + `[Материалы]` + `[Инструкции]` + `[Ранее]` + `[Вопрос]` на сервере, а фронт получает только `response`. Это создаёт **непрозрачность**:
- «почему модель не видит приложенные файлы?» — а в `[Материалах]` их и **нет** (attach не сработал / detach удалил);
- «почему модель отвечает не как Security Reviewer?» — а `syspromptId` **не** тот (не сохранился / fallback на default);
- «почему история обрезана?» — а `includedQAPairs` = 2 из 10 (LIFO, бюджет);
- «почему `[Инструкции]` не применились?» — а `selectedTemplateIds` **не** ушли (баг FormData).

**Last Prompt** — **одна кнопка** в шапке чата, которая показывает **финальный** промпт **последнего** запроса в сессии. **Пользователь** сам решает, когда смотреть.

### 1.2. Что НЕ входит в scope

- **История** промптов (все запросы) — только **последний** (per session).
- **Редактирование** — read-only.
- **Экспорт в файл** — опционально (backlog).
- **Сравнение** двух промптов — backlog.
- **Streaming-промпт** (пока стрим идёт) — только **завершённый** (после `done`/`error`/`close`).
- **Persist между F5** — **да** (`sessions.last_prompt`), но **не** история (перезапись при новом запросе).
- **`apiKey`** (если появится у провайдера, напр. Unsloth) — **не** должен попадать в `last_prompt` (промпт **не** содержит apiKey — он в заголовке; **проверить**, что `config` не инжектится в промпт).

### 1.3. Ключевые принципы

1. **Полный промпт** — `contextMessages` **как есть** (массив `{ role, content, images? }`), без обрезки.
2. **Метаданные** — что **реально** попало: `currentAttachments`, `mode`, `fixedChars`, `includedQAPairs`, `excludedIndices`, `syspromptId`, `selectedTemplateIds`, `generationParams`.
3. **Persist per session** — `sessions.last_prompt` (перезапись при новом запросе).
4. **Transient для «в процессе»** — пока стрим идёт, `last_prompt` **не** обновляется (только после `done`/`error`/`close` с partial).
5. **Read-only UI** — модалка с **Markdown**-рендером промпта + метаданные.
6. **Не ломает** существующее — `chatController` **дополняется**, не переписывается.

---

## 2. Backend

### 2.1. Схема БД — `sessions.last_prompt`

**`src/db/init.js`:**

- В `CREATE TABLE sessions` — `last_prompt TEXT DEFAULT NULL` (после `last_send_error`).
- В `ensureColumns` — **guarded ALTER** для legacy:
  ```js
  const sessionCols = columnNames('sessions');
  if (sessionCols.length > 0 && !sessionCols.includes('last_prompt')) {
      database.exec('ALTER TABLE sessions ADD COLUMN last_prompt TEXT DEFAULT NULL');
  }
  ```

**Формат `last_prompt` (JSON):**
```json
{
  "prompt": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "[Материалы]\n..." },
    { "role": "user", "content": "[Инструкции]\n..." },
    { "role": "user", "content": "[Ранее в этой сессии]" },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "[Вопрос]\n..." }
  ],
  "meta": {
    "mode": "research" | "project",
    "currentAttachments": [ { "fileId": "...", "name": "...", "kind": "reference" | "document" | "code" | "image", "size": 1234 } ],
    "fixedChars": 12345,
    "actualHistoryChars": 6789,
    "targetChars": 20000,
    "includedQAPairs": 3,
    "totalQAPairs": 10,
    "excludedIndices": [1, 2, 4],
    "syspromptId": "seed-react-developer" | null,
    "selectedTemplateIds": ["...", "..."],
    "generationParams": { "temperature": 0.2, "n_predict": 4096 },
    "questionId": "q_3_...",
    "model": "...",
    "provider": "llama_cpp" | "ollama",
    "timestamp": 1730000000000,
    "finishReason": "stop" | "length" | null,
    "usage": { "inputTokens": 123, "outputTokens": 456 }
  }
}
```

### 2.2. `sessionRepo.js` — `setLastPrompt` / `getLastPrompt`

```js
export function setLastPrompt(id, payload) {
    const json = payload == null ? null : JSON.stringify(payload);
    getDb().prepare('UPDATE sessions SET last_prompt = ? WHERE id = ?').run(json, id);
}

export function getLastPrompt(id) {
    const row = getDb().prepare('SELECT last_prompt FROM sessions WHERE id = ?').get(id);
    if (!row || !row.last_prompt) return null;
    try { return JSON.parse(row.last_prompt); } catch { return null; }
}
```

**Не трогает `updated_at`** (как `setSendError`).

### 2.3. `chatController.js` — сохранение `last_prompt`

**Точки сохранения:**

**A. Non-stream (обычный chat + vision):** после `buildLLMContext`, **до** `provider.chat`. После `provider.chat` — **обновить** `meta` (добавить `finishReason`, `usage`).

**B. Stream:** после `buildLLMContext`, **до** `provider.chat({ stream: true })`. После `done`/`error`/`close` — **обновить** `meta`.

**C. Vision:** после `buildLLMContext`, **до** `provider.chat`. `prompt` — `content` + `images: [{ type, size }]` (без base64).

**Функция (в `chatController`):**
```js
function persistLastPrompt(sessionId, contextResult, contextMessages, extra) {
    try {
        sessionService.setLastPrompt(sessionId, {
            prompt: contextMessages.map(m => ({
                role: m.role,
                content: m.content,
                ...(m.images ? { images: m.images.map(img => ({
                    size: typeof img === 'string' ? img.length : 0,
                    type: 'base64'
                })) } : {}),
            })),
            meta: {
                mode: extra.mode,
                currentAttachments: (extra.currentAttachments || []).map(a => ({
                    fileId: a.fileId, name: a.name, kind: a.kind, size: a.size,
                })),
                fixedChars: contextResult.info?.fixedChars ?? 0,
                actualHistoryChars: contextResult.info?.actualHistoryChars ?? 0,
                targetChars: contextResult.info?.targetChars ?? 0,
                includedQAPairs: contextResult.info?.includedQAPairs ?? 0,
                totalQAPairs: contextResult.info?.totalQAPairs ?? 0,
                excludedIndices: contextResult.info?.excludedIndices ?? [],
                syspromptId: extra.promptSelection?.syspromptId ?? null,
                selectedTemplateIds: extra.promptSelection?.selectedTemplateIds ?? [],
                generationParams: extra.generationParams ?? {},
                questionId: extra.questionId,
                model: extra.model,
                provider: extra.provider,
                timestamp: Date.now(),
                ...(extra.finishReason !== undefined ? { finishReason: extra.finishReason } : {}),
                ...(extra.usage !== undefined ? { usage: extra.usage } : {}),
            },
        });
    } catch (e) {
        log.warn('Failed to persist last_prompt', { sessionId: sessionId?.slice(0, 8), error: e.message });
    }
}
```

**Обновление после `provider.chat`:** повторный `persistLastPrompt` с `extra.finishReason`, `extra.usage` — **перезапись** (проще, чем `UPDATE` только `meta`). `timestamp` — **обновляется** (время завершения). Или — **оставить** первый `timestamp` (время отправки). **Рекомендую:** `timestamp` — время **отправки** (не перезаписывать при update). Реализация: передавать `extra.timestamp` (первый) при повторном вызове.

**Важно:** `persistLastPrompt` **не** должен **ломать** основной поток — `try/catch` с `log.warn`.

### 2.4. `sessionRoutes.js` — `GET /api/sessions/:id/last-prompt`

```js
router.get('/:id/last-prompt', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const lastPrompt = sessionService.getLastPrompt(req.params.id);
        if (!lastPrompt) return res.status(404).json({ error: 'No prompt yet for this session' });
        res.json(lastPrompt);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

**404**, если промпта **ещё нет** — UI покажет «No prompt yet — send a message first».

### 2.5. `sessionService.js` — прокси

```js
export function setLastPrompt(id, payload) { return sessionRepo.setLastPrompt(id, payload); }
export function getLastPrompt(id) { return sessionRepo.getLastPrompt(id); }
```

### 2.6. Очистка

- **`deleteSession`** — cascade (`sessions.last_prompt` удаляется вместе с сессией — FK). ✅
- **`clearChat`** (архивация) — **не** трогает `last_prompt` (новая сессия — новый, пустой). ✅
- **`DELETE /api/sessions/:id/send-error`** — **не** трогает. ✅

---

## 3. Frontend

### 3.1. `types/index.ts` — типы

```ts
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: Array<{ size: number; type: string }>;  // без base64
}

export interface LastPromptMeta {
  mode: 'research' | 'project';
  currentAttachments: Array<{ fileId?: string; name: string; kind?: string; size?: number }>;
  fixedChars: number;
  actualHistoryChars: number;
  targetChars: number;
  includedQAPairs: number;
  totalQAPairs: number;
  excludedIndices: number[];
  syspromptId: string | null;
  selectedTemplateIds: string[];
  generationParams: Record<string, number>;
  questionId: string;
  model: string;
  provider: string;
  timestamp: number;
  finishReason?: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LastPrompt {
  prompt: PromptMessage[];
  meta: LastPromptMeta;
}
```

### 3.2. `apiGateway.ts` — `sessionsApi.getLastPrompt`

```ts
getLastPrompt(sessionId: string): Promise<LastPrompt | null> {
  return request<LastPrompt>('GET', `/api/sessions/${sessionId}/last-prompt`);
}
```

**404** — `request` бросит `ApiError(404)` → UI **ловит** → «No prompt yet» (не error-тост).

### 3.3. `LastPromptModal` — новый компонент

`frontend/src/features/chat/components/last-prompt-modal.tsx`:

```tsx
interface LastPromptModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
}
```

**Поведение:**
- При `open` → `sessionsApi.getLastPrompt(sessionId)`.
- **Loading** → спиннер.
- **404** → «No prompt yet — send a message first».
- **200** → две секции:
  1. **Meta** (сверху, компактно): `mode`, `provider`/`model`, `questionId`, `timestamp`, `syspromptId`, `selectedTemplateIds`, `includedQAPairs`/`totalQAPairs`, `excludedIndices`, `fixedChars`/`actualHistoryChars`/`targetChars`, `generationParams`, `currentAttachments` (список файлов), `finishReason`/`usage`.
  2. **Prompt** (снизу) — **Markdown-рендер** (см. §3.4).

**Стиль:** `Dialog` из `@/components/ui/dialog`, `max-w-4xl max-h-[85vh]`, `overflow-auto`.

**Кнопка «Copy»** — **одна**, копирует **финальный промпт** в **Markdown-формате** (§3.4). Не две кнопки — пользователь хочет «скопировать промпт как он уходит в модель», одной кнопкой. Meta — **не** копируется (она для просмотра, не для отправки).

### 3.4. Рендер промпта — Markdown

**Почему Markdown, а не `<pre>`:** пользователь **копирует** промпт и **вставляет** в другое место (другой чат, редактор, документацию). Markdown — **читаемый** формат: заголовки, code-fences, списки. `<pre>` — «сырой» JSON, неудобно копировать.

**Формат рендера:**
```markdown
## System

<содержимое system, как есть>

---

## User: [Материалы]

<содержимое `[Материалы]`, как есть>

---

## User: [Инструкции]

<содержимое `[Инструкции]`, как есть>

---

## User: [Ранее в этой сессии]

<содержимое `[Ранее]`, как есть>

---

## User

<содержимое user-сообщений истории, как есть>

---

## Assistant

<содержимое assistant-сообщений истории, как есть>

---

## User: [Вопрос]

<содержимое `[Вопрос]`, как есть>
```

**Правила рендера:**
- Для каждого `message` — секция с заголовком:
  - `role === 'system'` → `## System`.
  - `role === 'user'` → `## User` + (если `content.startsWith('[Материалы]')` → `: [Материалы]`; `[Инструкции]` → `: [Инструкции]`; `[Ранее в этой сессии]` → `: [Ранее]`; `[Вопрос]` → `: [Вопрос]`; иначе — просто `## User`).
  - `role === 'assistant'` → `## Assistant`.
- `content` — **как есть** (Markdown-рендер, но **без** репарсинга — если в `content` есть Markdown, он отрендерится; если нет — plain text).
- `images` (если есть) — `**[images: N × base64, type]**` (без base64).
- Разделитель — `---` между секциями.

**Копирование (кнопка «Copy»):** копирует **этот Markdown** (не JSON). Пользователь вставляет в чат/редактор — видит **точный** промпт.

**«Copy JSON» — не нужна** (решение §8.3: «одна кнопка, Markdown»). Если понадобится — backlog.

### 3.5. `chat-area.tsx` — кнопка «Last Prompt» рядом с `⚙ Params`

**Где:** в `StatFooter` (`chat-area.tsx`), **рядом** с кнопкой `⚙ Params` (§8.1: «рядом с ⚙ Params»).

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-6 px-2 text-xs font-mono"
  onClick={() => setLastPromptOpen(true)}
  aria-label="Last prompt"
>
  <Eye className="w-3.5 h-3.5" /> Prompt
</Button>
<LastPromptModal open={lastPromptOpen} onClose={() => setLastPromptOpen(false)} sessionId={viewingSessionId} />
```

**Иконка:** `Eye` (`lucide-react`) — §8.2: «Eye».

**Текст кнопки:** `Prompt` (рядом с `⚙ Params` — визуально сбалансировано). Tooltip: «Last prompt — what was sent to the model».

**Состояние:** `const [lastPromptOpen, setLastPromptOpen] = useState(false)`.

**Обновление:** при новом запросе — модалка **не** обновляется автоматически (пользователь **сам** открывает заново — свежий `getLastPrompt`).

---

## 4. Тестирование

### 4.1. Backend

1. **`init.js`:** `sessions.last_prompt` в CREATE + guarded ALTER. `PRAGMA table_info(sessions)` содержит `last_prompt`.
2. **`sessionRepo.setLastPrompt/getLastPrompt`:** запись/чтение JSON, `null` при отсутствии, битый JSON → `null`.
3. **`chatController` (non-stream):** после `buildLLMContext` → `last_prompt` сохранён (`prompt` содержит `system` + `[Материалы]` + `[Ранее]` + `[Вопрос]`; `meta.currentAttachments` — список).
4. **`chatController` (stream):** после `done` → `last_prompt` сохранён (с `finishReason`/`usage`).
5. **`chatController` (vision):** `prompt` содержит `images: [{ size, type }]` (без base64).
6. **`chatController` (ошибка до `buildLLMContext`):** `last_prompt` **не** сохранён → `getLastPrompt` → `null`.
7. **`GET /api/sessions/:id/last-prompt`:** 200 с `{prompt, meta}`, 404 если нет, 404 если сессия не найдена.
8. **`DELETE /api/sessions/:id`** — `last_prompt` удалён (cascade).
9. **`clearChat`** — новая сессия, `last_prompt` пустой.

### 4.2. Frontend

1. **`LastPromptModal`:** `open` → `getLastPrompt` → 200 → рендер Markdown (system + `[Материалы]` + …) + meta; 404 → «No prompt yet»; loading → спиннер.
2. **`LastPromptModal`:** «Copy» копирует **Markdown** промпта (не JSON).
3. **`chat-area`:** кнопка «Prompt» (Eye) рядом с `⚙ Params` → открывает модалку.

### 4.3. Сквозной ручной сценарий

1. Новый чат → кнопка «Prompt» → «No prompt yet» (404). ✅
2. Отправить сообщение (Research mode) → кнопка → модалка: Markdown с `System` + `[Материалы]` (если были) + `[Ранее]` + `[Вопрос]`, meta с `currentAttachments`, `includedQAPairs`. ✅
3. **Сменить папку** (PROJECT mode, баг) → приложить файлы B → отправить → кнопка → **видно**, что в `[Материалах]` **фактически** (файлы A? B? пусто?) — **это** диагностика бага. ✅
4. **Сменить sysprompt** → отправить → кнопка → `meta.syspromptId` = новый, `System` = новый. ✅
5. **Включить user_template** → отправить → кнопка → `[Инструкции]` в промпте, `meta.selectedTemplateIds` = включённые. ✅
6. **Reasoning-модель** → отправить → кнопка → `meta.finishReason` = `'stop'`/`'length'`. ✅
7. **Vision** → отправить → кнопка → `images: [{size, type}]` (без base64). ✅
8. **F5** → кнопка → `last_prompt` **есть** (persist в БД). ✅
9. **Copy** → вставить в чат/редактор → **Markdown** с заголовками `## System`, `## User: [Материалы]`, … — **читаемо**. ✅

---

## 5. Крайние случаи

| Кейс | Решение |
|---|---|
| Промпт **очень большой** (100 КБ) | Хранится в БД (TEXT), отдаётся JSON. UI — Markdown с `overflow-auto`. **Не** обрезаем. |
| **Base64 картинка** (1.5 МБ) | **Не** храним (только `{size, type}`). Реестр `attachments` — `/api/attachments/:id/raw`. |
| **Битый JSON** в `last_prompt` | `getLastPrompt` → `null` (не падает). UI — «No prompt yet». |
| **Нет промпта** (новый чат) | 404 → «No prompt yet». |
| **Сессия не найдена** | 404. |
| **`buildLLMContext` упал** | `last_prompt` **не** сохранён (промпта нет). |
| **Провайдер упал** после `buildLLMContext` | `last_prompt` **сохранён** (до `provider.chat`). Пользователь видит, **что** ушло. |
| **Stream, клиент ушёл** | `last_prompt` сохранён (до `provider.chat`), `meta.finishReason` — `null`/`'error'`. |
| **Несколько сессий** | `last_prompt` **per session** (перезапись). |
| **`clearChat`/`deleteSession`** | `last_prompt` **удалён** (cascade). |
| **`updated_at`** | **Не** трогаем. |

---

## 6. Файлы к изменению/созданию

**Backend:**
- `server/src/db/init.js` — `sessions.last_prompt` (CREATE + guarded ALTER).
- `server/src/db/sessionRepo.js` — `setLastPrompt`, `getLastPrompt`.
- `server/src/services/sessionService.js` — прокси.
- `server/src/controllers/chatController.js` — `persistLastPrompt` (vision + stream + non-stream), вызов до `provider.chat`.
- `server/src/routes/sessionRoutes.js` — `GET /api/sessions/:id/last-prompt`.
- Тесты: `sessionRepo.lastPrompt.test.js`, `chatController.lastPrompt.test.js`, `sessionRoutes.lastPrompt.test.js` (новые).

**Frontend:**
- `frontend/src/types/index.ts` — `LastPrompt`, `LastPromptMeta`, `PromptMessage`.
- `frontend/src/lib/apiGateway.ts` — `sessionsApi.getLastPrompt`.
- `frontend/src/features/chat/components/last-prompt-modal.tsx` — **новый**.
- `frontend/src/features/chat/components/chat-area.tsx` — кнопка «Prompt» (Eye) рядом с `⚙ Params` в `StatFooter` + рендер модалки.
- Тесты: `last-prompt-modal.test.tsx`, `chat-area.lastPrompt.test.tsx` (новые).

**Документация:**
- `WORKLOG.md` — запись о Last Prompt (persist в `sessions.last_prompt`, endpoint, UI).
- `README.md` — секция «Last prompt» в Features (стандартная функция).

---

## 7. Порядок реализации (PR-план)

**Один PR** (~10 файлов, 2 логических блока):

1. **PR-1 (backend):** `init.js` + `sessionRepo` + `sessionService` + `chatController` + `sessionRoutes` + тесты. **Приёмка:** `last_prompt` сохраняется, endpoint 200/404.
2. **PR-2 (frontend):** `types` + `apiGateway` + `LastPromptModal` + `chat-area` (кнопка) + тесты. **Приёмка:** кнопка → модалка → Markdown + meta, Copy (Markdown).

---

## 8. Принятые решения (сводка)

| # | Решение |
|---|---|
| 8.1 | Кнопка — **рядом с `⚙ Params`** в `StatFooter` |
| 8.2 | Иконка — **`Eye`** (`lucide-react`) |
| 8.3 | **Одна** кнопка «Copy» — копирует **финальный промпт в Markdown** (не JSON, не meta). Две кнопки не нужны — пользователь хочет «скопировать промпт как он уходит в модель», одной кнопкой, в **Markdown** (читаемо, вставляется в чат/редактор). |
| 8.4 | `images` — **без base64** (только `{ size, type }`) |

---

## 9. Оценка

| Блок | Время |
|---|---|
| Backend: `init.js` + `sessionRepo` + `sessionService` + `chatController` + `sessionRoutes` + тесты | **~1–1.5 дня** |
| Frontend: `types` + `apiGateway` + `LastPromptModal` (Markdown) + `chat-area` + тесты | **~1 день** |
| **Итого** | **~2–2.5 дня** |

---

## 10. Итог

**Last Prompt** — **стандартная** функция (не debug):
- **Пользователь** всегда может открыть и посмотреть **финальный** промпт последнего запроса.
- **Персист** в `sessions.last_prompt` (переживает F5).
- **Метаданные:** `currentAttachments`, `mode`, `syspromptId`, `selectedTemplateIds`, `generationParams`, `includedQAPairs`, `excludedIndices`, `finishReason`, `usage`.
- **Кнопка** `Eye` «Prompt» рядом с `⚙ Params` (видна, не спрятана).
- **Markdown-рендер** — читаемо, **Copy** — одна кнопка (Markdown).
- **Помогает** диагностировать баги: «почему модель не видит файлы» → Last Prompt → увидеть, **какие** файлы в `[Материалах]` (и **каких** нет).
- **~2–2.5 дня**, дёшево, высокая ценность.

**После имплементации:**
1. Тестовые запросы (Research + Project со сменой папки).
2. Last Prompt → **фактический** промпт.
3. **Выяснить** реальную причину бага (attach B / detach A / `currentAttachments`).
4. Починить точечно + регрессионный тест.

**Готово к реализации.** Начинать с PR-1 (backend).