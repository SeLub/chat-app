// src/app.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sttRoutes from './routes/sttRoutes.js'; 

// Единый обработчик ошибок провайдеров
import { createLogger } from './utils/logger.js';
const appLog = createLogger('App');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.json());

// === COOP/COEP только для AI Helper и его ассетов ===
const coepHeaders = (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
};

app.use('/vad-assets', coepHeaders);
// TZ-F.2: vad-assets обслуживаются ЯВНОЙ статикой из public/vad-assets
// (раньше их отдавала широкая статика из public/ — после переключения корня
// статики на dist фронта они потеряли бы раздачу; vad-assets остаются на месте).
app.use('/vad-assets', express.static(path.join(__dirname, '..', 'public', 'vad-assets')));
// =====================================================

// TZ-F.1: production-статика React-приложения (сборка frontend/ → dist/)
// R.3: фронт переехал в frontend/ — статика из frontend/dist
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'dist')));

// Роуты
import modelRoutes from './routes/modelRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import attachmentRoutes from './routes/attachmentRoutes.js';
import configRoutes from './routes/configRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import promptRoutes from './routes/promptRoutes.js';

// ВАЖНО: Добавляем маршрут /api/show отдельно
import { showModelHandler } from './controllers/modelController.js';
import { providerMiddleware } from './middleware/providerMiddleware.js';
import { getProvider, listProviders, getDefaultProviderName } from './providers/providerManager.js';

app.use('/api/models', modelRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/stt', sttRoutes);
// ТЗ Project mode A: статус CONTEXT_BASE_DIR + PROJECT-эндпоинты
app.use('/api/config', configRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/prompts', promptRoutes);
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

// TZ-F.1: SPA-fallback — все прочие GET/HEAD отдают index.html React-приложения.
// NB: сниппет ТЗ с app.get('*') на Express 5 (path-to-regexp v8) кидает TypeError —
// семантика ТЗ воспроизведена завершающим app.use: /api, /ws, /vad-assets → 404 JSON,
// всё остальное → frontend/dist/index.html.
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/vad-assets')) {
        return res.status(404).json({ error: 'Not found' });
    }
    return res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'));
});

export default app;