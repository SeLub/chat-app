// src/routes/chatRoutes.js
import { Router } from 'express';
import multer from 'multer';
import { chatHandler } from '../controllers/chatController.js';
import { providerMiddleware } from '../middleware/providerMiddleware.js';

const router = Router();

// Multer для обработки multipart/form-data (файлы + текстовые поля)
const upload = multer({
    storage: multer.memoryStorage(),  // Храним файлы в памяти (буфер)
    limits: { fileSize: 50 * 1024 * 1024 }  // 50MB лимит
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
        { name: 'retainPercent', maxCount: 1 } // % истории
    ]),
    chatHandler
);

export default router;