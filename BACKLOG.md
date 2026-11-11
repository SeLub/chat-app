# BACKLOG — отложенные задачи

> Задача берётся в работу только по прямому указанию владельца (отдельным ТЗ).
> Порядок и объём очередного трека определяет владелец.
>
> **2026-11-11, актуализация владельцем:** #3 и #4 устарели и не подтверждаются,
> #5 исполнен (см. «Закрыто / устарело»); добавлены новые отложенные направления.
> #6 подтверждён в работе (проблема подтверждена, решение — по итогам исследования
> функциональности: пакеты извлечения уже в package.json — вернуть их в точку
> извлечения, утраченную при демонтаже fileService в PR #16); #2 и #7 — вернулись
> в отложенные (вердикт владельца 2026-11-11).
>
> **2026-11-11, вечер — вердикты владельца:** #6 исполнен (PR #19) и закрыт.
> По orphan-политике реестра (отчёт владельца «записи в attachments остаются после
> удаления сообщения»): **Вариант B** — чистить строки реестра, файлы на диске не
> трогать (картинки — для будущего File Manager); принцип реиспользования
> extracted_text по fileId/path **отменяется** (историческая причина orphan-политики,
> не реализован); каскад — на уровне БД. ТЗ `docs/plans/attachment-cascade-cleanup.md`.

## В работе (текущий трек — context-overflow-ux)

| # | Источник | Задача |
|---|----------|--------|
| context-overflow-ux | Отчёт владельца 2026-11-11 (400 `exceed_context_size_error`, PDF 5.4 MB → 3.9M токенов) + вердикт «Делаем №1+2. Не терять вопрос. На фейле возвращать текст в поле ввода» + ТЗ `docs/plans/context-overflow-ux.md` | **UX переполнения контекста.** Корень аномалии: `[Материалы]` (извлечённый текст вложений) инжектится в промпт целиком без обрезки и в RESEARCH реинжектится каждый запрос (история бюджетом режется, файлы — нет). №1: серверный пре-флайт ДО вызова LLM (та же chars/4) → `400 {code:'context_overflow', estimatedTokens, contextLength}` + cleanup реестра; жёсткий 400 llama.cpp парсится (`parseLlamaCppErrorResponse`) и числа пробрасываются на фронт. №2: транзитная пара «вопрос-ошибка» демонтирована — `sendError`-баннер над композером (kind, деталь, `≈N/M tok`, «Повторить» исходного текста с файлами, крестик), вопрос и вложения возвращаются в поле ввода (F5 больше не «способ убрать ошибку»). **Исполнено в ветке `feat/context-overflow-ux` (backend 189/189, vitest 134/134); после merge перенести в «Закрыто»** |

## Отложенные (в работу — по ТЗ владельца)

| Направление | ТЗ / источник |
|-------------|---------------|
| 2 — статус-точки провайдеров | ТЗ «Миграция на React», п. C.4: dropdown показывает только подключённых (`chat-area.tsx` фильтрует `status === 'connected'`); API отдаёт `connected`/`disconnected`/`error` — показать всех с точками `bg-success`/`bg-muted`/`bg-warning`. Возвращён в отложенные (вердикт владельца 2026-11-11) |
| 7 — code-splitting | vite warning «chunks larger than 500 kB»: `index` 1258 kB (gzip 375), `elk` 1515 kB (gzip 464; mermaid/highlight.js/elk) — `manualChunks` / dynamic `import()`. Возвращён в отложенные (вердикт владельца 2026-11-11) |
| E2E Playwright смоук | ТЗ «Миграция на React», п. E.2 — `frontend/e2e/`, devDep `@playwright/test`, 11 сценариев |
| llama.cpp vision | TODO в `LlamaCppProvider.js` (PROJECT_CONTEXT #121): поле `images` на message — формат Ollama; llama.cpp `/v1/chat/completions` его не стандартизует — vision гарантирован только для Ollama |
| PROJECT-режим: vision/картинки | ТЗ Project mode A — RESEARCH-only в этом ТЗ; расширение по желанию владельца |
| RAG / vector DB (Qdrant), Tree-sitter, watch/индексация, streaming | ТЗ `docs/plans/RAG/1783463502202-vector-db-repo-indexing-final.md` (Qdrant :6333, mxbai-embed-large в RAM через llama.cpp, Tree-sitter AST, hybrid search, SHA-256 incremental indexing, streaming) |
| Отложенное создание сессии в БД | ТЗ `docs/plans/1784201363408-deferred-session-creation.md` (pending-сессия: UUID в localStorage, запись в БД при первом сообщении; указано владельцем в кластере PROJECT-расширений) |
| Multi-project | ТЗ Project mode A (вариант A — один проект на сессию) |
| Git-интеграция | ТЗ Project mode A (вне скоупа) |

## Закрыто / устарело

| # | Что | Итог |
|---|-----|------|
| stats-size | Футер «Size: – GB» + расхождение бар/диалог (12% vs 38%) | **Исполнено**: PR #21 (`fix/stats-size-context-load`, смержен) — `frontend/src/lib/stats.ts`: `computeContextLoadPct` (единая токеновая формула, кап 100) и `formatSizeGb` (цепочка `modelDetail.size → details.size → models.find(name).size`); `LlamaCppProvider.resolveModelSize` (`meta.size → fs.stat(props.model_path)`). 180/180, vitest 119/119 |
| cascade | Каскадная очистка реестра attachments (Вариант B + FK на уровне БД) | **Исполнено**: PR #20 (`tz/attachment-cascade`) — `attachments.message_id` FK ON DELETE CASCADE (fresh CREATE + guarded ALTER); миграция legacy-БД (backfill по meta живых сообщений + очистка балласта); claim строк после успешного addMessage, cleanup незаклеймлённых при провале LLM; deletedAttachments — реальный count; reference не каскадится; файлы на диске не удаляются (File Manager); мёртвый POST /api/attachments/extract демонтирован; 174/174, red-first |
| 6 | Восстановить извлечение текста из документов (утрачено в PR #16) | **Исполнено**: PR #19 (`tz/doc-extraction`) — `extractText(buffer, filename)` (pdfjs/word-extractor/xlsx) в extractFromPaths + buildLLMContext, без новых зависимостей; 162/162, red-first. Ограничения: .docx — смоук на реальном файле за владельцем; скан-PDF без текстового слоя → пустой текст (OCR — отдельная тема) |
| 1 | E2E Playwright | Перенесён в «Отложенные» (2026-11-11) |
| 3 | «Таблица `attachments` пуста после сообщения с вложением» (Фаза B) | **Устарело**: PR #16 демонтировал инлайн-документы — файлы всегда идут через реестр attachments; владелец 2026-11-11: не подтверждается |
| 4 | Демонтаж правой панели `SettingsPanel` | **Устарело**: панель — живой UI Project mode (PR #17); владелец 2026-11-11: не подтверждается |
| 5 | Удаление `public/`, переезд vad-assets → `server/public/` | **Исполнено**: `frontend/public/` отсутствует, `server/public/vad-assets/` на месте; владелец 2026-11-11: сделано |
