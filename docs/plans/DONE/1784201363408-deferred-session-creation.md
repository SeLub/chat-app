# План: Отложенное создание сессии в БД

## Цель
Не создавать запись сессии в SQLite до отправки первого сообщения пользователем. UUID сессии хранится только в localStorage. При отправке первого сообщения — создаём сессию в БД с этим UUID.

## Текущее поведение
1. `ensureSession()` (script.js:76) — при загрузке страницы создаёт сессию в БД через `POST /api/sessions`
2. `activeSessionId` сохраняется в localStorage
3. При `Clear Chat` с сообщениями — старая сессия архивируется, новая создаётся в БД
4. При `Clear Chat` без сообщений — ничего не происходит (уже корректно)

## Проблема
- Пустая сессия создаётся в БД при каждом открытии/refresh страницы
- При refresh после Clear Chat — создаётся новая пустая сессия в БД

## Решение

### Изменения Frontend

#### 1. `ensureSession()` — отложить создание в БД
**Файл:** `public/script.js`, функция `ensureSession()` (строки 55-86)

**Логика:**
- Если `activeSessionId` есть в localStorage:
  - Проверяем через `GET /api/sessions/:id` — существует ли сессия в БД
  - **Если существует** → восстанавливаем как сейчас (устанавливаем `activeSessionId`, `viewingSessionId`)
  - **Если НЕ существует** → это "pending" сессия. Устанавливаем `activeSessionId` из localStorage, но `viewingSessionId = null` (пустой чат)
- Если `activeSessionId` нет в localStorage:
  - Генерируем `crypto.randomUUID()` локально (без вызова API)
  - Сохраняем в localStorage
  - Устанавливаем `activeSessionId`, `viewingSessionId = null`

**Код:**
```javascript
async function ensureSession() {
    const savedId = localStorage.getItem('activeSessionId');

    if (savedId) {
        try {
            const session = await window.apiGateway.sessions.get(savedId);
            if (session) {
                // Сессия существует в БД — восстанавливаем
                activeSessionId = savedId;
                viewingSessionId = localStorage.getItem('viewingSessionId') || savedId;
                log.info('Restored session', {
                    active: savedId.slice(0, 8),
                    viewing: viewingSessionId.slice(0, 8)
                });
                return;
            }
        } catch (error) {
            log.info('Session not in DB — pending (first message will create it)');
        }
        // Сессия не найдена в БД — "pending" режим
        activeSessionId = savedId;
        viewingSessionId = null; // Пустой чат
        log.info('Restored pending session (no DB record yet)', {
            active: savedId.slice(0, 8)
        });
        return;
    }

    // Нет сохранённого ID — создаём локальный pending
    activeSessionId = crypto.randomUUID();
    viewingSessionId = null;
    localStorage.setItem('activeSessionId', activeSessionId);
    localStorage.setItem('viewingSessionId', activeSessionId);
    log.info('Created pending session (no DB record yet)', {
        sessionId: activeSessionId.slice(0, 8)
    });
}
```

#### 2. `loadViewingSession()` — обработка pending режима
**Файл:** `public/script.js`, функция `loadViewingSession()` (строки 88-99)

**Изменение:** добавить проверку pending режима:
```javascript
async function loadViewingSession() {
    if (!viewingSessionId) {
        // Pending режим — пустой чат, ничего загружать не нужно
        return;
    }
    // ... существующая логика
}
```

#### 3. `sendMessage()` — создание сессии в БД при первом сообщении
**Файл:** `public/script.js`, функция `sendMessage()` (строки 473-575)

**Изменение:** перед отправкой сообщения (строка ~519), проверить pending режим и создать сессию в БД:

```javascript
// В начале sendMessage(), после проверки currentModel (строка ~481):
if (!isSessionInDB()) {
    // Pending режим — создаём сессию в БД
    try {
        const dbSession = await window.apiGateway.sessions.create();
        // Переиспользуем существующий UUID из localStorage
        await window.apiGateway.sessions.update(activeSessionId, { title: dbSession.title });
        // Обновляем ID на сервере (если create создал новый, а мы хотим свой)
        // ИЛИ: добавить новый эндпоинт для инициализации сессии с заданным ID
        viewingSessionId = activeSessionId;
        log.info('Session created in DB', { sessionId: activeSessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to initialize session in DB', error);
        showToast('Failed to initialize session', 'error');
        return;
    }
}
```

#### 4. Новая функция `isSessionInDB()`
**Файл:** `public/script.js`

```javascript
function isSessionInDB() {
    return activeSessionId !== null && viewingSessionId !== null;
}
```

**Логика:** `viewingSessionId !== null` = сессия существует в БД и загружена. `viewingSessionId === null` = pending режим.

#### 5. `clearChat()` — обработка pending режима
**Файл:** `public/script.js`, функция `clearChat()` (строки 893-951)

**Изменение:** в начале функции, добавить проверку pending режима:

```javascript
async function clearChat() {
    if (!confirm('Clear current chat and start new?')) return;

    // Pending режим — просто сбрасываем, ничего не архивируем
    if (!isSessionInDB()) {
        questions = [];
        questionCounter = 0;
        currentConversation = [];
        // ... сброс UI
        showToast('Chat cleared.', 'success');
        log.info('Chat cleared (pending session, no archive)');
        return;
    }

    // ... существующая логика (архивация + создание новой сессии)
}
```

#### 6. Новый API-метод для инициализации pending сессии
**Файл:** `public/apiGateway.js`

Добавить метод в `chatApi`:
```javascript
const chatApi = {
    // ... существующие методы

    /**
     * Инициализировать pending сессию в БД (создать запись с существующим UUID)
     * @param {string} sessionId - UUID из localStorage
     */
    initSession(sessionId) {
        return request('POST', '/api/chat/init-session', {
            body: { sessionId }
        });
    }
};
```

### Изменения Backend

#### 7. Новый эндпоинт `POST /api/chat/init-session`
**Файл:** `src/routes/chatRoutes.js` (создать/изменить)

Создать новый маршрут:
```javascript
// POST /api/chat/init-session
router.post('/init-session', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    const existing = sessionService.getSession(sessionId);
    if (existing) {
        return res.status(409).json({ error: 'Session already exists' });
    }

    const result = sessionService.createNewSessionWithId(sessionId);
    res.status(201).json(result);
});
```

#### 8. Функция `createNewSessionWithId()` в sessionService/sessionRepo
**Файл:** `src/db/sessionRepo.js`

Добавить функцию:
```javascript
export function createSessionWithId(id, title = null, mode = 'chat', projectId = null) {
    const db = getDb();

    // Проверка: сессия с таким ID уже существует
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    if (existing) {
        throw new Error(`Session ${id} already exists`);
    }

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
```

**Файл:** `src/services/sessionService.js` — добавить обёртку:
```javascript
export function createNewSessionWithId(id, title = null, mode = 'chat', projectId = null) {
    return sessionRepo.createSessionWithId(id, title, mode, projectId);
}
```

#### 9. Обновление `chatController.js`
**Файл:** `src/controllers/chatController.js`

В `chatHandler()` (строка ~118), изменить проверку sessionId:

**Было:**
```javascript
if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
}

// Verify session exists in SQLite
const session = sessionService.getSession(sessionId);
if (!session) {
    return res.status(404).json({ error: 'Session not found' });
}
```

**Стало:**
```javascript
if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
}

// Verify session exists in SQLite
let session = sessionService.getSession(sessionId);
if (!session) {
    // Pending сессия — инициализируем
    try {
        session = sessionService.createNewSessionWithId(sessionId);
        log.info('Auto-initialized pending session', { sessionId: sessionId.slice(0, 8) });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to initialize session: ' + error.message });
    }
}
```

**Преимущество:** бэкенд сам создаёт сессию при первом сообщении, фронтенду не нужен отдельный вызов `init-session`.

### 10. Обновление `clearChat()` для работы с двумя указателями
**Файл:** `public/script.js`, функция `clearChat()` (строки 893-951)

При Clear Chat с сообщениями (не pending режим):
- Старая сессия архивируется (как сейчас)
- Новая сессия — **pending** (локальный UUID, без вызова API)

```javascript
// Вместо вызова apiGateway.sessions.create():
activeSessionId = crypto.randomUUID();
viewingSessionId = null; // pending режим
localStorage.setItem('activeSessionId', activeSessionId);
localStorage.setItem('viewingSessionId', activeSessionId);
```

### 11. Dashboard — фильтрация pending сессий
**Файл:** `public/dashboard.js`

Проверить, что Dashboard не показывает pending сессии (они не в БД, так что автоматически не появятся в списке).

## Порядок реализации

1. **Backend:** добавить `createSessionWithId()` в `sessionRepo.js`
2. **Backend:** добавить обёртку в `sessionService.js`
3. **Backend:** обновить `chatController.js` — авто-инициализация pending сессии
4. **Frontend:** добавить `isSessionInDB()`
5. **Frontend:** переписать `ensureSession()` — pending режим
6. **Frontend:** обновить `loadViewingSession()` — обработка pending
7. **Frontend:** обновить `sendMessage()` — проверка pending
8. **Frontend:** обновить `clearChat()` — pending режим + new session как pending
9. **Тестирование:** открыть приложение → пустая сессия в localStorage, нет в БД
10. **Тестирование:** отправить первое сообщение → сессия создана в БД
11. **Тестирование:** refresh страницы → сессия восстановлена из localStorage
12. **Тестирование:** Clear Chat с сообщениями → архивация + новая pending сессия
13. **Тестирование:** Clear Chat без сообщений → просто сброс UI
14. **Тестирование:** Dashboard → нет пустых сессий в списке

## Edge Cases

| Сценарий | Поведение |
|----------|-----------|
| Открытие приложения | Pending сессия в localStorage, нет в БД |
| Refresh до первого сообщения | Тот же UUID из localStorage, нет в БД |
| Первое сообщение | БД создаёт сессию с этим UUID автоматически |
| Refresh после первого сообщения | Сессия найдена в БД, восстанавливается как обычно |
| Clear Chat с сообщениями | Архивация + новая pending сессия |
| Clear Chat без сообщений | Просто сброс UI |
| Закрытие браузера до первого сообщения | Pending UUID в localStorage, нет мусора в БД |
| Два вкладки с одним приложением | Каждая создаёт свой pending UUID (независимые сессии) |

## Что НЕ меняется
- Архивация сессий при Clear Chat (с сообщениями) — как раньше
- Сохранение сообщений в БД после каждого ответа AI — как раньше
- Два указателя (active/viewing) — как раньше
- Загрузка сессий из Dashboard — как раньше
- Schema БД — без изменений
