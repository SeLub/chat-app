# Объединённый план: Реструктуризация + Мультипровайдер

Ниже — согласованный план, который **сразу** закладывает модульную архитектуру под несколько провайдеров. Это избавит от двойной работы: мы не будем сначала писать `ollamaService`, а потом переделывать его в `OllamaProvider`.

---

## 1. Целевая структура проекта

```
server/
├── server.js                      # Точка входа (запуск сервера)
├── package.json
├── docker-compose.yml
├── run-ollama-docker.sh
│
├── src/
│   ├── app.js                     # Инициализация Express, middleware, роуты
│   │
│   ├── config/
│   │   └── providers.js           # Конфиг провайдеров (url, enabled, default)
│   │
│   ├── providers/                 # 🆕 Ядро мультипровайдерной архитектуры
│   │   ├── BaseProvider.js        # Абстрактный базовый класс
│   │   ├── OllamaProvider.js      # Реализация для Ollama
│   │   ├── LlamaCppProvider.js    # Реализация для llama.cpp
│   │   └── providerManager.js     # Фабрика/менеджер: получение активного провайдера
│   │
│   ├── controllers/               # Обработчики HTTP-запросов
│   │   ├── chatController.js
│   │   ├── modelController.js
│   │   └── imageController.js
│   │
│   ├── services/                  # Бизнес-логика, не зависящая от провайдера
│   │   ├── fileService.js         # PDF/DOC/XLS/код
│   │   ├── imageService.js        # Сохранение/удаление изображений
│   │   ├── webService.js          # Извлечение контента по URL
│   │   └── metricsService.js      # Нормализация метрик от разных провайдеров
│   │
│   ├── routes/
│   │   ├── chatRoutes.js
│   │   ├── modelRoutes.js
│   │   └── imageRoutes.js
│   │
│   ├── middleware/
│   │   ├── uploadMiddleware.js
│   │   ├── providerMiddleware.js  # 🆕 Определяет активного провайдера из запроса
│   │   └── errorHandler.js
│   │
│   └── utils/
│       ├── fileUtils.js
│       ├── urlUtils.js
│       └── imageUtils.js
│
├── uploads/
│   └── images/
│       └── thumbnails/
└── public/                        # Frontend
```

---

## 2. Ключевые интерфейсы и контракты

### 2.1. Единый интерфейс модели (`BaseProvider.js`)

```js
// src/providers/BaseProvider.js
export class BaseProvider {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  /** Список моделей: { name, size, contextLength, status, type } */
  async getModels() { throw new Error('Not implemented'); }

  /** Детали модели (контекст, параметры) */
  async showModel(name) { throw new Error('Not implemented'); }

  /** Генерация ответа (текст/документ) */
  async generate({ model, prompt, stream }) { throw new Error('Not implemented'); }

  /** Чат с историей + изображения */
  async chat({ model, messages, stream }) { throw new Error('Not implemented'); }

  /** Проверка доступности */
  async healthCheck() { throw new Error('Not implemented'); }
}
```

### 2.2. Менеджер провайдеров (`providerManager.js`)

```js
// src/providers/providerManager.js
import { OllamaProvider } from './OllamaProvider.js';
import { LlamaCppProvider } from './LlamaCppProvider.js';
import config from '../config/providers.js';

const registry = {
  ollama: OllamaProvider,
  llama_cpp: LlamaCppProvider,
};

const instances = {};

export function getProvider(name = config.defaultProvider) {
  if (!instances[name]) {
    const Ctor = registry[name];
    if (!Ctor) throw new Error(`Unknown provider: ${name}`);
    instances[name] = new Ctor(name, config.providers[name]);
  }
  return instances[name];
}

export function listProviders() {
  return Object.entries(config.providers)
    .filter(([, cfg]) => cfg.enabled)
    .map(([name, cfg]) => ({ name, type: cfg.type, url: cfg.url }));
}
```

### 2.3. Нормализованные метрики (`metricsService.js`)

Каждый провайдер возвращает сырые метрики → `metricsService.normalize(raw, providerName)` приводит к единому виду `{ tps, promptTps, inputTokens, outputTokens, totalTime, ttft, loadTime }`.

---

## 3. Пошаговый план реализации

### Этап 1 — Подготовка фундамента (1 день)
1. Создать структуру каталогов.
2. Перенести `server.js` → `src/app.js` + `server.js` (минимальная точка входа).
3. Вынести `config/providers.js` с дефолтным `defaultProvider: "ollama"`.
4. Написать `BaseProvider.js` с контрактом.

### Этап 2 — Инкапсуляция Ollama (1–2 дня)
1. Реализовать `OllamaProvider extends BaseProvider` — перенести всю текущую логику `ollamaService.js` и прямых `fetch('http://localhost:11434/...')` из `server.js`.
2. Реализовать `metricsService.normalize()` под формат Ollama.
3. Переписать `modelController.js`, `chatController.js` так, чтобы они работали **только через `getProvider()`**, без прямых URL.
4. **Валидация:** все существующие эндпоинты (`/api/models`, `/api/chat`, `/api/show`, `/api/images/...`) работают как раньше. Обратная совместимость сохранена.

### Этап 3 — Провайдер llama.cpp (2 дня)
1. Реализовать `LlamaCppProvider extends BaseProvider`:
   - `getModels()` → запрос к `/slots` или специфичному endpoint llama.cpp server.
   - `chat()` → `/completion` или `/v1/chat/completions` (llama.cpp поддерживает OpenAI-совместимый API).
   - `showModel()` → извлечь параметры из `/props` или `/slots`.
2. Добавить нормализацию метрик llama.cpp в `metricsService`.
3. Расширить `config/providers.js`:
   ```json
   {
     "defaultProvider": "ollama",
     "providers": {
       "ollama":     { "type": "ollama",     "url": "http://localhost:11434", "enabled": true },
       "llama_cpp":  { "type": "llama_cpp",  "url": "http://localhost:8080",  "enabled": true }
     }
   }
   ```

### Этап 4 — Маршрутизация провайдеров (1 день)
1. `providerMiddleware.js` — читает `X-Provider` заголовок или `provider` в body, кладёт `req.provider = getProvider(name)` в запрос.
2. Контроллеры используют `req.provider` вместо жёстко зашитого Ollama.
3. Эндпоинт `GET /api/providers` — возвращает список доступных провайдеров для UI.

### Этап 5 — Frontend (1–2 дня)
1. Dropdown выбора провайдера на панели моделей (сохранение в `localStorage`).
2. При смене провайдера — перечитывать `/api/models` с нужным заголовком.
3. Индикатор активного провайдера рядом со списком моделей.
4. Статистика — унифицированный формат, независимо от источника.

### Этап 6 — Отказоустойчивость и качество (1 день)
1. `healthCheck()` для каждого провайдера → UI показывает, кто жив.
2. Логирование ошибок провайдеров через единый логгер.
3. Если активный провайдер упал — fallback на `defaultProvider` с уведомлением UI.
4. Покрытие ключевых сценариев тестами (хотя бы smoke): получение моделей, чат без файлов, чат с изображением.

---

## 4. Что и куда переезжает из текущего `server.js`

| Текущий код | Новое место |
|---|---|
| `app.get('/api/models')` с `fetch('.../api/tags')` | `OllamaProvider.getModels()` → `modelController.getModelsHandler` |
| `app.post('/api/show')` | `OllamaProvider.showModel()` → `modelController.showModelHandler` |
| `app.post('/api/chat')` (логика файлов, URL, vision) | `chatController` + `fileService` + `webService` + `imageService` + `provider.chat()` |
| `extractMetrics()` | `metricsService.normalize()` (с поддержкой нескольких форматов) |
| `saveImageFiles`, `generateImageId` | `imageService` + `utils/imageUtils` |
| `extractUrls`, `fetchWebContent` | `webService` + `utils/urlUtils` |
| `isSpecialModel` | `utils/modelUtils.js` (общая утилита, не зависит от провайдера) |
| `app.delete('/api/conversation-images')` | `imageController.deleteHandler` |

---

## 5. Принципы, которые делают код поддерживаемым

1. **Один источник правды о провайдере** — `providerManager.js`. Никто, кроме него, не создаёт экземпляры провайдеров.
2. **Контроллеры не знают о HTTP-клиентах** — они работают только с интерфейсом `BaseProvider`.
3. **Сервисы (file/image/web) не знают о провайдерах** — они готовят данные, а провайдер решает, как их отправить.
4. **Конфигурация отделена от кода** — добавление третьего провайдера = одна запись в `providers.js` + новый класс.
5. **Нормализация метрик в одном месте** — UI всегда получает одинаковую структуру.
6. **Middleware провайдера** — вся магия выбора провайдера в одном файле, легко тестировать и расширять.

---

## 6. Риски и как их митигируем

| Риск | Митигация |
|---|---|
| API llama.cpp отличается от Ollama | Контракт `BaseProvider` + адаптеры в каждом провайдере |
| Разные форматы метрик | `metricsService.normalize()` с ветвлением по провайдеру |
| Поломка обратной совместимости | Этап 2 заканчивается **полной** проверкой всех старых эндпоинтов до перехода к Этапу 3 |
| UI-регрессии | Сохраняем старые маршруты, меняем только источник данных |
| Падение одного провайдера | `healthCheck` + fallback в `providerManager` |

---

## 7. Критерии готовности (Definition of Done)

- ✅ Проект разделён на модули по структуре выше.
- ✅ `server.js` содержит только 3–5 строк запуска.
- ✅ `OllamaProvider` полностью покрывает текущий функционал.
- ✅ `LlamaCppProvider` подключён и работает для чата и списка моделей.
- ✅ UI умеет переключать провайдеры, выбор сохраняется.
- ✅ Метрики отображаются единообразно для обоих провайдеров.
- ✅ Добавление третьего провайдера требует только нового класса и записи в конфиге.

---

**Рекомендация по порядку:** начать с Этапа 1–2, **не трогая UI и не добавляя llama.cpp**, пока вся текущая функциональность не будет работать через `BaseProvider`. Это самый дешёвый способ гарантировать, что рефакторинг ничего не сломал, и только потом наращивать мультипровайдерность.

Если согласны с планом — могу начать с детального ТЗ на **Этап 1** (структура каталогов + `BaseProvider` + `providerManager` + `config/providers.js`) и сразу написать код.