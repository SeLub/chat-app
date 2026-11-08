# WORKLOG — журнал решений и фаз

> Ведёт Исполнитель. Формат: запись на задачу (контекст → решения → фазы/статусы → итог).
> Регламент см. в `WORKFLOW.md`.

---

## 2026-11-07 — Инициализация рабочего процесса

**Контекст.** Первая сессия: клонирование репозитория в песочницу агента, проверка доступа на чтение и запись, формализация регламента совместной работы.

**Решения.**
1. Рабочая ветка агента — `qwen` (уже существовала на origin, агент работает в ней; на момент начала сессии ветка на 21 коммит впереди `main`).
2. Регламент совместной работы зафиксирован в `WORKFLOW.md` v1.0 (цикл: ТЗ → анализ → обсуждение/фиксация → исполнение по фазам → проверка → фикс → PR → ревью → merge только за Заказчиком).
3. Журнал решений — `WORKLOG.md` в корне репозитория, ведёт Исполнитель, коммитится вместе с фазами работ.

**Проверки доступа.**
- Чтение: clone + чтение истории — OK.
- Запись: коммит + push в ветку `qwen` — OK (см. коммит инициализации).

**Статус:** выполнено. Ожидаю ТЗ первой задачи (Фаза 0).

---

## 2026-11-08 — ТЗ «Миграция фронтенда на React + доработка attachments»: сверка и фиксация решений (Фазы 0–2)

**Контекст.** Владелец предоставил ТЗ (`plans/final-migration-to-react.md`, фазы A–F). Репозиторий синхронизирован: 58 коммитов владельца (включая `webq98/` и `webq98/PROJECT_CONTEXT.md`) поверх коммита регламента.

**Сверка ТЗ.** Все пункты подтверждены кодом, ложных утверждений нет: A.1 (`providerStore.ts:71-75,77-97`), A.2 (`tooltip.tsx:18` z-50), A.3 (`apiGateway.ts:121,157,165`), A.5/A.6 (`stt-input.tsx:27,34`), A.7 (`src/services/contextBuilder.js:42`), A.8 (`vadManager.ts:41-65`), A.9 (`ai-helper-overlay.tsx:100`), A.10 (`:154`), B.1 (`chatRoutes.js:11`), B.2 (`chatController.js:157`), C.1 (`App.tsx:31-33`), D.1 (`dashboard.tsx:31`), D.2 (`command-palette.tsx:37`), D.3 (`load-modal.tsx:72-75`). Конституция прочитана полностью, противоречий нет (§7.49 аннулируется решением 112 ТЗ).

**Решения (подтверждены владельцем 2026-11-08).**
1. Пути бэкенда: правим по факту в `src/` (структура `server/` в репозитории отсутствует).
2. E.2 (Playwright E2E) → `BACKLOG.md`, в этом треке не реализуем.
3. C.4 (статус-точки провайдеров) → `BACKLOG.md`, SKIP.
4. B.4 (`filesContextChars`) — SKIP.
5. F.6 (чистка корневого `package.json`) — выполняется **после приёмки этого ТЗ**.
6. A.4/D.4/D.5 — дубли (A.1/A.6/A.10), исполняются один раз в Фазе A.
7. Формат коммитов трека: `TZ-<фаза>.<пункт>` (`TZ-A.1`, …, `TZ-F.5`).

**План работ:** PR-1 = Фаза A (критические фиксы) → PR-2 = Фаза B (attachments в БД) → PR-3 = Фаза C (демонтаж правой панели) → PR-4 = Фаза D (UX-паритет) → PR-5 = Фаза E (unit-тесты + регрессия; E.2 в бэклоге) → PR-6 = Фаза F (переключение статики, архивация `public/`).

**Статус:** решения зафиксированы. Фаза A — в работе.

---

## 2026-11-08 — Фаза A: критические фиксы (TZ-A.1–A.10) — выполнена

**Сделано** (каждый пункт: красный тест → фикс → зелёный, §7.40).
- **A.1** `providerStore.setCurrentProvider`: сброс `currentModel/modelDetail/currentContextLength` до `loadModels`; авто-выбор единственной модели нового провайдера (фильтр по `m.provider`, guard от гонки). Тесты A.1.1–A.1.3 (красные до фикса).
- **A.2** `TooltipContent`: `z-50` → `z-[60]`, `collisionPadding={12}` сохранён. Аудит `chat-area.tsx`: конфликтующих `z-*` у StatFooter/контекст-бара/шапки НЕ обнаружено — правка только в tooltip. Ручная приёмка (тултип поверх статистики) — за владельцем.
- **A.3** `apiGateway`: `chatApi.send`, `modelsApi.list/show`, внутренний `request` — `provider: ProviderName`; `providerStore.loadModels` тоже `ProviderName` (каст удалён). Тест 8a: `'llama.cpp'` в localStorage → fallback по приоритету §7.92 (поведение init уже было корректным — тест закрепляет контракт).
- **A.5** `normalizeTranscript()` в `lib/audio.ts` + вызов в `stt-input.tsx`; append в `chat-area.tsx:934` не вставляет второй пробел. Тесты 8–10.
- **A.6** `AudioContext` кэшируется в `useRef` (lazy init), `close()` в cleanup; `bufferToWave(…, 16000)` — явная фиксация 16 kHz для STT-пути. Тесты 6–7.
- **A.7** `src/services/contextBuilder.js`: фильтр по `Array.isArray(includeQuestionIds)` — `null` = все пары, `[]` = 0 пар; `excludedIndices` при `[]` = `[1..N]` (подтверждено чтением кода). Фронт-тест 8b закрепляет контракт `sendMessage`. Бэкенд-vitest не настроен (нет скрипта) → по ТЗ покрыто фронт-тестом.
- **A.8** `vadManager.startDualVad`: ресурсы в try/catch; при любой ошибке (отказ в микрофоне и т.п.) — stop tracks + destroy VAD + rethrow. Приёмка ручная.
- **A.9** overlay: `onClick={() => void (isCapturing ? stopCapture() : startCapture())}` — без unhandled rejection.
- **A.10** `Sparkles` из `lucide-react`, локальная SVG-копия удалена.

**Гейты:** `npm run build` ✓ · `npm run lint` ✓ (max-warnings 0) · `npm run test:run` ✓ **83/83** (было 73, +10).

**Отклонения от буквы ТЗ (с Reasons):**
- A.5: чистка вынесена в чистую функцию `normalizeTranscript` вместо inline — покрыта юнит-тестами (решение 111).
- A.6: «подстраховка» — параметр `sampleRateOverride` в `bufferToWave`, а не хардкод внутри: функция остаётся точным портом эталона, его тесты не ломаются.
- A.4/D.4/D.5 — дубли, отдельно не исполнялись (решение от 2026-11-08, п. 6).

**Ручная приёмка (в песочнице нет Ollama/llama.cpp/whisper — за владельцем):** A.1 (смена провайдера в UI), A.2 (тултип поверх статистики), A.5 (STT-фраза → одна строка), A.6 (10 транскрипций подряд), A.7 (Manual+все сняты → `excludedIndices=[1..N]`, `includedQAPairs=0`), A.8 (отказ в микрофоне → захват не остаётся), A.9 (отмена шаринга → консоль чистая).

**Статус:** ✅ **merged** (PR [#2](https://github.com/SeLub/chat-app/pull/2), merge `9c1ae1e`; ветка `qwen` удалена по решению владельца).

---

## 2026-11-08 — Поправка в flow: WORKFLOW v1.1 — PR на каждую фазу

**Контекст.** Владелец изменил цикл приёмки: вместо одного PR после всех фаз — PR на каждую фазу.

**Решения.**
1. Каждая фаза завершается открытием PR из `qwen` в `main` (WORKFLOW.md §3, фазы 3/5/6 обновлены, версия 1.1).
2. Следующая фаза не начинается, пока по PR текущей не принят вердикт (merge / фикс).
3. Цикл фикса: новые коммиты в `qwen` автоматически обновляют открытый PR; после merge следующий PR содержит только дельту новой фазы.
4. Статусная модель: `в работе → PR фазы → ревью → (фикс → ревью)* → merged | отклонено | отложено`.

**Итог:** Фаза A прошла по этому циклу (PR #2 → merged). Веха устарела в части ветки `qwen` — см. следующую запись (v1.2).

---

## 2026-11-08 — Поправка в flow: WORKFLOW v1.2 — ветка на каждую фазу; Фаза B стартует

**Контекст.** Владелец смержил PR #2 (Фаза A) и изменил модель веток: ветка `qwen` удаляется, каждая фаза — в отдельной ветке.

**Решения.**
1. WORKFLOW v1.2: каждая фаза — в ветке `tz/phase-<буква>` от свежего `main`; после merge ветка фазы закрывается, следующая фаза стартует от обновлённого `main`.
2. Ветка `qwen` удалена (remote и локально). История Фазы A — в `main` через merge PR #2.
3. Фаза B — в ветке `tz/phase-b`.

**Анализ Фазы B (верификация кода перед исполнением).**
- B.1: `chatRoutes.js:10-13` — multer.memoryStorage подтверждён; лимит 50 MB сохраняем.
- B.2: `chatController.js:157` — `currentAttachments = attachmentMeta || []` подтверждён; фронт поле `attachments` в FormData НЕ шлёт (apiGateway:125-138) → сейчас `attachments_meta` в БД всегда `[]`; `attachmentService.extractFiles` → `attachmentRepo.extractFromPaths` → `{ results: [{fileId,name,size,type,path}], errors }` — контракт совпадает с ТЗ.
- **Критический нюанс B.1:** потребители `file.buffer` (`fileService.processDocument/processCodeFiles`, image-ветка `chatController.js:58-59`) при diskStorage получают `buffer === undefined` → ветки документов/кода/картинок ломаются. Решение: chatController восстанавливает буфер чтением с диска (`fs.readFile(file.path)`) в начале обработки — сервисы не трогаем (минимальный диф), extractFiles получает путь.
- **Обнаруженный разрыв контракта:** `GET /api/sessions/:id/messages` (`getQAPairs`, contextBuilder.js:189-194) НЕ выбирает `attachments_meta`/`metrics`/`image_data` из messages → после F5/Load бейджи вложений не рендерятся, хотя фронт (`mapQAPairsToMessages`) их ждёт и контракт API (ТЗ §API) это требует. Без правки `getQAPairs` приёмочный пункт «attachmentsMeta-бейджи рендерятся» невыполним → включаем в Фазу B отдельным пунктом (B.2b), обоснование в PR.
- B.4 (`filesContextChars`) — SKIP (решение владельца); `buildLLMContext` уже читает `attachments_meta` (contextBuilder.js:120-128) — контекстная сторона заработает после B.2.
- **Инфраструктура тестов:** в репо есть `tests/db/*.test.js` (node:test) от владельца, но они сломаны: импортируют `setDbPath`, которого нет в `src/db/init.js`; скрипта запуска нет. Включаем: добавляем `setDbPath`/скрипт `test:backend` (enabler-коммит до TZ-B.*), тесты Фазы B — в той же конвенции (node:test + `:memory:`).
- B.3: cleanup — try/finally вокруг тела chatHandler, `fs.promises.unlink(...).catch(()=>{})`, директорию `uploads/tmp` не удаляем.

**Исполнение Фазы B (ветка `tz/phase-b`, каждый пункт: красный тест → фикс → зелёный).**
- `269fb62` docs: регламент v1.2 + анализ фазы.
- `d559b32` **enabler**: `setDbPath` в `db/init.js` (тесты владельца импортировали несуществующий экспорт), скрипт `test:backend` (node --test glob), тест-онли фиксы: WAL проверяется на файловой БД (на `:memory:` WAL невозможен), FK-проект в сетапе sessionRepo, детерминированный порядок `updated_at`. Итог: 44/44 → **52/52** с тестами Фазы B.
- `82aac57` **B.1**: `chatRoutes` → `multer.diskStorage` (`uploads/tmp/`, паттерн имени из ТЗ + санитизация разделителей пути против traversal, лимит 50 MB сохранён). Контроллер восстанавливает `buffer` чтением с диска — сервисы `fileService`/`imageService` не тронуты, все ветки (документы/код/изображения) работают. Тест: файл только с path (без buffer) обрабатывается.
- `3066e6a` **B.2**: `extractFiles([path], sessionId)` до `addMessage` для doc-файла и каждого codeFile; `currentAttachments` = свежие `{fileId,name,size,type}` (серверный путь в meta не утекает); ошибки — log.warn + продолжение. Тесты: строка в `attachments` + fileId в `attachments_meta`; 2 codeFiles → 2 строки/2 fileId; без файлов → `[]`.
- `92e2265` **B.2b** (разрыв контракта, обнаружен при анализе): `getQAPairs` теперь возвращает `attachments_meta`, `metrics`, `image_data` (сырые JSON-строки — паритет эталону `public/script.js:156`, фронтовый `parseLoose` понимает оба вида). Без этого после F5/Load не рендерятся бейджи/превью и приёмка Фазы B невыполнима.
- `f76c589` **B.3**: `finally` вокруг тела chatHandler — `fs.promises.unlink` всех tmp-путей (успех и любая ошибка, включая падение провайдера); директория `uploads/tmp` сохраняется. Тесты: файл удалён после успеха; удалены при 500 от провайдера.
- **B.4** (`filesContextChars`) — SKIP (решение владельца); `buildLLMContext` уже читал `attachments_meta` — контекст следующего вопроса заработал без правок.
- `46918b1` **B.5**: контракт-тест фронта — `mapQAPairsToMessages` не падает от `fileId` в `attachments_meta`, поле доезжает до store (optimistic-сообщение оставлено как есть, по ТЗ).

**Ограничение (вне скоупа ТЗ, к сведению):** `attachmentRepo.extractFromPaths` читает файл как utf-8 — для бинарных PDF/DOC `extracted_text` будет шумом (codeFiles и CSV/текст — корректно). На контекст модели это не влияет (в промпт документа попадает честный текст из `processDocument`); предложение — в BACKLOG как «binary-safe extraction» на решение владельца.

**Гейты на HEAD:** build ✓ · lint ✓ (max-warnings 0) · test:run ✓ **84/84** (+1) · test:backend ✓ **52/52** (+8).

**Ручная приёмка (за владельцем):** отправить PDF → строка в `attachments`, `attachments_meta` с fileId; 2–3 codeFiles → 2–3 строки; F5 → новый вопрос → в логах `fixedChars > 0` (`filesContext` подмешан); бейджи вложений и превью видны после F5/Load; `uploads/tmp` пустеет после запроса; отправка изображения (vision) работает как раньше.

**Статус:** ✅ Фаза B выполнена, гейты зелёные, коммиты `TZ-B.*`. **PR открыт: [#3](https://github.com/SeLub/chat-app/pull/3)** (`tz/phase-b` → `main`, 8 коммитов, 12 файлов, +503/−36). Фаза C — после вердикта.

---

## 2026-11-08 — Вердикт по Фазе C: полный SKIP, PR #4 анулирован; Фаза D стартует (`tz/phase-d`)

**Вердикт владельца.**
1. C.1–C.2 (демонтаж правой панели) и C.4 — **полный SKIP**: PR #4 анулирован (закрыт без merge, [комментарий-верdict](https://github.com/SeLub/chat-app/pull/4#issuecomment-6723989208)), ветка `tz/phase-c` удалена (remote и локально). Правая панель остаётся смонтированной как слот Project-режима.
2. C.3 — правки не нужны (чек-лист подтверждён по коду в PR #4).
3. Баг приёмки Фазы B (пустая таблица `attachments`) — BACKLOG #3; демонтаж панели — BACKLOG #4 (обе записи перенесены в текущую ветку, т.к. первичные коммиты docs остались в анулированной `tz/phase-c`).

**Историческая справка.** Фаза C была технически исполнена в ветке `tz/phase-c` (5 коммитов `27f18b9..3cc0bbb`, guard-тест, гейты: build/lint/test:run 87/87/test:backend 52/52 — все зелёные), но по решению владельца в `main` не вошла. Коммиты доступны в истории GitHub (ветка удалена после закрытия PR #4).

**Инфраструктура.** `main` продвинут прямым коммитом владельца `8d4649f` (chore: `dist/` в `.gitignore`). Фаза D ветвится от `8d4649f`.

**Анализ Фазы D (верификация кода перед исполнением).**
- D.1: `dashboard.tsx:31` — `groupOpen` инициализируется `{}` → все группы свёрнуты (подтверждено: рендер `groupOpen[category] ? …` / `groupOpen[category] && …`, строки 244/253). Решение плана — инвертировать семантику: «развёрнута, если явно не закрыта». Чистая функция `isGroupOpen(groupOpen, category)` в `lib/utils.ts` (red-first тест в `utils.test.ts`), используется в toggle (241) и рендере (244/253).
- D.2: `command-palette.tsx:33-39` — `else`-ветка сбрасывает только `showSessions`, `sessions` остаётся (подтверждено). Фикс по плану: `setSessions([])` в `else`-ветке.
- D.3: `load-modal.tsx:72-75` — `await switchToViewing(id)` без обработки ошибки: при reject модалка остаётся открытой + unhandled rejection (подтверждено). Фикс: `try/catch → toast` (паритет с `dashboard.tsx:131-138`) + `finally → closeLoadModal()` — оба варианта плана покрыты.
- Покрытие: D.1 — юнит-тест (решение 111). D.2/D.3 — эффекты внутри компонентов без выделяемой логики; юнит-обёртки не дают ценности, E2E (E.2) — BACKLOG #1 → покрытие ручной приёмкой (E.3: Command palette, Load-модалка).

---

## 2026-11-08 — Фаза D исполнена (TZ-D.1–D.3, гейты зелёные)

**Исполнение (ветка `tz/phase-d`, каждый пункт: красный тест → фикс → зелёный, где применимо).**
- `faab179` docs: вердикт Фазы C (SKIP), BACKLOG #3/#4, анализ фазы.
- `7b9c8fe` **D.1**: чистая функция `isGroupOpen(groupOpen, category)` в `lib/utils.ts` — инвертированная семантика «развёрнута, если явно не закрыта» (`!== false`, решение плана). Использована в трёх местах `dashboard.tsx`: toggle пишет `!isGroupOpen(prev, cat)` (первый клик сворачивает, повторный разворачивает), шеврон и условие рендера списка. Red-first: 4 теста в `utils.test.ts` (default open / явное false / явное true / изоляция категорий).
- `50a4d16` **D.2**: `command-palette.tsx` — в `else`-ветке эффекта (короткий запрос) добавлен `setSessions([])` — старый список больше не «мигает» при следующем вводе.
- `35a432e` **D.3**: `load-modal.tsx` — `handleSelectSession` обёрнут в `try/catch/finally`: ошибка `switchToViewing` → toast «Failed to open conversation» (паритет с dashboard), `finally` закрывает модалку в любом исходе. Оба варианта плана (finally / catch→toast) покрыты одним блоком.

**Гейты на HEAD (`35a432e`):** build ✓ · lint ✓ (max-warnings 0) · test:run ✓ **88/88** (+4, 9 файлов) · test:backend ✓ **52/52**.

**Ручная приёмка (за владельцем):** dashboard — все группы развёрнуты при открытии, клик сворачивает/разворачивает; Cmd+K — при коротком запросе старый список не мелькает; Load-модалка — выбор сессии работает, при ошибке сети/провайдера модалка закрывается с toast.

**Статус:** ✅ Фаза D выполнена (5 коммитов в `tz/phase-d`). **PR открыт: [#5](https://github.com/SeLub/chat-app/pull/5)** (`tz/phase-d` → `main`, 7 файлов, +75/−6). Фаза E — после вердикта.

---

## 2026-11-08 — PR #5 (Фаза D) merged владельцем; Фаза E — верификация и финальный прогон (`tz/phase-e`)

**Статус Фазы D закрыт.** PR #5 merged владельцем (SeLub, 2026-11-08T16:42:35Z, merge-коммит `fcb6bb6`); ветка `tz/phase-d` удалена (remote + локально) по регламенту v1.2. `main` синхронизирован — Фаза E ветвится от `fcb6bb6`.

**Анализ Фазы E (верификация перед исполнением).**

- **E.1 (юнит-тесты для фиксов A–D) — требуемое покрытие уже существует**: по регламенту каждый фикс A–D писался red-first вместе со своим тестом, поэтому все три теста, перечисленные в ТЗ E.1, вошли в `main` ещё в Фазе A:
  - `providerStore.test.ts` — **A.1.1** «смена провайдера сбрасывает currentModel/modelDetail/currentContextLength» (setup через `selectModel('old-model')` → `setCurrentProvider('llama_cpp')` → `currentModel === null`); **A.1.2** авто-выбор единственной модели нового провайдера (§7.93); **A.1.3** несколько моделей → авто-выбора нет. Дублировать их в Фазе E — увеличение счётчика без добавления ценности, не делаем.
  - `sessionStore.test.ts` — **#7** «standard mode, 2 существующих вопроса → `includeQuestionIds` содержит все 3 id» (мок `chatApi.send` захватывает аргумент); **#8b** (TZ-A.7) «manual + все галочки сняты (`selectedQuestionIds=[]`) → `includeQuestionIds=[]` как есть».
  - `audio.test.ts` — уже покрыт (по ТЗ), присутствует в прогоне (9-й файл).
  - Итог E.1: покрытие подтверждено матрицей «пункт ТЗ → тест», новый код не требуется.
- **E.2 (E2E-смоук на Playwright)** — SKIP по решению владельца от 2026-11-08, зафиксирован в `BACKLOG.md` #1 (Playwright в проекте нет, добавление devDep запрещено §8).
- **E.3 (ручная сверка с эталоном)** — чек-лист ТЗ (12 пунктов) + проверка консоли браузера (E.4) переданы владельцу в теле PR (выполняется вручную, автоматизации не подлежит).
- **E.4 (финальный прогон)** — выполнен ниже; `test:e2e` — n/a (E.2 SKIP); «консоль браузера без новых ошибок» — за ручным проходом владельца (E.3).

**Гейты E.4 на HEAD (`tz/phase-e` = `fcb6bb6`):** build ✓ (24.2s) · lint ✓ (max-warnings 0) · test:run ✓ **88/88** (9 файлов) · test:backend ✓ **52/52**. Код ветки идентичен merge-коммиту PR #5 — кодовый диф пуст, прогон валиден для main.

**Статус:** ✅ Фаза E исполнена как верификационная (без кодовых изменений по причине полного покрытия E.1 тестами фиксов A–D). **PR открыт: [#6](https://github.com/SeLub/chat-app/pull/6)** (`tz/phase-e` → `main`, 1 docs-коммит, WORKLOG only, +21/−1; чек-листы E.3/E.4 — в теле PR). Фаза F — последняя.

---

## 2026-11-08 — Фаза F стартует (`tz/phase-f`); анализ и верификация кода перед исполнением

**Ветвление.** PR #6 (Фаза E, docs-only) на момент старта ещё не merged — ветка `tz/phase-f` построена **поверх головы `tz/phase-e` (`b4ccaf1`)**, чтобы два append-а в конец `WORKLOG.md` не конфликтовались. Порядок merge: сначала #6, затем #7 — история линейна; если владелец анулирует #6, его docs-коммиты всё равно доедут в `main` через #7 (чистый docs).

**Анализ Фазы F (верификация кода перед исполнением).**
- F.1: `src/app.js:33` — статика отдаётся из `public/` (подтверждено); роут `GET /ai-helper-overlay.html` (строки 28–30) с COOP/COEP — удалить; SPA-fallback отсутствует (подтверждено). **Отклонение от буквы ТЗ:** сниппет ТЗ с `app.get('*', …)` на Express 5 (path-to-regexp v8) кидает `TypeError` — реализую через завершающий `app.use((req,res,…))` с проверкой метода GET/HEAD и теми же тремя префиксами `/api` `/ws` `/vad-assets` → 404 JSON; остальное → `sendFile(webq98/dist/index.html)`. Семантика ТЗ сохранена.
- F.2: **подводный камень подтверждён** — сейчас `/vad-assets` обслуживается ШИРОКОЙ статикой из `public/` (строка 33); после переключения корня статики на `webq98/dist` vad-assets потеряли бы раздачу. Решение ТЗ (добавить явный `app.use('/vad-assets', express.static('…/public/vad-assets'))` после `coepHeaders`) обязательно к исполнению. Содержимое `public/vad-assets/` самодостаточно: свой `ort-wasm-simd-threaded.wasm/.mjs`, `silero_vad_*.onnx`, worklet-бандлы; фронт ссылается `vadManager.ts:26-27` (`baseAssetPath`/`onnxWASMBasePath` = `/vad-assets/`), dev-прокси vite (`vite.config.ts:34`) ведёт на :3000.
- F.3: в `public/` 10 файлов + `vad-assets/`; корневой `ort-wasm-simd-threaded.wasm` используется только легаси `public/script.js` (новый фронт грузит ORT из `/vad-assets/`) → уходит в архив по варианту А ТЗ (`git mv` пофайлово, всё кроме `vad-assets/`). `public/` остаётся с единственным содержимым `vad-assets/`. Ссылок на `public/` в `src/` кроме `app.js:29,33` нет (проверено grep) — обе правятся в F.1/F.2.
- F.4: `webq98/PROJECT_CONTEXT.md` — решения заканчиваются на #94; добавить 95–112 из таблицы ТЗ с двумя адаптациями под реальные вердикты владельца: **#103** — SettingsPanel остаётся смонтированной (PR #4 анулирован, BACKLOG #4), «слот Project» — фактически; **#111** — E2E Playwright SKIP → BACKLOG #1. §8 — правило read-only архива; §10 — карта репозитория (`public/` → только vad-assets, `docs/reference/public-archive/`, `webq98/dist`).
- F.5: `README.md` (англ.) — секция Setup учит `npm install && npm start` без сборки фронта; добавить «Frontend (webq98/)»: dev на 5175, `npm run build` → `webq98/dist`, бэкенд :3000 отдаёт собранный SPA.
- F.6: root `package.json` devDeps — 11 фронтовых пакетов (`@tailwindcss/forms/typography/vite`, `@types/react(-dom)`, `@typescript-eslint/*`, `@vitejs/plugin-react`, `eslint`, `tailwindcss`, `vitest`) — бэкендом не импортируются (тесты на `node:test`, root eslint-конфига нет), дублируются в `webq98/`. `jsdom` из **dependencies** (не dev) используется `src/services/webService.js` — НЕ трогаем. По ТЗ F.6 «желательно»; lockfile синхронизирую `npm install --package-lock-only --ignore-scripts` (node_modules не меняется).
- Тесты F.1/F.2 (red-first, `node:test`): новый `tests/app/static.test.js` — app поднимается на ephemeral-порту (`app.listen(0)`), `setDbPath(':memory:')` до импорта; фикстура `webq98/dist/index.html` создаётся при отсутствии (dist в .gitignore, реальная сборка не трогается); 7 сценариев: `/` == dist/index.html; deep-route `/dashboard` == index.html (SPA-fallback); `/api/*` miss → 404 JSON; `/ws/ai-helper` (plain GET) → 404 JSON; `/vad-assets/*` miss → 404 JSON; `/vad-assets/vad.worklet.bundle.min.js` → 200 + COOP/COEP; `/ai-helper-overlay.html` → больше НЕ оверлей (== index.html).
