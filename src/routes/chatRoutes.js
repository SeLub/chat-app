// src/routes/chatRoutes.js
import { Router } from 'express';
import { chatHandler } from '../controllers/chatController.js';
import { upload } from '../middleware/uploadMiddleware.js';
import { providerMiddleware } from '../middleware/providerMiddleware.js';

const router = Router();

router.post('/', 
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'codeFiles', maxCount: 50 }]),
  providerMiddleware,
  chatHandler
);

export default router;