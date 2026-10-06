# PROJECT_CONTEXT.md — Конституция проекта

> ЭТОТ ФАЙЛ ОБЯЗАТЕЛЕН К ПРОЧТЕНИЮ перед выполнением любого ТЗ.
> Он содержит решения, контракт бэкенда и запреты. Если ТЗ противоречит этому файлу —
> остановись и сообщи. Не выдумывай контракты, не описанные здесь.

---

## 1. Что это за проект

Multi-Provider AI Chat — десктопный инструмент для работы с локальными LLM
(Ollama, llama.cpp). Один пользователь, фронтенд и бэкенд на одной машине.

Два режима (как свойство сессии, `mode: 'chat' | 'project'`):
- **Study** — диалог с моделью: изучение, статьи, загрузка одиночных файлов (PDF/DOC/XLS/IMG/код), голосовой ввод.
- **Project** — работа с папкой проекта на диске (будущее, Фаза 5; файлы не передаются по сети — передаётся только относительный путь).

Сейчас реализуется Фаза 0 (фундамент). План фаз:
`0 Фундамент → 1 Контракт → 2 Паритет с эталоном → 3 AI Helper → 4 Дизайн → 5 Project-каркас → 6 Финал`

## 2. Компоненты системы и запуск

| Компонент | Где | Порт | Комментарий |
|---|---|---|---|
| Бэкенд (Express + БД) | репозиторий сервера | 3000 | **НЕ ИЗМЕНЯТЬ без прямого указания в ТЗ** |
| Эталонный фронтенд | `public/` (index.html, script.js, style.css, ...) | 3000 | **ТОЛЬКО ЧИТАТЬ. Golden master для сверки поведения. Не изменять, не удалять** |
| Новый фронтенд (наш) | `webq98/` | 5175 | `npm run dev`, `npm run build`, `npm run lint` |
| whisper.cpp (STT) | внешний сервис | 8081 | доступен через бэкенд |

- Прокси из vite: `/api` → :3000, `/ws` → :3000 (ws:true), `/vad-assets` → :3000.
- Бэкенд должен быть запущен (`npm start` на сервере), иначе API вернёт сетевые ошибки.

## 3. ЖЕЛЕЗНЫЙ КОНТРАКТ БЭКЕНДА

Никаких предположений. Всё ниже проверено по коду бэкенда и эталонному фронтенду.

### 3.1 POST /api/chat — ГЛАВНЫЙ эндпоинт
- **Запрос: multipart/form-data**, заголовок **X-Provider: 'ollama' | 'llama_cpp'**.
- Поля FormData (имена точные, НЕ выдумывать):
  - `message` — текст сообщения (НЕ `question`!)
  - `model` — имя модели
  - `sessionId` — UUID сессии (отправляем в `viewingSessionId`)
  - `questionId` — генерируется ФРОНТОМ, формат `q_{n}_{Date.now()}` (например `q_3_1730000000000`)
  - `contextLength` — число, опционально
  - `retainPercent` — число, по умолчанию 80
  - `includeQuestionIds` — **JSON.stringify(string[])** — id вопросов, включённых в контекст
  - `file` — одиночный File (PDF/DOC/XLS/изображение), опционально
  - `codeFiles` — несколько файлов (append для каждого), опционально
- **Ответ: обычный JSON. СТРИМИНГА НЕТ.** Читаем `response.json()`.
  ```ts
  {
    response: string;              // markdown
    metrics?: { tps, promptTps, ttft, loadTime, totalTime, inputTokens, outputTokens };
    imageData?: { thumbnailUrl, fullUrl, filename };
    contextInfo?: { contextSize, totalChars, includedQAPairs, totalQAPairs };
    excludedIndices?: number[];    // НОМЕРА Q, исключённые из контекста
  }
  ```
- Ошибки: `503 {error}` провайдер недоступен (показываем сообщение + предлагаем сменить провайдера); прочие статусы `{error}`; при тексте ошибки с `ECONNREFUSED` — человекочитаемое пояснение.

### 3.2 Провайдеры и модели
- `GET /api/providers/status` → **`{ providers: [...] }`** — ОБЁРТКА-ОБЪЕКТ, не массив!
  Каждый: `{ name, status: 'connected'|'disconnected'|'checking', latencyMs?, error? }`.
- `GET /api/models` (заголовок X-Provider) → `{ connected: boolean, models: [{ name, size, contextLength?, type? }] }`, `type: 'vision'` помечаем иконкой.
- `POST /api/show` `{name}` (X-Provider) → детали. Контекст-длина извлекается по цепочке:
  `model_info[*context_length*]` → `parameters.context_length` → `models[].contextLength`.

### 3.3 Сессии и сообщения
- `GET /api/sessions?search=&limit=&offset=` → `Session[]`
- `GET /api/sessions/:id` → `Session` (`{id, title, category, sysprompt, message_count, model?, provider?, created_at, updated_at}`)
- `POST /api/sessions` `{title?}` → `Session`
- `PATCH /api/sessions/:id` `{title?, category?, sysprompt?}`
- `DELETE /api/sessions/:id`
- `GET /api/sessions/:id/messages` → **Q&A-пары** («Вариант B»), НЕ плоские сообщения:
  ```ts
  { questionId, questionText, answerText, model,
    attachments_meta | attachmentsMeta,   // ⚠️ поле может прийти в snake_case ИЛИ camelCase — нормализуем ОБА
    metrics, image_data | imageData }
  ```
- `DELETE /api/sessions/:id/messages/:questionId` → `{ deletedMessages, deletedAttachments }`
- ⚠️ `/qa-pairs` и `/context-config` — существуют в старом коде, но эталоном НЕ вызываются, работа не подтверждена. **НЕ ИСПОЛЬЗОВАТЬ.** Конфигурация контекста живёт в localStorage (п. 4.3).

- ⚠️ Из apiGateway в ТЗ-1.1 УДАЛЕНЫ методы: getQAPairs, getContextConfig,updateContextConfig, весь attachmentsApi. Это whitelist-решение: не пересоздавать без прямого указания в ТЗ. Study-режим шлёт файлы через /api/chat (FormData), Project-режим (Фаза 5) получит свой контракт отдельно.

### 3.4 STT: `POST /api/stt/transcribe`
- multipart, поле `audio`. Бэкенд пересылает файл в whisper.cpp как **recording.wav / audio/wav**.
- **Требуется настоящий WAV PCM.** WebM присылать НЕЛЬЗЯ (webq98 так делал — ошибка).
- Конвертация на клиенте: MediaRecorder(webm) → `decodeAudioData` → ручная сборка WAV
  (порт функции `bufferToWave` из эталонного `public/script.js`).
- `AudioContext` создавать как `new AudioContext({ sampleRate: 16000 })` — тогда WAV будет 16 kHz.
- Ответ: `{ text, latencyMs }`. Текст **вставляется в поле ввода**, НЕ отправляется автоматически.

### 3.5 WebSocket `/ws/ai-helper` (Фаза 3)
Клиент → Сервер:
- `{ type: 'audio_chunk', role: 'user'|'interlocutor', audioBase64: string(PCM16LE→base64), sampleRate: 16000, format: 'pcm16', timestamp }`
- `{ type: 'request_hint' }`
- `{ type: 'end_session' }` — завершение сессии (посылается в stopCapture)

Сервер → Клиент:
- `{ type: 'transcript', role, text }`
- `{ type: 'hint_token', token }` — поток подсказки по токенам
- `{ type: 'hint_done' }`
- `{ type: 'error', message }`

## 4. Ключевые клиентские механики (нельзя ломать)

### 4.1 Two-pointer sessions
- `activeSessionId` — «текущая рабочая» сессия (цель кнопки Return-to-current).
- `viewingSessionId` — что отображается. **Сообщения всегда отправляются в viewingSessionId.**
- Загрузка истории: `viewing = id`, `active` не трогаем; кнопка «Return to current» видна при `viewing ≠ active`.
- Return to current: `viewing = active`, перезагрузить сообщения.
- Отправка при `viewing ≠ active`: после успешной отправки `active := viewing`.
- **New Chat / Clear Chat:** архивировать просматриваемую (если `title` пуст или начинается с `unsavedSession` → переименовать в `unsavedSession {N}`, где N = число сессий с таким префиксом + 1; иначе оставить title), создать новую сессию, `active = viewing = новая`.
  *(Отклонение от эталона: там `active` указывал на архивированную — признано багом.)*

### 4.2 questionId
- Всегда фронтовый формат `q_{counter}_{Date.now()}`. `counter` — номер Q&A в сессии.
- При удалении пары — перенумерация ОТОБРАЖАЕМЫХ номеров (Q1, Q2…), сами id не меняются.

### 4.3 Контекст (standard/manual)
- Per-session в localStorage: ключи `contextMode_{sessionId}` и `selectedIds_{sessionId}` (JSON).
- standard: `includeQuestionIds` = все id вопросов; чекбоксы disabled.
- manual: только выбранные; кнопки All/None. Переключение в standard → selected = все.
- Просмотр исторической сессии → принудительно standard.
- Контекст-бар: `pct = round(totalChars / (contextSize * 4) * 100)`; цвет: ≤50% зелёный `#10b981`, ≤75% янтарный `#f59e0b`, иначе красный `#ef4444`; подпись `{included}/{total} Q&A • {pct}%`.

### 4.4 System Prompt
- `DEFAULT_SYSPROMPT = "Ты Senior Developer. Отвечай четко, структурированно и по существу. Ты мыслишь архитектурно, производительность, системность."`
- Если `session.sysprompt` пуст → в textarea подставляем дефолт.
- Сохранение: PATCH при потере фокуса (blur) + ПЕРЕД отправкой, если значение изменилось (await PATCH, потом send).

### 4.5 Статистика
- `totalInputTokens`/`totalOutputTokens` аккумулируются за сессию.
- ContextLoad% = `round((in+out) / contextLength * 100)`.
- TPS-модалка: tps, promptTps, ttft, loadTime, totalTime + накопленные токены.

### 4.6 Markdown
- `react-markdown` + `remark-gfm`. Никаких самописных парсеров.

## 5. Стек и правила кода

- React 18 · TypeScript 5.8 (strict) · Vite 6 · Zustand 5 · Tailwind 4 (@tailwindcss/vite, typography, tw-animate-css) · react-router 7 · react-markdown + remark-gfm · sonner · lucide-react · Radix (только подключённые примитивы) · cva/clsx/tailwind-merge · @ricky0123/vad-web 0.0.30 · vitest · jsdom.
- **Запрещённые зависимости** (сняты/не добавлять): react-query, framer-motion, cmdk, react-hook-form, zod, dnd-kit, Vaul, next-themes, Socket.IO.
- **HTTP-вызовы — только через `src/lib/apiGateway.ts`.** Сырой `fetch` в компонентах/stores запрещён.
- WebSocket — только через отдельный модуль `src/lib/aiHelperSocket.ts` (Фаза 3).
- Новые зависимости — только если явно указаны в ТЗ.
- `npm run build`, `npm run lint` и и `npm run test:run` обязаны проходить. TS strict, без `any` (кроме нормализации snake/camel с комментарием).
- Коммит на каждое ТЗ: `TZ-N.M: краткое описание`.
- **Zustand-подписки:** селектор в useStore() должен возвращать СТАБИЛЬНУЮ ссылку
  (поле state или примитив). Запрещено вызывать в селекторе функции, создающие
  новые объекты/массивы (selectQuestions(s) и т.п.) — это бесконечный цикл
  useSyncExternalStore. Деривация — только через useMemo от стабильных полей.

## 6. Дизайн-система (Leteem, адаптированная)

- Токены цветов — CSS-переменные, темы через `data-theme` на `<html>`: `leteem` (по умолчанию, синяя), `besafe` (зелёная), `minimal` (монохром). Тёмный режим — класс `dark` на `<html>`.
- Токены: background, foreground, card(+fg), popover(+fg), primary(+fg), secondary(+fg), muted(+fg), accent(+fg), tertiary(+fg), destructive(+fg), border, input, ring, **message-own(+text), message-other(+text), content-text**, success, warning, online-status. Радиусы от `--radius: 0.625rem`. Шрифт Inter.
- **Адаптации против мессенджерного оригинала (обязательны):**
  1. Сообщения — карточки на всю ширину колонки (токены message-own/other для фона/текста), НЕ пузыри `max-w-xs`: в узких пузырях нечитаемы markdown-таблицы и код.
  2. Экстремальные радиусы (`rounded-[2rem+]`) — только для input-пилюли, модалок, крупных кнопок. Внутри плотных панелей — `rounded-lg/xl`.
  3. Текст сообщений/markdown — токен `content-text` (нейтральный), НЕ бирюзовый foreground. Бирюза — заголовки, акценты, ссылки.
- Glassmorphism (backdrop-blur + полупрозрачные фоны) — на панелях. Анимации — tw-animate-css (fade/zoom/slide). Никакого Framer Motion.
- Точная палитра тем — в `src/css/themes/*.theme.css` (создаются в ТЗ-0.2).
- Spacing-система (добавлено, решение 71)
  - Шкала — стандартная Tailwind (кратна 4). Источник отступов — ЭТА таблица, НЕ эталон.
  - Зазоры панелей и от краёв: `gap-2 p-2` (8px)
  - Внутренний padding панелей: `p-4`
  - Карточки (сообщения, сессии, вопросы): `p-4`
  - Внутрикардочный ритм: 8–12px (`gap-2` / `mt-2..3`)
  - Плотные данные (правая панель): `space-y-1..1.5`
  - Мин. отступ текста от любой границы: 12px
  - Эталон = источник СТРУКТУРЫ и эргономики; spacing — из этой таблицы.

## 7. Отклонения от эталона (журнал решений)

| # | Решение | Причина |
|---|---|---|
| 1 | react-markdown+GFM вместо самописного парсера | надёжность, таблицы из коробки |
| 2 | clearChat/New Chat: оба указателя → новая сессия | баг эталона (active→архив) |
| 3 | sysprompt: PATCH на blur + перед отправкой | надёжнее, чем только перед отправкой |
| 4 | AI Helper — in-app draggable overlay | проще, протокол не меняется |
| 5 | STT: AudioContext sampleRate 16000 | whisper.cpp ожидает 16 kHz |
| 6 | Дизайн Leteem вместо исходного | решение владельца |
| 7 | Комментарии «createContextualApi» заменены (ТЗ-0.1-fix) | функция не существует — галлюцинация агента |
| 8 | FOUC-fix: инлайн-скрипт в index.html до гидрации (ТЗ-0.2-fix) | устраняет вспышку светлой темы при dark |
| 9 | Глобальный transition 200ms на background/color/border | плавная смена тем |
| 10 | sendMessage живёт в sessionStore (не в chat-area) | единая точка контракта, ТЗ-1.2 |
| 11 | Контекст-состояние: state = contextMode + selectedQuestionIds + retainPercent; qaPairs удалён (деривация из messages) | одна модель данных, §4.3 |
| 12 | Manual-режим отправляет selectedQuestionIds как есть (новый вопрос может не входить) | поведение эталона сохранено |
| 13 | selectedProvider/selectedModel восстанавливаются из localStorage при init | паритет с эталоном loadSelectedProvider |
| 14 | init: при ?session= активная сессия восстанавливается/создаётся ДО switchToViewing | семантика буфера активной сессии |
| 15 | sendMessage ловит ApiError → bot-сообщение «Network error» | паритет эталона |
| 16 | Sidebar «New Chat» пока на старой семантике; подключение к clearChat/newChat — ТЗ-2.3 | граница ТЗ-1.2 |
| 17 | attachmentsMeta строит store в optimistic user-сообщении ({name,size}) | бейджи видны сразу |
| 18 | 503/тосты недоступности содержат fallback-подсказку | паритет эталона |
| 19 | Один doc/image-слот; избыток — с toast-предупреждением | честный UX вместо тихой потери |
| 20 | Структура интерфейса = эталон (панели/кнопки/расположение), стиль = Leteem (Фаза 4) | решение владельца, Фаза 1.5 |
| 21 | Вариант A: сайдбар сессий НЕ монтируется в лейаут; доступ к беседам — Load-модалка (ТЗ-2.3) + Dashboard; sidebar.tsx сохранить как основу Load-модалки | чистый эталон |
| 22 | TopBar не монтируется; функции: Dashboard/Save/AI Helper → шапка чата (эталон), тема-меню → иконка Palette в шапке (единственное видимое расширение), Cmd+K палитра остаётся (невидимое расширение), toggle-панели убираются | вариант A |
| 23 | retainPercent-слайдер остаётся в правой панели (мелкое расширение); mode-переключатель переезжает в левую панель как в эталоне | п. 21 |
| 24 | Dashboard-роут = отдельная страница без боковых панелей, шапка с «← Back to Chat» (эталон) | п. 21 |
| 25 | Вопросы в UI деривируются в компоненте (useMemo от messages); selectQuestions в store удалён | Zustand-паттерн §5 |
| 26 | data-атрибуты: data-question-id = карточка левой панели, data-chat-question-id = группа Q&A в чате | уникальные цели скролла |
| 27 | retainPercent: доля окна модели на контекст (system+история+вопрос); остаток — резерв под ответ; обрезка LIFO на бэкенде | §3.1 |
| 28 | contextMode_/selectedIds_ — кэш UX-непрерывности на беседу (переживает F5 и переключение); семантически это параметры запроса, но хранение защищает от тихого возврата в Standard после перезагрузки; чистка — при удалении сессии (ТЗ-2.3) и clearChat | детерминизм режима |
| 29 | Prev/Next на краях — disabled-кнопки (вместо toast-паритета эталона) | понятнее UX, guard остаётся как защита |
| 30 | Контекст-состояние (mode/выбор) редактируется ТОЛЬКО при viewing===active; исторические сессии read-only; returnToCurrent восстанавливает loadContextState | защита от затирания состояния активного буфера |
| 31 | context-notice живёт только на свежем ответе (excludedIndices не персистятся в БД) | паритет эталона |
| 32 | Доступ к беседам: Load-модалка (шапка) + Dashboard через /?session=; purge ключей при удалении | закрытие контура two-pointer |
| 33 | sidebar.tsx/top-bar.tsx — DEPRECATED-пометка, файлы хранятся | §7.21 |
| 34 | Заголовки бесед в Load-модалке — как в БД (unsavedSession N различимы) | идентифицируемость |
| 35 | Список Load-модалки перезагружается при каждом открытии | свежесть |
| 36 | Удаление active-беседы → новая сессия (startFreshAfterDelete); только viewing → returnToCurrent | целостность two-pointer |
| 37 | Шапка чата: Delete (Trash2, насовсем, shared deleteSession) и Clear (Archive, архив+новый) — раздельные действия; delete-логика едина для Dashboard и шапки | решение владельца, анти-путаница |
| 38 | Внутриприложная навигация к сессии — только прямой switchToViewing(id) (Load-модалка, Dashboard, палитра); ?session= — точка входа (ввод URL/закладки), init() одноразовый | SPA: navigate() не перезагружает страницу |
| 39 | HTTP 503 → ApiError ловится в sendMessage, отдельная ветка '⚠️ is unavailable' + refreshStatus (паритет эталона); 'Network error' — только статус 0 и прочие ошибки | найдено тестами ТЗ-2.5 |
| 40 | Стратегия тестов: vitest+jsdom; новое store/gateway-поведение — тест в том же ТЗ; красный-тест-перед-фиксом для багфиксов | стандарт процесса |
| 41 | Вложения истории: бейджи attachmentsMeta под вопросом, imageData-превью в ответе (клик → full, порядок эталона: notice→image→text) | паритет эталона |
| 42 | formatSize — в lib/utils как чистая функция (тестируемая) | §7.40 |
| 43 | STT: WebM→WAV конвертация на клиенте (bufferToWave, lib/audio.ts), sttApi (НЕ raw fetch), текст в input | §3.4 |
| 44 | sendMessage: прочие ApiError → '❌ Error {status}' с реальным статусом | точность сообщений |
| 45 | Vision на GGUF: ограничение detectModelType бэкенда; НЕ фиксим на фронте (решение A — отложено) | граница ответственности |
| 46 | Экспорт бесед: downloadJson в lib/export (общий), формат [{sessionId, messages}] для bulk | паритет эталона dashboard.js |
| 47 | Поиск Dashboard — только серверный (локальный filter удалён) | одна фильтрация |
| 48 | Фаза 2 закрыта: полный паритет с эталоном; 42 теста; UI-реестр U1–U4 отложен в Фазу 4 | milestone |
| 49 | AI Helper (текущий overlay) — мёртвый фасад, НЕ отлаживать до Фазы 3, переписывается целиком | экономия времени |
| 53 | «Подсказать» заменяется на «💬 Отправить в чат»: склейка транскриптов с ролями [Я]/[Собеседник] → sendMessage → очистка окна; hint-стриминг остаётся в транспорте, UI убран | решение владельца, сценарий собеседования |
| 54 | vad-assets ТОЛЬКО через прокси с бэкенда (1.22.0); НИКАКИХ скачиваний ort/onnx (ссылка 1.29.0 — ловушка); AudioNodeVAD не существует в 0.0.30 | docs/AI_HELPER_STT.md §8 |
| 55 | Авто-мост onTranscribe (ТЗ-3.1) удаляется в 3.3; транскрипты → чат только явной кнопкой | семантика подтверждена владельцем |
| 56 | stopCapture отправляет end_session (протокол дополнен по docs §5.2) | завершение сессии на бэкенде |
| 57 | Send-to-chat: buildTranscriptText ([Я]/[Собеседник] склейка) → sessionStore.sendMessage → очистка transcripts при успехе; при ошибке — сохранены | сценарий собеседования, решение 53 |
| 58 | onnxruntime-web пин 1.22.0 (точный) в webq98: npm-резолв 1.29.0 несовместим с бэкендовскими wasm-ассетами | находка ТЗ-3.2, §8 дока |
| 59 | Авто-мост onTranscribe удалён; Connect/Disconnect (debug 3.1) убраны из UI | решения 55/53 |
| 60 | Send-to-chat гонка: при успехе удаляются ТОЛЬКО отправленные транскрипты (снимок по ссылке); речь во время генерации ответа сохраняется | защита от тихой потери |
| 61 | Отказ sendMessage из helper → тост с причиной (guards) | UX-консистентность |
| 62 | Фаза 4 стартует: кожа ПОСЛЕ структуры (§7.20); три адаптации §6 — закон; AI Helper и Dashboard — отдельные мини-ТЗ после 4.3 | порядок работ |
| 63 | Кожа Фазы 4: глубина = радиальные световые пятна на body (CSS-only, аналог space.svg оригинала); glass читаем только над неоднородным фоном; калибровка 6% = невидимо, рабочие значения 8–14% | урок ТЗ-4.1: переносить ЭФФЕКТ, а не только числа |
| 64 | Tailwind 4: кастомные утилиты — ТОЛЬКО через @utility; @layer utilities не генерирует классы (молча) | урок ТЗ-4.1, ловушка миграции v3→v4 |
| 65 | glass/glass-strong — обычные CSS-классы вне слоёв (unlayered бьёт TW-слои, гарантия бандла); @utility-гипотеза снята | прагматизм над чистотой |
| 66 | Текстура фона — CSS dot-grid (1px, foreground/0.05, 22px) вместо space.svg; даёт блюру высокочастотное содержимое | ответ «blur невидим над градиентами» |
| 67 | Приоритет Фазы 4: читабельность (4.2) > остатки стекла; мерцание U2 — кандидат: smooth-scrollIntoView на больших сессиях → мгновенный scrollTop | решение владельца |
| 68 | АННУЛИРОВАНО решением 71 (ранее: gap/p 7px из эталона; заменено на gap-2 p-2 по spacing-системе §6) | см. 71 |
| 69 | DevTools-диагностика glass: инспектировать aside (Ctrl+F по классу), не вложенный overflow-контейнер (улики: display:block+flex-grow при отсутствии flex-классов) | метод |
| 70 | ЧАСТИЧНО аннулировано решением 71: ревизия отступов обязательна, но по spacing-системе §6 (НЕ по эталону); markdown-таблицы display:block+overflow-x — актуально | см. 71 |
| 71 | Spacing-система определена явно (таблица в §6): шкала 4px, эталон больше НЕ источник spacing — только структура/эргономика | вопрос владельца |

## 8. Запрещено

1. Изменять бэкенд и `public/` (эталон).
2. Предполагать стриминг `/api/chat`.
3. Вызывать `/qa-pairs`, `/context-config`.
4. Сырой fetch/WebSocket вне выделенных модулей.
5. Добавлять зависимости или менять версии пакетов без ТЗ.
6. Ломать two-pointer семантику и форматы id.

## 9. Definition of Done (для любого ТЗ)

- [ ] `npm run build` — успех; `npm run lint` — без ошибок.
- [ ] Приложение запускается на :5175, консоль браузера без новых ошибок.
- [ ] Все пункты «Критерии приёмки» ТЗ выполнены и проверены против **реального бэкенда** (:3000).
- [ ] Поведение сверено с эталоном на :3000, где применимо.
- [ ] npm run test:run — все тесты зелёные (с ТЗ-2.4)
- [ ] Коммит создан.


## 10. Карта репозитория (для агентов)

Корень: `/home/selub/Documents/progs/chat-app/`
Все пути в ТЗ — относительно `webq98/`, если явно не сказано иное.
Перед чтением файла сверяй путь с этой картой. Если файл не найден —
ищи от `webq98/`, НЕ от корня репозитория.

```
chat-app/
├── docs/AI_HELPER_STT.md  # STT-подсистема: версии, протокол, грабли (читать в ТЗ-3.2/3.3)
├── server/                        # БЭКЕНД — не изменять
│   └── src/ (controllers, services, providers, routes)
├── public/                        # ЭТАЛОН — только читать
│   ├── index.html, script.js, style.css, apiGateway.js, logger.js
│   ├── dashboard.html, dashboard.js
│   └── ai-helper-overlay.html, ai-helper.js
└── webq98/                        # НАШ ФРОНТЕНД — вся работа здесь
    ├── PROJECT_CONTEXT.md         # эта конституция
    ├── package.json, vite.config.ts, eslint.config.js, index.html
    └── src/
        ├── main.tsx, index.css
        ├── app/                   # App.tsx, ThemeProvider.tsx
        ├── lib/                   # apiGateway.ts, logger.ts, utils.ts (scrollToQuestion)
        ├── stores/                # sessionStore.ts, providerStore.ts, uiStore.ts
        ├── types/index.ts
        ├── components/ui/         # button, dialog, select, switch, tooltip, dropdown-menu
        ├── features/
        │   ├── chat/components/chat-area.tsx        # средняя колонка целиком
        │   ├── questions/components/questions-panel.tsx   # левая панель
        │   ├── models/components/settings-panel.tsx       # правая панель
        │   ├── sessions/components/save-modal.tsx
        │   ├── dashboard/components/dashboard.tsx
        │   ├── ai-helper/components/ai-helper-overlay.tsx
        │   └── stt/components/stt-input.tsx         # переписывается в ТЗ-2.5
        └── shared/components/     # sidebar.tsx, top-bar.tsx (не монтируются,
                                   #  сохранить как скелет Load-модалки), command-palette.tsx
```

## 11. Бэклог бэкенда (следующая инициатива после фронтенда)
1. detectModelType: vision-поддержка GGUF/mmproj-моделей (Qwen3.8-... отфильтровывается, §7.45)
2. attachments: сохранять пути/метаданные присланных файлов в БД (сейчас — только в тексте сообщения)
3. (из §7.27) Архивация: timestamp-суффикс против дублей unsavedSession N
4. Чистка backend/package.json: фронтовые devDeps, дубль vitest, проверить актуальность form-data (см. §5.3 документации — глобальный FormData вместо него)
