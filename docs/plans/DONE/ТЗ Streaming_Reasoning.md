# ТЗ: Streaming + Reasoning в ответе (единый трек)

**Версия:** 1.0 (самодостаточное, без внешних ссылок)
**Статус:** готово к реализации
**Область:** backend (`chatController`, `LlamaCppProvider`, `OllamaProvider`, `chatRoutes`, `messageRepo`, `init.js`, `contextBuilder`), frontend (`chat-area`, `sessionStore`, `apiGateway`, `types`, `ReasoningBlock`)
**Оценка:** ~8.5–9.5 дней (streaming ~5.5–6 + reasoning ~3–3.5)
**Порядок:** streaming **сначала** (транспорт), reasoning **поверх** (данные) — в одном PR-цикле, но двумя логическими блоками.

---

## 1. Цель и границы

### 1.1. Что решаем (две связанные проблемы)

**Проблема 1 — ожидание полного ответа (streaming).**
Сейчас `/api/chat` возвращает **весь** ответ одним JSON (`provider.chat({ stream: false })`). Пользователь ждёт **полное** время генерации:
- короткий ответ (200 токенов, 35B GPU) — ~3–5 с (терпимо);
- длинный (2000 токенов) — ~30–40 с (боль);
- reasoning-модель (9901 токенов размышлений, инцидент answer-loss-diagnostics 2026-11-12) — **2–3 минуты** (пользователь думает, что приложение зависло).

Streaming даёт: **TTFT** (time-to-first-token) = время обработки промпта (3–10 с), дальше токены идут в UI по мере генерации. Пользователь **читает** ответ, пока модель **дописывает**. **Субъективное** ускорение для длинных ответов в 5–10 раз.

**Проблема 2 — reasoning теряется (reasoning-блок).**
Reasoning-модели (Qwen3.8, DeepSeek-R1, o1-like) отдают `content` (видимый ответ) + `reasoning_content` (размышления). Сейчас:
- `LlamaCppProvider.chat` **возвращает** `reasoning` (и stream, и non-stream);
- `composeAssistantAnswer` — если `content=''` и `reasoning` есть → маркер + 1200 символов reasoning в `content`; полные — **в логах сервера**;
- `metrics.reasoningChars` / `reasoningPreview` (1000 символов) — в БД;
- **`messages.reasoning` (полный) — нет**, UI **не рендерит** reasoning отдельно, **маркер обрезки** — только общий `truncated` для content.

Пользователь **не видит**, что модель «думала» 2–3 минуты и **обрезалась**. Reasoning **теряется** после F5 (только 1200 в маркере + 1000 в metrics, полные — в логах).

**Reasoning-блок:** отдельный раскрывающийся блок в UI (свёрнут по умолчанию), полный reasoning в БД (восстанавливается после F5), явный маркер «reasoning truncated» при обрезке.

### 1.2. Что НЕ входит в scope

- **Static reasoning в промпт** — **никогда** не инжектится в `[Ранее]` / `[Материалы]`. Reasoning — «internal», раздувает контекст (10–35 КБ/сообщение), не нужен модели. **Явное требование** (проверка в `buildLLMContext`).
- **Copy Q&A с reasoning** — опционально (чекбокс «Include reasoning», §4.3), по умолчанию **off**. Можно отложить отдельным PR.
- **Vision-streaming** — vision-ветка `/api/chat` (с картинкой) остаётся **JSON** (`stream: false`), не стримится. Streaming — только для текстового чата. Не блокер.
- **WebSocket** — не используем. Транспорт — **SSE через `fetch` + POST + `ReadableStream`** (см. §2.1).
- **Reasoning для vision-моделей** — если провайдер вернул reasoning в vision-ветке, **сохраняем** (тот же `chatController`-путь), но UI-блок — опционально (редкость). Не блокер.
- **Мультиязычный SSE-парсер** — только `data: {...}\n\n` (llama.cpp / Ollama формат), не общий SSE-стандарт.

### 1.3. Ключевые принципы

1. **Streaming — транспорт, Reasoning — данные.** Streaming делается **первым** (транспорт), reasoning ложится **поверх** (данные по готовому транспорту). В одном PR — два логических блока.
2. **Один `/api/chat`** — тот же путь, тот же POST multipart, тот же контракт 400/409. Streaming — по `Accept: text/event-stream`. Без streaming — JSON (как сейчас).
3. **«Не передан — не отправляем»** (для generation params P0.1) — **не меняется**. Streaming не влияет на `generationParams`.
4. **Reasoning — в БД полностью**, не только preview. Пользователь восстанавливает после F5.
5. **Reasoning НЕ в промпт** — `buildLLMContext` не читает `messages.reasoning`.
6. **Совместимость с PR answer-loss-diagnostics** — `composeAssistantAnswer` не ломается (маркер + preview в `content` при `content=''` — сохраняется; полный reasoning — **теперь** в БД).
7. **Ошибки mid-stream** — частичный ответ + маркер обрыва (`composeAssistantAnswer` уже умеет для non-stream; для stream — `finishReason`/`lastMetrics` из финального чанка).

---

## 2. Backend

### 2.1. Транспорт — SSE через `fetch` + POST

**Почему SSE, а не WebSocket:**
- `/api/chat` — **POST multipart** (файлы, `FormData`). `EventSource` умеет **только GET** — не подходит. `fetch` + POST + `ReadableStream` — работает, но это **ручной** SSE-парсер (не нативный `EventSource`).
- WebSocket — отдельный путь, бинарные файлы отдельно — сложнее. `aiHelperWs` есть, но переиспользовать под multipart — неудобно.
- **SSE через `fetch`** — один эндпоинт, один контракт (JSON vs SSE по `Accept`), без нового пути.

**Контракт:**
- `POST /api/chat` с `Accept: text/event-stream` → ответ `Content-Type: text/event-stream`, поток:
  ```
  data: {"type":"token","delta":"Hel"}\n\n
  data: {"type":"token","delta":"lo"}\n\n
  data: {"type":"reasoning","delta":"think..."}\n\n
  data: {"type":"done","metrics":{...},"finishReason":"stop","questionId":"q_..."}\n\n
  ```
- `POST /api/chat` без `Accept` (или `Accept: application/json`) → JSON (как сейчас).

**Формат чанков (SSE `data`):**
| type | payload | когда |
|---|---|---|
| `token` | `{ delta: string }` | `delta.content` из провайдера |
| `reasoning` | `{ delta: string }` | `delta.reasoning_content` (reasoning-модели) |
| `done` | `{ metrics, finishReason, questionId, excludedIndices, contextInfo }` | финальный чанк (usage/finish_reason) |
| `error` | `{ error, code?, field?, ... }` | ошибка mid-stream (после `done` — **не** отправлять `done`) |

**Порядок:** `reasoning`-чанки идут **до** `token`-чанков (reasoning-модели сначала «думают»), но **не гарантируется** (модель может чередовать) — UI должен **принимать любой порядок**.

**Headers:** `X-Accel-Buffering: no` (если за nginx — не буферизовать). `Cache-Control: no-cache`. `Connection: keep-alive`.

**Cleanup:** при `res.on('close')` — если клиент ушёл mid-stream — **не** отправлять `done`, сохранить **накопленный** буфер (частичный ответ + маркер обрыва, как non-stream).

### 2.2. `LlamaCppProvider.chat` — stream-ветка (уже есть, доработать)

**Уже есть** (из PR answer-loss-diagnostics):
- SSE-парсер с **буферизацией** строк (разрезанные чанки TCP — не теряются).
- `delta.content` → `fullResponse`.
- `delta.reasoning_content` → `fullReasoning`.
- `finish_reason` (из чанка) → `finishReason`.
- `usage` (финальный чанк) → `lastMetrics` (`extractLlamaCppMetrics`).
- Возврат: `{ response: fullResponse, reasoning: fullReasoning, finishReason, metrics: lastMetrics }`.

**Доработать:** **ничего** (stream-ветка готова). Только **логирование** `fullReasoning.length` при `fullResponse === '' && fullReasoning` (уже есть `log.warn`). ✅

**Non-stream** — **не трогаем** (возвращает `{ response, reasoning, finishReason, metrics }`, как сейчас).

### 2.3. `OllamaProvider.chat` — stream-ветка (**баг**, чинить)

**Сейчас:** stream-ветка (`chunk.split('\n').filter(...)`) **без буферизации** — разрезанные чанки TCP **теряются** (тот же баг, что был в llama.cpp до answer-loss-diagnostics).

**Доработать:**
- **Буферизация** строк (как в `LlamaCppProvider`): `buffer += decoder.decode(value, { stream: true })`, `lines = buffer.split('\n')`, `buffer = lines.pop() ?? ''`.
- **Накопление** `delta.message?.content` → `fullResponse` (сейчас `data.message?.content` — только non-stream; в stream-ветке — `delta.message?.content`? — проверить формат Ollama: `/api/chat` stream → `{ message: { content: "..." }, done: false }`; **у Ollama `delta` нет — `message.content` в каждом чанке** — **проверить** актуальный формат. Если `message.content` — накапливать).
- **`done: true`** → `lastMetrics = extractMetrics(data)` (сейчас есть).
- **Reasoning:** Ollama может отдавать `message.reasoning_content` (некоторые модели) — накапливать в `fullReasoning` (если поле есть — `data.message?.reasoning_content`). **Опционально** (Ollama reasoning — редкость, но не падать).
- **Возврат** (stream): `{ response: fullResponse, reasoning: fullReasoning, finishReason: done ? 'stop' : null, metrics: lastMetrics }`.

**Non-stream** — **не трогаем**.

### 2.4. `chatController.chatHandler` — streaming-ветка

**Вход:** `req.body` (multipart, как сейчас) + `req.headers.accept`.

**Определение:** `const isStream = req.headers.accept?.includes('text/event-stream')`.

**Ветка `isStream === true`:**

1. **Валидация** (`MAX_MESSAGE_CHARS`, `parseGenerationParams`, вложения) — **как сейчас**, **до** streaming. При 400 — **JSON**-ответ (не SSE; клиент ещё не начал читать поток).
2. **Установка SSE-заголовков:**
   ```js
   res.writeHead(200, {
     'Content-Type': 'text/event-stream',
     'Cache-Control': 'no-cache',
     'Connection': 'keep-alive',
     'X-Accel-Buffering': 'no',
   });
   ```
3. **`provider.chat({ ..., stream: true })`** — но **важно:** провайдер возвращает **полный** результат (`fullResponse`, `fullReasoning`) только **после** завершения. Чтобы **отправлять чанки в UI по мере генерации**, нужно **два** варианта:
   - **A (рекомендую):** провайдер **принимает `onToken` callback** — вызывает его на каждый `delta.content` / `delta.reasoning_content`, **и** возвращает `{ response, reasoning, finishReason, metrics }` в конце. `chatController` в `onToken` → `res.write('data: ...\n\n')`. **Минимальное изменение** сигнатуры провайдера (добавить `onToken?: (type, delta) => void`).
   - **B:** провайдер возвращает `ReadableStream` / async-iterator — сложнее (переписать stream-ветку). **Не рекомендую** — меняет контракт провайдера.

   **Рекомендую A.** Сигнатура: `provider.chat({ ..., stream: true, onToken: (type, delta) => void })`. `type: 'token' | 'reasoning'`. Провайдер в stream-цикле: `onToken?.('token', delta.content)` / `onToken?.('reasoning', delta.reasoning_content)`.

4. **Накопление + сохранение:** после `provider.chat` (await) — `fullResponse`, `fullReasoning`, `finishReason`, `metrics` — **как non-stream**:
   - `composeAssistantAnswer({ content: fullResponse, reasoning: fullReasoning, finishReason, metrics, contextLength })` — **не трогаем** (маркер + preview при `content=''`).
   - `sessionService.addMessage(sessionId, { role: 'assistant', content: answer, reasoning: fullReasoning || null, metrics: {...}, ... })` — **новое поле `reasoning`** (см. §2.6).
   - **`done`-чанк:** `res.write('data: ' + JSON.stringify({ type: 'done', metrics, finishReason, questionId, excludedIndices, contextInfo }) + '\n\n')`, `res.end()`.
5. **Ошибка mid-stream:** `catch` → `res.write('data: ' + JSON.stringify({ type: 'error', error: message, code?, ... }) + '\n\n')`, `res.end()`. **Не** писать `done`. **Сохранить** накопленный буфер? — **да**, если `fullResponse`/`fullReasoning` уже есть (частичный ответ + маркер обрыва). Паттерн `composeAssistantAnswer` + `persistSendError` — **как non-stream**, но с частичным контентом.
6. **`req.on('close')`** — если `!res.writableEnded` — клиент ушёл mid-stream. **Логировать** (`log.warn` «client disconnected mid-stream»), **не** отправлять `done`, сохранить накопленный буфер (частичный) + маркер. **Не** падать.

**Ветка `isStream === false`** — **как сейчас** (JSON, `addMessage({ content, reasoning: result.reasoning || null })` — **тоже** добавить `reasoning` в БД, см. §2.6). Vision-ветка — **как сейчас** (JSON, `stream: false`), + `reasoning: result.reasoning || null` в `addMessage` (если vision-провайдер вернул).

### 2.5. `chatRoutes.js` — **не** меняется

`upload.fields([...])` — **как сейчас** (все поля multipart, включая `generationParams` P0.1 и `syspromptId`/`selectedTemplateIds` P0.2). Streaming — по `Accept` header, **не** по полю. ✅

### 2.6. Схема БД — `messages.reasoning`

**`init.js`:**
- В `CREATE TABLE messages` — `reasoning TEXT DEFAULT NULL` (после `metrics`).
- В `ensureColumns` — **guarded ALTER** для legacy:
  ```js
  const msgCols = columnNames('messages');
  if (msgCols.length > 0 && !msgCols.includes('reasoning')) {
      database.exec('ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT NULL');
  }
  ```

**`messageRepo.addMessage`** — `reasoning` в INSERT:
```js
INSERT INTO messages (..., metrics, sort_order, sysprompt_id, reasoning)
VALUES (..., ?, ?, ?, ?)
...
message.reasoning ?? null
```

**`chatController`** — `reasoning: fullReasoning || null` / `result.reasoning || null` в `addMessage` (обе ветки: stream + non-stream + vision).

### 2.7. `contextBuilder.getQAPairs` — `answerReasoning`

`getQAPairs` (для `GET /api/sessions/:id/messages`) — **добавить** `reasoning` в SELECT:
```js
'SELECT role, content, reasoning, question_id, sort_order, model, attachments_meta, metrics FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
```
И в объект QAPair:
```js
currentQuestion.answerReasoning = msg.reasoning || '';
```

**`buildLLMContext`** — **не** читает `reasoning` (только `content`). Комментарий:
```js
// Reasoning НЕ включается в контекст (только content) —
// раздувает промпт (10–35 КБ/сообщение), не нужен модели (internal).
```

### 2.8. `composeAssistantAnswer` — **не трогаем**

Поведение сохраняется:
- `content !== ''` → `answer = content` (+ маркер обрыва при `finish_reason='length'`).
- `content === ''`, `reasoning` есть → маркер «[Ответ не сформирован]» + 1200 символов reasoning в `answer`.
- Оба пусты → маркер «[Пустой ответ модели]».

**Плюс:** `reasoning` (полный) **теперь** сохраняется в `messages.reasoning` (§2.6) — не только preview в `metrics`.

---

## 3. Frontend

### 3.1. `apiGateway.chat.sendStream` — новый метод

```ts
export const chatApi = {
  // существующий send — без изменений (JSON, non-stream)
  send(...) { ... },

  // новый: SSE-стрим
  async sendStream(
    data: ChatRequestData,
    provider: ProviderName,
    files: { file?: File; codeFiles?: File[] } | undefined,
    callbacks: {
      onToken: (delta: string) => void;
      onReasoning: (delta: string) => void;
      onDone: (payload: { metrics?, finishReason?, questionId, excludedIndices?, contextInfo? }) => void;
      onError: (err: { error: string; code?: string; field?: string; ... }) => void;
    },
    signal?: AbortSignal,
  ): Promise<void>
};
```

**Реализация:**
- `FormData` — **как `send`** (все поля, включая `generationParams`, `syspromptId`, `selectedTemplateIds`, файлы).
- `fetch('/api/chat', { method: 'POST', body: formData, headers: { 'X-Provider': provider, Accept: 'text/event-stream' }, signal })`.
- Если `!response.ok` — **JSON-ответ** (валидация 400/409) → `onError(await response.json())` → **вернуть** (без стрима).
- `response.body.getReader()` + `TextDecoder` → буферизация строк (`buffer += decode(...)`, `lines = buffer.split('\n')`, `buffer = lines.pop()`) → для каждой `data: ...` — `JSON.parse` → `switch (msg.type)`: `onToken` / `onReasoning` / `onDone` / `onError`.
- `signal` — для AbortController (отмена mid-stream).

### 3.2. `sessionStore.sendMessage` — streaming-ветка

**Сейчас:** `apiGateway.chat.send(...)` → `addMessage` / `addBotMessage` (JSON).

**Изменение:**
```ts
// Оптимистичный user-message (как сейчас) — addMessage(userMsg).
// Streaming: placeholder assistant-message (streaming: true, content: '', reasoning: '')
const assistantMsgId = get().addBotMessage('', model, questionId, { streaming: true });

try {
  await apiGateway.chat.sendStream(
    { ...data, questionId },
    currentProvider,
    files,
    {
      onToken: (delta) => get().appendToMessage(assistantMsgId, 'content', delta),
      onReasoning: (delta) => get().appendToMessage(assistantMsgId, 'reasoning', delta),
      onDone: (payload) => get().finalizeMessage(assistantMsgId, payload),
      onError: (err) => get().failStreamingMessage(assistantMsgId, err),
    },
    signal,
  );
} catch (e) {
  // AbortError / network — failStreamingMessage
}
```

**Новые экшены в `sessionStore`:**
- `addBotMessage(content, model, questionId, { streaming: true })` — создаёт assistant-message с `streaming: true`, возвращает `id` (для `appendToMessage`).
- `appendToMessage(id, field: 'content' | 'reasoning', delta)` — накапливает `content`/`reasoning` (immutable update).
- `finalizeMessage(id, payload)` — `streaming: false`, `metrics`, `finishReason`, `excludedIndices`, `contextInfo` (как сейчас).
- `failStreamingMessage(id, err)` — `streaming: false`, `content` — частичный (накопленный) + маркер обрыва, `error` — из `err` (паттерн `composeAssistantAnswer`-подобный на фронте для partial; **или** оставить как есть, если бэкенд уже сохранил partial в БД — см. §2.4 п.5; **рекомендую** доверять бэкенду: `onDone`/`onError` → **перечитать** `getMessages` для этой `questionId`, чтобы получить **сохранённый** partial с маркером — **проще** и **без** дублирования логики `composeAssistantAnswer` на фронте).

> **Уточнение:** `failStreamingMessage` **не** должен **дублировать** `composeAssistantAnswer` на фронте. Бэкенд **уже** сохранил partial (с маркером) в `messages` (см. §2.4 п.5). Фронт: `onError` → `failStreamingMessage(id, err)` → **перечитать** `getMessages` (или принять partial из `err.partial` — если бэкенд пришлёт) → `replaceMessage(id, { content: savedContent, reasoning: savedReasoning, streaming: false })`. **Рекомендую:** бэкенд в `error`-чанке **включает** `partialContent`/`partialReasoning` (сохранённые) → фронт **не** перечитывает. **Проще:** `onError` → `getMessages(sessionId)` → пересобрать `messages` (как `switchToViewing`). **Выбрать** при реализации (оба валидны).

### 3.3. `chat-area.tsx` — streaming UI + ReasoningBlock

**Состояние streaming-сообщения:**
- `message.streaming === true` → показывать «AI печатает…» (спиннер/курсор) **до** первого токена.
- `message.content` накапливается **по мере** `onToken` → рендер **plain text** (не markdown!) во время стрима — **иначе** `ReactMarkdown` перепарсивает весь текст на каждом чанке (дорого, CPU-жор) + **незакрытые code fences** ломают парсинг.
- **Throttle** рендера: до 50–100 мс (не на каждый чанк) — `requestAnimationFrame` / `setTimeout` / `useDeferredValue` — **обязательно**.
- После `done` (`streaming: false`) — **финальный** `ReactMarkdown` рендер.

**ReasoningBlock (новый компонент):**
- **Во время стрима:** если `reasoning` накапливается (`onReasoning`) — показать `ReasoningBlock` (свёрнут) **над** `content`, с «Thinking…» (спиннер) + счётчик символов. **Не разворачивать** автоматически.
- **После `done`:** полный `reasoning` — в `ReasoningBlock` (свёрнут, разворот по клику), маркер `truncated` (если `finishReason === 'length'`).
- **Если `reasoning` пуст** — не рендерится.

**Интеграция в `groupedByQuestion`:**
```ts
currentGroup.answers.push(msg.content);
currentGroup.reasoning = msg.reasoning || undefined;   // новое
currentGroup.finishReason = msg.finishReason;          // из metrics/finishReason
currentGroup.streaming = msg.streaming;                // streaming-флаг
```

**Рендер:**
```tsx
{group.streaming && <span className="animate-pulse">AI печатает…</span>}
{group.reasoning && (
  <ReasoningBlock
    reasoning={group.reasoning}
    truncated={group.finishReason === 'length'}
    outputTokens={...}
    contextLength={currentContextLength}
    streaming={group.streaming}
  />
)}
<div className="chat-markdown">
  {group.streaming ? <pre className="whitespace-pre-wrap">{group.answers[0]}</pre> : <ReactMarkdown ...>{group.answers[0]}</ReactMarkdown>}
</div>
```

### 3.4. `ReasoningBlock` — компонент (новый)

`frontend/src/features/chat/components/reasoning-block.tsx`:

```tsx
interface ReasoningBlockProps {
  reasoning: string;
  truncated?: boolean;
  outputTokens?: number;
  contextLength?: number;
  streaming?: boolean;
  defaultOpen?: boolean;   // default false
}
```

**Поведение:**
- Свёрнут: `<button>🧠 Thinking… (N chars)</button>` (N — длина).
- Развёрнут: `<pre className="whitespace-pre-wrap font-mono text-xs">{reasoning}</pre>`.
- `truncated` → **развёрнут по умолчанию** (`defaultOpen = truncated`), сверху маркер:
  ```
  [Reasoning truncated: N/M tokens, context limit reached]
  ```
  (N=`outputTokens`, M=`contextLength`; если нет — «context limit reached»).
- `streaming` → спиннер + «Thinking…» (не разворачивать, пока не `done`? — **на усмотрение**, рекомендую **не** разворачивать до `done`; после `done` — нормальное поведение).
- `reasoning === ''` → `null`.
- **Copy:** кнопка «Copy reasoning» в развёрнутом виде (опционально, §3.6).

### 3.5. `types/index.ts` — типы

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  questionId: string;
  model: string;
  reasoning?: string;        // новое
  streaming?: boolean;       // новое (transient, не в БД)
  finishReason?: string;     // новое (для маркера truncated)
  metrics?: ResponseMetrics;
  attachmentsMeta?: AttachmentMeta[];
  imageData?: ImageData;
  excludedIndices?: number[];
}

export interface ChatResponse {
  response: string;
  reasoning?: string;        // новое
  metrics?: ...;
  ...
}
```

`getMessages` (QAPair):
```ts
answerReasoning?: string;    // новое
```

### 3.6. Copy Q&A — опционально (чекбокс)

**Сейчас:** `## Question\n\n${q}\n\n## Answer\n\n${a}`.
**Новое:** чекбокс «Include reasoning» (по умолчанию **off**) рядом с `Copy Q&A`. При on:
```
## Question
...
## Reasoning
...
## Answer
...
```
**Объём:** ~0.5 дня. **Можно отложить** отдельным PR — не блокер MVP.

### 3.7. Recovery после F5

`sessionStore.init` → `getMessages` → QAPair с `answerReasoning` → `messages` в store с `reasoning` → `chat-area` рендерит ReasoningBlock. ✅

---

## 4. Тестирование (критерии приёмки)

### 4.1. Backend (unit/integration)

**Streaming:**
1. `LlamaCppProvider.chat({ stream: true, onToken })` — `onToken` вызывается на каждый `delta.content`/`delta.reasoning_content`; возвращает `{ response, reasoning, finishReason, metrics }`.
2. `OllamaProvider.chat({ stream: true, onToken })` — **буферизация** (разрезанный чанк не теряется), `onToken` вызывается; возвращает полный.
3. `chatController` с `Accept: text/event-stream` → `Content-Type: text/event-stream`, поток `data: {"type":"token","delta":"..."}\n\n`, финальный `data: {"type":"done",...}\n\n`.
4. `chatController` с `Accept: application/json` (или без) → JSON (как сейчас). **Регрессия:** non-stream не сломан.
5. `chatController` mid-stream ошибка → `data: {"type":"error",...}\n\n`, `res.end()`, **без** `done`. Накопленный partial **сохранён** в БД (если есть).
6. `chatController` `req.on('close')` mid-stream → `log.warn`, partial сохранён (если есть), `done` **не** отправлен.

**Reasoning:**
7. `init.js` — `messages.reasoning` в CREATE + guarded ALTER (legacy). `PRAGMA table_info` содержит `reasoning`.
8. `messageRepo.addMessage` — assistant с `reasoning: 'x'` → БД `reasoning = 'x'`; user без — `NULL`.
9. `chatController` — провайдер вернул `{ response: '', reasoning: 'long', finishReason: 'length' }` → БД `content` = маркер, `reasoning = 'long'`.
10. `chatController` — `{ response: 'answer', reasoning: 'think', finishReason: 'stop' }` → БД `content = 'answer'`, `reasoning = 'think'`.
11. `buildLLMContext` — reasoning **не** в `[Ранее]` (даже если assistant имеет `reasoning = 'x'`, `conversation` содержит только `content`).
12. `getQAPairs` — `answerReasoning` = `reasoning` assistant; без — `''`.

### 4.2. Frontend (unit)

1. `ReasoningBlock` — `reasoning=''` → `null`.
2. `ReasoningBlock` — `reasoning='text'`, `truncated=false` → свёрнут, клик → развёрнут.
3. `ReasoningBlock` — `truncated=true` → развёрнут, маркер «[Reasoning truncated: N/M tokens…]».
4. `chat-area` — `group.reasoning` → ReasoningBlock **перед** content; `streaming` → «AI печатает…» + plain text; после `done` — markdown.
5. `sessionStore.appendToMessage` / `finalizeMessage` — накопление/финализация.
6. `apiGateway.chat.sendStream` — парсинг SSE (`token`/`reasoning`/`done`/`error`), буферизация строк.

### 4.3. Сквозной ручной сценарий

1. Отправить вопрос (короткий ответ) → **TTFT виден** (первые токены через ~3–5 с), поток в UI.
2. Отправить длинный вопрос (2000 токенов) → поток идёт, пользователь **читает** по мере.
3. Reasoning-модель (Qwen3.8) → «Thinking…» во время reasoning-фазы, потом content; после `done` — ReasoningBlock (свёрнут), разворот — полный reasoning.
4. F5 → reasoning **восстановлен** из БД.
5. `finish_reason='length'` (маленький `n_predict`) → маркер в content + ReasoningBlock с «truncated».
6. Проверить, что reasoning **не** в `[Ранее]` (по логам `Sending chat request`).
7. Клиент ушёл mid-stream (закрыл вкладку) → partial сохранён, `done` не отправлен.
8. Non-stream (`Accept: application/json`) → JSON, как сейчас (регрессия).
9. Vision (картинка) → JSON, как сейчас (не streaming).

---

## 5. Крайние случаи

| Кейс | Решение |
|---|---|
| Провайдер **не** возвращает reasoning (обычная модель) | `reasoning = ''`/`undefined` → ReasoningBlock не рендерится. Поведение как до reasoning. ✅ |
| `content=''`, `reasoning` есть (answer-loss-diagnostics) | `composeAssistantAnswer` → маркер в content + полный reasoning в БД. UI: ReasoningBlock (свёрнут) + маркер. ✅ |
| `content` есть, `reasoning` есть, `finish_reason='length'` | content + маркер обрыва + reasoning в БД. ReasoningBlock с `truncated`. ✅ |
| Legacy-сообщения (`reasoning = NULL`) | ReasoningBlock не рендерится. ✅ |
| Reasoning **очень большой** (35 КБ) | В БД ок; в UI свёрнут; **не** в промпт. ✅ |
| **Streaming mid-stream ошибка** | `error`-чанк, partial сохранён (если есть), `done` не отправлен. Фронт: `failStreamingMessage` (перечитать или из `err.partial`). ✅ |
| **Streaming клиент ушёл** | `req.on('close')` → `log.warn`, partial сохранён, `done` не отправлен. ✅ |
| **Vision + streaming** | Vision-ветка **не** стримится (JSON, `stream: false`). Reasoning сохраняется. ✅ |
| **Ollama stream-чанк разрезан TCP** | Буферизация (§2.3) — не теряется. ✅ |
| **Reasoning и content чередуются** | UI принимает любой порядок: `onToken`/`onReasoning` → накопление по полю. ReasoningBlock — над content, независимо от порядка. ✅ |
| **Пустой reasoning** (`reasoning = ''`) | `|| null` в БД → не рендерится. ✅ |
| **Throttle рендера** не сделан | Markdown перепарсивается на каждом чанке → CPU-жор. **Обязательно** throttle (50–100 мс) + plain text в процессе. ✅ |

---

## 6. Файлы к изменению/созданию

**Backend:**
- `server/src/providers/LlamaCppProvider.js` — `chat({ ..., stream, onToken })`: добавить `onToken?: (type, delta) => void`, вызывать в stream-цикле (stream-ветка **уже** есть, добавить callback). Non-stream — **не трогать**.
- `server/src/providers/OllamaProvider.js` — `chat({ ..., stream, onToken })`: **починить** буферизацию stream-ветки (как в llama.cpp), добавить `onToken`. Non-stream — **не трогать**.
- `server/src/controllers/chatController.js` — `isStream` по `Accept`; SSE-headers; `provider.chat({ ..., stream: true, onToken: (type, delta) => res.write(...) })`; `done`-чанк; `error`-чанк; `req.on('close')` partial; `addMessage({ content, reasoning: fullReasoning || null })` в обеих ветках (stream + non-stream + vision).
- `server/src/db/init.js` — `messages.reasoning` (CREATE + guarded ALTER).
- `server/src/db/messageRepo.js` — `reasoning` в INSERT.
- `server/src/services/contextBuilder.js` — `getQAPairs` (`reasoning` в SELECT + `answerReasoning`); комментарий «reasoning не в промпт».
- Тесты: `providers.chat.stream.test.js` (новый), `chatController.stream.test.js` (новый), `messageRepo.reasoning.test.js` (новый), `contextBuilder.reasoning.test.js` (новый).

**Frontend:**
- `frontend/src/types/index.ts` — `ChatMessage.reasoning?`, `streaming?`, `finishReason?`; `ChatResponse.reasoning?`; `QAPair.answerReasoning?`.
- `frontend/src/lib/apiGateway.ts` — `chatApi.sendStream` (новый, SSE-парсер с буферизацией); `getMessages` QAPair + `answerReasoning`.
- `frontend/src/stores/sessionStore.ts` — `addBotMessage(..., { streaming: true })`; `appendToMessage(id, field, delta)`; `finalizeMessage(id, payload)`; `failStreamingMessage(id, err)`; `sendMessage` → `sendStream`; маппинг QAPair → `ChatMessage` (`answerReasoning` → `reasoning`).
- `frontend/src/features/chat/components/reasoning-block.tsx` — **новый**.
- `frontend/src/features/chat/components/chat-area.tsx` — `group.reasoning`/`group.streaming`/`group.finishReason`; «AI печатает…»; plain text в процессе + throttle; `ReasoningBlock`; markdown после `done`.
- `frontend/src/features/chat/components/chat-area.tsx` — Copy Q&A (опционально, §3.6).
- Тесты: `reasoning-block.test.tsx` (новый), `chat-area.stream.test.tsx` (новый), `apiGateway.stream.test.ts` (новый), `sessionStore.stream.test.ts` (новый).

**Документация:**
- `WORKLOG.md` — запись о streaming + reasoning (транспорт SSE, `messages.reasoning`, «reasoning не в промпт», throttle рендера).

---

## 7. Порядок реализации (PR-план)

**Один PR** (объём сопоставим с P0.1/P0.2, ~15–20 файлов, два логических блока):

1. **PR-1 (backend streaming + reasoning):**
   - Провайдеры: `onToken` callback + фикс буферизации Ollama.
   - `chatController`: SSE-ветка, `done`/`error`/`req.on('close')`.
   - `init.js` + `messageRepo` + `contextBuilder` (`reasoning`).
   - Тесты.
   - **Приёмка:** SSE работает (`curl` с `Accept: text/event-stream`), reasoning в БД, non-stream не сломан.

2. **PR-2 (frontend streaming + reasoning):**
   - `apiGateway.sendStream` (SSE-парсер).
   - `sessionStore` (streaming-экшены).
   - `chat-area` (streaming UI, plain text + throttle, «AI печатает…»).
   - `ReasoningBlock` + интеграция.
   - `types`.
   - Тесты.
   - **Приёмка:** сквозной сценарий §4.3.

> PR-1 и PR-2 **можно объединить** в один (как P0.1/P0.2). Разделение — для ревью «транспорт» vs «UI».

3. **PR-3 (опционально):** Copy Q&A с чекбоксом «Include reasoning» — отдельный маленький PR (не блокер MVP).

---

## 8. Открытые вопросы (не блокирующие, на усмотрение)

1. **`onToken` в провайдере** (вариант A — callback) vs **`ReadableStream`** (вариант B) — рекомендую **A** (минимальное изменение сигнатуры, stream-ветка уже есть).
2. **`failStreamingMessage`** — перечитывать `getMessages` или принимать `err.partial` от бэкенда? — рекомендую **`err.partial`** (бэкенд уже сохранил partial; фронт не перечитывает).
3. **Throttle рендера** — 50 мс vs 100 мс vs `requestAnimationFrame` — рекомендую **`requestAnimationFrame`** (естественная синхронизация с браузером).
4. **ReasoningBlock `defaultOpen`** — свёрнут; при `truncated` — **развёрнут** (пользователь видит обрезку). Рекомендую.
5. **Copy reasoning** — кнопка в развёрнутом блоке. Рекомендую **добавить** (дёшево).
6. **Copy Q&A с reasoning** — НЕ ДЕЛАТЬ.
7. **Стиль ReasoningBlock** — `bg-muted/40` + `🧠`, как `[Материалы]`. Рекомендую.
8. **`finishReason` в `ChatMessage`** — писать из `metrics.finishReason` (backend `extractLlamaCppMetrics` возвращает) или отдельным полем? — рекомендую **отдельным полем** `finishReason` в `ChatMessage` (проще для UI-маркера, не зависит от `metrics`).

---

## 9. Оценка (итог)

| Блок | Время |
|---|---|
| **Streaming backend:** провайдеры (`onToken`, фикс Ollama), `chatController` (SSE, done/error/close), тесты | ~2.5–3 дня |
| **Streaming frontend:** `sendStream`, `sessionStore` (экшены), `chat-area` (UI + throttle), тесты | ~3–3.5 дня |
| **Reasoning backend:** `init.js`, `messageRepo`, `contextBuilder` (`getQAPairs`), `chatController` (`reasoning` в `addMessage`), тесты | ~1–1.5 дня |
| **Reasoning frontend:** `ReasoningBlock`, `chat-area` интеграция, `types`, `apiGateway`, `sessionStore` (маппинг), тесты | ~2–2.5 дня |
| **Итого MVP** | **~8.5–10.5 дней** |
| **+ Copy Q&A с reasoning (PR-3)** | **~+0.5 дня** |

Совпадает с суммой из предыдущих оценок (streaming ~5.5–6 + reasoning ~3–3.5 = ~8.5–9.5, плюс округление).

---

## 10. Итог

**Единый трек: Streaming + Reasoning.**

- **Streaming** — транспорт (SSE через `fetch` + POST + `ReadableStream`), TTFT 3–10 с вместо 30–180 с. Провайдеры (`LlamaCppProvider` — готов; `OllamaProvider` — фикс буферизации) + `chatController` (SSE, `done`/`error`/`close`) + UI (plain text + throttle, «AI печатает…»). ~5.5–6.5 дней.
- **Reasoning** — данные (по готовому транспорту): `messages.reasoning` (полный, F5-recovery), `ReasoningBlock` (свёрнут, разворот, маркер truncated), **не в промпт**. ~3–4 дня.
- **Совместимость:** `composeAssistantAnswer` (answer-loss-diagnostics) не ломается; vision-ветка — JSON (не streaming); non-stream — JSON (как сейчас).
- **Порядок:** streaming **первым** (транспорт), reasoning **поверх** (данные) — **одна итерация** reasoning-UI (Thinking… в процессе, финальный после done), **без** второй переделки.

**~8.5–10.5 дней, высокий UX-выигрыш** (streaming для всех моделей + reasoning для reasoning-моделей). **Стоит делать** — и streaming, и reasoning **вместе**, в одном PR-цикле.

