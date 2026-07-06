// src/middleware/uploadMiddleware.js
// Middleware для загрузки файлов

import multer from 'multer';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max file size
});