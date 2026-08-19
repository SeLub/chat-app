// src/routes/sttRoutes.js
import { Router } from 'express';
import { transcribeHandler } from '../controllers/sttController.js';
import { upload } from '../middleware/uploadMiddleware.js'; // Используем твой существующий middleware

const router = Router();

// Принимаем один файл с именем 'audio'
router.post('/transcribe', upload.single('audio'), transcribeHandler);

export default router;