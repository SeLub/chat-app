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

## В работе (текущий трек — #6)

| # | Источник | Задача |
|---|----------|--------|
| 6 | WORKLOG Фазы B + исследование 2026-11-11 | **Восстановить извлечение текста из документов.** История: `fileService.processDocument` (pdfjs-dist для PDF, word-extractor для DOC/DOCX, xlsx для XLSX/CSV — честный текст в промпт) демонтирован в PR #16 вместе с инлайн-документами; переезд на реестр attachments потерял парсеры: `attachmentRepo.extractFromPaths` читает любой файл как utf-8 → PDF в `extracted_text` = сырой байтовый поток (`%PDF-1.6...FlateDecode`-мусор), и этот шум попадает в `[Материалы]` (contextBuilder инлайнит непустой extracted_text). В PROJECT — то же через чтение reference с диска. Пакеты остались в package.json (pdfjs-dist/word-extractor/xlsx — сейчас использует только webService для URL). Решение: единая `extractText(buffer, filename)` → extractFromPaths (kind=document) + buildLLMContext (reference с бинарным расширением, с mtime-кэшем); без новых зависимостей. **Исполнено в ветке `tz/doc-extraction` (162/162, red-first); после merge перенести в «Закрыто»** |

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
| 1 | E2E Playwright | Перенесён в «Отложенные» (2026-11-11) |
| 3 | «Таблица `attachments` пуста после сообщения с вложением» (Фаза B) | **Устарело**: PR #16 демонтировал инлайн-документы — файлы всегда идут через реестр attachments; владелец 2026-11-11: не подтверждается |
| 4 | Демонтаж правой панели `SettingsPanel` | **Устарело**: панель — живой UI Project mode (PR #17); владелец 2026-11-11: не подтверждается |
| 5 | Удаление `public/`, переезд vad-assets → `server/public/` | **Исполнено**: `frontend/public/` отсутствует, `server/public/vad-assets/` на месте; владелец 2026-11-11: сделано |
