# План глобальной реструктуризации: `server/` + `frontend/`

> Статус: **ВЕРДИКТЫ ВЛАДЕЛЬЦА ПРИНЯТЫ (2026-11-09)** — D1 pnpm · D2 исполнено досрочно · D3 исполнено частично (`test-mic.html`) · D4/D5/D6 — как рекомендовано.
> Досрочные меры исполнены в PR #8 (закрытие трека): pnpm по умолчанию, `ai_helper.db` untrack → `data/`, архив `test-mic.html`.
> Исполнение остального — отдельным треком (`tz/restructure-*`). Составлен 2026-11-08 по прямому указанию владельца.
> Базовые гейты на `main` (`57a3ba4`): build ✓ · lint ✓ · test:run 88/88 · test:backend 59/59.

## 1. Цель

Верхний уровень репозитория — две директории кода: `server/` (бэкенд) и `frontend/`
(переименованный `webq98/`). Корень очищается от всего, что не является кодом/инфраструктурой.
История `git mv` сохраняется. Работоспособность (`:3000` отдаёт SPA, API, WS, vad-assets,
whisper, docker-compose) — не ломается.

## 2. Аудит текущего корня (18 записей)

| Файл/папка | Что это | Вердикт |
|---|---|---|
| `src/` | бэкенд (Express + better-sqlite3 + WS) | → `server/src/` |
| `tests/` | backend-тесты (`node --test`, 59) | → `server/tests/` |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | **бэкенд-**манифест (start/whisper/test:backend); lock обновлён 2026-11-09 (устарел после TZ-F.6 — содержал фронтовые devDeps) | → `server/` |
| ~~`package-lock.json`~~ (корень и `webq98/`) | npm-артефакты двойного пакетного менеджера — **удалены 2026-11-09 (D1: pnpm по умолчанию)**; в `webq98/` добавлен свой `pnpm-lock.yaml` | — |
| `scripts/whisper.sh` | STT-инфраструктура (пути внешние: `/home/selub/...`) | → `server/scripts/` |
| `public/` (только `vad-assets/`) | VAD/ORT-ассеты, раздаются `app.js` | → `server/public/vad-assets/` |
| `uploads/` (gitignored) | runtime-файлы (multer diskStorage, изображения) | → `server/uploads/` (создаётся автоматически) |
| `ai_helper.db` | был затрекчен в git (анти-паттерн: бинарные данные в VCS). **Исполнено 2026-11-09 (D2):** `git rm --cached` → `data/ai_helper.db` (untracked, gitignore `data/*.db*`). Файл пуст (0 строк) — таблицы ai-helper живут в `data/chat.db` (общий `getDb()`) | ✅ исполнено |
| `data/` (в git: только `.gitkeep`) | runtime-каталог БД (`data/*.db*` gitignored, 2026-11-09; покрывает `chat.db*` и `ai_helper.db*`) | → `server/data/` |
| `webq98/` | фронтенд (React 18 + Vite 6 + Tailwind 4) | → `frontend/` (переименование) |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | артефакты pnpm; workspace-файл НЕ workspace (только `allowBuilds` для нативных сборок) — **остаются: D1 → pnpm по умолчанию** | → `server/` |
| `plans/` | ТЗ-документы трека (+ `DONE/`) | → `docs/plans/` |
| `docs/` | `AI_HELPER_STT.md`, `reference/public-archive/` | остаётся, пополняется |
| `BACKLOG.md`, `WORKLOG.md`, `WORKFLOW.md` | процесс-документы коллаборации | → `docs/` (рекомендация) или корень (D4) |
| `README.md` | инструкция (содержит **битую ссылку** `run-ollama-docker.sh` — файла нет) | корень; правится |
| `docker-compose.yml` | инфраструктура провайдера (ollama, GPU, 48G) | корень (или `infra/` — D5) |
| `.env.example` | шаблон конфига бэкенда (PORT, OLLAMA_URL…) | → `server/.env.example` |
| `select_dir/` (index.html, script.js) | ad-hoc эксперимент, затрекчен с baseline | архив `docs/reference/legacy-scratch/` (R.4) |
| `test-mic.html` | ad-hoc проверка микрофона — **архивирован 2026-11-09 (D3)**: `docs/reference/legacy-scratch/test-mic.html` | ✅ исполнено |
| `test-ai-helper-repo.js` | ad-hoc проверка репозитория, затрекчен с baseline | архив `docs/reference/legacy-scratch/` (R.4) |
| `.gitignore` | паттерны без якорей (`uploads/`, `dist/`, `data/*.db*` с 2026-11-09) — переживают переезд без правок | корень (проверка после mv) |
| `.kilo/`, `.kilocodeignore`, `.vscode/` | конфиги инструментов/редактора | корень (не трогаем) |

**Вывод аудита:** ни один файл корня не является «лишним мусором» без ведома — каждый либо
код (`src/tests/package`), либо инфраструктура (docker, whisper), либо процесс-документ, либо
legacy-артефакт с решением D3. Оба анти-паттерна устранены 2026-11-09 (D1 — pnpm по умолчанию,
npm-артефакты удалены; D2 — БД выведена из VCS).

## 3. Целевая структура (рекомендуемый вариант)

```
chat-app/
├── README.md                  # единственный обязательный корневой md
├── docker-compose.yml         # infra провайдера
├── .gitignore
├── server/                    # БЭКЕНД
│   ├── package.json           # start / whisper / test:backend
│   ├── pnpm-lock.yaml
│   ├── pnpm-workspace.yaml    # allowBuilds для нативных сборок
│   ├── .env.example
│   ├── src/                   # app.js: static('../frontend/dist') + SPA-fallback + static('public/vad-assets')
│   ├── tests/                 # node --test "tests/**/*.test.js"
│   ├── scripts/whisper.sh
│   ├── public/vad-assets/     # решение #109 сохраняется, переезд вместе с бэкендом
│   └── data/                  # runtime SQLite (gitignored) + ai_helper.db (после D2 — untracked)
└── frontend/                  # ФРОНТЕНД (бывший webq98/)
    ├── package.json           # dev :5175 / build → dist/
    ├── pnpm-lock.yaml         # добавлен 2026-11-09 (D1)
    ├── vite.config.ts, eslint.config.js, index.html
    ├── PROJECT_CONTEXT.md     # конституция (D4: остаётся здесь или docs/)
    ├── src/
    └── dist/                  # gitignored; отдаётся server на :3000
```

Процесс-документы: рекомендую `docs/WORKFLOW.md`, `docs/WORKLOG.md`, `docs/BACKLOG.md`,
`docs/plans/`, `docs/reference/` — корень = только README + инфраструктура (D4).

### Чем этот вариант гибче буквального «две директории»

1. **`server/` самодостаточен**: манифест, тесты, статика и данные едут вместе —
   `cd server && pnpm install && pnpm start` работает без корня; бэкенд можно вынести в
   отдельный репозиторий/контейнер одной командой `git mv`.
2. **`frontend/` уже самодостаточен**: свой `pnpm-lock.yaml` (добавлен 2026-11-09, D1).
3. **Единое дерево `docs/`** — планы/процесс/справочники в одном месте; корень читается
   с одного экрана; новые агенты находят всё по карте §10.
4. **`data/` рядом с сервером** — бэкап/миграция БД очевидны; `ai_helper.db` уходит из VCS.

### Рассмотренные альтернативы

- **npm workspaces** (монорепо с одним корневым lockfile): отвергнуто на текущем размере —
  hoisting нативных модулей (better-sqlite3, sharp) добавляет хрупкость, выгоды нет
  (нет общих зависимостей). Возможно позже, без правок структуры каталогов.
- **`apps/server` + `apps/frontend`** (nx/turbo-стиль): избыточно — лишний слой инструмента.
- **Буквальные две директории без `docs/`** (процесс-файлы в корне): рабочее, но корень
  остаётся замусоренным на 4 md — компромисс D4.

## 4. Точки решения (владелец) — ВЕРДИКТЫ 2026-11-09

| # | Вопрос | Была рекомендация | **Вердикт владельца** |
|---|---|---|---|
| D1 | pnpm vs npm | npm | **pnpm по умолчанию.** Исполнено 2026-11-09 в PR #8: `package-lock.json` (корень + `webq98/`) удалены; корневой `pnpm-lock.yaml` обновлён (устарел после TZ-F.6), в `webq98/` добавлен свой `pnpm-lock.yaml`; README/PROJECT_CONTEXT — команды pnpm (решение #113) |
| D2 | `ai_helper.db` (затрекчена) | untrack + gitignore | **Исполнено 2026-11-09 в PR #8:** `git rm --cached` → `data/ai_helper.db` (untracked, gitignore `data/*.db*`). Файл пуст (0 строк): таблицы ai-helper живут в `data/chat.db` (общий `getDb()`); локальная БД владельца не тронута (решение #114) |
| D3 | `select_dir/`, `test-mic.html`, `test-ai-helper-repo.js` | архив в `docs/reference/legacy-scratch/` | **Частично исполнено 2026-11-09 в PR #8:** `test-mic.html` → `docs/reference/legacy-scratch/`. Остаток (`select_dir/`, `test-ai-helper-repo.js`) — R.4 (решение #115) |
| D4 | `WORKLOG/WORKFLOW/BACKLOG` и `PROJECT_CONTEXT.md` | WORKLOG/WORKFLOW/BACKLOG → `docs/`; PROJECT_CONTEXT.md — в `frontend/` | **Принято как рекомендовано** — исполнение в R.4 |
| D5 | `docker-compose.yml` | остаётся в корне | **Принято как рекомендовано** |
| D6 | Имя `frontend` | переименование `webq98` → `frontend` | **Принято** — исполнение в R.3 |

## 5. Исполнение (фазы, каждая — ветка `tz/restructure-<X>` → PR, красный-первый где применимо)

### R.1 — Префлайт (0.5 ч)
- Гейты на `main` зелёные (зафиксированы выше); тег `pre-restructure` — точка отката.
- Инвентаризация всех ссылок на переезжаемые пути (`rg -n "webq98|'public|data/|uploads/"`).

### R.2 — Бэкенд → `server/` (2–3 ч)
- `git mv src tests scripts public package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example → server/…`
- Правки путей: `server/src/app.js` — `webq98/dist` → `../frontend/dist`, `public/vad-assets` → `public/vad-assets` (относительно server), `uploads` → `server/uploads`; `db/init.js` — пути БД → `server/data/…` (env-переменная уже поддерживается — проверить); скрипт `test:backend` — без изменений (glob относительный).
- `.gitignore`: проверить неякорные паттерны (`uploads/`, `dist/`, `data/*.db*`) — совпадают на новой глубине (глубина та же — паттерны относительно корня репо; при необходимости добавить `server/data/*.db*`).
- **Гейты:** `cd server && pnpm run test:backend` 59/59 + live-smoke `:3000` (SPA пока из старого места — R.3).

### R.3 — `webq98/` → `frontend/` (1–2 ч)
- `git mv webq98 frontend` (свой `pnpm-lock.yaml` переезжает вместе с каталогом); правка `server/src/app.js` (dist-путь), README, PROJECT_CONTEXT §10.
- **Гейты:** build/lint/test:run (88/88) + test:backend (59/59) + live-smoke (SPA, `/dashboard`, vad-assets+COOP/COEP, `/api` 404 JSON).
- Тест `tests/app/static.test.js` — путь фикстуры `webq98/dist` → `frontend/dist` (обновить в R.2/R.3 вместе с кодом).

### R.4 — Корень и docs (1 ч)
- `git mv plans → docs/plans`; `git mv WORKLOG.md WORKFLOW.md BACKLOG.md → docs/` (D4); правка README (пути, битая ссылка `run-ollama-docker.sh` — удалить или восстановить файл).
- D3-остаток → `docs/reference/legacy-scratch/`: `select_dir/`, `test-ai-helper-repo.js` (`test-mic.html` уже там — 2026-11-09).

### R.5 — Финал (0.5 ч)
- PROJECT_CONTEXT §10 — новая карта; README — итоговые команды; WORKLOG.
- Полные гейты + live-smoke + ручная приёмка владельца.

**Оценка:** 5–7 часов. Риск: средний (много файловых путей, но все покрыты grep-инвентаризацией
и тестами; откаты — тег `pre-restructure` и пофазные PR).

## 6. Контрольный список приёмки реструктуризации

- [ ] Корень: `README.md`, `docker-compose.yml`, `.gitignore`, `server/`, `frontend/`, `docs/` — ничего больше.
- [ ] `cd server && pnpm install && pnpm start` → :3000 отдаёт SPA (главная, `/dashboard`), API, WS, vad-assets + COOP/COEP.
- [ ] `cd frontend && pnpm install && pnpm run dev` → :5175 с прокси; `pnpm run build` → `frontend/dist`.
- [ ] Гейты: build ✓ · lint ✓ · test:run 88/88 · test:backend 59/59.
- [ ] `ai_helper.db` не в git (D2 — исполнено 2026-11-09 досрочно), история `git mv` читается через `git log --follow`.
- [ ] README без битых ссылок; PROJECT_CONTEXT §10 = реальности; §8/§11 актуальны.
