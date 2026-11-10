# BACKLOG — отложенные задачи

> Задача берётся в работу только по прямому указанию владельца (отдельным ТЗ).
> Порядок и объём очередного трека определяет владелец.
>
> **2026-11-11, актуализация владельцем:** #3 и #4 устарели и не подтверждаются,
> #5 исполнен (см. «Закрыто / устарело»); добавлены новые отложенные направления.
> #2, #6, #7 взяты в текущий трек.

## В работе (текущий трек — #2, #6, #7)

| # | Источник | Задача |
|---|----------|--------|
| 2 | ТЗ «Миграция на React», п. C.4 | Статус-точки провайдеров в provider-dropdown (`bg-success`/`bg-muted`/`bg-warning`). Сейчас dropdown показывает **только** подключённых провайдеров (`chat-area.tsx` фильтрует `status === 'connected'`); API отдаёт `connected`/`disconnected`/`error` — показать всех с цветными точками статуса |
| 6 | WORKLOG Фазы B — «Ограничение (вне скоупа ТЗ)» | **Binary-safe extraction**: `attachmentRepo.extractFromPaths` читает файл как utf-8 — для бинарных PDF/DOCX `extracted_text` в БД = шум. В PROJECT-режиме дыра шире: `buildLLMContext` читает reference с диска тоже utf-8 — attach бинарника → шум прямо в `[Материалы]` |
| 7 | Логи сборки (гейты всех треков) | **Code-splitting** фронтенда: vite warning «chunks larger than 500 kB» — `index` 1258 kB (gzip 375), `elk` 1515 kB (gzip 464; mermaid/highlight.js/elk) — `build.rollupOptions.output.manualChunks` / dynamic `import()` |

## Отложенные (в работу — по ТЗ владельца)

| Направление | ТЗ / источник |
|-------------|---------------|
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
| 1 | E2E Playwright | Перенесён в «Отложенные» (2026-11-11) |
| 3 | «Таблица `attachments` пуста после сообщения с вложением» (Фаза B) | **Устарело**: PR #16 демонтировал инлайн-документы — файлы всегда идут через реестр attachments; владелец 2026-11-11: не подтверждается |
| 4 | Демонтаж правой панели `SettingsPanel` | **Устарело**: панель — живой UI Project mode (PR #17); владелец 2026-11-11: не подтверждается |
| 5 | Удаление `public/`, переезд vad-assets → `server/public/` | **Исполнено**: `frontend/public/` отсутствует, `server/public/vad-assets/` на месте; владелец 2026-11-11: сделано |
