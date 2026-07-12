// src/routes/attachmentRoutes.js
import { Router } from 'express';
import * as attachmentService from '../services/attachmentService.js';
import * as sessionService from '../services/sessionService.js';

const router = Router();

// POST /api/attachments/extract - Extract text from file paths
router.post('/extract', async (req, res) => {
    try {
        const { paths, sessionId } = req.body;

        // Валидация
        if (!paths || !Array.isArray(paths) || paths.length === 0) {
            return res.status(400).json({ error: 'paths array is required' });
        }

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        // Проверка существования сессии
        const session = sessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Извлечение файлов
        const { results, errors } = await attachmentService.extractFiles(paths, sessionId);

        // Возвращаем результаты и ошибки
        res.json({ results, errors });
    } catch (error) {
        console.error('Error in /api/attachments/extract:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attachments/:fileId - Get extracted text for a file
router.get('/:fileId', (req, res) => {
    try {
        const attachment = attachmentService.getAttachment(req.params.fileId);
        
        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        res.json(attachment);
    } catch (error) {
        console.error('Error in GET /api/attachments/:fileId:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;