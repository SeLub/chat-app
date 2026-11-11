# WORKLOG — журнал решений и фаз

> Ведёт Исполнитель. Формат: запись на задачу (контекст → решения → фазы/статусы → итог).
> Регламент см. в `docs/WORKFLOW.md` (с R.4 — 2026-11-09 — регламент и журналы живут в `docs/`).

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

---

## 2026-11-08 — Фаза F исполнена (TZ-F.1–F.6, гейты зелёные, live-smoke :3123)

**Исполнение (ветка `tz/phase-f`, red-first где применимо).**
- `9b60e87` docs: анализ фазы (ветвление поверх `tz/phase-e`, подводный камень vad-assets, отклонение Express 5).
- **F.1/F.2**: `src/app.js` — статика → `webq98/dist`; SPA-fallback завершающим `app.use` (GET/HEAD; `/api` `/ws` `/vad-assets` → 404 JSON `{error:'Not found'}`; иначе `sendFile(dist/index.html)` — сниппет ТЗ `app.get('*')` на Express 5 кидает TypeError, семантика сохранена); роут `/ai-helper-overlay.html` удалён вместе со своим COOP/COEP; добавлена ЯВНАЯ статика `app.use('/vad-assets', express.static('…/public/vad-assets'))` после `coepHeaders` — без неё vad-assets потеряли бы раздачу после переключения корня. Red-first: 6/7 тестов красные до фикса (F.2.1 зелёный — работает и сегодня через широкую статику) → 7/7 зелёные после.
- **F.3**: `git mv` пофайлово 10 файлов из `public/` (включая корневой `ort-wasm-simd-threaded.wasm` — его использует только легаси `script.js`; фронт грузит ORT из `/vad-assets/`, проверено по `vadManager.ts:26-27`) → `docs/reference/public-archive/` + README «golden master, не изменять». `public/` теперь содержит только `vad-assets/`.
- **F.4**: `PROJECT_CONTEXT.md` §7 — решения 95–112 (адаптации: #103 — демонтаж панели АННУЛИРОВАН владельцем, панель остаётся слотом Project; #111 — E2E SKIP → BACKLOG #1); §8 п.1 — read-only архива + запрет на vad-assets; §10 — карта репозитория (реальный бэкенд `src/` вместо несуществующего `server/`, `public/` → только vad-assets, архив, `webq98/dist`, актуальные stores/lib); §11 — отметки «ВЫПОЛНЕНО» по п.2 (Фаза B) и п.4 (F.6).
- **F.5**: `README.md` — Setup дополнен сборкой фронта (`cd webq98 && npm install && npm run build` перед `npm start`), новая секция «Frontend (`webq98/`)»: dev :5175 с прокси, `webq98/dist` отдаётся бэкендом :3000, архив легаси read-only.
- **F.6**: root `package.json` — удалены все 11 фронтовых devDeps (`@tailwindcss/*`, `@types/react(-dom)`, `@typescript-eslint/*`, `@vitejs/plugin-react`, `eslint`, `tailwindcss`, `vitest`); `jsdom` (dependencies, используется `webService.js`) не тронут; lockfile синхронизирован `npm install --package-lock-only --ignore-scripts` (−5449 строк, node_modules не менялся), бэкенд-тесты после — зелёные.

**Live-smoke (`PORT=3123 node src/server.js`, реальный dist):** `/` → React `index.html` (`data-theme="leteem"`) ✓ · `/dashboard` → 200 text/html (SPA-fallback) ✓ · `/api/nope` → 404 JSON ✓ · `/vad-assets/silero_vad_v5.onnx` → 200 + COOP same-origin + COEP credentialless ✓ · `/ai-helper-overlay.html` → SPA ✓ · `AI Helper WebSocket server configured on /ws/ai-helper` в логе ✓.

**Гейты на HEAD:** build ✓ (24.8s) · lint ✓ (max-warnings 0) · test:run ✓ **88/88** (9 файлов) · test:backend ✓ **59/59** (+7: tests/app/static.test.js).

**Ручная приёмка (за владельцем, по ТЗ):** `npm run build` (webq98) → `npm start` → :3000 отдаёт React-SPA (`/` — ChatArea+QuestionsPanel, `/dashboard` — Dashboard); AI Helper работает (VAD/WS/whisper — vad-assets с :3000, COOP/COEP навешены); Command palette (Cmd+K), Save/Load/Export; консоль браузера без новых ошибок.

**Статус:** ✅ Фаза F исполнена — последняя кодовая фаза трека «Миграция на React». **PR открыт: [#7](https://github.com/SeLub/chat-app/pull/7)** (`tz/phase-f` → `main`, поверх `tz/phase-e`; 8 коммитов фазы F: 1 docs-анализ + F.1/F.2 + F.3 + F.4 + F.5 + F.6 + docs-исполнена; порядок merge: #6 → #7). Трек «Миграция на React» — все кодовые фазы A/B/D/F исполнены, E — верификация; осталась ручная приёмка владельца (E.3 + приёмка F).

---

## 2026-11-08 — Трек «Миграция на React» завершён (PR #6/#7 merged); закрытие трека: ветки, BACKLOG, план реструктуризации, вердикт по ветке `context`

**Merge-статус.** PR #6 (Фаза E, docs) merged 2026-11-08T17:10:47Z; PR #7 (Фаза F) merged 2026-11-08T17:21:48Z, merge-коммит `57a3ba4` — оба владельцем. `main` синхронизирован.

**Инфраструктура/гигиена веток.** По указанию владельца удалены `tz/phase-e` и `tz/phase-f` (remote + локально) по регламенту v1.2. В репо остались: `main` + `origin/context`.

**Анализ ветки `context` (подсчёт контекста) — вердикт: УДАЛЯТЬ МОЖНО.**
- `origin/context` (tip `9e7d2ad`, 2026-08-19 «feat: STT Whisper integration») — **полный предок `main`** (`git merge-base --is-ancestor` = true): 0 уникальных коммитов, ветка после форка не развивалась ни разу, tip == merge-base. Любой её код уже в `main` (в эволюционировавшем виде), удаления ни одного байта работы не происходит.
- Сравнение реализации подсчёта контекста (tip ветки → `main`), расхождения — только эволюция трека миграции:
  1. **Manual-фильтрация (`cutContext`)**: ветка — `includeQuestionIds.length > 0` (баг: «Manual + все сняты» отправлял ВСЕ пары); `main` — `Array.isArray` (TZ-A.7, решение #100): `[]` = «ничего», `null` = «все».
  2. **Контракт `getQAPairs`**: ветка — `{questionId, questionText, answerText, questionChars, answerChars, totalChars, sortOrder, model}`; `main` — + `attachments_meta`, `metrics`, `image_data` (TZ-B.2b) — бейджи/превью после F5/Load. Ядро подсчёта символов (`content.length` → `totalChars`) НЕ менялось.
  3. **chatController**: ветка — memoryStorage, `currentAttachments = attachmentMeta || []` (клиентская мета, фронт её не слал → вложения никогда не доходили до контекста); `main` — diskStorage + восстановление буфера + `extractFiles` → `{fileId,name,size,type}` + cleanup в `finally` (TZ-B.1–B.3) — только в `main` файлы реально попадают в подсчёт контекста (`filesContext`).
  4. Формула/политика подсчёта НЕ менялись ни там, ни там: символы, `availableChars × retainPercent` (80%-буфер по умолчанию), LIFO-обрезка; pct считался на фронте (`contextInfo.totalChars / maxChars`, легаси `script.js:1288`) → в React то же через `sessionStore.contextInfo` (`contextSize, totalChars, includedQAPairs, totalQAPairs`).
  5. Альтернативной/«другой» реализации подсчёта в ветке НЕТ — в ней нет ни одного коммита сверх общей истории.
- **Рекомендация: `git push origin --delete context`** — исполню по вердикту владельца (сам не удаляю: указание было «выяснить»).

**BACKLOG пополнен (BACKLOG.md):** владелец принял весь отложенный список к реализации в следующем треке (после реструктуризации): #1 E2E Playwright, #2 статус-точки провайдеров, #3 attachments-таблица пуста, #4 демонтаж панели — помечены «к реализации»; добавлены новые: **#5** удаление `public/` (чек-лист ТЗ, vad-assets переезжают), **#6** binary-safe extraction (utf-8 шум для PDF/DOC, наблюдение Фазы B), **#7** code-splitting >500 kB (vite warning из логов гейтов).

**План глобальной реструктуризации создан:** `plans/restructure-server-frontend.md` (статус ПРОЕКТ, ждёт вердикта). Ключевое: аудит 18 записей корня; целевая структура `server/` (самодостаточен: src+tests+package+scripts+public/vad-assets+data) + `frontend/` (бывший webq98) + `docs/` (процесс/планы/справочники); 6 точек решения (D1 pnpm vs npm — рекомендация npm; D2 ai_helper.db затрекчена — untrack; D3 legacy select_dir/test-файлы — архив; D4 процесс-документы в docs/; D5 docker-compose в корне; D6 имя frontend); 5 фаз исполнения (R.1 префлайт+тег отката → R.2 server → R.3 frontend → R.4 корень/docs → R.5 финал), гейты и live-smoke после каждой фазы; оценка 5–7 ч. Отмечено: битая ссылка README `run-ollama-docker.sh` (файла нет).

**Статус:** ✅ Трек «Миграция на React» ЗАВЕРШЁН (A–F, PR #2/#3/#5/#6/#7 merged; C — анулирован владельцем). Следующий трек: глобальная реструктуризация (план готов) + backlog-пункты.

---

## 2026-11-09 — Верды владельца по плану реструктуризации → исполнены досрочно в PR #8: pnpm по умолчанию, `ai_helper.db` untrack → `data/`, архив `test-mic.html`

**Контекст.** Владелец выдал вердикты по точкам решения D1–D3 плана `plans/restructure-server-frontend.md` (PR #8, ветка `tz/track-closeout`) и подтвердил: ветка `context` удалена владельцем самостоятельно (remote; после `git fetch --prune` локальных следов нет — вердикт «УДАЛЯТЬ МОЖНО» из прошлого WORKLOG-записи исполнен). D4/D5/D6 приняты как рекомендовано; исполнение реструктуризации — отдельным треком `tz/restructure-*`.

**D1 — pnpm по умолчанию (решение #113).** Удалены npm-артефакты: `package-lock.json` (корень) и `webq98/package-lock.json`. Корневой `pnpm-lock.yaml` оказался устаревшим (содержал фронтовые devDeps, удалённые в TZ-F.6) — обновлен свежей резолюцией `pnpm install --lockfile-only` (pnpm 10.34.9, 248 пакетов, резолюция соответствует текущему `package.json`). В `webq98/` добавлен собственный `pnpm-lock.yaml` (607 пакетов; ранее lock внутри webq98 отсутствовал вовсе — только npm). Команды в README и PROJECT_CONTEXT (§2, §6/§8, §9) переведены на pnpm (`pnpm install/start/run dev/run build/run lint/test:run/run whisper`). README: блок Project Structure приведён к фактической структуре (прежний описывал до-React-era `server/`+`public/`), в Requirements добавлен pnpm 10+.

**D2 — `ai_helper.db` untrack → `data/` (решение #114).** `git rm --cached ai_helper.db`; файл физически перемещён в `data/ai_helper.db` (байты сохранены — требование владельца «сохранить тестовые данные в БД» выполнено). `.gitignore`: `data/chat.*` → `data/*.db*` (покрывает chat.db/-shm/-wal и ai_helper.db). Уточнение по факту: файл в git ПУСТ (0 строк в обеих таблицах) — таблицы ai-helper (`ai_helper_sessions`/`ai_helper_messages`) живут в `data/chat.db` через общий `getDb()` (`src/db/init.js`); код ссылок на корневой файл не имеет. Живая БД с тестовыми данными владельца — `data/chat.db` на машине владельца — данной операцией не затрагивается вовсе.

**D3 — архив ad-hoc артефактов (решение #115).** `test-mic.html` → `docs/reference/legacy-scratch/test-mic.html` (по указанию владельца; каталог по образцу golden-master `docs/reference/public-archive/`). Остаток D3 (`select_dir/`, `test-ai-helper-repo.js`) — в R.4 реструктуризации.

**Документы.** План реструктуризации: статус «ВЕРДИКТЫ ПРИНЯТЫ», §2/§4/§5/§6 отражают верды и досрочное исполнение; целевая структура — `pnpm-lock.yaml` в `server/` и `frontend/`. PROJECT_CONTEXT: решения #113–115, карта §10 (`data/` без ai_helper.db), команды pnpm. README — см. D1.

**Гейты (после изменений, узел `tz/track-closeout`):** build ✓ · lint ✓ (--max-warnings 0) · test:run ✓ 88/88 · test:backend ✓ 59/59. Красный-первый неприменим: 0 строк исполняемого кода (git-гигиена, lockfiles, docs).

**Статус:** ✅ Верды D1–D3 исполнены; PR #8 обновлён (документы + хозработы). Реструктуризация `server/` + `frontend/` — следующий трек (план готов, верды учтены).

---

## 2026-11-09 — Реструктуризация R.1 (префлайт) + R.2 (бэкенд → `server/`): PR открыт

**R.1 — префлайт.** Тег отката `pre-restructure` поставлен на `main` (`874b669`, merge PR #8) и запушен. Инвентаризация ссылок на переезжаемые пути (`rg` по `src/`, `tests/`, конфигам): все относительные импорты — внутренние для `src/`/`tests/` (переезд бесследен); абсолютные пути через `__dirname` — `db/init.js` (`server/data` — следует автоматически), `imageService.js` (`server/uploads/images` — автоматически), `chatRoutes.js` tmpDir (`server/uploads/tmp` — автоматически), `app.js` vad-assets (`server/public/vad-assets` — автоматически). Требовали правки только dist-пути фронта: `app.js` ×2 и `repoRoot` в `static.test.js`.

**R.2 — `git mv` → `server/`.** Переехали: `src/`, `tests/`, `scripts/` (whisper.sh), `public/` (vad-assets — решение #109 соблюдено), `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.env.example`, `data/` (.gitkeep). Правки: `server/src/app.js` — dist-статика и SPA-fallback → `../../webq98/dist` (до R.3 фронт в корне); `server/tests/app/static.test.js` — `repoRoot` на 3 уровня вверх; README — команды `cd server && …`, структура, пути провайдеров. `.gitignore` — неякорные паттерны (`uploads/`, `dist/`, `data/*.db*`, `node_modules`) совпадают на новой глубине без правок. Попутно (гигиена pnpm): `webq98/pnpm-workspace.yaml` — allowBuilds esbuild/protobufjs (снимает «Ignored build scripts», зеркалит корневой файл).

**Гейты (ветка `tz/restructure-r2`):** `cd server && pnpm install` ✓ (3.3s; better-sqlite3/sharp нативно OK — валидация pnpm-lock после переезда) · `pnpm run test:backend` ✓ **59/59** (22 suites) · webq98 `pnpm install` ✓ + `pnpm run build` ✓ (29.8s, warning >500 kB — известный, BACKLOG #7). **Live-smoke :3000:** `GET /` → 200 React index ✓ · `GET /dashboard` → 200, тот же index (SPA-fallback) ✓ · `/vad-assets/silero_vad_v5.onnx` → 200 + COOP/COEP ✓ · `/api/nonexistent` → 404 JSON ✓ · `/api/providers` → JSON ✓. Красный-первый: поведение не менялось (чистый переезд) — контракты покрыты существующими тестами (59/59 зелёные на новом месте).

**Примечание владельцу:** локальные runtime-файлы надо перенести на новое место: `data/chat.db*` (и `data/ai_helper.db`) → `server/data/`; `uploads/` пересоздаётся автоматически при старте (или перенести `uploads/images` для сохранения картинок). Кратцевременно: пока R.3 не смержен, фронт собирается из `webq98/` как раньше.

**Статус:** ✅ R.1+R.2 исполнены, PR открыт (`tz/restructure-r2` → `main`). Далее R.3 (`webq98` → `frontend`) — после merge.

---

## 2026-11-09 — Реструктуризация R.3 (`webq98` → `frontend/`) + два латентных фикса: PR открыт

**Merge R.2, пост-merge верификация.** PR #9 смержен владельцем (`ac2b30e`); ветка `tz/restructure-r2` удалена (remote+local), `main = origin/main`. Runtime-файлы БД перенесены владельцем в `server/data/` (примечание из записи R.2 исполнено). Проверка кода: `db/init.js` → `server/data` (пути следуют за переездом автоматически), `app.js` — переходный dist-путь `../../webq98/dist`, структура `server/` соответствует плану.

**Фикс 1 — `.gitignore`: `server/data/*.db*` (хвост R.2).** Паттерн `data/*.db*` — якорный (средний слэш ⇒ относительно корня репо), на новой глубине не действует: `git check-ignore server/data/chat.db` → не игнорируется (exit=1). Примечание плана (§5 R.2: «при необходимости добавить `server/data/*.db*`») оказалось необходимым. После фикса рантайм-артефакты live-smoke (`server/data/chat.db`/-shm/-wal, `server/uploads/`) подтверждённо игнорируются.

**Фикс 2 — `@eslint/js` прямой devDep (латентный баг перехода D1/pnpm).** `eslint.config.js` импортирует `@eslint/js`, но пакет никогда не был прямым devDep (`git log -S` по `package.json` пуст): исторически lint работал на плоском npm-node_modules (до D1), где хоистинг поднимал транзитив. Чистая pnpm-установка (isolated layout, после сброса песочницы битый снапшотный node_modules пересоздан) дала `ERR_MODULE_NOT_FOUND`. Объявлен `"@eslint/js": "^9.39.5"` — пакет уже в сторе как транзитив eslint 9.39.5 (lockfile +3 строки, новых пакетов нет; §8 соблюдён — фикс декларации, не новая зависимость). Гейт lint --max-warnings 0 снова зелёный.

**R.3 — `git mv webq98 frontend`.** Каталог переехал целиком (58 rename-записей; untracked `node_modules/`, `dist/`, `tsconfig.tsbuildinfo` — вместе с ним). Правки: `server/src/app.js` — dist-статика и SPA-fallback → `../../frontend/dist` (+комментарии); `server/tests/app/static.test.js` — фикстура `frontend/dist`; README — `cd frontend`, структура, Requirements (`server/` и `frontend/`); PROJECT_CONTEXT — §7 (frontend/), §8.1 (`server/public/vad-assets/`, `frontend/public`), §10-карта переписана под реальность R.2+R.3 (server/, server/data/, uploads/, frontend/; R.4-планы отмечены), решение #116; ARCHITECTURE.md — корень дерева; `docs/reference/public-archive/README.md` — текущее состояние раздачи (`server/src/app.js`, `frontend/dist`). Исторические документы (plans/*, BACKLOG #1, находки решений #87/#113) не переписывались — фиксация истории.

**Гейты (ветка `tz/restructure-r3`):** frontend `pnpm install` ✓ · `pnpm run build` ✓ (29.6s, warning >500 kB — известный, BACKLOG #7) · `pnpm run lint` ✓ (--max-warnings 0) · `pnpm run test:run` ✓ **88/88** · `cd server && pnpm run test:backend` ✓ **59/59**. **Live-smoke :3000:** `GET /` → 200 React index из `frontend/dist` ✓ · `GET /dashboard` → 200 (SPA-fallback) ✓ · `/vad-assets/vad.worklet.bundle.min.js` → 200 + COOP/COEP ✓ · `/api/nonexistent` → 404 JSON ✓ · `/api/providers` → 200 JSON ✓. Красный-первый: поведение не менялось (чистый переезд) — контракты покрыты существующими тестами.

**Статус:** ✅ R.3 исполнена, PR открыт (`tz/restructure-r3` → `main`). Остались R.4 (корень+docs: plans → docs/plans, WORKLOG/WORKFLOW/BACKLOG → docs/, select_dir/ + test-ai-helper-repo.js → legacy-scratch, битая ссылка README run-ollama-docker.sh) и R.5 (финал: полная карта §10, итоговые команды README, приёмка владельца).

---

## 2026-11-09 — Хотфикс (хвост R.2): `.env` перестал находиться после переезда бэкенда — добавлен в PR R.3 до merge

**Отчёт владельца.** После merge PR #9 при старте `pnpm start` (из `server/`): `Provider ollama is not responding, attempting fallback` → `All providers are unavailable`; `/api/models` → 503. llama.cpp при этом работает (`llama-server listening on :8080`). В логе старта: `llama.cpp: … (enabled: false)`.

**Диагноз.** `server.js` грузил env через `import 'dotenv/config'` — dotenv ищет `.env` от `process.cwd()`. До R.2 cwd был корнем репо (там жил `.env` владельца); после переезда cwd=`server/` → корневой `.env` не находился → все переменные откатились на дефолты кода: `DEFAULT_PROVIDER=ollama`, `LLAMA_CPP_ENABLED` → `false` (строгое `=== 'true'` в `config/providers.js`). `providerManager` фильтрует по `enabled` (`providerManager.js:40`), поэтому работающий llama.cpp не участвовал ни в прямом вызове, ни в fallback → 503. Примечание владельцу в записи R.2 упоминало перенос `data/chat.db*` и `uploads/`, но не `.env` — упущение исполнительной стороны.

**Фикс.** Новый `server/src/config/env.js`: путь `.env` резолвится от `__dirname` модуля — cwd не важен; порядок: `server/.env` (основной) → корневой `.env` (legacy-fallback на время миграции; dotenv не переопределяет уже заданные — `server/.env` всегда приоритетен). `server.js`: `import './config/env.js'` ПЕРВЫМ импортом (до `app.js`, чьи модули читают `process.env` при импорте). Тест `server/tests/config/env.test.js` (3): пути поиска, приоритет первого файла, толерантность к отсутствию файла. `.env.example` и README (Configuration) — расположение `.env` задокументировано.

**Проверка.** `test:backend` **62/62** (59 + 3). Live: временный `server/.env` (PORT=3210, LLAMA_CPP_ENABLED=true), старт `node src/server.js` из cwd=`/tmp` (вне репо) → сервер поднялся на **:3210**, `Default provider: llama_cpp`, `llama.cpp enabled: true` — env найден от модуля; фикстура удалена.

**Уточнения по отчёту (не баги).** (1) «Total Time: 37.85s» в футере при недоступных провайдерах — это персист-метрики последнего ответа ассистента, загруженного из БД вместе с сессией (`chat-area.tsx: deriveLastMetrics`; метрики хранятся с Фазы B/TZ-B.2) — историческое значение, к текущей попытке не относится; Size/Ctx — «–», потому что список моделей не получен (503). (2) `[vite] server connection lost` + `ws://localhost:5175/ failed` — HMR-реконнект dev-сервера Vite (транзиент при перезапуске/навигации); API через прокси 5175→3000 в том же логе отвечал 200 — к R.2 не относится.

**Действие владельцу:** перенести `.env` в `server/.env` (`mv .env server/.env`) — фиксирует проблему и на текущем main без кода; после merge PR #10 работает и legacy-вариант (корневой `.env` подхватывается fallback'ом).

**Статус:** ✅ Фикс добавлен в ветку `tz/restructure-r3` (PR #10) до merge. test:backend 62/62.

---

## 2026-11-09 — R.4 — Корень и docs (ветка `tz/restructure-r4`)

**Контекст.** Merge PR #10 (R.3 + хотфикс `.env`) подтверждён владельцем (`3cd4662`), ветка `tz/restructure-r3` удалена (локально и на remote). По плану `docs/plans/restructure-server-frontend.md` остались R.4 (корень и docs) и R.5 (финал).

**Переносы (git mv, 23 rename-записи; история читается через `git log --follow`):**
- `plans/` → `docs/plans/` (целиком, включая `DONE/` и файлы с кириллицей в именах);
- `WORKLOG.md`, `WORKFLOW.md`, `BACKLOG.md` → `docs/` (D4 плана);
- `select_dir/` → `docs/reference/legacy-scratch/select_dir/`, `test-ai-helper-repo.js` → `docs/reference/legacy-scratch/` (D3-остаток, решение #115; рядом уже лежит `test-mic.html` из PR #8).

**Правки ссылок (по grep-инвентаризации до переноса):**
- **README**: «Option 1: Docker Setup» ссылалась на несуществующий `run-ollama-docker.sh` (файл отсутствует в HEAD; в истории — установщик Docker/NVIDIA-toolkit + `compose up`). По плану («удалить или восстановить») выбрано «удалить»: восстановление противоречит чек-листу приёмки («корень — ничего больше»), сценарий покрывает трекаемый `docker-compose.yml` — инструкции заменены на `docker compose up -d`. Дерево Project Structure: `docs/` дополнен реальным содержимым.
- **`.kilocodeignore`**: `select_dir/` → `docs/reference/legacy-scratch/`, `plans/` → `docs/plans/` (скрытие legacy/планов от инструмента сохранено; заодно закрывает `test-mic.html`, видимый там с PR #8).
- **`docs/WORKFLOW.md`** §2: карта документов регламента → пути в `docs/` (с пометкой о переносе).
- **`docs/WORKLOG.md`** шапка: указатель на регламент → `docs/WORKFLOW.md`.
- **`docs/BACKLOG.md`** шапка: указатель на план → `docs/plans/restructure-server-frontend.md`.
- **`frontend/PROJECT_CONTEXT.md`** §10: строка корня и ветка `docs/` переписаны под реальность R.4; в `legacy-scratch/` добавлен состав. Исторические записи WORKLOG и документы в `docs/plans/` не переписывались (фиксация истории — практика с R.3).

**Корень после R.4 (трекаемое):** `.gitignore`, `.kilocodeignore`, `README.md`, `docker-compose.yml`, `server/`, `frontend/`, `docs/` — чек-лист приёмки §6 выполнен (`.kilo/`, `.vscode/` — не трекаемые конфиги инструментов).

**На R.5 (замечено при правке §10):** карта называет `docs/AI_HELPER_STT.md`, реальный файл — `docs/STT_SYSTEM.md`; полная карта §10 и итоговые команды README — объём R.5.

**Гейты (ветка `tz/restructure-r4`):** frontend `pnpm run build` ✓ (30.3s, известный warning >500 kB — BACKLOG #7) · `pnpm run lint` ✓ (--max-warnings 0) · `pnpm run test:run` ✓ **88/88** · `cd server && pnpm run test:backend` ✓ **62/62**. Красный-первый: код и тесты не менялись (docs-only фаза) — контракты покрыты существующими тестами.

**Статус:** ✅ R.4 исполнена, PR открыт (`tz/restructure-r4` → `main`). Осталась R.5 (финал: полная карта §10, итоговые команды README, WORKLOG, полные гейты + live-smoke, приёмка владельца).

---

## 2026-11-09 — R.5 — Финал реструктуризации (ветка `tz/restructure-r5`)

**Контекст.** Merge PR #11 (R.4) подтверждён владельцем (`08088bb`), ветка удалена. Владелец исполнил рекомендацию хотфикса: `.env` перенесён в `server/.env`. R.5 — закрывающая фаза плана.

**PROJECT_CONTEXT §10 — финальная карта.** Сверена с фактическим деревом (ls-инвентаризация server/, frontend/, docs/): исправлено имя `docs/STT_SYSTEM.md` (в карте ошибочно значился `AI_HELPER_STT.md` — замечено ещё в R.4); `server/src` дополнен `config/` (env.js — #117) и расшифровкой `middleware/`/`db/`; `tests/` — `config/`, `fixtures/`; `frontend/src` — `css/themes/` (besafe/leteem/minimal), `components/chat/CodeBlock.tsx`, `lib/chatRender.ts`/`export.ts` (+ пометка о co-located `*.test.ts`), lockfile/workspace/tsconfig в шапке frontend.

**README — итоговые команды.** Добавлена секция «Tests & Lint» (`pnpm run test:run`/`lint`/`build` в frontend; `pnpm run test:backend` в server). Остальные команды (Docker → `docker compose up -d`, Local Install, Frontend dev :5175, Whisper, Configuration с `server/.env`) проверены по тексту — актуальны после R.2–R.4 правок.

**Решение #118** (PROJECT_CONTEXT §7) — фиксирует завершение R.4+R.5.

**Гейты (ветка `tz/restructure-r5`):** frontend `pnpm run build` ✓ (31.9s, известный warning >500 kB — BACKLOG #7) · `pnpm run lint` ✓ (--max-warnings 0) · `pnpm run test:run` ✓ **88/88** · `cd server && pnpm run test:backend` ✓ **62/62**.

**Live-smoke (:3100, env-переменная; `server/.env` в песочнице нет — заодно проверена толерантность env.js):** старт ✓ (`injected env (0) from .env` / `../.env` — оба отсутствуют, дефолты; `Default provider: ollama`, `llama.cpp enabled: false` — ожидаемо без .env) · `GET /` → 200 `text/html` (React index из `frontend/dist`) · `GET /dashboard` → 200 (SPA-fallback) · `/vad-assets/vad.worklet.bundle.min.js` → 200 + `COOP: same-origin` + `COEP: credentialless` · `/api/nonexistent` → 404 JSON `{"error":"Not found"}` · `/api/providers` → 200 JSON.

**Чек-лист приёмки §6 плана — статус к merge:**
- [x] Корень: `README.md`, `docker-compose.yml`, `.gitignore` (+ `.kilocodeignore`), `server/`, `frontend/`, `docs/` — ничего больше;
- [x] `cd server && pnpm install && pnpm start` → :3000 SPA (/, /dashboard), API, WS, vad-assets + COOP/COEP (smoke на :3100, тот же код-путь);
- [x] `cd frontend && pnpm install && pnpm run dev` → :5175 с прокси (README); `pnpm run build` → `frontend/dist` ✓;
- [x] Гейты: build ✓ · lint ✓ · test:run 88/88 · test:backend 62/62 (59 + 3 env — хотфикс);
- [x] `ai_helper.db` не в git (D2), история `git mv` читается (`--follow`, R.2–R.4);
- [x] README без битых ссылок (run-ollama-docker.sh удалён в R.4); PROJECT_CONTEXT §10 = реальности; §8/§11 актуальны.

**Статус:** ✅ R.5 исполнена, PR открыт (`tz/restructure-r5` → `main`). Трек реструктуризации R.1–R.5 завершён; дальше — BACKLOG #1–#4 отдельным треком (по прямому указанию владельца).

---

## 2026-11-09 — План «система хранения данных контекста» создан (ветка `tz/plan-context-storage`)

**Запрос владельца.** Продумать систему хранения данных, передаваемых в контекст. Ключевые вводные: фронт и бэкенд на одной ФС → передача файлов формой не нужна (кроме clipboard-бинарей); относительный путь в `attachments`, резолв от `CONTEXT_BASE_DIR` (значение `/home/selub/Documents/progs`, прототип — `legacy-scratch/select_dir/`); два режима: текущий (extract→inline, для статей/исследований — предложить имя) и PROJECT (ссылки id+путь, контент читается при сборке контекста, git-восстановимость, позже vector DB с авто-индексацией); сейчас — только изображения: clipboard → `server/data/uploads/<sid>_<qid>.<ext>` + строка в `attachments`; при загрузке истории — проверять сохранённую картинку. Также: владелец исполнил `rm -rf uploads/` (старые image-URL в истории мертвы — принято), доработка PR #13 (уборка webq98) исполнена отдельным коммитом `9120b9c` в ветке PR.

**План:** `docs/plans/context-data-storage.md` (статус ПРОЕКТ). Ключевые предложения: режимы **RESEARCH/PROJECT** (хранение в `sessions.mode` — колонка уже в схеме, default `'chat'` → backfill); `CONTEXT_BASE_DIR`; расширение `attachments` без rebuild (`kind`, `path_base` — guarded ALTER; `extracted_text=''` для изображений); раздача `/api/attachments/:id/raw|thumb`; unlink data-файлов при удалении Q&A; совместимость — legacy `image_data` только чтение + onerror-скрытие; security — canonicalize + запрет traversal. Фазы S.1–S.6 (≈4–6 ч, один PR — рекомендация) + S.7 (режимы, отдельный PR). Шесть точек решения D-A…D-F ждут вердикта. Отмечено соответствие §3.3 PROJECT_CONTEXT («Project-режим получит свой контракт отдельно» — этот план и есть его проект контракта).

**Статус:** ⏳ план на утверждении владельца; исполнение не начато (WORKFLOW фаза 2).

## 2026-11-09 — Аудит структуры (запрос владельца) + фикс якорей .gitignore (ветка `tz/fix-gitignore-anchors`)

**Запрос.** «Проверь текущую структуру проекта. Какие файлы нужно удалить? Сверить со схемой в документации.» Контекст: main `87ef519` (merge PR #12 + 3 прямых коммита владельца: `server/data/` и Vite-артефакты в gitignore, чистка plans).

**Сверка с документацией (§10-карта PROJECT_CONTEXT, README Project Structure, чек-лист §6 плана).** Tracked-дерево полностью соответствует §10; чистка владельца в `docs/plans/` (удалены FRONTEND_MIGRATION_PLAN.md и final_solution_proposal.md, «План реализации» и refactoring-session-management.md → DONE/) учтена. Находки аудита:

1. **Корневой `uploads/` (untracked, runtime) — наследие до-R.2, единственное расхождение «структура vs карта».** Содержимое: `images/` — 8 файлов `img_<ts>_<rand>` + `thumbnails/` — 8 миниатюр. После R.2 сервер работает ТОЛЬКО с `server/uploads/images` (app.js/imageService — пути от `__dirname`; раздача `/api/images/:id/full|thumb`; URL в БД). Старые файлы не находятся по своим URL → картинки в старых сообщениях (server/data/chat.db) отдадут 404. **Рекомендация владельцу: перенести** `uploads/images/*` → `server/uploads/images/`, `uploads/images/thumbnails/*` → `server/uploads/images/thumbnails/` (history сохранится — ID совпадают, `generateImageId` = `img_<ts>_<rand>`), затем удалить опустевший корневой `uploads/`. Альтернатива — просто `rm -rf uploads/`, если старые вложения не нужны (ссылки в БД останутся с битыми картинками).
2. **.gitignore — мёртвые якоря `webq98/.vite/`, `webq98/tsconfig.tsbuildinfo`** (прямые коммиты владельца c4c5d42/87ef519): каталога `webq98/` не существует с R.3. Фактически `frontend/tsconfig.tsbuildinfo` уже игнорируется через `frontend/.gitignore` (`*.tsbuildinfo`; проверено `git check-ignore`), кэш Vite живёт в `node_modules/.vite`. Фикс: якоря → `frontend/…` (намерение сохранено, паттерны снова действуют). Исправлено в этом PR.
3. **Не удалять:** `server/data/chat.db-shm`/`-wal` (WAL-сайдкары better-sqlite3, runtime), `server/uploads/tmp` (переиспользуется, cleanup в `finally` — TZ-B.3), `node_modules/`/`dist/` (артефакты), `.kilo/`, `.vscode/` (tracked-конфиги инструментов; проверены — устаревших путей нет, добавлены в §10-карту).
4. **Косметика (не исполнено, на усмотрение):** заголовки describe/it в `server/tests/app/static.test.js` упоминают «webq98/dist» (фикстура давно `frontend/dist`); `docs/plans/restructure-server-frontend.md` и `docs/plans/Выявленные недостатки:.md` можно дослать в `DONE/` (владелец начал эту чистку в eb2abb1).

**Гейты (docs/.gitignore-only; код не менялся):** frontend lint ✓ · test:run 88/88 ✓ · build ✓ · server test:backend 62/62 ✓.

---

## 2026-11-10 — ТЗ «vision-картинки в истории» исполнено (ветка `tz/vision-attachments`)

**Вердикт владельца по плану context-data-storage.** Финальное ТЗ с ключевыми решениями: без обратной совместимости и миграции; legacy `image_data` и поток `imageService`/`/api/images` демонтируются в том же PR (ранее — фаза S.6); файлы не удаляются ни при удалении Q&A, ни при удалении сессии (orphan-файлы — предмет будущего File Manager); закрыт пропуск 2.0.1 — ветки `file` (картинка/документ) и `codeFiles` больше не взаимоисключающие.

**S.1–S.2 (конфиг + БД).** Новый `server/src/config/paths.js`: `DATA_DIR/UPLOADS_DIR/THUMBS_DIR` (от `__dirname` — паттерн #117), `getContextBaseDir()` (`CONTEXT_BASE_DIR`, D-B), `resolveAttachmentPath(row)` (path_base `data`→`server/data`, `context`→`CONTEXT_BASE_DIR`; canonicalize + запрет traversal). `init.js`: `attachments` += `kind`/`path_base` (CREATE для свежих БД + guarded `ALTER TABLE ADD COLUMN` по `PRAGMA table_info`); `messages.image_data` демонтирован (guarded `DROP COLUMN`, try/catch для SQLite < 3.35). `attachmentRepo`: `insertAttachment` (полный набор колонок), `getAttachmentPath`, `extractFromPaths(..., kind)` — для RESEARCH-документов/кода `file_path=NULL` (tmp удаляется, путь мёртв).

**S.3–S.4 (приём + раздача).** `attachmentService.addImageAttachment`: sharp → `server/data/uploads/<sid>_<qid>.<ext>` + `thumbs/<...>_thumb.jpg` (150×150, как раньше), строка реестра (`kind='image'`, `path_base='data'`, `extracted_text=''`), meta с `fullUrl/thumbnailUrl` = `/api/attachments/<uuid>/raw|thumb`. `attachmentRoutes` += `GET /:fileId/raw` (поток с `mime_type` + Cache-Control; traversal → 400) и `GET /:fileId/thumb` (только kind=image). `chatController` переписан: валидация до файлов; все три ветки независимы; порядок сборки — **документ → код → текст**; vision-ветка сохраняет док/код в реестр тоже; `imageData` в ответе — legacy-shape из meta (фронт-контракт §3.1 сохранён); PROJECT-режим (`sessions.mode`) резервирует ветку без инлайна (S.7). `contextBuilder`: файлы-фильтр `kind != 'image' AND extracted_text != ''`; `getQAPairs` без image_data. `messageRepo`: INSERT без image_data; `deleteMessagesByQuestionId` — строки реестра и файлы НЕ удаляются, `deletedAttachments` всегда 0.

**S.5 (фронт).** `mapQAPairsToMessages` строит `imageData` из `attachments_meta` (первый `kind='image'` с `thumbnailUrl`); поле `image_data` не парсится. `types`: `AttachmentMeta` += `fileId?/kind?/fullUrl?/thumbnailUrl?` (optimistic-мета `{name,size,type}` не ломается). `chat-area` не менялся (shape сохранён).

**S.6 (демонтаж).** Удалены: `imageService.js`, `imageController.js`, `imageRoutes.js`, `imageUtils.js`, `generateImageId` (fileUtils), создание `uploads/images`+`thumbnails` в `app.js`, монтаж `/api/images`; `server/uploads/` снята с диска. `unlink` в коде остался только для tmp-файлов (multer tmp + ai-helper audio — вне ТЗ).

**Доки.** README (CONTEXT_BASE_DIR, endpoints Attachments, структура data/uploads), `server/.env.example` (+CONTEXT_BASE_DIR), PROJECT_CONTEXT §3.3 (контракт Q&A без image_data), решения **#119**/**#120**, §10 (data/uploads, tests/routes, paths.js); план context-data-storage — статус ПРИНЯТ, §8 — колонка вердиктов D-A…D-F.

**Тесты (red-first в фазах).** Бэкенд 89/89 (было 62; +27: guarded-ALTER на legacy-схеме, paths/traversal, insertAttachment, addImageAttachment (sharp, файл+миниатюра+строка), routes raw/thumb (express+fetch: 200/404/400-traversal), chatHandler 2.0.1a (картинка+2 кода: 3 записи, meta с kind, images+код в vision-вызове, imageData из meta) и 2.0.1b (док+2 кода+текст: порядок документ→код→текст), 400 не-vision, orphan-политика messageRepo, фильтр изображений в filesContext, getQAPairs без image_data). Фронт 89/89 (+1: 1c — imageData из meta). Найдено тестом и исправлено: prepend-цепочка давала «код → документ» вместо заданного порядка.

**Гейты:** `pnpm run build` ✓ (30.4s, известный warning >500 kB — BACKLOG #7) · `pnpm run lint` ✓ (--max-warnings 0) · `test:run` ✓ 89/89 · `test:backend` ✓ 89/89 · live-smoke :3100 ✓ (`GET /` 200 html; `/api/attachments/xxx/raw|thumb` → 404 JSON; `/api/images/*` → 404 — демонтаж подтверждён).

**Наблюдение для следующего ТЗ (не входит в это):** `addBotMessage` не подставляет `result.imageData` в свежий ответ — превью после отправки появляется только после перезагрузки истории (поведение существовало и до ТЗ; теперь данные для фикса в ответе есть).

**Статус:** ✅ S.1–S.6 исполнены одним PR (`tz/vision-attachments` → `main`); S.7 (режимы) — следующий PR.

---

## 2026-11-10 — ТЗ «один system, [Материалы] / [Ранее] / [Вопрос]» исполнено (ветка `tz/one-system-context`)

**Запрос владельца.** Финальное ТЗ: два `system` подряд (sysprompt + filesContext) шаблон Qwen3.8-…-mtp отвергает (`System message must be at the beginning`); vision-ветка вообще не использовала `buildLLMContext` — теряла sysprompt и историю Q&A. Решение — единая архитектура промпта.

**Контекст-сборка (`contextBuilder.js`).** `DEFAULT_SYSPROMPT` — именованная константа (на бэке её не было — инлайн «Ты — полезный и компетентный ИИ-ассистент…», текст отличался от фронтовского «Senior Developer»; по ТЗ новый текст объясняет модели структуру промпта и правила работы с файлами, синхронная копия в `sessionStore.ts`). `finalConversation = system(sysprompt) + user[Материалы](filesContext)? + user[Ранее в этой сессии]? + truncatedHistory` — ровно один system. Латентный баг, пойман тестом: при нулевых строках реестра `filesContext` оставался строкой-заголовком → пустой `[Материалы]`; исправлено (`rows.length > 0`).

**`chatController.js`.** `message` = только текст пользователя (после URL-extract); инлайн документов/кода демонтирован — `processDocument`/`processCodeFiles` и `fileService.js` (unit-экспорты, импортёров больше нет) удалены; следствие: невалидный документ — warn + строка реестра без `extracted_text` (не 400). Контекст-конфиг (contextLength/retainPercent/includeQuestionIds) поднят выше ветвления — общий для chat и vision. Обе ветки добавляют последнее user-сообщение `[Вопрос]` (в БД пишется БЕЗ префикса); vision-ветка теперь вызывает `buildContext` и крепит base64-картинку к `[Вопрос]` (`images`) — sysprompt и история в vision восстановлены, картинка не попадает в `[Материалы]` (фильтр `kind != 'image'`). `info.*` не изменён.

**Провайдеры.** `LlamaCppProvider.mergeSystemMessages` — страховка-склейка system (п.6 ТЗ: в репо склейки НЕ было — файл не менялся с R.2, добавлена; в норме no-op — та же ссылка) + TODO(vision): поле `images` — формат Ollama, llama.cpp `/v1/chat/completions` его не стандартизует. Ollama шлёт messages как есть — vision нативно.

**Тесты (red-first, коммит `15e4c1e`).** Бэкенд 98/98 (было 89; +9: 5×one-system-контракт contextBuilder — один system с/без файлов, `[Материалы]` user, `[Ранее]`+порядок истории, info.*-контракт, регрессия DEFAULT_SYSPROMPT; 3×`mergeSystemMessages` — no-op/склейка/без system; 2.0.3 chat-ветка — system + `[Ранее]` + история + `[Вопрос]`). 2.0.1a/b переведены на новый контракт (vision: system + `[Материалы]` с кодом + `[Вопрос]`+images; `[Вопрос]` = ровно текст пользователя — ассерты в формате fileService заменены на сырой `extracted_text` реестра). Фронт 89/89 без изменений (тест sysprompt — non-empty, текст не фиксируется).

**Гейты:** `pnpm run build` ✓ (29.8s, известный warning >500 kB — BACKLOG #7) · `pnpm run lint` ✓ (--max-warnings 0) · `test:run` ✓ 89/89 · `test:backend` ✓ 98/98 · live-smoke :3100 ✓ (`GET /` 200 html, `/dashboard` 200, `/api/nonexistent` 404 JSON, `POST /api/chat` → 503 «no providers» — в песочнице провайдеров нет, полный путь chat покрыт мок-тестами).

**Доки.** README (структура: contextBuilder — сборка промпта, attachmentService добавлен, fileService удалён), PROJECT_CONTEXT §10 (+providers/ в тестах), решение **#121**.

**Ручной смоук на реальной модели — на владельце (DoD):** сообщение с PDF → ответ, в консоли llama.cpp нет `System message must be at the beginning`; vision → ответ в стиле Senior Developer (sysprompt применён).

**Статус:** ✅ исполнено одним PR (`tz/one-system-context` → `main`); ручная приёмка на модели — за владельцем.

## 2026-11-11 — ТЗ «Project mode A» (plain fs.readFile + `[Материалы]`) исполнено (ветка `tz/project-mode`)

**Запрос владельца.** PROJECT-режим без RAG/Qdrant/Tree-sitter/streaming: переключение режима, выбор папки внутри `CONTEXT_BASE_DIR`, attach reference-файлов (не копируются), чтение с диска при сборке контекста (mtime-кэш), предупреждения missing/too-large, правая панель. Все открытые вопросы §10 — по дефолтам ТЗ (подтверждены владельцем в анализе).

**Схема/репо.** `attachments.extracted_mtime` — CREATE + guarded ALTER (legacy-БД, default NULL); `sessionRepo.createSession` default `'chat'` → `'research'` (legacy `'chat'` трактуется кодом как research; backfill не делался). `projectRepo.js` — projects + bind/unbind сессии (`mode` меняется вместе с привязкой), авто-detach чужих reference при смене проекта (§10.7: `file_path NOT LIKE '<newProjectPath>/%'`), detach всех reference при Remove (§10.8). `attachmentRepo`: экспорт `detectLanguage`/`getMimeType` (переиспользование §3.4/3.5), `deleteAttachment`, `listBySessionAndKind`, `findReferenceByPath` (идемпотентность attach).

**Сервер.** `paths.js`: `getContextBaseDirStatus()` (§3.1, честный статус на каждый запрос) + `getMaxReferenceFileSize()` (env, 1 MB дефолт — единая точка для attach и buildLLMContext). `GET /api/config` (configRoutes). Projects API (projectRoutes): `POST /api/projects` (идемпотентно по path, `totalFiles` с ранним пропуском игнор-директорий — вместо буквального `readdir recursive` из ТЗ: не обходим node_modules целиком; при смене проекта — авто-detach чужих), `GET /api/projects/:id` (микродополнение: восстановление CurrentProject в UI после F5 — ТЗ формы не задавало, согласовано в анализе), `GET /:id/files` (фильтр, лимит 500 + truncated, только stat), `POST /:id/attach` (traversal относительно корня ПРОЕКТА, too large → errors без записи в БД, лимит 100/сессия, идемпотентность → `skipped:true`). `PATCH /api/sessions/:id` + `mode` (валидация research|project; `project_id` не сбрасывается в обе стороны). `GET /api/sessions/:id/attachments` (missing/mtimeStale; свежий attach → mtimeStale=true — кэш ещё не читался, обновится при сборке контекста). `DELETE /api/attachments/:fileId` (только строка реестра). `DELETE /api/sessions/:id/project` (Remove: project_id=NULL + mode=research + detach reference) — форма эндпоинта из анализа ТЗ. `chatController`: `mode = session.mode==='project'` (legacy 'chat'→research); multipart в PROJECT → 400 «Use /api/projects/:id/attach» (§10.1, картинки — тоже, RESEARCH-only); currentAttachments = пул reference из реестра; `contextInfo` += mode/filesAttached/filesMissing/filesTooLarge (контракт info.* не тронут). RESEARCH-ветка без изменений.

**Контекст (`contextBuilder.js`).** 6-й параметр `mode`. PROJECT: `allFileIds` — ТОЛЬКО `currentAttachments` (§5.7: старые document/code из `attachments_meta` прошлых RESEARCH Q&A не попадают в `[Материалы]`); reference читается с диска с mtime-кэшем (`extracted_mtime !== stat.mtimeMs || !content` → `fs.readFileSync` + UPDATE); суффикс `(актуальная версия)`; missing → блок `--- FILE: x (MISSING) ---\n[file not found on disk]` (рекомендация §5.4 принята — модель знает, что файл был); too large → `--- FILE: x (TOO LARGE) ---` (симметрично MISSING — моё микрорешение, в ТЗ поведение не задано). SQL упрощён до `WHERE id IN (...) AND kind != 'image'` — буквальный SQL ТЗ с `OR kind='reference'` имел precedence-баг (OR вырывает reference из-под фильтра id → утечка чужих сессий); пустые не-reference фильтруются в JS — RESEARCH-поведение бит-в-бит (тест-регрессия: пустой файл не порождает пустой `[Материалы]`). `info` += mode/filesMissing/filesTooLarge. `getQAPairs` не менялся.

**Фронт.** `apiGateway`: configApi/projectsApi (create/get/listFiles/attach/unlink)/attachmentsApi (listBySession/detach); sessionsApi.get/list — mode/project_id в типах. `projectStore.ts` (config, currentProject, attachments, filter, browse*, isLoading; init восстанавливает проект по `session.project_id`); mode сессии — в `sessionStore` (не дублируется, §4): `mode` + `setMode` (PATCH, оптимистично с откатом при ошибке). `SettingsPanel` — шапка с ModeToggle; research-тело — реальное описание вместо заглушки «Reserved for Project mode»; `ProjectPanel` (ModeToggle, красный баннер CONTEXT_BASE_DIR + disabled кнопки, CurrentProject/Open Folder/Change/Remove, AttachList с бейджами missing/stale, `[📎 Attach file(s)]` — rel=имя файла (корень проекта; промах → честная ошибка сервера), `[📂 Browse project files]` → `BrowseDialog` (Radix Dialog как LoadModal, debounced-фильтр, чекбоксы, лимит 500 → подпись)). App.tsx: projectStore.init после session init. chat-area не менялся.

**Тесты.** Бэкенд 148/148 (было 98; +50): paths (статус/лимит), configRoutes, projectController (23: create/traversal/без base/не-сущ./идемпотентность/смена проекта/игнор-паттерны/фильтр/лимит 505/attach+идемпотентность+too-large+traversal+лимит 100/список+missing+stale/detach+orphan/PATCH mode+валидация/info/unlink), contextBuilder PROJECT (8: чтение с диска+кэш+перечитывание+MISSING+TOO LARGE+§5.7 document-фильтр+RESEARCH-регрессии×3), chatController PROJECT (5: §5.2-контракт+400+filesMissing+RESEARCH-регрессия+legacy chat), init (extracted_mtime fresh+legacy), sessionRepo default research. Фронт 111/111 (было 89; +22): projectStore (8), apiGateway (8), sessionStore mode (4). Фикс теста №4 sessionStore.test.ts: подмена window.location теперь восстанавливается (протекала в последующие init-тесты).

**Гейты:** `npm run test:backend` ✓ 148/148 · `npm run lint` ✓ (--max-warnings 0) · `test:run` ✓ 111/111 · `npm run build` ✓ (известный warning >500 kB — BACKLOG #7). NB: pnpm в окружении нет — гейты выполнены npm (как в прошлых ТЗ).

**Смоук :3000 (песочница).** 5.1: без `CONTEXT_BASE_DIR` → config ok:false, POST /api/projects → 400, PATCH mode разрешён. 5.2: research-сессия → PATCH project → POST /api/projects (totalFiles=4 при node_modules/dist в фикстуре — игнор работает) → files?filter → attach 3 → список с filePath. 5.5: настоящий 2MB-файл → `File too large (2097152 bytes, max 1048576)`; traversal → errors. 5.6: DELETE detach — строка удалена, файл на диске цел. 5.7: research↔project — project_id сохраняется; Remove → project_id=NULL + mode=research + авто-detach. POST /api/chat в песочнице → 503 (провайдеров нет — ожидаемо; PROJECT-ветка chatHandler покрыта мок-тестами §5.2/§5.4).

**Доки.** README (CONTEXT_BASE_DIR/MAX_REFERENCE_FILE_SIZE, GET /api/config, Projects, PATCH mode, GET /:id/attachments, DELETE detach, DELETE /:id/project, режимные отличия chat), PROJECT_CONTEXT §1 (Study→Research, mode research|project), §7 #125–127 (дословно из ТЗ), §10 карта (+projectRepo/projectStore/новые компоненты), WORKLOG.

**Ручной смоук на реальной модели — на владельце (DoD):** Project-сессия: вопрос по attach-файлу → ответ, в `[Материалы]` актуальная версия; изменить файл на диске → следующий вопрос видит новую версию (mtime-кэш перечитал); context-bar: mode/filesAttached.

**Статус:** ✅ исполнено одним PR (`tz/project-mode` → `main`); merge — за владельцем.

## 2026-11-11 — Приёмка PR #17 (Project mode A): наблюдения → решения (ветка `tz/project-mode`)

**Запрос владельца.** Приёмка ТЗ — вердикт ✅ ПРИНЯТО; список наблюдений (не блокеров) — «рассмотри критически, сам реши, нужно ли выполнять».

**Выполнено (решил «да»).**
- **3.1 mtimeStale при свежем attach.** `getSessionReferenceAttachments`: `mtimeStale = extracted_mtime !== null && extracted_mtime !== stat.mtimeMs` — NULL теперь «кэш не инициализирован», а не «устарел»; ложный бейдж `stale` сразу после attach исчез (реальный stale — после первого вопроса при изменении файла). buildLLMContext не тронут (NULL → перечитать + UPDATE). Тест «свежий attach → mtimeStale=true» переписан на false.
- **3.4 filesAttached vs факт.** Вместо правки `contextInfo.filesAttached` (фронт его не показывает) сделал наблюдаемость там, где пользователь реально смотрит: бэкенд-бейдж `tooLarge` в §3.7 (stat-only; файл, разросшийся после attach, раньше был невидим — attach его отклоняет, а разрастание ловилось только при сборке контекста TOO LARGE-блоком) + сводка «N/M in context» в заголовке AttachList (missing/tooLarge — блокирующие; stale — нет: stale-файл перечитывается и попадает актуальной версией). Тип `SessionReferenceAttachment.tooLarge`. Тест tooLarge: attach при дефолтном лимите → MAX='5' → `tooLarge: true`.
- **3.8 .env.example.** `MAX_REFERENCE_FILE_SIZE` (+семантика post-attach-разрастания) задокументирован рядом с CONTEXT_BASE_DIR.
- **Доки §7.** #128–130 — дословно по формулировкам владельца (SQL precedence, GET /api/projects/:id, walkProjectFiles); #131–132 — семантика mtimeStale/отказ по 3.2 и tooLarge-бейдж.

**Отклонено (решил «нет»).**
- **3.2 filesMissing при !CONTEXT_BASE_DIR** — оставлено: (а) состояние самозаживляется после настройки env, ничего не теряется; (б) причина уже объясняется красным баннером §5.1 в той же панели; (в) третье состояние (`missingReason`) расширяет контракт §3.7 ради transient-состояния, невидимого в норме (attach невозможен без базы — панель disabled); (г) с точки зрения сборки контекста файл действительно недоступен — `missing: true` честно.
- **3.3/3.5/3.6/3.7** — уже ок (cleanup tmp в finally; иммутабельный снимок attachments_meta; regex корректны; default research), правок не требуют.

**Гейты:** `npm run test:backend` (149/149), `npm run lint` (--max-warnings 0), `test:run`, `npm run build`.

**Статус:** ✅ докоммичено в ветку `tz/project-mode` (PR #17); merge — за владельцем.

## 2026-11-11 — BACKLOG актуализирован и возвращён в корень (ветка `tz/backlog-refresh`)

**Запрос владельца.** Вердикты по бэклогу после приёмки PR #17: #3/#4 — устарели и не подтверждаются, #5 — исполнен владельцем (`frontend/public/` отсутствует, `server/public/vad-assets/` на месте — проверено по репо). Взять в текущий трек #6 (binary-safe extraction) + #7 (code-splitting) + #2 (статус-точки провайдеров); создать `BACKLOG.md` в корне репозитория.

**Сделано.** `git mv docs/BACKLOG.md BACKLOG.md` (история сохранена) + переписан: секция «В работе» (#2/#6/#7 — с точными фактами кода: dropdown-фильтр `status === 'connected'`, utf-8 в `extractFromPaths` и `buildLLMContext`, размеры чанков index 1258 kB / elk 1515 kB), секция «Отложенные» (E2E Playwright; llama.cpp vision — TODO #121; PROJECT vision — RESEARCH-only; RAG/Tree-sitter/watch/streaming — ТЗ `docs/plans/RAG/1783463502202-vector-db-repo-indexing-final.md`; отложенное создание сессии — ТЗ `docs/plans/1784201363408-deferred-session-creation.md`; multi-project; git-интеграция), секция «Закрыто/устарело» (#3/#4 устарели, #5 исполнено — с датой вердикта). Карта PROJECT_CONTEXT §10 и README-дерево обновлены под новый путь. Трек #2/#6/#7 стартует после подтверждения владельцем объяснения проблемы/пользы (запрошено владельцем).

**Статус:** ✅ docs-only PR (`tz/backlog-refresh` → `main`); merge — за владельцем.

## 2026-11-11 — BACKLOG #6: восстановление извлечения текста из документов (ветка `tz/doc-extraction`)

**Запрос владельца.** «Проблему подтверждаю. Но решение странное. Что нам нужно? Мы хотим сохранить извлеченный текст в extracted_text... в package.json есть пакеты предназначенные для извлечения текста» — исследовать реализованную функциональность, потом решение. #7/#2 — вернулись в BACKLOG (исправлено в PR #18).

**Исследование (до кода).** Пакеты есть: `pdfjs-dist@^5.4.149`, `word-extractor@^1.0.4`, `xlsx@^0.18.5` — но жив только readability-стек в `webService.js` (URL). Регрессия PR #16 (`4a59734`): `fileService.processDocument` (pdfjs → getTextContent постранично, word-extractor → getBody, xlsx → sheet_to_csv первого листа) демонтирован вместе с инлайн-документами; `attachmentRepo.extractFromPaths` остался `fs.readFile(path, 'utf-8')` — PDF в `extracted_text` = сырой байтовый поток (`%PDF-1.6...FlateDecode`), и этот шум инлайнится в `[Материалы]` (contextBuilder: непустой extracted_text → блок). В PROJECT — то же через чтение reference с диска. Мой прежний план «binary-detection + блок-заглушка» отозван: парсим и сохраняем текст (подход подтверждён владельцем).

**Реализация.** Новый `server/src/utils/docExtract.js`: `extractText(buffer, filename)` (async) — `.pdf` → pdfjs legacy (`pdfjs-dist/legacy/build/pdf.mjs`, постранично, `destroy()` в finally), `.doc/.docx` → word-extractor (`getBody()`), `.xls/.xlsx/.csv` → xlsx (первый лист, `Sheet: <имя>` + csv — как в старом processDocument), прочее → utf-8 as-is; `isDocExtractPath` + `DOC_EXTRACT_EXTENSIONS` (.pdf/.doc/.docx/.xls/.xlsx/.csv). Точки: (1) `extractFromPaths` — `fs.readFile` без encoding → `extractText`; ошибка парсера → `errors[]` (файл не попадает в реестр с мусором — существующий контракт ошибок chatController warn); (2) `buildLLMContext` PROJECT reference — при перечитке doc-расширения через `extractText(fs.readFileSync(abs), filename)`, mtime-кэш прежний, ошибка парсера → внешний catch → MISSING-блок (мусор не инлайнится). buildLLMContext уже async — рефакторинга не потребовалось.

**Тесты (red-first, 162/162, было 149, +13).** Красный подтверждён (4 поведенческих падения до правок). `tests/helpers/pdf-fixture.js` — генератор минимального валидного PDF 1.4 (честный xref, чтобы pdfjs не уходил в recovery). `tests/utils/docExtract.test.js` (8): PDF текстовый слой / битый → reject / XLSX через XLSX.write / CSV / utf-8 as-is / isDocExtractPath / ровно 6 расширений. attachmentRepo (+3): PDF → extracted_text = извлечённый текст без `%PDF`; CSV → Sheet+данные; битый PDF → errors[] и файл НЕ в реестре. contextBuilder (+2): reference .pdf → `[Материалы]` с текстом слоя, `(актуальная версия)`, mtime-кэш установлен, filesMissing/TooLarge пусты; битый .pdf → MISSING-блок, сырое содержимое не инлайнится.

**Ограничения (честно).** word-extractor официально заявляет старый `.doc`; `.docx` идёт тем же путём (как в старом коде) — ручной смоук на реальном .docx за владельцем, при неудаче fallback честный: errors[] / MISSING (без мусора). Сканы PDF без текстового слоя → пустой извлечённый текст (OCR — пакетов нет, отдельная тема). `destroy()` в finally — батчевые extract-и не копят воркер.

**Гейты:** `npm run test:backend` ✓ 162/162 (red-first: 4 падения до правок) · lint/vitest/build — фронт не менялся, прогнаны для DoD.

**Ручной смоук на реальных документах — на владельце (DoD):** PDF с текстовым слоем → ответ по содержимому; `.docx` → текст извлечён; скан-PDF → честная пустота/ошибка, без `%PDF`-мусора.

**Статус:** ✅ исполнено одним PR (`tz/doc-extraction` → `main`); merge — за владельцем. После merge: перенести #6 в «Закрыто» BACKLOG.

## 2026-11-11 — ТЗ attachment-cascade: каскадная очистка реестра attachments (ветка `tz/attachment-cascade`)

**Запрос владельца.** «Сообщение удаляется из БД, но записи в attachments остаются» — исследовать. Исследование показало: это зафиксированная orphan-политика финального ТЗ context-data-storage (вердикт 2026-11-10, «orphan-файлы — предмет будущего File Manager»), а не баг. Владелец решил: **Вариант B** — чистить строки реестра, файлы на диске не трогать (картинки — для будущего File Manager); принцип реиспользования extracted_text по fileId/path **отменяется** (историческая причина orphan-политики; так и не был реализован); каскад — на уровне БД, если возможно. «Если согласен — твоё ТЗ». ТЗ `docs/plans/attachment-cascade-cleanup.md`, вердикт «start».

**Исследование (до кода).** Связь attachments↔messages — только JSON-снапшот `attachments_meta`, FK нет: строки переживают удаление сообщения и становятся недостижимым балластом (contextBuilder собирает fileIds только из meta живых сообщений; UI-список — только reference). По kind: document/code — `file_path=NULL` (мёртвая строка с extracted_text), image — строка + 2 файла на диске, reference — не orphan (пул сессии). Каждая строка document/code/image принадлежит ровно одному сообщению (новый UUID при каждой отправке) — удаление по владельцу безопасно. Смежная дыра: удаление сессии каскадит строки, но файлы остаются навсегда (без изменений — File Manager). `/api/attachments/extract` — мёртвый роут (ни фронт, ни тесты).

**Реализуемость каскада — проверено в песочнице до ТЗ.** better-sqlite3 12.11.1 → SQLite 3.53.2 (JSON1 встроен): FK в CREATE каскадит; FK через `ALTER TABLE ADD COLUMN` (default NULL) работает; backfill по meta через `json_each`/`json_extract` работает; reference (message_id NULL) каскадом не затрагивается; claim на несуществующее сообщение отклоняется FK.

**Реализация (4 коммита).** (1) `init.js`: `message_id TEXT REFERENCES messages(id) ON DELETE CASCADE` в CREATE + guarded ALTER; миграция legacy-БД — backfill claim по meta живых сообщений + однократная очистка накопленного балласта (`kind != 'reference' AND message_id IS NULL` после backfill; счётчики в лог); индекс `idx_attachments_message` — после ensureColumns. (2) `messageRepo.deleteMessagesByQuestionId`: строки чистятся каскадом БД, `deletedAttachments` — реальный COUNT (до DELETE); докблок переписан. `attachmentRepo`: `claimAttachments` (гвард `message_id IS NULL` — не переклеймляет) + `deleteUnclaimedAttachments`. (3) `chatController`: `sentFileIds` только из RESEARCH-веток; claim после успешного `addMessage(user)` (обычная + vision); cleanup незаклеймлённых в catch (inner chat/vision + outer — context-config вне inner-try): проваленная отправка не оставляет строк. `attachmentService` — обёртки. PROJECT-ветка не тронута (reference не клеймится). (4) мёртвый `POST /api/attachments/extract` демонтирован (+ его импорт).

**Тесты (red-first, 174/174, было 162, +12).** init (+2): свежая схема — колонка/FK-действие/индекс/реальный каскад + выживание без message_id; legacy — ALTER + backfill + purge (reference выживает, чужие данные целы, каскад работает на ALTER-колонке). messageRepo: orphan-тест переписан на новую семантику (каскад + реальный deletedAttachments) + reference выживает + соседнее сообщение не тронуто. attachmentRepo (+3): claim/переклейм-гвардия, FK-отказ на ghost-сообщение, unclaimed-only cleanup. chatController (+4): claim на user-сообщение (обычная/vision, файлы остаются на диске), провал → строк нет, PROJECT reference message_id NULL. routes (+1): /extract → 404, строк не появляется. Два legacy-фикстуры поправлены под миграцию: фикстурная строка заклеймлена через meta (иначе purge), sessions-фикстура — без FK на отсутствующий projects (better-sqlite3 проверяет FK на INSERT).

**Гейты:** `npm run test:backend` ✓ 174/174 · фронт не менялся: lint ✓, vitest 111/111 ✓, build ✓.

**Не тронуто (по ТЗ):** файлы на диске (uploads/thumbs — File Manager), reference и attach/detach, PROJECT-ветка, снапшоты meta живых сообщений, `/raw` для удалённых строк отдаёт 404 (фронт их не рендерит).

**Статус:** ✅ исполнено одним PR (`tz/attachment-cascade` → `main`); merge — за владельцем. Ручная проверка на живой БД владельца: удалить Q&A с файлом → записи в attachments исчезают, файлы картинок остаются.

## 2026-11-11 (ночь) — фикс статистики: Size модели + единый процент контекста (ветка `fix/stats-size-context-load`)

**Запрос владельца.** (1) Футер всегда «Size: – GB» — «наверное сервер не шлёт данные; когда-то ранее был». (2) Контекст-бар показывает 12%, диалог Detailed Statistics — Context Load 38% на тех же данных (`5 • 37200/603`, Ctx 98304) — «правильно скорее всего 38%».

**Исследование (по исходникам llama.cpp master+b6000 и Ollama API).** (1) React-футер читает `modelDetail.details.size` — поля нет ни у одного провайдера: llama.cpp `showModel` отдаёт size верхним уровнем (ключа `details` нет вовсе), Ollama `/api/show` отдаёт `details` без size (размер только в `/api/tags`). Регрессия при переписывании на React: оригинальный `public/script.js:468–475` имел фолбэк на размер из списка моделей (`/api/tags`, llama.cpp `meta.size` = `llama_model_size` на b4xxx–b6xxx) — потерян в TZ-1.5a (774fd94). (2) Бар считал серверную char-эвристику `totalChars/(ctx*4)` («4 символа = 1 токен», как `maxChars` в contextBuilder), диалог — реальные токены метрик; на кириллице/коде плотность 1.3–2.5 символа/токен → эвристика занижает в 1.5–3 раза (12% при 38%).

**Реализация.** Фронт: новый `frontend/src/lib/stats.ts` — чистые `computeContextLoadPct` (токеновая формула диалога, кап 100) и `formatSizeGb` (цепочка `modelDetail.size → details.size → models.find(name).size` — фолбэк script.js восстановлен); бар и диалог считают по одной формуле — разойтись не могут; тип `modelDetail` расширен `size?` (providerStore, ModelDetail). Бэк: `LlamaCppProvider.resolveModelSize(meta, props)` — `meta.size` → `fs.stat(props.model_path)` (покрывает master-сборки без meta.size; удалённый/недоступный путь → молча 0), применён в `showModel`. ТЗ: `docs/plans/stats-size-context-load.md`.

**Тесты.** Фронт `stats.test.ts` +8 (кейс владельца (37200+603)/98304→38, кап 100, null-контекст, формат ГБ). Бэк llamaCppProvider +6 (meta.size приоритет; fs.stat по реальному tmp-файлу; каталог→0; недоступный путь→0 без throw; пустая строка size→0 — ollama-совместимый слой b6000 отдаёт `size: ""`). Гейты: backend 180/180 ✓ (было 174) · lint ✓ · vitest 119/119 ✓ (было 111) · build ✓.

**Честный нюанс.** `totalInputTokens` — накопительная сумма полных промптов всех запросов (история пересылается каждым запросом): «Context Load» = «сколько окна сессия израсходовала суммарно», не строгое заполнение последнего промпта (точнее был бы `lastMetrics.inputTokens`, но бар и диалог снова разошлись бы). Для кейса владельца — ожидаемые 38%.

**Статус:** PR `fix/stats-size-context-load` → `main`; merge — за владельцем. Ручная проверка (DoD): Size на llama.cpp и Ollama; бар = диалог по проценту.

## 2026-11-11 (ночь→утро) — ТЗ context-overflow-ux: пре-флайт переполнения контекста + баннер ошибки отправки (ветка `feat/context-overflow-ux`)

**Запрос владельца.** Переполнение контекста: лог — `400 exceed_context_size_error, n_prompt_tokens: 3937667, n_ctx: 98304`; вложение — PDF 5.4 MB. В UI — пара «вопрос-ошибка», F5 её стирает (пары из БД), вопрос пропадает. «Error - F5 как бы не очевиден. И UX сомнительный. Что можно сделать?». По текстовому разбору владелец выбрал: **№1 (пре-флайт с дружелюбным предупреждением до запроса) + №2 (неблокирующий баннер с «Повторить» вместо транзитной пары) + «Не терять вопрос: на фейле возвращать текст в поле ввода»**. ТЗ `docs/plans/context-overflow-ux.md`.

**Исследование (до кода).** (1) Корень аномалии 3.9M токенов (≈40× окна): char-бюджет `maxChars = ctx*4` в buildLLMContext режет только Q&A-историю — `filesContext` ([Материалы], извлечённый текст вложений) входит в промпт **целиком без обрезки** (`availableChars = max(0, maxChars - fixedChars)` зажимается в 0, файлы остаются); в RESEARCH `allFileIds` — из meta ВСЕХ сообщений → PDF реинжектится в каждый запрос. PDF 5.4 MB (стримы deflate ~4×) → ~15–20 MB текста → ~3.9M токенов. (2) Ошибка уходила на фронт без чисел: LlamaCppProvider парсил тело 400 только в лог (фронт получал «Chat error: Bad Request»). (3) Транзитность: сервер пишет пару в БД только после успешного ответа LLM; фронт при фейле оставлял оптимистичный вопрос + добавлял assistant-сообщение с ошибкой через addBotMessage — пара не в БД, лечилась только F5.

**Реализация.** №1: chatController — пре-флайт ДО вызова LLM (та же chars/4-эвристика): `estimatedPromptTokens = ceil((fixedChars + actualHistoryChars + questionChars + 64)/4)`; превышение → `400 {code:'context_overflow', estimatedTokens, contextLength}` без вызова провайдера + cleanup строк реестра (принцип attachment-cascade); vision-ветка не тронута (mmproj токенизирует сам). Проброс чисел: `LlamaCppProvider.parseLlamaCppErrorResponse` (обёртка `{error:{…}}` и плоский JSON, не-JSON → null) → `err.details` → оба catch chatController отдают `n_prompt_tokens/n_ctx/type` верхним уровнем. №2: новый `frontend/src/lib/sendError.ts` — чистая `buildSendErrorInfo` (обе формы overflow, 503, network, generic, строка `result.error` с ECONNREFUSED-текстом, fallback-подсказка как раньше) + `formatTokensCompact` (3.94M / 98K); sessionStore — `sendError`-состояние, `setSendErrorFromException`, `dismissSendError`, `rollbackMessage` (откат оптимистичного вопроса и questionCounter); все три провальные ветки sendMessage больше не создают пары-ошибки; новая отправка гасит предыдущий баннер. chat-area — неблокирующий баннер над композером (только в сессии фейла): заголовок/деталь/моно-числа/«Повторить» (исходный текст + исходные файлы)/крестик; эффект возвращает `failedText` в поле ввода (если не начали печатать новый) и `failedFiles` в композер (если пуст); guard-ошибки в handleSend/handleRetry тоже возвращают вопрос в композер.

**Тесты (red-first не требовался — поведение новое; 189/189 бэк, было 180, +9).** chatController (+4): пре-флайт 400 ДО вызова LLM + строки реестра чистятся; обычный запрос 200; большой файл при достаточном контексте 200 (граница снизу); проброс `n_prompt_tokens/n_ctx/type` в 500. llamaCppProvider (+5): parseLlamaCppErrorResponse — реальное тело владельца, плоский JSON, не-JSON→null, без известных полей→null, строковые числа отбрасываются. Фронт 134/134 (было 119, +15): `sendError.test.ts` +12 (формат чисел, обе формы overflow с кейсом владельца 3937667/98304, 503+fallback, network, generic, строка, failedFiles); sessionStore 10–11 переписаны под баннер (503 → provider_unavailable без пары, 400 → server; rollback counter) + новые 12 (пре-флайт → context_overflow с числами) / 13 (жёсткий 400 → числа в баннере) / 14 (новая отправка гасит sendError). Гейты: backend 189/189 ✓ · lint ✓ · vitest 134/134 ✓ · build ✓ (чанк-warning — BACKLOG #7, не регрессия).

**Не тронуто (осознанно, вне вердикта владельца):** кап/тримминг [Материалы] (политика инъекции файлов — отдельное решение), персистентная плашка на сессию (№3), авто-тримминг с повтором (№5), черновик поля ввода в localStorage (F5 сохранял бы незавершённый текст).

**Статус:** PR `feat/context-overflow-ux` → `main`; merge — за владельцем. Ручная проверка (DoD в ТЗ): большой PDF → баннер с числами, вопрос/файлы в композере, пары в чате нет; «Повторить» повторяет исходную отправку; удаление пары с файлом → повтор проходит; остановка llama-server → «недоступен» + подсказка fallback; обычный диалог — как раньше.

## 2026-11-11 (утро) — ТЗ send-error-persist-actions: персистентная плашка провальной отправки + быстрые действия (ветка `feat/send-error-persist-actions`)

**Запрос владельца.** «merged / делаем №3+4» — после merge PR #22 (context-overflow-ux №1+2: пре-флайт + баннер с «Повторить» и возвратом вопроса в композер). Исходный нумерованный список вариантов был текстом в чате; в ТЗ `context-overflow-ux.md` зафиксированы №3 («персистентная плашка на сессию, переживает F5» — прямая цитата) и №5 (авто-тримминг, не в этом треке); **№4 реконструирован** из подсказки транзитного баннера («удали Q&A-пару с файлом / начни новую сессию») — быстрые действия одним кликом. Интерпретация №4 явно помечена в ТЗ (`docs/plans/send-error-persist-actions.md`) — правка по факту ревью, если владелец подразумевал иное.

**Дыры после №1+2.** (1) F5 стирает инцидент безвозвратно: провальная отправка не пишет в messages (user-месседж — только после ответа LLM), реестр чистится — сессия после перезагрузки «чистая». (2) Подсказка баннера требует ручного поиска пары и Delete под вопросом. (3) Транзитный возврат вопроса в поле ввода умирает с F5.

**Реализация.** №3: `sessions.last_send_error` (TEXT JSON|NULL; CREATE + guarded ALTER по паттерну attachment-cascade; SELECT * отдаёт колонку фронту бесплатно). chatController пишет снапшот `{kind, providerName, failedText, fileNames, estimatedTokens/contextLength (пре-флайт) | nPromptTokens/nCtxTokens (жёсткий 400), message, at}` во все провальные точки (пре-флайт, catch chat, catch vision, outer catch; classifyProviderError — та же классификация, что проброс details) и чистит на успехе (chat+vision перед res.json); запись/очистка в try/catch — не роняют обработчик; `updated_at` не трогается (провал не поднимает сессию в списке). `sessionRepo.setSendError/getSendError` (mусор в JSON → null), роут `DELETE /api/sessions/:id/send-error` (dismiss). Фронт: `buildPersistedSendErrorInfo` (sendError.ts, чистая) + `sessionStore.persistedSendError`, собирается во ВСЕХ 4 точках открытия сессии (init/switchToViewing/returnToCurrent/loadViewingSession; при открытии — сброс в null, плашка не «переезжает»), успех гасит локально, `dismissPersistedSendError` — локально сразу + DELETE best-effort. chat-area: персистентная плашка (приглушённый стиль, бейдж времени `formatSendErrorTime`) показывается при отсутствии транзитного баннера этой сессии. №4: кнопки «Удалить пару с файлом» (только context_overflow И есть пара: `findLatestFileQAPairId` — последняя user-пара с document/code в meta; image/reference исключены — картинки не входят в [Материалы]; optimistic-мета без kind — по mime) через существующий `deleteMessage`, «Новая сессия» через существующий `clearChat` (обе плашки), «Вернуть вопрос в поле ввода» (`setInputValue(failedText)`, только персистентная — File-объекты F5 не переживают, только текст). Ограничения: network-провалы не персистятся (писать некому); вложения после F5 не восстанавливаются (только имена в detail).

**Тесты (203/203 бэк, было 189, +14).** init (+1 fresh-колонка; legacy-тест дополнен ALTER-проверкой), sessionRepo (+6: roundtrip, clear, не-JSON→null, не-объект→null, updated_at не тронут, чужая сессия→null), chatController (+4: пре-флайт→снапшот с числами/at, успех гасит, жёсткий 400→kind context_overflow c nPromptTokens/nCtxTokens, ECONNREFUSED→kind server), роут (+3: dismiss, 404, GET /:id отдаёт колонку). Фронт 153/153 (было 134, +19): sendError (+12: обе формы overflow с кейсом владельца, server-kind, overflow-без-чисел→fallback, мусор→null×7, fileNames-фильтр, isInjectingFileMeta/findLatestFileQAPairId ×4, formatSendErrorTime ×2), sessionStore (+7: 15 switchToViewing→плашка, 16 не переезжает, 17 мусор в столбце, 18 успех гасит, 19 dismiss+DELETE при провале запроса, 20 dismiss без сессии, 21 init-ветка). Гейты: backend 203/203 ✓ · lint ✓ · vitest 153/153 ✓ · build ✓ (чанк-warning — BACKLOG #7).

**Не тронуто (осознанно):** авто-тримминг [Материалы] с повтором (№5 — политика инъекции за владельцем), черновик поля ввода в localStorage, плашка в списке сессий, «Удалить пару с файлом» для PROJECT-reference (управляется правой панелью), очистка плашки при удалении Q&A-пары (честно висит до успеха/dismiss).

**Статус:** PR `feat/send-error-persist-actions` → `main`; merge — за владельцем. Ручная проверка (DoD в ТЗ): большой PDF → баннер → F5 → персистентная плашка с временем и восстановлением вопроса; «Удалить пару с файлом» → повтор проходит; «Новая сессия»; крестик переживает F5; успех гасит; ECONNREFUSED → плашка с текстом; обычный диалог — как раньше.
## 2026-11-11 (день) — ТЗ adaptive-context-budget: адаптивный бюджет истории (№3) + кап на message (№4) (ветка `feat/adaptive-context-budget`)

**Запрос владельца.** Вердикт «делаем №3+4» после merge PR #22. Владелец восстановил исходный нумерованный список (давался текстом в чат, в репо не попал): №3 — «Корень — адаптивный бюджет… измеренная плотность charsPerToken = totalChars/prompt_n прошлого ответа; бюджет = ctx * измеренная_плотность * 0.9. На кириллице бюджет сам ужмётся в ~2–3 раза»; №4 — «Кап на message. Вставка длиннее ~64К символов → мгновенный 400 с понятным текстом». **Расхождение нумерации:** ветка `feat/send-error-persist-actions` (ждёт merge) исполнила ДРУГУЮ пару под этими номерами (персистентная плашка + быстрые действия) — реконструкцию из старой внутренней нумерации ТЗ context-overflow-ux; работа ценная сама по себе, но пункты 3/4 списка владельца — не она. Этот трек закрывает именно их. ТЗ `docs/plans/adaptive-context-budget.md`.

**Исследование (до кода).** (1) Бюджет истории: `maxChars = ctx*4` — эвристика под английский; на кириллице/коде реальная плотность 1.3–2.5 симв/токен → бюджет завышен в 1.6–3 раза, переполнение ловил только пре-флайт/400 вместо честного тримминга. (2) Источник «реальных prompt_n»: README llama-server — `timings.prompt_n` = «number of prompt tokens being processed» (БЕЗ кэш-хитов; хиты — `cache_n`); при включённом слот-кэше prompt_n — размер ХВОСТА промпта, плотность по нему завышалась бы на порядки на каждом кэш-ходе. Полный промпт — `usage.prompt_tokens` (slot.n_prompt_tokens, то же поле, что в 400-ошибке). Ollama полного счётчика не отдаёт.

**Реализация.** №3: `extractLlamaCppMetrics` — inputTokens = полный промпт (цепочка `usage.prompt_tokens` → `prompt_n + cache_n` → `prompt_n`; promptTps остался на timings — он про обработанные токены; +`cachedTokens` в metrics) — заодно бар #21 перестаёт недосчитывать кэш-хиты. chatController (chat-ветка, успех) пишет в metrics assistant-сообщения `promptChars` (fixedChars + actualHistoryChars + questionChars + 64 — числитель тот же, что у пре-флайта; vision-ветка не пишет — mmproj). contextBuilder: экспорт `resolveCharsPerToken(messages)` — с конца первая assistant-метрика с `promptChars>0`, `inputTokens>=64` и плотностью в полосе [1.0; 5.0] (мусор/вне полосы/vision-ходы пропускаются) → бюджет `floor(ctx * density * 0.9)`; ни одного кандидата → фолбэк `4` БЕЗ запаса (поведение до ТЗ); `info.charsPerToken/charsPerTokenSource/maxChars` в логе и contextInfo. Пре-флайт №1 теперь делит на измеренную плотность этого хода (моки без поля — фолбэк 4). №4: `chatController.MAX_MESSAGE_CHARS = 64000` (экспорт) — первая проверка в try ДО URL-обработки и реестра → мгновенный `400 {code:'message_too_long', messageLength, maxMessageChars}` без persist (строк реестра ещё нет, вопрос откатывается фронтом); фронт: новый `lib/messageCap.ts` (дубликат константы — менять ОБА места, `isMessageOverCap/isMessageNearCap/formatChars`), композер — Send и Enter заблокированы при over-cap + разрушающая подсказка «Слишком длинный ввод: N / 64 000 символов…», нейтральный счётчик при >90% капа; `sendError.ts` — `code:'message_too_long'` → баннер «Слишком длинный ввод» с числами (kind server — не переполнение контекста).

**Тесты (206/206 бэк, было 189, +17; vitest 140/140, было 134, +6).** metricsService (+6): usage-приоритет при кэш-хитах (4880 из кэша + 120 хвост → inputTokens 5000), фолбэк prompt_n+cache_n, старая сборка без usage, мусорный usage, пустой ответ, Ollama-контракт не изменён. contextBuilder (+7): resolveCharsPerToken — фолбэки (пусто/null/мусор), кириллическая метрика → {2, measured}, последний ход вне полосы → предыдущий, promptChars<=0/inputTokens<64 — пропуск, vision-ход пропускается; buildLLMContext — бюджет ctx*2*0.9 с меньшим включением пар, без метрик — maxChars = ctx*4 (поведение до ТЗ). chatController (+4): 64001 → 400 message_too_long (LLM/реестр не задеты), граница 64000 проходит, promptChars в metrics assistant-сообщения (= DEFAULT_SYSPROMPT + вопрос + 64), пре-флайт отклоняет промпт, проходящий chars/4, при измеренной плотности 1.5. Фронт: messageCap.test.ts (+4: границы 64000/64001, зона 90%, формат «64 000»), sendError.test.ts (+2: message_too_long с числами/без). Нюанс тестов: metrics в messageRepo передавать ОБЪЕКТОМ (repo стрингифицирует сам — строка закодировалась бы дважды и честно отфильтровалась). Гейты (после merge origin/main с PR #23): backend 220/220 ✓ · lint ✓ · vitest 159/159 ✓ · build ✓ (чанк-warning — BACKLOG #7, не регрессия).

**Не тронуто (осознанно):** №5 (авто-retry с пересборкой контекста) и кап/тримминг `[Материалы]` — политика инъекции файлов за владельцем; env-конфигурируемость капа; пер-модельная плотность (per-session по формуле владельца «прошлого ответа»).

**Статус:** origin/main (с PR #23) влит в ветку, конфликты BACKLOG/WORKLOG/chat-area/chatController разрешены — обе фичи целы; PR `feat/adaptive-context-budget` → `main`; merge — за владельцем. Ручная проверка (DoD в ТЗ): кириллическая сессия → в логе «Context built» charsPerToken ≈ 1.3–2.5 source=measured, история режется раньше; новый чат → default 4; вставка >64К в композер → Send серый + подсказка, Enter не отправляет; ровно 64 000 уходит; прямой запрос >64К → мгновенный 400 message_too_long.
