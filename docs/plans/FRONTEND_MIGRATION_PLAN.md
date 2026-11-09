# План перехода на webq98 + доработка attachments

> Дата: 2026-10-28
> Статус: черновик

---

## Текущее состояние

### `public/` (vanilla JS, продакшен)
- **2808 строк** JS в 6 файлах (script.js, dashboard.js, ai-helper.js, apiGateway.js, logger.js, style.css)
- Запускается с `pnpm start` (Express: `express.static(public)`)
- Все 10 функциональных блоков (F1–F10) работают

### `webq98/` (React + TS + Vite, в разработке)
- **~5500 строк** TS/TSX (без тестов) + 6 test-файлов
- **НЕ подключён к бэкенду** — сервит только `public/`
- Vite dev server на порту 5175 с proxy на `localhost:3000`

### Пробелы webq98 vs public

| Функция | public | webq98 | Статус |
|---|---|---|---|
| F1. Чат (стриминг, markdown, копирование, удаление Q&A) | ✅ | ⚠️ ChatArea есть, но без стриминга/удаления | ❌ |
| F2. Выбор провайдера | ✅ | ⚠️ providerStore есть, UI нет | ❌ |
| F3. Выбор модели + метаданные | ✅ | ⚠️ SettingsPanel — заглушка | ❌ |
| F4. Системный промпт | ✅ | ✅ QuestionsPanel.prompts tab | ✅ |
| F5. Standard/Manual + чекбоксы | ✅ | ✅ QuestionsPanel | ✅ |
| F6. Вложения (PDF/DOC/XLS/код/изображения) | ✅ | ❌ папка пустая | ❌ |
| F7. Dashboard (поиск, экспорт, массовые операции) | ✅ | ✅ Dashboard | ✅ |
| F8. AI Helper (Dual VAD, подсказки) | ✅ | ✅ Overlay + store + VAD | ✅ |
| F9. Голосовой ввод (STT) | ✅ | ✅ STTInput | ✅ |
| F10. Сохранение/загрузка сессий | ✅ | ✅ SaveModal + LoadModal | ✅ |

### Критический баг: attachments не интегрированы

В `public/` файлы НЕ сохраняются в таблицу `attachments` — текст встраивается в `message.content` и `attachments_meta` всегда `[]`. Это касается и `webq98/`.

---

## Фаза 0: Бэкенд — интеграция attachments

**Цель:** файлы сохраняются в БД `attachments`, `attachments_meta` заполняется, контекст собирается из `extracted_text`.

### 0.1. chatController.js — добавить сохранение в attachments

**Файл:** `src/controllers/chatController.js`

После обработки файла, но до отправки в LLM:

```javascript
// После processDocument / processCodeFiles — ДО addMessage:
if (file) {
    const { results, errors } = await attachmentService.extractFiles(
        [file.path || file.destination + file.filename],
        sessionId
    );
    if (errors.length > 0) {
        // логировать, но продолжить (файл уже в message.content)
    }
    // attachmentMeta содержит fileId
    attachmentMeta = results.map(r => ({
        fileId: r.fileId,
        name: r.name,
        size: r.size,
        type: r.type
    }));
}

if (codeFiles.length > 0) {
    // аналогично — сохранить каждый codeFile в attachments
    for (const cf of codeFiles) {
        const { results } = await attachmentService.extractFiles(
            [cf.path],
            sessionId
        );
        // добавить в attachmentMeta
    }
}
```

### 0.2. chatController.js — передать attachmentMeta в addMessage

**Файл:** `src/controllers/chatController.js`

```javascript
sessionService.addMessage(sessionId, {
    role: 'user',
    content: message,
    model,
    questionId: finalQuestionId,
    attachmentsMeta: currentAttachments  // ← уже есть, но currentAttachments должен содержать fileId
});
```

### 0.3. contextBuilder.js — уже работает

**Проверка:** `contextBuilder.buildLLMContext()` уже:
- Собирает `fileId` из `msg.attachments_meta`
- Загружает `extracted_text` из `attachments` по ID
- Формирует `filesContext` как отдельный system message
- Вычитает `filesContext.length` из бюджета

**Статус:** ✅ Код уже есть, просто не получает данных. После 0.1–0.2 заработает.

### 0.4. Добавить endpoint для загрузки файлов

**Файл:** `src/routes/attachmentRoutes.js`

```javascript
// POST /api/attachments/upload — загрузка файла в uploads/
router.post('/upload', upload.single('file'), async (req, res) => {
    const { sessionId } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    if (!sessionId) return res.status(400).json({ error: 'No sessionId' });

    const { results, errors } = await attachmentService.extractFiles(
        [req.file.path], sessionId
    );
    res.json({ results, errors });
});
```

---

## Фаза 1: webq98 — доделать недостающие фичи

### 1.1. F1 — Чат: стриминг, копирование, удаление Q&A

**Файл:** `webq98/src/features/chat/components/chat-area.tsx` (~6367 строк)

Нужно добавить:

| Что | Описание |
|---|---|
| **Стриминг токенов** | SSE/fetch ReadableStream → обновление `content` в реальном времени |
| **Копирование** | Кнопка на каждом сообщении: копировать ответ / вопрос / пару Q&A (как Markdown) |
| **Удаление Q&A** | Кнопка удаления пары с подтверждением → `DELETE /api/sessions/:id/messages/:questionId` |
| **Навигация Q&A** | Стрелки ← → для переключения между парами |
| **Индикатор исключённых** | `excludedIndices` из ответа бэкенда → предупреждение над чатом |
| **Индикатор модели** | Отображение модели под каждым ответом |

### 1.2. F2 — Выбор провайдера

**Файл:** `webq98/src/stores/providerStore.ts` + новый компонент

Нужно добавить:
- Dropdown выбора провайдера в TopBar или рядом с полем ввода
- Индикатор статуса (подключен/отключен/проверка)
- Автоопределение недоступности с предложением переключиться
- Данные из `GET /api/providers/status`

### 1.3. F3 — Выбор модели + метаданные

**Файл:** `webq98/src/features/models/components/settings-panel.tsx` (заглушка)

Заменить заглушку на:
- Dropdown моделей из `GET /api/models` (с заголовком `X-Provider`)
- Показывать: размер модели, длину контекста, метку vision
- Данные из `POST /api/show` для деталей

### 1.4. F6 — Вложения (полная реализация)

**Файл:** `webq98/src/features/attachments/` (пустая папка)

Создать:

| Компонент | Назначение |
|---|---|
| `AttachmentUploader.tsx` | Drag-and-drop зона + кнопка выбора файлов |
| `AttachmentList.tsx` | Список прикреплённых файлов с превью |
| `ImagePreview.tsx` | Превью изображений |
| `CodeFileBadge.tsx` | Бейдж для кодовых файлов |

**Логика:**
- Поддержка: PDF, DOC, XLS, CSV, изображения, кодовые файлы (до 50)
- Отправка: `FormData.append('file', file)` + `FormData.append('codeFiles', file)`
- Превью изображений — FileReader → base64
- Отображение бейджей файлов в сообщении (как в `public/script.js:227-244`)

### 1.5. F9 — Голосовой ввод в поле чата

**Статус:** `STTInput` есть, но нужно интегрировать в `ChatArea`

- Добавить `<STTInput onTranscribe={appendText} />` в input-бар `ChatArea`
- Микрофон рядом с кнопкой отправки

---

## Фаза 2: webq98 — доработка существующих фич

### 2.1. ChatArea — текущий статус

**Файл:** `webq98/src/features/chat/components/chat-area.tsx`

Проверить что реализовано:
- ✅ Markdown rendering (react-markdown + remark-gfm)
- ✅ Подсветка кода (highlight.js)
- ⚠️ Стриминг — проверить, есть ли
- ⚠️ Копирование — проверить, есть ли
- ⚠️ Удаление Q&A — проверить, есть ли

### 2.2. SaveModal — доработка

**Файл:** `webq98/src/features/sessions/components/save-modal.tsx`

Проверить:
- ✅ Сохранение названия и категории
- ⚠️ Автосохранение sysprompt — проверить
- ⚠️ Экспорт в JSON — проверить

### 2.3. LoadModal — доработка

**Файл:** `webq98/src/features/sessions/components/load-modal.tsx`

Проверить:
- ✅ Загрузка сессии
- ⚠️ Загрузка без потери текущего буфера (двух-указательная система) — проверить

---

## Фаза 3: Подключение webq98 к бэкенду

### 3.1. Изменить app.js

**Файл:** `src/app.js`

Заменить:
```javascript
// БЫЛО:
app.use(express.static(path.join(__dirname, '..', 'public')));

// СТАЛО:
const webq98Dist = path.join(__dirname, '..', 'webq98', 'dist');
app.use(express.static(webq98Dist));
```

### 3.2. Собрать webq98

```bash
cd webq98 && pnpm build
```

### 3.3. Проверить COOP/COEP заголовки

В `app.js` уже настроены COOP/COEP для `/vad-assets` и `/ai-helper-overlay.html`.
Нужно убедиться, что для AI Helper в webq98 это тоже работает.

### 3.4. Проверить proxy в Vite

**Файл:** `webq98/vite.config.ts`

Уже настроен:
```typescript
proxy: {
    '/api': { target: 'http://localhost:3000', changeOrigin: true },
    '/ws': { target: 'ws://localhost:3000', ws: true },
    '/vad-assets': { target: 'http://localhost:3000', changeOrigin: true },
}
```

---

## Фаза 4: Тестирование и переход

### 4.1. Пошаговое тестирование

1. **Бэкенд:** `pnpm start` → проверить `/api/chat` с файлами → `attachments` заполняется
2. **Контекст:** отправлять сообщения с файлами → `filesContext` в контексте
3. **webq98 dev:** `cd webq98 && pnpm dev` → проверить все фичи через proxy
4. **webq98 build:** `cd webq98 && pnpm build` → проверить production сборку
5. **Интеграция:** заменить `app.js` → проверить что webq98 сервится

### 4.2. Чеклист перед удалением public/

- [ ] Все 10 функциональных блоков работают в webq98
- [ ] attachments сохраняются в БД и появляются в контексте
- [ ] Двух-указательная система сессий работает
- [ ] AI Helper работает (Dual VAD + подсказки)
- [ ] Dashboard работает (поиск, экспорт, массовые операции)
- [ ] Голосовой ввод работает
- [ ] Стандартный и ручной режимы контекста работают
- [ ] Темы (светлая/тёмная) работают
- [ ] Тесты проходят: `cd webq98 && pnpm test`
- [ ] Lint проходит: `cd webq98 && pnpm lint`

### 4.3. После удаления public/

1. Удалить `public/`
2. Удалить `public/vad-assets/` (используется npm-пакет `@ricky0123/vad-web`)
3. Удалить COOP/COEP заголовки для `/ai-helper-overlay.html` (больше не нужен)
4. Обновить `README.md`
5. Очистить `node_modules` в корне (если там были старые зависимости фронтенда)

---

## Оценка объёма работ

| Фаза | Задачи | Оценка |
|---|---|---|
| **0. Бэкенд attachments** | 0.1–0.4 | 2–4 часа |
| **1.1. F1 Чат** | Стриминг, копирование, удаление | 4–6 часов |
| **1.2. F2 Провайдеры** | UI выбора + статус | 2–3 часа |
| **1.3. F3 Модели** | SettingsPanel полноценный | 2–3 часа |
| **1.4. F6 Вложения** | Полный UI компонентов | 4–6 часов |
| **1.5. F9 STT** | Интеграция в ChatArea | 1–2 часа |
| **2. Доработка существующего** | Проверка и исправление | 2–4 часа |
| **3. Подключение** | app.js + build | 1–2 часа |
| **4. Тестирование** | Пошаговое тестирование | 2–3 часа |
| **Итого** | | **20–32 часа** |

---

## Рекомендуемый порядок выполнения

```
Фаза 0 (бэкенд) → Фаза 1.4 (вложения) → Фаза 1.1 (чат) → Фаза 1.2/1.3 (провайдеры/модели)
→ Фаза 1.5 (STT) → Фаза 2 (доработка) → Фаза 3 (подключение) → Фаза 4 (тестирование)
```

Причина: бэкенд-изменения должны быть готовы первыми, так как все фичи зависят от них. Вложения — критичная фича, которая сейчас полностью отсутствует.
