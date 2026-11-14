// src/routes/chatRoutes.js
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatHandler } from '../controllers/chatController.js';
import { providerMiddleware } from '../middleware/providerMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TZ-B.1: diskStorage вместо memoryStorage — attachmentRepo.extractFromPaths
// должен читать файл по пути (uploads/tmp/), а не из памяти
const tmpDir = path.join(__dirname, '..', '..', 'uploads', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// Санитизация имени: убираем разделители пути (защита от path traversal при записи)
const sanitizeName = (name) => name.replace(/[/\\]+/g, '_');

const router = Router();

// Multer для обработки multipart/form-data (файлы + текстовые поля)
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, tmpDir),
        filename: (req, file, cb) =>
            cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}_${sanitizeName(file.originalname)}`)
    }),
    limits: { fileSize: 50 * 1024 * 1024 }  // 50MB лимит (сохранён)
});

// POST /api/chat
// Порядок middleware ВАЖЕН:
// 1. providerMiddleware — определяет провайдера из X-Provider header
// 2. upload.fields — парсит multipart/form-data, заполняет req.body и req.files
// 3. chatHandler — обрабатывает сообщение
router.post('/',
    providerMiddleware,
    upload.fields([
        { name: 'file', maxCount: 1 },        // одно изображение/документ
        { name: 'codeFiles', maxCount: 50 },  // до 50 code файлов
        { name: 'message', maxCount: 1 },     // текст сообщения
        { name: 'model', maxCount: 1 },       // модель
        { name: 'sessionId', maxCount: 1 },   // ID сессии
        { name: 'questionId', maxCount: 1 },  // ID вопроса
        { name: 'contextLength', maxCount: 1 }, // контекст модели
        { name: 'retainPercent', maxCount: 1 }, // % истории
        // Dynamic generation params (P0.1) — text fields, maxCount 1 each.
        // Absent/empty → "use server default" (not forwarded to provider).
        { name: 'temperature', maxCount: 1 },
        { name: 'top_p', maxCount: 1 },
        { name: 'top_k', maxCount: 1 },
        { name: 'min_p', maxCount: 1 },
        { name: 'n_predict', maxCount: 1 },
        { name: 'presence_penalty', maxCount: 1 },
        { name: 'repeat_penalty', maxCount: 1 },
        // P0.2: prompt selection
        { name: 'syspromptId', maxCount: 1 },
        { name: 'selectedTemplateIds', maxCount: 1 }
    ]),
    chatHandler
);

export default router;