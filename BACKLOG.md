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
>
> **2026-11-11, ночь/утро:** stats-size исполнен (PR #21), context-overflow-ux №1+2
> исполнен (PR #22), send-error-persist-actions исполнен (PR #23) — все смержены
> владельцем. Реальные №3+4 (адаптивный бюджет + кап message) исполнены — PR #24
> (смержен 5354f71). №5 (авто-retry) отложен владельцем в «Отложенные».
> Текущий трек: актуализация README (docs/readme-actualization).


## Отложенные (в работу — по ТЗ владельца)

| Направление | ТЗ / источник |
|-------------|---------------|
| №5 — авто-retry с пересборкой контекста | Восстановленный список владельца, п.5 + вердикт владельца 2026-11-11: «откладываем в бэклог». Суть: при жёстком 400 llama.cpp (`exceed_context_size_error`, известны `n_prompt_tokens`/`n_ctx`) сервер один раз пересобирает контекст с коэффициентом `(n_ctx*0.9)/n_prompt_tokens` и повторяет — юзер не видит ошибки, в логе «retry, ужато в N раз». Обсуждение 2026-11-11: польза узкая — только остаточные кейсы после PR #24 (расхождение оценки и реального токенизатора: смена модели в сессии, аномально плотный контент, эвристичный счётчик Ollama); **не решает** file-driven переполнение (`[Материалы]` не режется — guard: если fixedChars+question сами ≥ лимита, не ретраить); обязательны прозрачность (`info.retried/trimFactor`, пометка в UI — иначе тихая потеря истории) и ровно один retry. Решать по данным — частота жёстких 400 в логах после недели реального использования |
| 2 — статус-точки провайдеров | ТЗ «Миграция на React», п. C.4: dropdown показывает только подключённых (`chat-area.tsx` фильтрует `status === 'connected'`); API отдаёт `connected`/`disconnected`/`error` — показать всех с точками `bg-success`/`bg-muted`/`bg-warning`. Возвращён в отложенные (вердикт владельца 2026-11-11) |
| 7 — code-splitting | vite warning «chunks larger than 500 kB»: `index` 1258 kB (gzip 375), `elk` 1515 kB (gzip 464; mermaid/highlight.js/elk) — `manualChunks` / dynamic `import()`. Возвращён в отложенные (вердикт владельца 2026-11-11) |
| E2E Playwright смоук | ТЗ «Миграция на React», п. E.2 — `frontend/e2e/`, devDep `@playwright/test`, 11 сценариев |
| llama.cpp vision | TODO в `LlamaCppProvider.js` (PROJECT_CONTEXT #121): поле `images` на message — формат Ollama; llama.cpp `/v1/chat/completions` его не стандартизует — vision гарантирован только для Ollama |
| PROJECT-режим: vision/картинки | ТЗ Project mode A — RESEARCH-only в этом ТЗ; расширение по желанию владельца |
| RAG / vector DB (Qdrant), Tree-sitter, watch/индексация, streaming | ТЗ `docs/plans/RAG/1783463502202-vector-db-repo-indexing-final.md` (Qdrant :6333, mxbai-embed-large в RAM через llama.cpp, Tree-sitter AST, hybrid search, SHA-256 incremental indexing, streaming) |
| Отложенное создание сессии в БД | ТЗ `docs/plans/1784201363408-deferred-session-creation.md` (pending-сессия: UUID в localStorage, запись в БД при первом сообщении; указано владельцем в кластере PROJECT-расширений) |
| Multi-project | ТЗ Project mode A (вариант A — один проект на сессию) |
| Git-интеграция | ТЗ Project mode A (вне скоупа) |
| Reasoning-модели: UI для reasoning_content + подсказки AI-helper | ТЗ answer-loss-diagnostics (2026-11-12, ветка `fix/answer-loss-diagnostics`): collapsible-панель размышлений в чате (сейчас preview 1200 симв в content), отключение/ограничение мышления per-request (`chat_template_kwargs`, не проверено на сборке владельца); `generateHint` AI-helper ходит в llama.cpp без max_tokens — подсказка ждёт окончания reasoning (инцидент: 2301 токен вместо 1–3 предложений) |

## Закрыто / устарело

| # | Что | Итог |
|---|-----|------|
| adaptive-context-budget (реальные №3+4 из восстановленного списка владельца) | Адаптивный бюджет истории + кап на message | **Исполнено**: PR #24 (`feat/adaptive-context-budget`, смержен 5354f71) — №3: бюджет истории по измеренной плотности (`resolveCharsPerToken`: promptChars из chatController / inputTokens — полный промпт llama.cpp, `usage.prompt_tokens` → `prompt_n+cache_n` → `prompt_n`; полоса [1.0; 5.0], фолбэк 4 без запаса; `maxChars = ctx*density*0.9`; пре-флайт на той же плотности; `info.charsPerToken/charsPerTokenSource/maxChars`); №4: кап message 64 000 симв (`chatController.MAX_MESSAGE_CHARS` → мгновенный 400 `message_too_long`; фронт `messageCap.ts` — блок Send/Enter, счётчик при >90% капа, баннер с числами). С merge main (PR #23): backend 220/220, vitest 159/159. №5 (авто-retry) — отложен владельцем |
| send-error-persist-actions (реконструкция «№3+4») | Персистентная плашка провальной отправки + быстрые действия | **Исполнено**: PR #23 (`feat/send-error-persist-actions`, смержен da936b2) — `sessions.last_send_error` (CREATE + guarded ALTER), снапшот провала во всех точках chatController (пре-флайт/catch chat/vision/outer), clear на успехе, dismiss `DELETE /api/sessions/:id/send-error`; фронт: `persistedSendError` в 4 точках открытия сессии, приглушённая плашка (переживает F5), кнопки «Удалить пару с файлом»/«Новая сессия»/«Вернуть вопрос». 203/203, vitest 153/153. Нумерация: под «№3+4» здесь другая пара (реконструкция внутренней нумерации ТЗ context-overflow-ux); реальные №3+4 — PR #24 |
| context-overflow-ux (№1+2) | UX переполнения контекста: пре-флайт + баннер вместо пары-ошибки («Не терять вопрос») | **Исполнено**: PR #22 (`feat/context-overflow-ux`, смержен 18e6e3c) — серверный пре-флайт ДО вызова LLM (с PR #24 — на измеренной плотности), `400 {code:'context_overflow'}`, cleanup реестра; проброс чисел жёсткого 400 llama.cpp (`parseLlamaCppErrorResponse` → details → фронт); транзитная пара демонтирована: `sendError`-баннер с «Повторить» и возвратом вопроса/вложений в композер. Продолжение трека: №3+4 → `adaptive-context-budget` (закрыто PR #24) |
| stats-size | Футер «Size: – GB» + расхождение бар/диалог (12% vs 38%) | **Исполнено**: PR #21 (`fix/stats-size-context-load`, смержен) — `frontend/src/lib/stats.ts`: `computeContextLoadPct` (единая токеновая формула, кап 100) и `formatSizeGb` (цепочка `modelDetail.size → details.size → models.find(name).size`); `LlamaCppProvider.resolveModelSize` (`meta.size → fs.stat(props.model_path)`). 180/180, vitest 119/119 |
| cascade | Каскадная очистка реестра attachments (Вариант B + FK на уровне БД) | **Исполнено**: PR #20 (`tz/attachment-cascade`) — `attachments.message_id` FK ON DELETE CASCADE (fresh CREATE + guarded ALTER); миграция legacy-БД (backfill по meta живых сообщений + очистка балласта); claim строк после успешного addMessage, cleanup незаклеймлённых при провале LLM; deletedAttachments — реальный count; reference не каскадится; файлы на диске не удаляются (File Manager); мёртвый POST /api/attachments/extract демонтирован; 174/174, red-first |
| 6 | Восстановить извлечение текста из документов (утрачено в PR #16) | **Исполнено**: PR #19 (`tz/doc-extraction`) — `extractText(buffer, filename)` (pdfjs/word-extractor/xlsx) в extractFromPaths + buildLLMContext, без новых зависимостей; 162/162, red-first. Ограничения: .docx — смоук на реальном файле за владельцем; скан-PDF без текстового слоя → пустой текст (OCR — отдельная тема) |
| 1 | E2E Playwright | Перенесён в «Отложенные» (2026-11-11) |
| 3 | «Таблица `attachments` пуста после сообщения с вложением» (Фаза B) | **Устарело**: PR #16 демонтировал инлайн-документы — файлы всегда идут через реестр attachments; владелец 2026-11-11: не подтверждается |
| 4 | Демонтаж правой панели `SettingsPanel` | **Устарело**: панель — живой UI Project mode (PR #17); владелец 2026-11-11: не подтверждается |
| 5 | Удаление `public/`, переезд vad-assets → `server/public/` | **Исполнено**: `frontend/public/` отсутствует, `server/public/vad-assets/` на месте; владелец 2026-11-11: сделано |
