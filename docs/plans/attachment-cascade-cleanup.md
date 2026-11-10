# ТЗ: каскадная очистка реестра attachments (Вариант B + каскад на уровне БД)

**Статус:** ПРИНЯТ К ИСПОЛНЕНИЮ — вердикт владельца 2026-11-11 («start» после ТЗ).
Ветка: `tz/attachment-cascade`. Базовая регрессия: orphan-политика из финального ТЗ
context-data-storage (2026-11-10) **частично отменяется** — см. §2.

## 1. Решение владельца

1. **Отменяется принцип реиспользования** «extracted_text можно переиспользовать по
   fileId/path в других запросах» — подход признан сложным и ненужным. Историческая
   причина orphan-политики (возможный реиспольз) не реализована ни в одном месте
   кода: контекст собирается только из `attachments_meta` живых сообщений
   (contextBuilder §«allFileIds»), вне контекста прямых обращений по fileId нет.
2. **Вариант B**: при удалении сообщения чистятся **строки реестра** attachments;
   файлы на диске не трогаются (картинки — для будущего File Manager).
3. Каскадное удаление — **на уровне БД** (если возможно — проверено: возможно, §4).

## 2. Семантика после ТЗ

- **reference** (PROJECT-пул) — единственный механизм реиспользования, остаётся
  как есть: живой файл на диске + mtime-кэш с перечитыванием (текст всегда свежий).
- **document/code** — одноразовый снимок «на момент извлечения»: живёт не дольше
  своего сообщения. Файла на диске нет (`file_path=NULL`, tmp удалён при отправке).
- **image** — строка живёт не дольше своего сообщения; файлы (`uploads/…` +
  `thumbs/…_thumb.jpg`) остаются на диске как orphan-файлы (будущий File Manager).
- Инвариант: **строки реестра живут не дольше своей сущности (сообщение/сессия);
  файлы на диске приложением не удаляются никогда.**

Цена решения: повторная отправка того же файла — повторное извлечение (миллисекунды).

## 3. Механика: message_id FK ON DELETE CASCADE

Связь attachments↔messages существует только как JSON-снапшот `attachments_meta`
(FK нет). Вводится настоящая FK-связь:

```sql
message_id TEXT REFERENCES messages(id) ON DELETE CASCADE
```

Проверено в песочнице (better-sqlite3 12.11.1 → SQLite 3.53.2, JSON1 встроен):
FK в `CREATE TABLE` каскадит; FK через `ALTER TABLE ADD COLUMN` (default NULL)
тоже; backfill по meta через `json_each`/`json_extract` работает; `reference`
(message_id NULL) каскадом не затрагивается; claim в несуществующее сообщение
отклоняется FK.

**Claim-паттерн** (строки создаются до отправки в LLM, сообщение — после ответа):
вставка строк с `message_id = NULL` (FK разрешает) → после успешного
`addMessage(user)` один `UPDATE … SET message_id = ? WHERE id IN (…) AND
message_id IS NULL`. FK гарантирует, что заклеймлены только реальные сообщения.
Каждая строка document/code/image принадлежит ровно одному сообщению (новый UUID
при каждой отправке) — общих fileId нет, dangling-ссылок в meta живых сообщений
не возникает. `reference` не claimится никогда (пул сессии, не принадлежит
сообщению; PROJECT-ветка строк при отправке не создаёт).

## 4. Изменения по файлам

| Файл | Изменение |
|---|---|
| `db/init.js` | CREATE TABLE attachments: + `message_id REFERENCES messages(id) ON DELETE CASCADE`. ensureColumns: guarded ALTER для legacy + миграция — backfill (claim по meta живых сообщений через `json_each`) и однократная очистка накопленного балласта (`kind != 'reference' AND message_id IS NULL` после backfill → DELETE, счётчики в лог). Индекс `idx_attachments_message` — после ensureColumns (на legacy-БД колонка появляется только там) |
| `db/attachmentRepo.js` | `claimAttachments(fileIds, messageId)` — привязка строк к сообщению (гвард `message_id IS NULL`); `deleteUnclaimedAttachments(fileIds)` — cleanup незаклеймлённых строк провалившейся отправки |
| `db/messageRepo.js` | `deleteMessagesByQuestionId`: строки удаляются каскадом БД; `deletedAttachments` — реальный COUNT по message_id удаляемых сообщений (снимается до DELETE); докблок переписан (orphan-политика строк отменена) |
| `controllers/chatController.js` | Обе RESEARCH-ветки: после успешного `addMessage(user)` — claim; в catch (inner и outer) — cleanup незаклеймлённых строк текущей отправки. PROJECT-ветка не трогается (claim-нечего) |
| `routes/attachmentRoutes.js` | Удалён мёртвый `POST /api/attachments/extract` (не вызывается ни фронтендом, ни тестами; создаёт строки-сироты без владельца). Сервисная `extractFiles` остаётся (нужна chatHandler) |

**Не трогается**: файлы на диске (`uploads/`, `thumbs/`) — ни при удалении Q&A,
ни при удалении сессии; reference и его attach/detach; PROJECT-ветка; снапшоты
`attachments_meta` живых сообщений.

## 5. Сценарии-результаты

1. Удалён Q&A с документом → строки document/code исчезли, `deletedAttachments` > 0.
2. Удалён Q&A с картинкой → строка исчезла, файлы остались на диске (File Manager).
3. Удалено сообщение PROJECT-сессии → reference-пул цел.
4. Удалена сессия → каскад-цепочка sessions→messages→attachments (оба FK
   срабатывают, удаление строки идемпотентно), файлы остались.
5. LLM упал при отправке → строк реестра не осталось вовсе.
6. Существующая БД при старте → миграция заклеймила живое, почистила балласт
   (счётчики в лог), reference и данные не тронуты.

## 6. Тесты (red-first) и гейты

- `init.test.js`: свежая схема — колонка + FK-действие CASCADE + индекс + каскад
  реально работает; legacy-путь — ALTER + claim по meta + purge балласта
  (reference выживает, чужие данные не тронуты).
- `messageRepo.test.js`: тест «строки attachments НЕ удаляются» (orphan-политика)
  перевёрнут — каскад удаляет заклеймлённые строки, `deletedAttachments` реальный;
  reference-строка выживает; удаление одного Q&A не трогает строки другого.
- `chatController.test.js`: успешная отправка — `message_id` проставлен у всех
  строк отправки; провал провайдера — строк нет; vision-успех — image-строка
  заклеймлена.
- `attachmentRepo.test.js`: claim/unclaimed-семантика (гвард `IS NULL`).
- `attachmentRoutes.test.js`: `POST /api/attachments/extract` → 404.
- Гейты: `cd server && npm run test:backend`; фронт не затронут, но
  `lint` / `test:run` / `build` прогоняются.

## 7. Вне scope

File Manager (скан диска + cleanup orphan-файлов), удаление файлов при удалении
сессии, `GET /api/attachments/:id/raw` для удалённых строк отдаёт 404 (фронтенд
не рендерит их — meta сообщения удалена вместе с сообщением).
