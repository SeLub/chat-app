// src/app.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Создание директорий для загрузок
const uploadsDir = path.join(__dirname, '..', 'uploads', 'images');
const thumbnailsDir = path.join(uploadsDir, 'thumbnails');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

export { uploadsDir, thumbnailsDir };

// Роуты
import modelRoutes from './routes/modelRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import imageRoutes from './routes/imageRoutes.js';

app.use('/api/models', modelRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/images', imageRoutes);

// ВАЖНО: Добавляем маршрут /api/show отдельно
import { showModelHandler } from './controllers/modelController.js';
import { providerMiddleware } from './middleware/providerMiddleware.js';

app.post('/api/show', providerMiddleware, showModelHandler);

// Эндпоинт со списком провайдеров
import { listProviders, getDefaultProviderName } from './providers/providerManager.js';
app.get('/api/providers', (req, res) => {
  res.json({
    default: getDefaultProviderName(),
    providers: listProviders(),
  });
});

export default app;