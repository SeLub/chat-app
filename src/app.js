// src/app.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Единый обработчик ошибок провайдеров
import { createLogger } from './utils/logger.js';
const appLog = createLogger('App');

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

// ВАЖНО: Добавляем маршрут /api/show отдельно
import { showModelHandler } from './controllers/modelController.js';
import { providerMiddleware } from './middleware/providerMiddleware.js';
import { getProvider, listProviders, getDefaultProviderName } from './providers/providerManager.js';
import { startSessionCleanup } from './services/sessionService.js';

app.use('/api/models', modelRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/images', imageRoutes);

startSessionCleanup();
app.use((err, req, res, next) => {
    // Ошибки подключения к провайдеру
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        appLog.error(`Provider ${req.providerName || 'unknown'} unreachable`, {
            code: err.code,
            url: req.provider?.url,
            message: err.message
        });
        
        return res.status(503).json({
            error: `Provider "${req.providerName}" is currently unavailable.`,
            details: err.message,
            code: err.code,
            hint: 'Check if the provider server is running and accessible.'
        });
    }
    
    // Таймауты
    if (err.type === 'request-timeout' || err.code === 'FETCH_TIMEOUT' || err.name === 'AbortError') {
        appLog.error(`Provider ${req.providerName} timed out`);
        return res.status(504).json({
            error: `Provider "${req.providerName}" did not respond in time.`,
            hint: 'The model may be loading or the server is overloaded.'
        });
    }
    
    // Прочие ошибки
    appLog.error('Unhandled error', { error: err.message, stack: err.stack });
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.post('/api/show', providerMiddleware, showModelHandler);

// Эндпоинт со списком провайдеров
app.get('/api/providers', (req, res) => {
  res.json({
    default: getDefaultProviderName(),
    providers: listProviders(),
  });
});

// GET /api/providers/status — статус всех провайдеров
app.get('/api/providers/status', async (req, res) => {
  const providers = listProviders();
  const statuses = await Promise.all(
    providers.map(async (p) => {
      try {
        const provider = await getProvider(p.name);
        return await provider.getStatus();
      } catch (error) {
        return {
          name: p.name,
          type: p.type,
          url: p.url,
          enabled: true,
          status: 'error',
          latencyMs: 0,
          error: error.message,
        };
      }
    })
  );
  res.json({ providers: statuses });
});

export default app;