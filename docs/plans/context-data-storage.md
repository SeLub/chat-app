# План: система хранения данных, передаваемых в контекст (режимы RESEARCH / PROJECT)

**Статус:** ПРОЕКТ — ждёт вердикта владельца (2026-11-09).
**Инициатор:** владелец (соображения + наработка `docs/reference/legacy-scratch/select_dir/`).
**Исполнитель:** агент. Оценка: S.1–S.6 ≈ 4–6 ч; S.7 — отдельный трек.

---

## 1. Контекст и цель

Сейчас данные попадают в контекст тремя несвязанными путями:

1. **Изображения** — multipart-файл → `imageService.saveImageFiles` → `server/uploads/images/img_<ts>_<rand>` + миниатюра → URLs `/api/images/:id/full|thumb` в `messages.image_data` (JSON) → vision-модель получает base64.
2. **Документы (PDF/DOC/XLS)** — multipart → extract text → текст приклеивается к сообщению; копия в `attachments` (`extracted_text`), `file_path` указывает на временный файл, удаляемый в `finally` (ссылка мертва).
3. **Код-файлы** — multipart (до 50) → formatted text в сообщение; копия в `attachments`.

Владелец: **передача файлов через форму не нужна** — фронт и бэкенд на одной физической системе (одна ФС). Достаточно **относительного пути файла**, сохраняемого в `attachments`; путь резолвится от базовой директории из `.env`. Механизм нужен для истории сообщений и будущей функциональности **PROJECT**.

Прототип mechanics: `select_dir/` («RAG Path Calculator») — браузер отдаёт `webkitRelativePath` (`zoog/start_screen.png`), сервер считает полный путь как `PROJECT_ROOT + / + relativePath`.

**Цель:** единый реестр вложений (таблица `attachments`) со ссылками на файлы, два режима работы с ФС, в текущей фазе — перевод изображений на этот реестр.

---

## 2. Принципы

1. **Одна ФС.** Файлы не передаются формой, если у них есть путь на диске: фронт передаёт **относительный путь**, сервер резолвит от `CONTEXT_BASE_DIR`.
2. **Исключение — clipboard-изображения**: у них пути нет (буфер существует только в браузере), поэтому бинарник unavoidable передаётся по сети **один раз** при отправке, сохраняется на диск с стандартизированным именем и дальше живёт как ссылка.
3. **Единый реестр.** Все внешние данные сообщения — строки в `attachments`; сообщение ссылается на них через `attachments_meta` (уже реализовано, TZ-B.2).
4. **Два режима работы с ФС** (глобально для сессии, см. §4): RESEARCH — самодостаточные снапшоты контента; PROJECT — ссылки на живые файлы.
5. **Red-first:** каждая фаза — тесты до кода; гейты после каждой фазы (build · lint · test:run · test:backend).
6. **Обратная совместимость истории:** старые `image_data` не мигрируем (их URLs мертвы после удаления `uploads/` — решение владельца 2026-11-09); фронт скрывает битые изображения через `onerror`.

---

## 3. Модель данных

### 3.1 `.env` (новая переменная)

```env
# Базовая директория пользовательских файлов для вложений по относительному пути (PROJECT)
CONTEXT_BASE_DIR=/home/selub/Documents/progs
```

Читается в `server/src/config/env.js` (паттерн хотфикса #117). Отсутствие/несуществование каталога — `warn` при старте, не fatal (RESEARCH-режиму не требуется).

### 3.2 Таблица `attachments` (расширение, без rebuild)

Миграционного фреймворка нет — применяем guarded `ALTER TABLE ADD COLUMN` (проверка `PRAGMA table_info`), для свежих БД — сразу в `CREATE TABLE`:

| Колонка | Тип | Смысл |
|---|---|---|
| `kind` | TEXT DEFAULT `'document'` | `document` \| `code` \| `image` \| `reference` |
| `path_base` | TEXT DEFAULT `'context'` | `context` = относительно `CONTEXT_BASE_DIR`; `data` = относительно `server/data/` (app-managed) |

- `extracted_text TEXT NOT NULL` **не трогаем** (rebuild не нужен): для изображений пишем `''`; `contextBuilder` перестаёт инлайнить строки с `kind='image'`/пустым текстом.
- Для clipboard-картинок `file_path` = `uploads/<sessionId>_<questionId>[_<n>].<ext>` (относительно `server/data/`).
- Для PROJECT-файлов `file_path` = относительный путь от `CONTEXT_BASE_DIR` (как в прототипе: `zoog/start_screen.png`).
- `language` для изображений — `image`.

### 3.3 `messages.attachments_meta` (формат JSON, расширение)

```json
[{ "fileId": "…", "name": "start_screen.png", "size": 12345, "type": "image",
   "kind": "image", "fullUrl": "/api/attachments/<id>/raw", "thumbnailUrl": "/api/attachments/<id>/thumb" }]
```

`messages.image_data` — legacy, только чтение (старые записи).

### 3.4 Файлы

- `server/data/uploads/` — новая папка (внутри gitignored `server/data/`), clipboard-изображения: `<sessionId>_<questionId>[_<n>].<ext>` + `thumbs/<имя>_thumb.jpg` (sharp, 150×150 — как сейчас).
- `sessions.mode` (колонка **уже в схеме**, default `'chat'`) — хранение режима: значения `research` | `project`; backfill `'chat' → 'research'`. Таблица `projects` уже в схеме — пригодится PROJECT-треку.

---

## 4. Два режима работы с ФС

| | **RESEARCH** (предложение имени; альтернативы: STUDY, ARTICLE) | **PROJECT** |
|---|---|---|
| Назначение (владелец) | «работа и сохранение сессий для написания статей и исследования» | работа с кодом |
| Что попадает в сообщение/контекст | **контент**: extract text → inline (текущее поведение) | **ссылка**: id вложения + относительный путь; контент НЕ хранится |
| Чтение контента | в момент отправки (снапшот) | в момент сборки контекста (актуальное состояние файла) |
| Изменение файла после прикрепления | не важно (снапшот сохранён) | контекст соответствует текущему файлу; восстановимость — через git (по дате), приемлемо |
| Масштаб (300 файлов кода) | не предназначен | ссылки вместо контента — рационально; позже — vector DB с авто-индексацией |
| История | самодостаточна (текст в БД) | ссылки в БД + файлы на диске |

**Переключение:** атрибут сессии `sessions.mode` (API: расширить `PATCH /api/sessions/:id`); дефолт `research`. UI-тумблер — в PROJECT-треке (слот правой панели, решения #103/#4-BACKLOG).

### Границы методов (матрица «контент × режим»)

| Контент | RESEARCH | PROJECT |
|---|---|---|
| PDF/DOC/XLS | extract → inline + строка в `attachments` (текст в БД) | `attachments` c `kind='reference'`: только id + путь; контент по требованию |
| Код-файлы | inline formatted + строка в `attachments` (как сейчас) | id + путь; чтение при сборке контекста; бюджетирование через существующий `cutContext` |
| Изображение из clipboard | файл в `server/data/uploads/` + `attachments` (kind=`image`) + миниатюра; base64 в vision-модель | то же (пути у clipboard нет) |
| Изображение/файл из base-dir | — (браузер не отдаёт путь) | относительный путь (picker как в прототипе `select_dir`) → `attachments` (`path_base='context'`) |
| URL | extract → inline (как сейчас, без изменений) | как сейчас |

---

## 5. Потоки (целевое состояние)

### 5.1 Отправка сообщения с clipboard-изображением
1. Фронт: paste → `clipboardData.items` → `File` → слот вложения (как file-pick) → multipart `file` (единственный оставшийся multipart-случай).
2. Бэкенд: sharp → оригинал в `server/data/uploads/<sid>_<qid>.<ext>` + миниатюра → INSERT `attachments` (kind=`image`, path_base=`data`, `extracted_text=''`) → vision: base64 **из сохранённого файла** (логика модели не меняется).
3. `attachments_meta` сообщения получает `fileId` + `kind` + URLs; ответ API сохраняет поле `imageData` (совместимый shape, URL уже новые) — фронт переезжает без ломки.

### 5.2 Загрузка истории
`getQAPairs` уже возвращает `attachments_meta` — фронт рендерит миниатюру из `thumbnailUrl`, клик → `fullUrl`. Для строк без meta, но с legacy `image_data` — прежний рендер + `onerror`-скрытие.

### 5.3 Раздача файлов
`GET /api/attachments/:id/raw` и `/thumb`: резолв `path_base` → поток с `mime_type` (+`Cache-Control` как сейчас). `thumb` существует только у kind=`image`/path_base=`data`.

### 5.4 Удаление Q&A
`deleteMessagesByQuestionId`: дополнительно `unlink` физических файлов (оригинал + миниатюра) **только** для `path_base='data'` (пользовательские файлы из base-dir не трогаем никогда). Удаление сессии — best-effort очистка её data-файлов.

---

## 6. Фазы

| Фаза | Объём | Гейты |
|---|---|---|
| **S.1 Конфиг** | `CONTEXT_BASE_DIR` в env.js/`.env.example`/README; `src/config/paths.js` — `resolveAttachmentPath(row)`, `resolveContextPath(rel)` (canonicalize, запрет выхода за base); тесты `paths.test.js` + env | test:backend |
| **S.2 БД** | guarded ALTER (`kind`, `path_base`) + CREATE для свежих БД; `attachmentRepo.addImageAttachment`; `contextBuilder` — фильтр image/пустых из inline; red-first тесты | test:backend |
| **S.3 Приём изображений** | chatController image-ветка → `server/data/uploads` + attachments row (§5.1); совместимый ответ | test:backend + smoke |
| **S.4 Раздача + история** | `/api/attachments/:id/raw|thumb`; unlink при удалении Q&A; getQAPairs-совместимость; red-first тесты | test:backend |
| **S.5 Фронтенд** | paste-хендлер; рендер из `attachments_meta`; onerror-скрытие legacy; vitest | test:run · lint |
| **S.6 Чистка и доки** | демонтаж `imageService`/`/api/images`/`server/uploads/images` (точка решения D-D); README/PROJECT_CONTEXT (решения #119+)/WORKLOG; полные гейты + live-smoke (ручная проверка clipboard) | все гейты |
| **S.7 Режимы** (отдельный PR после приёмки S.1–S.6) | backfill `mode`; PATCH mode; PROJECT-ветка extract: **только относительные пути** + security (canonicalize, запрет traversal); `kind='reference'` без inline; contextBuilder PROJECT: чтение файлов по id при сборке; UI-тумблер в слоте правой панели | все гейты |

Vector DB с авто-индексацией — отдельная инициатива поверх PROJECT-режима (наработки: `docs/plans/1783463502202-vector-db-repo-indexing-final.md`), в S.7 не входит.

---

## 7. Риски

1. **Path traversal** — фронт передаёт относительный путь; сервер обязан резолвить и проверять, что итог внутри base (`path.resolve` + `startsWith`), иначе 400. Тест обязателен.
2. **`extracted_text NOT NULL`** — обходим пустой строкой (без rebuild таблицы); риск «мусорных» inline-блоков закрыт фильтром в contextBuilder.
3. **Двойная запись (meta + image_data)** — переходный период; после S.6 `image_data` только legacy-чтение.
4. **Дубли имён** — `<sid>_<qid>` уникальны в рамках сессии; `_n` для нескольких картинок в одном сообщении.

---

## 8. Точки решения (ждут вердикта владельца)

| # | Вопрос | Рекомендация |
|---|---|---|
| D-A | Имя режима «для статей и исследований» | **RESEARCH** (парный к PROJECT) |
| D-B | Имя переменной базовой директории | **`CONTEXT_BASE_DIR`** (значение `/home/selub/Documents/progs`) |
| D-C | `extracted_text=''` для изображений vs миграция на NULLable | **`''`** — без rebuild таблицы |
| D-D | Демонтаж legacy image-потока (`imageService`, `/api/images`, `server/uploads/images`) в S.6 | **да**, с сохранением поля `imageData` в API-ответе для совместимости |
| D-E | PR-стратегия S.1–S.6 | **один PR** (фазы = атомарные коммиты) — трек меньше реструктуризации |
| D-F | PROJECT без vector DB: контент по id читается при сборке контекста (бюджет через `cutContext`) | **да**, vector DB позже отдельной инициативой |

## 9. Чек-лист приёмки

- [ ] `.env`: `CONTEXT_BASE_DIR` задокументирован, читается от модуля, тест есть.
- [ ] Clipboard-изображение: файл в `server/data/uploads/<sid>_<qid>.<ext>` + миниатюра, строка в `attachments` (kind=`image`, path_base=`data`), meta с URL.
- [ ] История: картинка восстанавливается из `attachments_meta` после F5 и в сохранённых сессиях.
- [ ] Удаление Q&A удаляет и физические файлы (data-base).
- [ ] `contextBuilder` не инлайнит изображения; текстовые вложения ведут себя как раньше (RESEARCH не изменился).
- [ ] `/api/attachments/:id/raw|thumb` работают; traversal-тест зелёный.
- [ ] Legacy `image_data` не ломает рендер (onerror-скрытие).
- [ ] Гейты: build ✓ · lint ✓ · test:run ✓ · test:backend ✓ · live-smoke ✓.
