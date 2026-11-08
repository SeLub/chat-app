# План глобальной реструктуризации: `server/` + `frontend/`

> Статус: ПРОЕКТ (ждёт вердикта владельца). Исполнение — отдельным треком (`tz/restructure-*`),
> после merge приёмки трека «Миграция на React». Составлен 2026-11-08 по прямому указанию владельца.
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
| `package.json`, `package-lock.json` | **бэкенд-**манифест (start/whisper/test:backend) | → `server/` |
| `scripts/whisper.sh` | STT-инфраструктура (пути внешние: `/home/selub/...`) | → `server/scripts/` |
| `public/` (только `vad-assets/`) | VAD/ORT-ассеты, раздаются `app.js` | → `server/public/vad-assets/` |
| `uploads/` (gitignored) | runtime-файлы (multer diskStorage, изображения) | → `server/uploads/` (создаётся автоматически) |
| `ai_helper.db` | **SQLite-БД, ЗАТРЕКЧЕНА в git (24 KB)** — анти-паттерн: бинарные данные в VCS | → `server/data/` + `git rm --cached` + gitignore (D2) |
| `data/` (только `.gitkeep` в git) | runtime-каталог БД (`data/chat.*` gitignored) | → `server/data/` |
| `webq98/` | фронтенд (React 18 + Vite 6 + Tailwind 4) | → `frontend/` (переименование) |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | артефакты pnpm; workspace-файл НЕ workspace (только `allowBuilds` для нативных сборок); параллельно живёт npm (`package-lock.json`) — **двойной пакетный менеджер** | удалить при выборе npm (D1) |
| `plans/` | ТЗ-документы трека (+ `DONE/`) | → `docs/plans/` |
| `docs/` | `AI_HELPER_STT.md`, `reference/public-archive/` | остаётся, пополняется |
| `BACKLOG.md`, `WORKLOG.md`, `WORKFLOW.md` | процесс-документы коллаборации | → `docs/` (рекомендация) или корень (D4) |
| `README.md` | инструкция (содержит **битую ссылку** `run-ollama-docker.sh` — файла нет) | корень; правится |
| `docker-compose.yml` | инфраструктура провайдера (ollama, GPU, 48G) | корень (или `infra/` — D5) |
| `.env.example` | шаблон конфига бэкенда (PORT, OLLAMA_URL…) | → `server/.env.example` |
| `select_dir/` (index.html, script.js) | ad-hoc эксперимент, затрекчен с baseline | архив `docs/reference/` или удалить (D3) |
| `test-mic.html`, `test-ai-helper-repo.js` | ad-hoc проверки микрофона/репозитория, затрекчены с baseline | архив или удалить (D3) |
| `.gitignore` | паттерны без якорей (`uploads/`, `dist/`, `data/chat.*`) — переживают переезд без правок | корень (проверка после mv) |
| `.kilo/`, `.kilocodeignore`, `.vscode/` | конфиги инструментов/редактора | корень (не трогаем) |

**Вывод аудита:** ни один файл корня не является «лишним мусором» без ведома — каждый либо
код (`src/tests/package`), либо инфраструктура (docker, whisper), либо процесс-документ, либо
legacy-артефакт с решением D3. Единственный явный анти-паттерн — затрекченная БД (D2) и
двойной пакетный менеджер (D1).

## 3. Целевая структура (рекомендуемый вариант)

```
chat-app/
├── README.md                  # единственный обязательный корневой md
├── docker-compose.yml         # infra провайдера
├── .gitignore
├── server/                    # БЭКЕНД
│   ├── package.json           # start / whisper / test:backend
│   ├── package-lock.json
│   ├── .env.example
│   ├── src/                   # app.js: static('../frontend/dist') + SPA-fallback + static('public/vad-assets')
│   ├── tests/                 # node --test "tests/**/*.test.js"
│   ├── scripts/whisper.sh
│   ├── public/vad-assets/     # решение #109 сохраняется, переезд вместе с бэкендом
│   └── data/                  # runtime SQLite (gitignored) + ai_helper.db (после D2 — untracked)
└── frontend/                  # ФРОНТЕНД (бывший webq98/)
    ├── package.json           # dev :5175 / build → dist/
    ├── vite.config.ts, eslint.config.js, index.html
    ├── PROJECT_CONTEXT.md     # конституция (D4: остаётся здесь или docs/)
    ├── src/
    └── dist/                  # gitignored; отдаётся server на :3000
```

Процесс-документы: рекомендую `docs/WORKFLOW.md`, `docs/WORKLOG.md`, `docs/BACKLOG.md`,
`docs/plans/`, `docs/reference/` — корень = только README + инфраструктура (D4).

### Чем этот вариант гибче буквального «две директории»

1. **`server/` самодостаточен**: манифест, тесты, статика и данные едут вместе —
   `cd server && npm install && npm start` работает без корня; бэкенд можно вынести в
   отдельный репозиторий/контейнер одной командой `git mv`.
2. **`frontend/` уже самодостаточен** (свой lockfile в `webq98/package-lock.json`? — нет,
   lock внутри webq98 отсутствует; добавить при переезде, если отсутствует).
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

## 4. Точки решения (владелец)

| # | Вопрос | Рекомендация |
|---|---|---|
| D1 | pnpm vs npm: `pnpm-lock.yaml`+`pnpm-workspace.yaml` против `package-lock.json` | **npm** везде (актуальный lock после TZ-F.6, node_modules под npm); pnpm-артефакты удалить, README `pnpm whisper` → `npm run whisper` |
| D2 | `ai_helper.db` (затрекчена) | **untrack** (`git rm --cached`), gitignore `server/data/*.db*`; схема создаётся при старте; локальная БД владельца не трогается |
| D3 | `select_dir/`, `test-mic.html`, `test-ai-helper-repo.js` | **архив** в `docs/reference/legacy-scratch/` (golden master подход, как public-archive) — либо удалить, если владелец подтвердит ненужность |
| D4 | `WORKLOG/WORKFLOW/BACKLOG` и `PROJECT_CONTEXT.md` | WORKLOG/WORKFLOW/BACKLOG → `docs/`; PROJECT_CONTEXT.md — остаётся в `frontend/` (ритуал «прочти конституцию» сохраняется, путь в §10 обновится) |
| D5 | `docker-compose.yml` | остаётся в корне (инфраструктура машины, не сервера) |
| D6 | Имя `frontend` | подтверждение переименования `webq98` → `frontend` (owner сформулировал; имя `webq98` историческое) |

## 5. Исполнение (фазы, каждая — ветка `tz/restructure-<X>` → PR, красный-первый где применимо)

### R.1 — Префлайт (0.5 ч)
- Гейты на `main` зелёные (зафиксированы выше); тег `pre-restructure` — точка отката.
- Инвентаризация всех ссылок на переезжаемые пути (`rg -n "webq98|'public|data/|uploads/"`).

### R.2 — Бэкенд → `server/` (2–3 ч)
- `git mv src tests scripts public package.json package-lock.json .env.example → server/…`
- Правки путей: `server/src/app.js` — `webq98/dist` → `../frontend/dist`, `public/vad-assets` → `public/vad-assets` (относительно server), `uploads` → `server/uploads`; `db/init.js` — пути БД → `server/data/…` (env-переменная уже поддерживается — проверить); скрипт `test:backend` — без изменений (glob относительный).
- `.gitignore`: проверить неякорные паттерны (`uploads/`, `dist/`, `data/chat.*`) — совпадают на новой глубине; добавить `server/data/*.db*` (D2).
- **Гейты:** `cd server && npm run test:backend` 59/59 + live-smoke `:3000` (SPA пока из старого места — R.3).

### R.3 — `webq98/` → `frontend/` (1–2 ч)
- `git mv webq98 frontend`; правка `server/src/app.js` (dist-путь), README, PROJECT_CONTEXT §10.
- **Гейты:** build/lint/test:run (88/88) + test:backend (59/59) + live-smoke (SPA, `/dashboard`, vad-assets+COOP/COEP, `/api` 404 JSON).
- Тест `tests/app/static.test.js` — путь фикстуры `webq98/dist` → `frontend/dist` (обновить в R.2/R.3 вместе с кодом).

### R.4 — Корень и docs (1 ч)
- `git mv plans → docs/plans`; `git mv WORKLOG.md WORKFLOW.md BACKLOG.md → docs/` (D4); правка README (пути, битая ссылка `run-ollama-docker.sh` — удалить или восстановить файл).
- D3-артефакты → `docs/reference/legacy-scratch/` (или удаление по вердикту).

### R.5 — Финал (0.5 ч)
- PROJECT_CONTEXT §10 — новая карта; README — итоговые команды; WORKLOG.
- Полные гейты + live-smoke + ручная приёмка владельца.

**Оценка:** 5–7 часов. Риск: средний (много файловых путей, но все покрыты grep-инвентаризацией
и тестами; откаты — тег `pre-restructure` и пофазные PR).

## 6. Контрольный список приёмки реструктуризации

- [ ] Корень: `README.md`, `docker-compose.yml`, `.gitignore`, `server/`, `frontend/`, `docs/` — ничего больше.
- [ ] `cd server && npm install && npm start` → :3000 отдаёт SPA (главная, `/dashboard`), API, WS, vad-assets + COOP/COEP.
- [ ] `cd frontend && npm install && npm run dev` → :5175 с прокси; `npm run build` → `frontend/dist`.
- [ ] Гейты: build ✓ · lint ✓ · test:run 88/88 · test:backend 59/59.
- [ ] `ai_helper.db` не в git (D2), история `git mv` читается через `git log --follow`.
- [ ] README без битых ссылок; PROJECT_CONTEXT §10 = реальности; §8/§11 актуальны.
