# Техническое задание: миграция фронтенда на React + доработка attachments

> **Для агента-исполнителя.** Это ТЗ самодостаточно. Все пути — от корня репозитория `chat-app/`. Перед началом работы **прочитай `webq98/PROJECT_CONTEXT.md`** — это конституция проекта, она обязательна к исполнению. Если какое-то требование ТЗ противоречит конституции — остановись и сообщи.
>
> **Стек.** React 18, TypeScript 5.8 (strict), Vite 6, Zustand 5, Tailwind 4, react-router 7, react-markdown + remark-gfm + remark-breaks + rehype-highlight, sonner, lucide-react, Radix (dialog, dropdown-menu, select, switch, tooltip), vitest, jsdom, @ricky0123/vad-web 0.0.30, onnxruntime-web **1.22.0** (точный пин).
>
> **Запрещено.** Менять бэкенд `server/` без явного указания в ТЗ (исключение — Фаза B, там прямо разрешено). Добавлять зависимости. Использовать сырой `fetch`/`WebSocket` вне `src/lib/`. Трогать `public/` до Фазы F. Менять формат id `q_{n}_{Date.now()}`. Предполагать стриминг `/api/chat` (его нет).
>
> **Обязательно после каждой фазы.** `npm run build`, `npm run lint`, `npm run test:run` — всё зелёное. Приложение запускается на `:5175` против реального бэкенда `:3000`. Коммит формата `TZ-N.M: краткое описание`.

---

## Контракт бэкенда (справочник, не меняется)

Все вызовы — через `webq98/src/lib/apiGateway.ts`.

- **`POST /api/chat`** — multipart/form-data, заголовок `X-Provider: 'ollama' | 'llama_cpp'`. Поля: `message`, `model`, `sessionId`, `questionId`, `contextLength?`, `retainPercent`, `includeQuestionIds` (**JSON.stringify(string[])**), `file?`, `codeFiles[]`. Ответ — **обычный JSON** (не стриминг): `{ response, metrics?, imageData?, contextInfo?, excludedIndices?, error? }`. Ошибки: `503 {error}` — провайдер недоступен; прочие `{error}`.
- **`GET /api/providers/status`** → `{ providers: [{ name, status: 'connected'|'disconnected'|'checking'|'error', latencyMs?, error? }] }`. `'error'` нормализуется в `'disconnected'`.
- **`GET /api/models`** (X-Provider) → `{ connected, models: [{ name, size, contextLength?, type? }] }`.
- **`POST /api/show`** `{name}` (X-Provider) → `{ model_info?, details?, parameters? }`. Контекст-длина извлекается по цепочке: `model_info[*context_length*]` → `parameters.context_length` → `models[].contextLength`.
- **`GET /api/sessions`**, `GET /api/sessions/:id`, `POST /api/sessions`, `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id` — стандартный CRUD.
- **`GET /api/sessions/:id/messages`** → **Q&A-пары** (не плоские сообщения): `[{ questionId, questionText, answerText, model, attachments_meta|attachmentsMeta, metrics, image_data|imageData }]`. snake_case/camelCase — нормализовать оба.
- **`DELETE /api/sessions/:id/messages/:questionId`** → `{ ok, deletedMessages, deletedAttachments }`.
- **`POST /api/stt/transcribe`** — multipart, поле `audio`. **Только настоящий WAV PCM 16kHz mono 16-bit.** Ответ: `{ text, latencyMs }`. Текст **вставляется в поле ввода**, не отправляется.
- **WebSocket `/ws/ai-helper`.** Клиент→сервер: `{type:'audio_chunk', role, audioBase64 (PCM16LE), sampleRate:16000, format:'pcm16', timestamp}`, `{type:'request_hint'}`, `{type:'end_session'}`. Сервер→клиент: `{type:'transcript', role, text}`, `{type:'hint_token', token}`, `{type:'hint_done'}`, `{type:'error', message}`.
- **`/vad-assets/*`** — WASM и ONNX-модели **бэкенда** (1.22.0). React-клиент ходит за ними через Vite-proxy на `:3000`. **Не копировать в `webq98/public`.**

---

## Ключевые механики (нельзя ломать)

1. **Two-pointer sessions.** `activeSessionId` — «рабочая» сессия; `viewingSessionId` — отображаемая. Сообщения всегда уходят в `viewingSessionId`. При `viewing ≠ active` — после успешной отправки `active := viewing`. При `init()` с `?session=` — `active` восстанавливается/создаётся **до** переключения на историю.
2. **Clear/Delete.** «Clear» (Archive) — архивировать просматриваемую (если `title` пуст или `unsavedSession*` → переименовать в `unsavedSession {N+1}`), создать новую, `active = viewing = new`. «Delete» (Trash2) — удалить насовсем; если удалили active — создать новую сессию (fresh); если удалили viewing ≠ active — `returnToCurrent`.
3. **Контекст (standard/manual).** Per-session в `localStorage`: `contextMode_{sessionId}`, `selectedIds_{sessionId}`. Standard — `includeQuestionIds` = все id; Manual — **ровно `selectedQuestionIds` как есть** (даже пустой массив — это валидное значение, означающее «ничего не включать», см. Фазу A). В исторической сессии (`viewing ≠ active`) контекст **read-only**.
4. **System Prompt.** `DEFAULT_SYSPROMPT = "Ты Senior Developer. Отвечай четко, структурированно и по существу. Ты мыслишь архитектурно, производительность, системность."`. Если `session.sysprompt` пуст — подставить дефолт. Сохранение: PATCH при потере фокуса **и** перед отправкой, если значение изменилось.
5. **questionId.** Всегда `q_{counter}_{Date.now()}`. `counter` — номер Q&A в сессии. При удалении пары — перенумерация **отображаемых** номеров Q1, Q2… (сами id не меняются).
6. **Markdown.** `react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-highlight`. **`remark-breaks` обязателен** — LLM пишут одиночные `\n`. `CodeBlock` рендерит **настоящий `<pre>`** внутри. Mermaid — lazy import, автогидрат через 600ms стабильности, фоллбэк на исходник при ошибке.

---

## Фаза A — Критические фиксы (видимые пользователю баги)

**Цель.** Закрыть баги, которые пользователь видит прямо сейчас. Без них удаление `public/` невозможно.

### A.1. Сброс модели при смене провайдера

**Файл:** `webq98/src/stores/providerStore.ts`

**Проблема.** При переключении провайдера в `setCurrentProvider` загружаются новые модели, но `currentModel`, `modelDetail`, `currentContextLength` остаются от предыдущего провайдера.

**Требование.**
- `setCurrentProvider(provider)`: перед `loadModels` **сбросить** `currentModel: null, modelDetail: null, currentContextLength: null`.
- После `loadModels`: если у нового провайдера ровно одна модель — **авто-выбрать** её через `selectModel`.
- Сохранять `currentProvider` в `localStorage` (уже есть).

**Приёмка.**
- Переключить `llama_cpp → ollama` (или наоборот) → в шапке model-dropdown показывает «—» (или единственную модель нового провайдера).
- Старая модель не «прилипает».
- `npm run test:run` — зелёный (добавить тест).

### A.2. Tooltip над статистикой

**Файл:** `webq98/src/components/ui/tooltip.tsx`

**Проблема.** В шапке чата Tooltip при наведении на иконки **уходит под** блок статистики (`StatFooter`) и контекст-бар после получения ответа. Не всегда — зависит от длины контента.

**Требование.**
- `TooltipContent`: класс `z-[60]` (или выше, если в проекте уже есть `z-*` > 50). `collisionPadding={12}` — сохранить.
- Проверить `chat-area.tsx`: у `StatFooter`, контекст-бара, `chat-header` **не должно быть** `z-*`-классов, конфликтующих с тултипом. Если есть — убрать.
- Проверить, что `main`-контейнер и `messagesContainerRef` не создают stacking-context с `z-index` выше, чем у портала.

**Приёмка.**
- Навести на любую иконку в шапке (Dashboard, Save, Load, Return, Clear, Delete, Export, Theme) → тултип **виден поверх** всего контента, включая статистику, при любом состоянии (пустой чат / после ответа / длинное сообщение).
- В DevTools инспектор: `.TooltipContent` имеет `z-index >= 60`, виден в `elements`-дереве как потомок `body` (Radix portal).

### A.3. Типизация провайдера — `ProviderName` везде

**Файл:** `webq98/src/lib/apiGateway.ts`

**Проблема.** `chatApi.send(data, provider: string, files?)`, `modelsApi.list(provider: string)`, `modelsApi.show(name, provider: string)` принимают `string`. Из-за этого возможен рецидив `'llama.cpp'` (с точкой) — сервер **молча** fallback-ит на default, и пользователь не понимает, почему говорит не с тем провайдером.

**Требование.**
- Заменить `provider: string` → `provider: ProviderName` (тип из `@/types`) во всех трёх методах.
- Проверить все вызовы в `providerStore`, `sessionStore`, `aiHelperStore` — уже используют `ProviderName`, но убедиться, что TS не ругается.
- Проверить, что `providerStore.setCurrentProvider` принимает `ProviderName`.

**Приёмка.**
- `npm run build` — без ошибок.
- В `localStorage.setItem('selectedProvider', 'llama.cpp')` (с точкой) → перезагрузить → `providerStore.init` не выбирает этот провайдер (или падает в fallback на `ollama`/`llama_cpp` по приоритету).
- `npm run test:run` — зелёный.

### A.4. Сброс `currentModel` при смене провайдера (дубль A.1 — см. выше, объединить)

### A.5. STT: чистка текста от переносов

**Файл:** `webq98/src/features/stt/components/stt-input.tsx`

**Проблема.** После транскрипции в поле ввода иногда попадает `\n` посреди слова или в конце — whisper возвращает многострочный текст.

**Требование.**
- После `sttApi.transcribe`: нормализовать `result.text`:
  ```ts
  const cleaned = result.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  ```
- Передавать в `onTranscribe(cleaned)`.
- В `chat-area.tsx` — append: `prev + (prev && !prev.endsWith(' ') ? ' ' : '') + cleaned`.

**Приёмка.**
- Произнести фразу → в поле ввода **одна строка**, без `\n`.
- Повторить 2–3 раза → каждая транскрипция вставляется через пробел, не слипается и не рвётся.

### A.6. `AudioContext` — кэш и закрытие

**Файл:** `webq98/src/features/stt/components/stt-input.tsx`

**Проблема.** `new AudioContext({ sampleRate: 16000 })` создаётся **на каждую** транскрипцию. WebAudio имеет лимит (~6 активных контекстов в Chrome). При частом использовании STT — ошибка `Cannot create AudioContext`.

**Требование.**
- `useRef<AudioContext | null>(null)`.
- Lazy init: `if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: 16000 });`
- В `useEffect` cleanup: `ctxRef.current?.close(); ctxRef.current = null;`.
- `bufferToWave` **использует `sampleRate: 16000`** (не `abuffer.sampleRate`) — whisper ждёт 16k; `AudioContext({sampleRate: 16000})` гарантирует это, но подстраховаться.

**Приёмка.**
- 10 транскрипций подряд → нет ошибок в консоли.
- `npm run test:run` — тест `audio.test.ts` зелёный.

### A.7. Manual + `selectedQuestionIds = []` — бэкенд должен вернуть пустой контекст

**Файлы:**
- `server/src/services/contextBuilder.js` (бэкенд)
- `webq98/src/stores/sessionStore.ts` (проверка контракта)

**Проблема.** В Manual-режиме пользователь снимает **все** галочки → `includeQuestionIds = []`. Бэкенд `cutContext` проверяет `if (includeQuestionIds && Array.isArray && length > 0)` → **пустой массив = false** → фильтр не применяется → в контекст уходит **вся история**. Пользователь ожидает пустой контекст (только system prompt + новый вопрос).

**Требование (бэкенд, разрешено менять `server/src/services/contextBuilder.js`):**
- В `cutContext(qaHistory, targetChars, includeQuestionIds)`:
  ```js
  let filteredPairs = qaPairs;
  if (Array.isArray(includeQuestionIds)) {
      filteredPairs = qaPairs.filter(p => includeQuestionIds.includes(p.questionId));
  }
  ```
  Различие: `null` (не задано) → все пары; `[]` (задано пустым) → 0 пар; `[...]` → только указанные.
- `excludedIndices` при `[]` = `[1, 2, …, totalQAPairs]`.

**Требование (фронт, проверка):**
- `sessionStore.sendMessage` в Manual отправляет `includeQuestionIds = [...selectedQuestionIds]` **как есть** (даже `[]`). Уже так — но покрыть тестом.
- Standard отправляет `[...все id, questionId нового]`.

**Приёмка.**
- Manual, снять все галочки, отправить сообщение → ответ содержит `excludedIndices = [1..N]`, `contextInfo.includedQAPairs = 0`.
- В ответе модели виден только новый вопрос (и system prompt).
- Standard — работает как раньше.
- `npm run test:run` — добавить тест `contextBuilder` (сервер, vitest, если настроен; иначе — фронтовый тест на `sendMessage` с пустым массивом).

### A.8. AI Helper: утечка `displayStream`

**Файл:** `webq98/src/lib/vadManager.ts`

**Проблема.** `startDualVad` получает `displayStream` через `getDisplayMedia`, затем `getUserMedia` для микрофона. Если пользователь откажет в микрофоне — `displayStream` **не останавливается**, экран продолжает захватываться.

**Требование.**
- Обернуть всё после `getDisplayMedia` в `try/catch`. В `catch` — `displayStream.getTracks().forEach(t => t.stop()); throw e;`.
- Аналогично для `MicVAD.new`/`start` — при ошибке остановить всё, что уже получено.
- В `finally` — если `controller` не создан, освободить ресурсы.

**Приёмка.**
- Разрешить шаринг экрана → отказать в микрофоне → в индикаторе браузера **не горит** «идёт захват экрана».
- Отменить шаринг → `isCapturing: false` в store, консоль без ошибок.

### A.9. AI Helper: unhandled rejection в `onClick`

**Файл:** `webq98/src/features/ai-helper/components/ai-helper-overlay.tsx`

**Проблема.** `onClick={isCapturing ? stopCapture : startCapture}` — `startCapture` возвращает `Promise<void>`. Если отклонится — unhandled rejection в консоли.

**Требование.**
- `onClick={() => void (isCapturing ? stopCapture() : startCapture())}` — или `.catch` с `useUIStore.getState().addToast(...)`.

**Приёмка.**
- Отменить диалог шаринга → консоль без unhandled rejection.

### A.10. Убрать локальную `Sparkles` в overlay

**Файл:** `webq98/src/features/ai-helper/components/ai-helper-overlay.tsx`

**Требование.**
- Импортировать `Sparkles` из `lucide-react`; удалить локальную функцию.

**Приёмка.** `npm run build` — без ошибок; иконка рендерится.

**Оценка Фазы A:** 6–9 часов.

---

## Фаза B — Attachments в БД (критический функциональный пробел)

**Цель.** Файлы (PDF/DOC/XLS/CSV, codeFiles) должны сохраняться в таблицу `attachments`, `messages.attachments_meta` — содержать `fileId`. При загрузке сессии (F5, Load, Dashboard) контекст следующего вопроса должен включать `extracted_text` из `attachments`.

**Текущее состояние (проверено):**
- `chatController.js` при `file`/`codeFiles` обрабатывает их **только в памяти** (`processDocument`, `processCodeFiles` → `message`), **не вызывает** `attachmentService.extractFiles`. `attachments_meta` в БД = `[]`.
- `contextBuilder.buildLLMContext` ищет `msg.attachments_meta[].fileId` → находит ничего → `filesContext = ''`.
- Эталон (`public/`) ведёт себя так же — **это не регрессия React, а общий пробел бэкенда**.

### B.1. Перевести `chatRoutes` на `diskStorage`

**Файл:** `server/src/routes/chatRoutes.js`

**Проблема.** Сейчас `multer.memoryStorage` — файла на диске нет, `attachmentRepo.extractFromPaths(paths, sessionId)` не может прочитать по пути.

**Требование.**
- Заменить `multer.memoryStorage()` на `multer.diskStorage` с `destination: uploads/tmp/`, `filename: ${Date.now()}_${Math.random().toString(36).slice(2)}_${originalname}`.
- Лимит `fileSize` — 50 MB (сохранить).
- Убедиться, что `chatController` получает `req.file.path` и `req.files.codeFiles[i].path`.
- **Cleanup:** после обработки (в `finally`) удалить `req.file.path` и `codeFiles[i].path`.

### B.2. Сохранять вложения в БД в `chatController`

**Файл:** `server/src/controllers/chatController.js`

**Требование.**
- После `processDocument`/`processCodeFiles`, **до** `sessionService.addMessage`:
  - Если `file`: `attachmentService.extractFiles([file.path], sessionId)` → `{ results, errors }`. Если `errors.length > 0` — залогировать, **продолжить**.
  - Если `codeFiles.length > 0`: для каждого `cf` — `extractFiles([cf.path], sessionId)`, собрать все `results`.
- Сформировать `currentAttachments` = массив `{ fileId, name, size, type }` из `results`.
- Передать `currentAttachments` в `addMessage` как `attachmentsMeta` (для user-сообщения).
- **Важно:** до этого `currentAttachments = req.body.attachments || []` — заменить на **свежесозданный** массив.
- В `finally` — удалить временные файлы (`file.path`, все `cf.path`).

### B.3. Cleanup временных файлов

**Файл:** `server/src/controllers/chatController.js`

**Требование.**
- Обернуть основную логику в `try/finally`.
- В `finally`: `[file?.path, ...(codeFiles || []).map(cf => cf.path)].filter(Boolean).forEach(p => fs.unlinkSync(p))` (или `fs.promises.unlink` с `.catch(()=>{})`).
- **Не удалять `uploads/tmp/`** (используется повторно).

### B.4. Проверка `contextBuilder`

**Файл:** `server/src/services/contextBuilder.js` (только чтение, менять не нужно)

**Проверка:** `buildLLMContext` уже собирает `fileId` из `msg.attachments_meta`, загружает `extracted_text` из `attachments` по ID, формирует `filesContext` как отдельный system message. После B.1–B.2 — заработает.

**Требование:** добавить в `info` поле `filesContextChars` (длина `filesContext`) для отладки. Опционально.

### B.5. Фронт: optimistic-сообщение

**Файл:** `webq98/src/stores/sessionStore.ts`

**Требование.**
- В `sendMessage` при формировании optimistic-сообщения `attachmentsMeta` уже содержит `{ name, size, type }` (без `fileId` — его пока нет). **Оставить как есть.**
- При загрузке сессии `mapQAPairsToMessages` читает `attachments_meta` из БД — теперь с `fileId`. **Фронт не должен падать** от лишнего поля.

**Приёмка (Фаза B):**
- Отправить PDF → в БД `attachments` появляется строка; `messages.attachments_meta` содержит `fileId`.
- Отправить codeFiles (2–3) → 2–3 строки в `attachments`.
- F5 (перезагрузить) → отправить новый вопрос → в логах бэкенда `contextResult.info.fixedChars > 0` (значит `filesContext` подмешан).
- Ответ модели ссылается на содержимое файла.
- `npm run test:run` (frontend) — зелёный; `attachmentsMeta`-бейджи рендерятся.
- Временные файлы в `uploads/tmp/` удаляются после запроса.

**Оценка Фазы B:** 4–7 часов.

---

## Фаза C — Демонтаж правой панели

**Цель.** Правая панель `SettingsPanel` — по дизайн-системе должна быть **демонтирована** (слот под Project-режим). Все её функции уже перенесены: Provider/Model — в шапку `chat-area`, Sysprompt/Retain — в левую панель (`questions-panel`, вкладка Prompts).

### C.1. Убрать `<SettingsPanel />` из лейаута

**Файл:** `webq98/src/app/App.tsx`

**Требование.**
- Убрать `<SettingsPanel className="w-1/5 min-w-[280px]" />` из Route `/`.
- Расширить `ChatArea`: `className="w-4/5"` (было `w-3/5`).
- `QuestionsPanel` — `w-1/5` (без изменений).
- Импорт `SettingsPanel` — убрать.

### C.2. Пометить `settings-panel.tsx` как DEPRECATED

**Файл:** `webq98/src/features/models/components/settings-panel.tsx`

**Требование.**
- Файл **не удалять** — это скелет для Project-режима (будущая фаза).
- В начало файла — комментарий `/* DEPRECATED: не монтируется. Скелет для Project-режима. */`.
- Компонент **не импортируется** нигде.

### C.3. Проверить покрытие `questions-panel`

**Файл:** `webq98/src/features/questions/components/questions-panel.tsx`

**Проверка (без правок, если всё есть):**
- Вкладка **Prompts**: Sysprompt textarea (blur → PATCH) — есть.
- Retain slider (`setRetainPercent`) — есть.
- Вкладка **Questions**: список Q&A, mode-переключатель Standard/Manual, чекбоксы, All/None — есть.
- `isViewing` (viewing ≠ active) → mode-переключатель disabled — есть.

**Если чего-то не хватает** — добавить. Если всё есть — ничего не менять.

### C.4. Статус-точки в provider-dropdown (опционально, но желательно)

**Файл:** `webq98/src/features/chat/components/chat-area.tsx`

**Требование.**
- В `DropdownMenuItem` для каждого провайдера: слева цветной `span` с `w-2 h-2 rounded-full` и классом по статусу (`bg-success` / `bg-muted` / `bg-warning`).
- Показывать **все** провайдеры (не только `connected`) — но с индикатором. **Решение:** оставить только `connected` (как сейчас), чтобы не путать пользователя. Статус-точки — для будущего. **Опционально: пропустить, если не влезает в бюджет.**

**Приёмка (Фаза C):**
- Правая панель отсутствует.
- Чат занимает `w-4/5`.
- Provider/Model dropdown в шапке — работают.
- Sysprompt/Retain — в левой вкладке Prompts.
- `npm run build`, `npm run lint` — без ошибок.

**Оценка Фазы C:** 2–3 часа.

---

## Фаза D — UX-паритет и мелкие улучшения

### D.1. Dashboard: группы развёрнуты по умолчанию

**Файл:** `webq98/src/features/dashboard/components/dashboard.tsx`

**Проблема.** `groupOpen` по умолчанию `{}` → все группы свёрнуты. В эталоне — развёрнуты.

**Требование.**
- После `setSessions(data)` — инициализировать `groupOpen` всеми категориями: `true`. Или инвертировать семантику: `groupOpen[category] !== false` → развёрнута. **Решение:** инвертировать (меньше кода, не надо синхронизировать при загрузке).

### D.2. CommandPalette: сброс списка при коротком запросе

**Файл:** `webq98/src/shared/components/command-palette.tsx`

**Проблема.** При `query.length < 2` `showSessions = false`, но `sessions` остаётся. При следующем вводе «мигает» старый список.

**Требование.**
- В `else`-ветке: `setShowSessions(false); setSessions([]);`.

### D.3. LoadModal: не зависает при ошибке

**Файл:** `webq98/src/features/sessions/components/load-modal.tsx`

**Требование.**
- `handleSelectSession`: `try { await switchToViewing(id); } finally { closeLoadModal(); }` (или `catch` → toast).

### D.4. Убрать дублирование `AudioContext` (см. A.6 — если не сделано)

### D.5. AI Helper overlay: `Sparkles` из lucide (см. A.10 — если не сделано)

**Оценка Фазы D:** 2–3 часа (без дублей A.6/A.10).

---

## Фаза E — Тесты и регрессия

### E.1. Юнит-тесты для фиксов A–D

**Файлы:** `webq98/src/stores/providerStore.test.ts`, `webq98/src/stores/sessionStore.test.ts`, `webq98/src/lib/audio.test.ts`.

**Требование.**
- `providerStore.test.ts`: тест «смена провайдера сбрасывает `currentModel`». Setup: `currentModel = 'old-model'`, `setCurrentProvider('other')` → `currentModel === null` (или авто-выбор единственной).
- `sessionStore.test.ts`: тест «Manual + `selectedQuestionIds = []` → `includeQuestionIds = []`» — мок `chatApi.send` захватывает аргумент.
- `sessionStore.test.ts`: тест «Standard + 2 существующих + новый → `includeQuestionIds` содержит 3 id».
- `audio.test.ts`: уже покрыт.

### E.2. E2E-смоук (если Playwright уже в проекте; если нет — создать `webq98/e2e/` и добавить в `package.json` devDep + скрипт `test:e2e`)

**Сценарии (минимум):**
1. Отправка сообщения → ответ рендерится в чате.
2. Prev/Next между Q&A.
3. Copy Question / Copy Q&A → в буфере.
4. Delete Q&A → пара исчезает, `fetch DELETE` вызван.
5. Clear (Archive) → новая сессия.
6. Delete (Trash2) → удалена, fresh или return.
7. Load-модалка → переключение сессии.
8. Dashboard: поиск, rename, bulk export, bulk delete.
9. Save-модалка → сохранение title/category.
10. STT: mock `getUserMedia` + mock `/api/stt/transcribe` → текст в поле ввода.
11. AI Helper: mock `getDisplayMedia` + mock WebSocket → открыть/закрыть оверлей.

### E.3. Ручная сверка с эталоном

Чек-лист:
- [ ] Отправка сообщения (текст, файл, изображение на vision, codeFiles).
- [ ] Two-pointer: switch, return, clear, delete.
- [ ] Manual + все сняты → пустой контекст (после A.7).
- [ ] Manual + частично → `excludedIndices`.
- [ ] Sysprompt: смена, blur, сохранение, F5.
- [ ] Retain: слайдер, сохранение в localStorage.
- [ ] Контекст-бар: pct, цвет.
- [ ] STT: одна строка без `\n`.
- [ ] AI Helper: старт, стоп, отмена шаринга.
- [ ] Темы: leteem/besafe/minimal × light/dark/system.
- [ ] Command palette (Cmd+K).
- [ ] Save/Load/Export.

### E.4. Финальный прогон

- [ ] `npm run build` — успех.
- [ ] `npm run lint` — без ошибок.
- [ ] `npm run test:run` — зелёный.
- [ ] `npm run test:e2e` — зелёный (если E.2 реализован).
- [ ] Консоль браузера при ручном проходе — без новых ошибок.

**Оценка Фазы E:** 8–12 часов.

---

## Фаза F — Переключение статики и архивация `public/`

**Цель.** Отдавать production-сборку React с `:3000`. `public/` — **не удалять**, а переместить в архив (golden master для сверки).

### F.1. `app.js` — SPA-fallback и статика

**Файл:** `server/src/app.js`

**Требование.**
- Заменить `app.use(express.static(path.join(__dirname, '..', 'public')))` → `express.static(path.join(__dirname, '..', 'webq98', 'dist'))`.
- Добавить **SPA-fallback** в конец всех API-роутов (после них):
  ```js
  app.get('*', (req, res) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/vad-assets')) {
          return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(__dirname, '..', 'webq98', 'dist', 'index.html'));
  });
  ```
- **Удалить** роут `GET /ai-helper-overlay.html` (страницы больше нет — AI Helper рендерится в React-компоненте внутри SPA).
- **Оставить** `app.use('/vad-assets', coepHeaders)` и COOP/COEP для `/vad-assets` (иначе AI Helper не заработает — `SharedArrayBuffer`).
- **Удалить** COOP/COEP для `/ai-helper-overlay.html` (роута нет).

### F.2. Проверить `/vad-assets`

**Требование.** `vad-assets` остаются в `public/vad-assets/` (или где сейчас — проверить `app.js`). Если `public/` архивируется — `vad-assets` **переместить** в `server/public/vad-assets/` (или оставить `public/` как есть — только для `vad-assets`).

**Решение:** оставить `public/vad-assets/` и `app.use('/vad-assets', express.static(path.join(__dirname, '..', 'public', 'vad-assets')))`. **Не удалять.**

### F.3. Переместить `public/` в архив (кроме `vad-assets`)

**Требование.**
- `git mv public/ docs/reference/public-archive/` (кроме `public/vad-assets/`, которые остаются).
- Или: `git mv public/*.html public/*.js public/*.css public/dashboard.html docs/reference/public-archive/` (пофайлово).
- `docs/reference/public-archive/README.md`: «Golden master для сверки поведения. Не изменять. Ссылки из `app.js` на него нет.»

### F.4. Обновить `PROJECT_CONTEXT.md`

**Требование.**
- §7: добавить решения, принятые в этой сессии (см. таблицу решений в конце ТЗ).
- §8: `public/` → `docs/reference/public-archive/` (только чтение).
- §10: карта репозитория — обновить.

### F.5. Обновить `README.md` (если есть в корне)

**Требование.** Раздел «Frontend»: теперь `webq98/`, `npm run dev` (порт 5175), `npm run build` → `webq98/dist`, бэкенд на :3000 отдаёт `webq98/dist`.

### F.6. Удалить мёртвые зависимости фронта из корневого `package.json`

**Файл:** `chat-app/package.json`

**Требование (опционально, но желательно):**
- Убрать devDependencies, относящиеся только к фронтенду (`@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `eslint`, `vitest`, `jsdom`, `tailwindcss` — если они дублируются в `webq98/package.json`).
- **Осторожно:** если корневой `chat-app` использует `vitest` для бэкенд-тестов — оставить.
- Если сомневаешься — не трогай.

**Приёмка (Фаза F):**
- `npm start` в `chat-app/` → `:3000` отдаёт React-приложение (SPA). Главная `/` — ChatArea + QuestionsPanel (без правой панели). `/dashboard` — Dashboard.
- AI Helper работает (VAD, WS, whisper) — `vad-assets` отдаются с `:3000`, COOP/COEP навешены.
- `public/` (кроме `vad-assets`) — в `docs/reference/public-archive/`.
- Ссылок из `app.js` на `public/` (кроме `vad-assets`) — нет.
- `npm run build` (`webq98/`) → `dist/` собирается.
- `npm run lint` — без ошибок.
- `npm run test:run` — зелёный.

**Оценка Фазы F:** 3–4 часа.

---

## Таблица решений (добавить в `PROJECT_CONTEXT.md §7`)

| # | Решение |
|---|---|
| 95 | `providerStore.setCurrentProvider` сбрасывает `currentModel` перед `loadModels`; если 1 модель — авто-выбор. |
| 96 | `TooltipContent` — `z-[60]`; конфликтующие `z-*` в `chat-area` убрать. |
| 97 | `apiGateway.chat.send`/`modelsApi.*` принимают `ProviderName` (не `string`) — защита от тихого fallback'а `providerMiddleware`. |
| 98 | STT: `result.text` нормализуется (`\n → ' '`, `\s+ → ' '`, `trim`). |
| 99 | STT: `AudioContext` — `useRef` + lazy init + `close()` в cleanup. |
| 100 | `contextBuilder.cutContext`: `includeQuestionIds = []` = «ничего не включать»; `null` = «все». Различие проверяется через `Array.isArray`. |
| 101 | `vadManager.startDualVad`: `try/catch` вокруг `getDisplayMedia` + `getUserMedia`; cleanup `displayStream` при любой ошибке. |
| 102 | `ai-helper-overlay.onClick`: `void (...)` для промисов — без unhandled rejection. |
| 103 | `settings-panel.tsx` — DEPRECATED, не монтируется (слот под Project). Чат — `w-4/5`, левая панель — `w-1/5`. |
| 104 | Dashboard: `groupOpen[category] !== false` — развёрнута по умолчанию. |
| 105 | CommandPalette: при `query.length < 2` — `setSessions([])` (не мигает старый список). |
| 106 | LoadModal: `try/finally` вокруг `switchToViewing` — модалка не виснет при ошибке. |
| 107 | Attachments (бэкенд): `chatRoutes` → `diskStorage` (uploads/tmp); `chatController` вызывает `attachmentService.extractFiles` до `addMessage`; `attachments_meta` содержит `fileId`; cleanup временных файлов в `finally`. |
| 108 | `app.js`: SPA-fallback `GET *` → `webq98/dist/index.html` (кроме `/api`, `/ws`, `/vad-assets`). Роут `/ai-helper-overlay.html` удалён. |
| 109 | `public/vad-assets/` — **остаются** (WASM/ONNX 1.22.0 бэкенда, COOP/COEP навешены). Не копировать в `webq98/public`, не удалять. |
| 110 | `public/` (кроме `vad-assets`) → `docs/reference/public-archive/` — golden master. Не изменять. |
| 111 | Тестовая стратегия: каждый фикс A–D — тест (unit или E2E) в той же фазе. E2E — Playwright, сценарии E.2. |
| 112 | §7.49 (AI Helper «мёртвый фасад») — **аннулировано**: AI Helper работает end-to-end (WS + whisper + LLM + БД). Баг только в `vadManager` — фикс A.8. |

---

## Итоговая оценка

| Фаза | Оценка |
|---|---|
| A — Критические фиксы | 6–9 ч |
| B — Attachments в БД | 4–7 ч |
| C — Демонтаж правой панели | 2–3 ч |
| D — UX-паритет | 2–3 ч |
| E — Тесты и регрессия | 8–12 ч |
| F — Переключение + архивация | 3–4 ч |
| **Итого** | **25–38 ч** (3–5 рабочих дней) |

---

## Чек-лист «готово к удалению `public/`»

После завершения всех фаз (A–F) проверить:

- [ ] Все баги A.1–A.10 закрыты, покрыты тестами.
- [ ] Attachments сохраняются в БД; F5 сохраняет контекст.
- [ ] Правая панель демонтирована; Provider/Model/Sysprompt/Retain доступны.
- [ ] Manual + все сняты → пустой контекст.
- [ ] Tooltip виден над всем.
- [ ] STT — одна строка без `\n`; AudioContext не течёт.
- [ ] AI Helper: старт/стоп/отмена шаринга — без утечек.
- [ ] Dashboard: группы развёрнуты; поиск/rename/bulk/export — работают.
- [ ] CommandPalette: не мигает старым списком.
- [ ] LoadModal: не виснет при ошибке.
- [ ] `webq98` собирается (`npm run build`), `lint` и `test:run` — зелёные.
- [ ] `:3000` отдаёт React SPA (главная + `/dashboard`).
- [ ] `vad-assets` — отдаются с `:3000`, AI Helper работает.
- [ ] `public/` (кроме `vad-assets`) → `docs/reference/public-archive/`.
- [ ] `PROJECT_CONTEXT.md §7` — обновлён (решения 95–112).
- [ ] `PROJECT_CONTEXT.md §8` — `public/` разрешено не трогать (уже архив).
- [ ] `PROJECT_CONTEXT.md §10` — карта репозитория обновлена.