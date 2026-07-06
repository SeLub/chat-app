Question:
Как лучше структурировать код разбив файл на отдельные модули? Приведи список всех функций в файле и предложи структуру проекта.

Answer:
## Структура проекта

```
server/
├── src/
│   ├── app.js                    # Основной серверный файл
│   ├── config/
│   │   └── ollama.js             # Конфигурация Ollama
│   ├── controllers/
│   │   ├── chatController.js     # Контроллер для чата
│   │   ├── modelController.js    # Контроллер для моделей
│   │   └── imageController.js    # Контроллер для работы с изображениями
│   ├── middleware/
│   │   ├── uploadMiddleware.js   # Мидлвар для загрузки файлов
│   │   └── authMiddleware.js     # Мидлвар для аутентификации (если нужно)
│   ├── services/
│   │   ├── ollamaService.js      # Сервис для работы с Ollama
│   │   ├── fileService.js        # Сервис для обработки файлов
│   │   ├── imageService.js       # Сервис для работы с изображениями
│   │   ├── webService.js         # Сервис для работы с веб-контентом
│   │   └── metricsService.js     # Сервис для извлечения метрик
│   ├── utils/
│   │   ├── fileUtils.js          # Утилиты для работы с файлами
│   │   ├── urlUtils.js           # Утилиты для работы с URL
│   │   └── imageUtils.js         # Утилиты для работы с изображениями
│   └── routes/
│       ├── chatRoutes.js         # Роуты для чата
│       ├── modelRoutes.js        # Роуты для моделей
│       └── imageRoutes.js        # Роуты для изображений
├── uploads/
│   ├── images/
│   │   └── thumbnails/
├── public/
├── package.json
└── server.js                     # Основной файл (может быть удалён после переноса)
```

## Функции в файле server.js

### 1. Вспомогательные функции
- `generateImageId()` - генерация уникального ID для изображений
- `saveImageFiles(buffer, originalName)` - сохранение изображений и создание миниатюр

### 2. Функции извлечения метрик
- `extractMetrics(data)` - извлечение метрик производительности из ответа Ollama

### 3. Функции работы с моделями
- `isSpecialModel(modelName)` - определение типа модели (embedding, vision)
- `extractUrls(text)` - извлечение URL из текста
- `fetchWebContent(url)` - получение контента с веб-страницы

### 4. Основные обработчики запросов
- `app.get('/api/models')` - получение списка доступных моделей
- `app.post('/api/show')` - получение информации о модели
- `app.get('/api/images/:imageId/:type')` - предоставление изображений
- `app.post('/api/chat')` - обработка чата с возможностью загрузки файлов
- `app.delete('/api/conversation-images')` - удаление изображений из разговора

## Предлагаемая структура модулей

### 1. `src/app.js` (основной серверный файл)
```javascript
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация Express
const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Создание директорий для загрузок
const uploadsDir = './uploads/images';
const thumbnailsDir = './uploads/images/thumbnails';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

// Подключение маршрутов
import chatRoutes from './routes/chatRoutes.js';
import modelRoutes from './routes/modelRoutes.js';
import imageRoutes from './routes/imageRoutes.js';

app.use('/api/chat', chatRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/images', imageRoutes);

// Запуск сервера
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
```

### 2. `src/controllers/chatController.js`
```javascript
import { processChatRequest } from '../services/fileService.js';
import { processImageRequest } from '../services/imageService.js';
import { extractMetrics } from '../services/metricsService.js';

export const chatHandler = async (req, res) => {
  try {
    const { message, model } = req.body;
    const file = req.files?.file?.[0];
    const codeFiles = req.files?.codeFiles || [];

    // Логика обработки запроса
    // ...
    
    res.json({
      response: data.response,
      model: model,
      metrics: extractMetrics(data)
    });
  } catch (error) {
    res.status(500).json({ error: 'Connection failed' });
  }
};
```

### 3. `src/controllers/modelController.js`
```javascript
import { getModels } from '../services/ollamaService.js';

export const getModelsHandler = async (req, res) => {
  try {
    const models = await getModels();
    res.json({ models, connected: true });
  } catch (error) {
    res.json({ models: [], connected: false });
  }
};

export const showModelHandler = async (req, res) => {
  try {
    const { name } = req.body;
    const data = await showModel(name);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get model information' });
  }
};
```

### 4. `src/controllers/imageController.js`
```javascript
import { saveImageFiles } from '../services/imageService.js';
import { deleteImages } from '../services/imageService.js';

export const imageHandler = async (req, res) => {
  // Логика получения изображений
};

export const deleteImagesHandler = async (req, res) => {
  try {
    const { imageUrls } = req.body;
    const result = await deleteImages(imageUrls);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete images' });
  }
};
```

### 5. `src/services/ollamaService.js`
```javascript
import fetch from 'node-fetch';

export const getModels = async () => {
  const [tagsResponse, psResponse] = await Promise.all([
    fetch('http://localhost:11434/api/tags'),
    fetch('http://localhost:11434/api/ps')
  ]);

  if (!tagsResponse.ok || !psResponse.ok) {
    throw new Error('Ollama service not responding');
  }

  const availableModels = await tagsResponse.json();
  const runningModels = await psResponse.json();

  // Логика формирования списка моделей
  // ...
};

export const showModel = async (name) => {
  const response = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (!response.ok) {
    throw new Error(response.statusText);
  }

  return await response.json();
};
```

### 6. `src/services/fileService.js`
```javascript
import { extractUrls, fetchWebContent } from './webService.js';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { processCodeFiles } from './fileService.js';

export const processDocument = async (file) => {
  // Логика обработки различных типов файлов
  // ...
};

export const processCodeFiles = async (codeFiles) => {
  // Логика обработки кодовых файлов
  // ...
};
```

### 7. `src/services/imageService.js`
```javascript
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export const saveImageFiles = async (buffer, originalName) => {
  // Логика сохранения изображений и создания миниатюр
  // ...
};

export const deleteImages = async (imageUrls) => {
  // Логика удаления изображений
  // ...
};
```

### 8. `src/utils/fileUtils.js`
```javascript
export const generateImageId = () => {
  return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const getSupportedExtensions = () => {
  return ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.html', '.css', '.scss', '.json', '.xml', '.yaml', '.yml', '.md', '.txt', '.sql', '.php', '.rb', '.go', '.rs', '.cpp', '.c', '.h', '.cs', '.swift', '.kt', '.scala', '.sh', '.bat', '.dockerfile', '.gitignore', '.env'];
};
```

### 9. `src/routes/chatRoutes.js`
```javascript
import express from 'express';
import { chatHandler } from '../controllers/chatController.js';
import { upload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.post('/', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'codeFiles', maxCount: 50 }]), chatHandler);

export default router;
```

### 10. `src/middleware/uploadMiddleware.js`
```javascript
import multer from 'multer';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max file size
});
```

## Преимущества такой структуры

1. **Читаемость**: Каждый модуль имеет конкретную ответственность
2. **Поддержка**: Легко находить и изменять нужную часть кода
3. **Тестирование**: Каждый модуль можно тестировать отдельно
4. **Масштабируемость**: Легко добавлять новые функции и модули
5. **Разделение ответственности**: Сервисы, контроллеры, маршруты, утилиты разнесены по отдельным папкам
6. **Повторное использование**: Утилиты и сервисы могут использоваться в разных частях приложения

Такая структура значительно улучшает организацию кода и делает его более поддерживаемым.