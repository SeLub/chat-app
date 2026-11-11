# ТЗ stats-size: размер модели в футере + единый процент контекста

**Статус:** исполнено в ветке `fix/stats-size-context-load` → PR в `main`.
**Источник:** отчёт владельца 2026-11-11 (ночь) — два дефекта статистики.

## Дефект 1 — «Size: – GB» всегда

**Симптом.** Футер: `Qwen3.8-27B-GSQ-RCO-IQ3_S-mtp • Size: – GB • Ctx: 98304 • …` — размер никогда не заполнен; по словам владельца, «когда-то ранее был».

**Корневая причина (проверено по исходникам llama.cpp и Ollama API).**
React-футер (`chat-area.tsx`, StatFooter) читает `modelDetail.details.size` — поля, которого **не существует ни у одного провайдера**:

- llama.cpp `showModel` (наш ответ из `/props` + `/v1/models`) отдаёт size **верхним уровнем**: `{ model, size, parameters, … }` — ключа `details` нет вовсе;
- Ollama `/api/show` возвращает `details` **без size** (размер есть только в `/api/tags`).

«Когда-то был»: оригинальный `public/script.js` (строки 468–475) имел цепочку
`data.details.size` → фолбэк `model.size` **из списка моделей** (Ollama `/api/tags` — реальный размер; llama.cpp `/v1/models` `meta.size` — реальный `llama_model_size` на сборках b4xxx–b6xxx). При переписывании на React (TZ-1.5a, 774fd94) фолбэк потерян — регрессия.

Формат размера по сборкам llama.cpp (проверено по исходникам master и b6000):

| Сборка | /v1/models | /props | Источник размера |
|---|---|---|---|
| b4xxx–b6xxx (single-model) | `meta.size` = `llama_model_size` ✓ | `model_path` ✓ | `meta.size`, иначе `fs.stat(model_path)` |
| master (router) | `meta` без size (есть `memory` — RAM, не файл) | `model_path` (у router — заглушка) | только `fs.stat`, иначе «–» |

**Решение.**
- Фронт (`frontend/src/lib/stats.ts` → `formatSizeGb` + StatFooter): цепочка источников `modelDetail.size` (llama.cpp, верхний уровень) → `modelDetail.details.size` (legacy-форма) → `models.find(name).size` (фолбэк оригинального script.js; Ollama здесь всегда даёт реальный размер) → «–».
- Бэк (`LlamaCppProvider.resolveModelSize(meta, props)`): `meta.size` → `fs.stat(props.model_path)` (штатная схема — llama-server на той же машине; удалённый/недоступный путь → молча 0). Используется в `showModel` вместо голого `modelMeta.size || 0`.

## Дефект 2 — бар 12% vs диалог 38%

**Симптом.** Хедер-бар: `5 • 37200/603 • 12%`; диалог Detailed Statistics: `Context Load 38%` при тех же данных (Ctx 98304).

**Корневая причина.** Две разные формулы на разных данных:

- бар: `contextInfo.totalChars / (contextInfo.contextSize * 4)` — серверная char-эвристика «4 символа = 1 токен» (contextBuilder `maxChars = contextSize * 4`, ей сервер решает, какие QA-пары влезают);
- диалог: `(totalInputTokens + totalOutputTokens) / currentContextLength` — реальные токены из метрик llama.cpp.

Для кириллицы и кода реальная плотность 1.3–2.5 символа/токен → char-эвристика занижает в 1.5–3 раза: бар 12% при фактических 38%. Ориентир владельца — 38%.

**Решение.** Обе точки (бар и диалог) считают через один хелпер `computeContextLoadPct(totalTokens, contextLength)` — токеновая формула диалога, кап 100% (при тримминге накопительная сумма растёт, фактический контекст ограничен окном). Разойтись они больше не могут.

**Честный нюанс.** `totalInputTokens` — накопительная сумма полных промптов всех запросов сессии (каждый запрос пересылает историю), т.е. метрика «сколько окна сессия израсходовала суммарно», а не строгое заполнение последнего промпта (точнее был бы `lastMetrics.inputTokens`, но тогда бар и диалог снова разошлись бы). Для кейса владельца — ровно ожидаемые 38%.

## Гейты

`npm run test:backend` 180/180 (+6 `resolveModelSize`) · lint (--max-warnings 0) ✓ · vitest 119/119 (+8 `stats.test.ts`) · build ✓.

## Ручная проверка (владелец, DoD)

1. llama.cpp: футер «Size: X.X GB» (meta.size или fs.stat по model_path).
2. Ollama: футер «Size: X.X GB» (фолбэк из списка моделей).
3. Бар и диалог показывают **одинаковый** процент.
