## Question

Code Analysis Request - 4 files:

--- File: attachmentRepo.js ---
// src/db/attachmentRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const languageMap = {
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.html': 'html', '.css': 'css', '.json': 'json',
    '.md': 'markdown', '.txt': 'text'
};

const mimeTypeMap = {
    '.js': 'text/javascript', '.ts': 'text/typescript',
    '.py': 'text/x-python', '.json': 'application/json'
};

function detectLanguage(ext) {
    return languageMap[ext] || 'text';
}

function getMimeType(ext) {
    return mimeTypeMap[ext] || 'text/plain';
}

export async function extractFromPaths(paths, sessionId) {
    const db = getDb();
    const results = [];
    const errors = [];

    for (const filePath of paths) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const fileId = crypto.randomUUID();
            const filename = path.basename(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const language = detectLanguage(ext);
            const stats = await fs.stat(filePath);

            db.prepare(`
                INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(fileId, sessionId, filename, filePath, getMimeType(ext), stats.size, content, language);

            results.push({
                fileId,
                name: filename,
                size: stats.size,
                type: language,
                path: filePath
            });
        } catch (error) {
            errors.push({
                path: filePath,
                error: error.message
            });
        }
    }

    return { results, errors };
}

export function getAttachment(fileId) {
    return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);
}

export function getAttachmentsByIds(fileIds) {
    if (fileIds.length === 0) return [];
    const placeholders = fileIds.map(() => '?').join(',');
    return getDb().prepare(
        `SELECT * FROM attachments WHERE id IN (${placeholders})`
    ).all(...fileIds);
}

--- File: messageRepo.js ---
// src/db/messageRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';

export function addMessage(sessionId, message) {
    const db = getDb();
    const id = crypto.randomUUID();

    const max = db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM messages WHERE session_id = ?'
    ).get(sessionId);

    db.prepare(`
        INSERT INTO messages (id, session_id, question_id, role, content, model, attachments_meta, metrics, image_data, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, sessionId, message.questionId, message.role, message.content,
        message.model,
        JSON.stringify(message.attachmentsMeta || []),
        JSON.stringify(message.metrics || {}),
        JSON.stringify(message.imageData || {}),
        max.max_order + 1
    );

    db.prepare(`
        UPDATE sessions SET message_count = message_count + 1, updated_at = datetime('now')
        WHERE id = ?
    `).run(sessionId);

    return id;
}

export function getMessagesBySession(sessionId) {
    return getDb().prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);
}

/**
 * Удалить Q&A pair из БД + связанные attachments
 * @param {string} questionId - ID вопроса (q_1_1234567890)
 * @returns {{ deletedMessages: number, deletedAttachments: number }}
 */
export function deleteMessagesByQuestionId(questionId) {
    const db = getDb();

    // 1. Найти все сообщения с этим questionId
    const msgs = db.prepare(
        'SELECT id, session_id, attachments_meta FROM messages WHERE question_id = ?'
    ).all(questionId);

    if (msgs.length === 0) {
        return { deletedMessages: 0, deletedAttachments: 0 };
    }

    const sessionId = msgs[0].session_id;

    // 2. Собрать все fileId из attachments_meta
    const fileIds = new Set();
    for (const msg of msgs) {
        try {
            const meta = JSON.parse(msg.attachments_meta || '[]');
            for (const item of meta) {
                if (item.fileId) fileIds.add(item.fileId);
            }
        } catch (error) {
            // Игнорируем невалидный JSON
        }
    }

    // 3. Удалить attachments (если есть)
    let deletedAttachments = 0;
    if (fileIds.size > 0) {
        const placeholders = [...fileIds].map(() => '?').join(',');
        const result = db.prepare(
            `DELETE FROM attachments WHERE id IN (${placeholders})`
        ).run(...fileIds);
        deletedAttachments = result.changes;
    }

    // 4. Удалить сообщения
    const msgResult = db.prepare(
        'DELETE FROM messages WHERE question_id = ?'
    ).run(questionId);

    // 5. Пересчитать message_count
    db.prepare(`
        UPDATE sessions 
        SET message_count = (
            SELECT COUNT(*) FROM messages WHERE session_id = ?
        ), updated_at = datetime('now') 
        WHERE id = ?
    `).run(sessionId, sessionId);

    return {
        deletedMessages: msgResult.changes,
        deletedAttachments
    };
}

--- File: sessionRepo.js ---
// src/db/sessionRepo.js
import { getDb } from './init.js';
import crypto from 'crypto';

export function createSession(title = null, mode = 'chat', projectId = null) {
    const id = crypto.randomUUID();
    const db = getDb();

    if (!title) {
        const count = db.prepare(
            "SELECT COUNT(*) as count FROM sessions WHERE title LIKE 'unsavedSession%'"
        ).get().count;
        title = `unsavedSession ${count + 1}`;
    }

    db.prepare(`
        INSERT INTO sessions (id, title, mode, project_id)
        VALUES (?, ?, ?, ?)
    `).run(id, title, mode, projectId);

    return { id, title };
}

export function getSession(id) {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function listSessions(options = {}) {
    const { mode, limit = 100, offset = 0, search } = options;
    let sql = 'SELECT * FROM sessions WHERE is_archived = 0';
    const params = [];
    if (mode) { sql += ' AND mode = ?'; params.push(mode); }
    if (search) { sql += ' AND (title LIKE ? OR category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return getDb().prepare(sql).all(...params);
}

export function updateSession(id, updates) {
    const fields = Object.keys(updates);
    if (fields.length === 0) return;
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);
    getDb().prepare(`
        UPDATE sessions SET ${sets}, updated_at = datetime('now') WHERE id = ?
    `).run(...values);
}

export function deleteSession(id) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function archiveSession(id, newTitle) {
    getDb().prepare(`
        UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newTitle, id);
}


--- File: init.js ---
// src/db/init.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT_DIR, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'chat.db');

let db;
let dbPath = DB_PATH; 

export function getDb(customPath = null) {
    const targetPath = customPath || dbPath;
    
    if (!db || db.name !== targetPath) {
        if (!fs.existsSync(path.dirname(targetPath))) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        }
        db = new Database(targetPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('synchronous = NORMAL');
        initializeSchema(db);
    }
    return db;
}

export function initializeSchema(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id              TEXT PRIMARY KEY,
            title           TEXT DEFAULT 'unsavedSession 1',
            category        TEXT DEFAULT 'General',
            mode            TEXT DEFAULT 'chat',
            project_id      TEXT REFERENCES projects(id),
            model           TEXT,
            provider        TEXT DEFAULT 'ollama',
            message_count   INTEGER DEFAULT 0,
            is_archived     INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            question_id     TEXT,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            model           TEXT,
            attachments_meta TEXT DEFAULT '[]',
            metrics         TEXT DEFAULT '{}',
            image_data      TEXT DEFAULT '{}',
            sort_order      INTEGER NOT NULL,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            filename        TEXT NOT NULL,
            file_path       TEXT,
            mime_type       TEXT,
            file_size       INTEGER,
            extracted_text  TEXT NOT NULL,
            language        TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS projects (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            path            TEXT NOT NULL UNIQUE,
            description     TEXT DEFAULT '',
            watch_enabled   INTEGER DEFAULT 0,
            last_indexed    TEXT,
            total_files     INTEGER DEFAULT 0,
            total_chunks    INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS project_files (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            file_path       TEXT NOT NULL,
            content_hash    TEXT NOT NULL,
            language        TEXT,
            file_size       INTEGER,
            chunk_count     INTEGER DEFAULT 0,
            qdrant_point_ids TEXT DEFAULT '[]',
            last_indexed    TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, file_path)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
        CREATE INDEX IF NOT EXISTS idx_sessions_title ON sessions(title);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_messages_question ON messages(question_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_path ON attachments(file_path);
        CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_files_hash ON project_files(content_hash);
    `);
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}



User request: Проанализируй файлы, опиши функциональность и предложи улучшения.

## Answer

Ниже представлен детальный анализ кода, описание текущей функциональности и список рекомендаций по улучшению безопасности, производительности и надежности.

---

### 1. Описание функциональности

Код реализует слой доступа к данным (Repository Layer) для приложения на базе **Node.js** и **SQLite** (используется библиотека `better-sqlite3`). Система предназначена для управления историей чатов (LLM-чат), сессиями, проектами и прикрепленными файлами.

**Основные компоненты:**

1.  **`init.js` (Инициализация БД):**
    *   Настройка подключения к SQLite файлу (`chat.db`).
    *   Создание схемы БД (таблицы `sessions`, `messages`, `attachments`, `projects`, `project_files`) при первом запуске или изменении пути.
    *   Включение WAL-режима (Write-Ahead Logging) для повышения производительности конкурентного чтения/записи.
    *   Управление жизненным циклом соединения (single instance pattern через переменную `db`).

2.  **`sessionRepo.js` (Управление сессиями):**
    *   Создание сессий чата (с автогенерацией названия, если не указано).
    *   Получение, обновление, удаление и архивация сессий.
    *   Поиск сессий по режиму, категории и названию.

3.  **`messageRepo.js` (Управление сообщениями):**
    *   Добавление сообщений в сессию с сохранением порядка (`sort_order`).
    *   Автоматическое обновление счетчика сообщений в родительской сессии.
    *   **Ключевая функция:** `deleteMessagesByQuestionId` — пакетное удаление пары "Вопрос-Ответ" вместе с метаданными вложений.
    *   Извлечение метаданных вложений из JSON-полей сообщений для каскадного удаления.

4.  **`attachmentRepo.js` (Управление вложениями):**
    *   Чтение файлов с файловой системы и сохранение их содержимого (`extracted_text`) прямо в базу данных.
    *   Определение языка файла и MIME-типа по расширению.
    *   Получение информации о конкретных вложениях.

---

### 2. Проблемы и Риски (Code Review)

#### 🚨 Критические риски

1.  **SQL Injection в `sessionRepo.js` (Динамический SQL):**
    *   В функции `updateSession` используется конкатенация строк для формирования запроса: `` `${f} = ?` ``.
    *   **Риск:** Если переменная `updates` приходит от пользователя и не валидируется строго, злоумышленник может передать ключ, содержащий SQL-команды (хотя имена колонок не экранируются, сам подход небезопасен для динамических полей).
    *   **Пример атаки:** `updates = { "title = 1; DROP TABLE sessions; --": "new_title" }`. Хотя `better-sqlite3` может заблокировать множественные запросы, конструкция `SET title = 1; DROP TABLE sessions; -- = ?` может вызвать синтаксическую ошибку или, в зависимости от драйвера, привести к проблемам.

2.  **Отсутствие транзакций в атомарных операциях:**
    *   В `messageRepo.js` (функция `addMessage`) и `deleteMessagesByQuestionId` несколько SQL-запросов выполняются последовательно.
    *   **Риск:** Если ошибка произойдет между вставкой сообщения и обновлением счетчика сессии, данные окажутся рассинхронизированы. В `deleteMessagesByQuestionId` удаление вложений и сообщений тоже не атомарно.

3.  **Хранение текста файлов в БД:**
    *   В `attachmentRepo.js` весь текст файла (`content`) сохраняется в поле `extracted_text TEXT NOT NULL`.
    *   **Риск:** SQLite имеет ограничения на размер строки (по умолчанию 1 ГБ, но это может быть проблематично для индексов и памяти). Если файлы большие, база данных раздуется, запросы замедлятся, а RAM сервера может закончиться при загрузке записей.

#### ⚠️ Умеренные риски и недостатки

4.  **Уязвимость при удалении вложений (Logic Error / Security):**
    *   В `deleteMessagesByQuestionId` код парсит JSON из `attachments_meta`. Если JSON поврежден или содержит невалидные данные, он игнорируется (`catch` блок).
    *   Более важно: если в `attachments_meta` есть ссылки на файлы, которые физически были удалены из БД ранее (но остались в мета-данных), код попытается удалить их снова. Ошибки не будет (так как `DELETE` без `WHERE` по несуществующим ID ничего не делает), но логика "грязная".

5.  **Жесткая привязка к структуре вложений:**
    *   Функция `extractFromPaths` ожидает, что файлы читаются как текст (`utf-8`).
    *   **Риск:** Попытка прочитать бинарные файлы (изображения, PDF, архивы) приведет к ошибке или некорректному тексту. Проверка `detectLanguage` основана только на расширении, что ненадежно.

6.  **Отсутствие обработки ошибок чтения файлов:**
    *   В `extractFromPaths` ошибки чтения логируются, но процесс продолжает работу. Если критический файл не прочитан, система может работать с неполными данными, не уведомив пользователя явно (кроме возврата массива `errors`).

7.  **Производительность `getAttachmentsByIds`:**
    *   Создание плейсхолдеров через `join(',')` и спред-оператор `...fileIds` работает, но при большом количестве ID (тысячи) это может превысить лимит аргументов SQLite (обычно 32766, но лучше избегать таких больших пакетов).

---

### 3. Рекомендации по улучшению

#### 1. Исправление SQL Injection и динамических запросов

Замените динамическое построение SQL в `sessionRepo.js` на проверку белого списка (whitelist).

```javascript
// src/db/sessionRepo.js

// Определите разрешенные поля
const ALLOWED_UPDATE_FIELDS = ['title', 'category', 'mode', 'project_id', 'is_archived', 'model', 'provider'];

export function updateSession(id, updates) {
    // Фильтруем обновления, оставляя только разрешенные поля
    const allowedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([key]) => ALLOWED_UPDATE_FIELDS.includes(key))
    );

    const fields = Object.keys(allowedUpdates);
    if (fields.length === 0) return;

    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = [...fields.map(f => allowedUpdates[f]), id];

    getDb().prepare(`
        UPDATE sessions SET ${sets}, updated_at = datetime('now') WHERE id = ?
    `).run(...values);
}
```

#### 2. Добавление транзакций (Atomicity)

Используйте метод `transaction` из `better-sqlite3` для гарантированной целостности данных.

```javascript
// src/db/messageRepo.js

export function addMessage(sessionId, message) {
    const db = getDb();
    const id = crypto.randomUUID();

    // Оборачиваем операции в транзакцию
    const insertMessageAndCount = db.transaction((msgId, sessId, qId, role, content, model, attMeta, metrics, imgData, order) => {
        db.prepare(`
            INSERT INTO messages (id, session_id, question_id, role, content, model, attachments_meta, metrics, image_data, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(msgId, sessId, qId, role, content, model, attMeta, metrics, imgData, order);

        db.prepare(`
            UPDATE sessions SET message_count = message_count + 1, updated_at = datetime('now')
            WHERE id = ?
        `).run(sessId);
    });

    const max = db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM messages WHERE session_id = ?'
    ).get(sessionId);

    insertMessageAndCount(
        id, sessionId, message.questionId, message.role, message.content,
        message.model,
        JSON.stringify(message.attachmentsMeta || []),
        JSON.stringify(message.metrics || {}),
        JSON.stringify(message.imageData || {}),
        max.max_order + 1
    );

    return id;
}
```

То же самое нужно сделать для `deleteMessagesByQuestionId`, объединив удаление вложений и сообщений в одну транзакцию.

#### 3. Безопасная работа с файлами и бинарными данными

В `attachmentRepo.js` добавьте проверку типа файла и обработку бинарных данных.

```javascript
// src/db/attachmentRepo.js

// Добавьте проверку MIME типа или Magic Numbers для определения реального типа файла
import { fileTypeFromBuffer } from 'file-type'; // npm install file-type (опционально)

export async function extractFromPaths(paths, sessionId) {
    const db = getDb();
    const results = [];
    const errors = [];

    // Начинаем транзакцию для пакетной вставки, если paths много
    const insertAttachment = db.transaction((fileData) => {
        db.prepare(`
            INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...fileData);
    });

    for (const filePath of paths) {
        try {
            const stats = await fs.stat(filePath);
            const contentBuffer = await fs.readFile(filePath);
            
            // Пытаемся определить тип файла
            const fileType = await fileTypeFromBuffer(contentBuffer).catch(() => null);
            const ext = path.extname(filePath).toLowerCase();
            
            // Если это бинарный файл, возможно, не стоит хранить его как текст
            // Или хранить как BLOB, а не TEXT
            const isBinary = !['text', 'javascript', 'python', 'json', 'html', 'css', 'markdown', 'typescript'].includes(detectLanguage(ext));
            
            // Для бинарных файлов можно хранить null в extracted_text или base64 (но base64 раздувает БД)
            const extractedText = isBinary ? null : contentBuffer.toString('utf-8');

            const fileId = crypto.randomUUID();
            const filename = path.basename(filePath);
            
            // Проверка на null перед вставкой
            if (extractedText === null && isBinary) {
                 // Логика для бинарных файлов (например, сохранить только метаданные, а контент в S3/FS)
                 // Здесь упрощенно: пропускаем или логируем ошибку
                 throw new Error("Binary files are not supported for text extraction in this version");
            }

            insertAttachment([
                fileId, sessionId, filename, filePath, getMimeType(ext), stats.size, extractedText, detectLanguage(ext)
            ]);

            results.push({ fileId, name: filename, size: stats.size, type: detectLanguage(ext), path: filePath });
        } catch (error) {
            errors.push({ path: filePath, error: error.message });
        }
    }

    return { results, errors };
}
```

#### 4. Оптимизация запросов и индексов

*   **Индексы:** В `init.js` добавлен индекс `idx_attachments_path`. Убедитесь, что `file_path` уникален или часто используется для поиска.
*   **Pagination:** В `listSessions` используется `LIMIT` и `OFFSET`. Для больших таблиц это медленно. Рассмотрите "Keyset Pagination" (cursor-based), если количество сессий превысит тысячи.

#### 5. Валидация входных данных

Добавьте валидацию `sessionId` и `fileIds` (типы данных). Убедитесь, что `fileIds` в `getAttachmentsByIds` действительно являются массивом UUID, чтобы предотвратить атаки типа "IDOR" (если эта функция экспортируется в API без проверки прав доступа).

---

### Итоговое резюме

Код написан чисто и структурировано, но требует усиления по трем направлениям:
1.  **Безопасность:** Устранение SQL Injection через whitelist полей.
2.  **Надежность:** Использование транзакций для поддержания целостности данных.
3.  **Архитектура:** Пересмотр хранения бинарных файлов и больших текстов в SQLite (рассмотрите использование внешнего хранилища для файлов, а в БД храните только ссылки/метаданные).