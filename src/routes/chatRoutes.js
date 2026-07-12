// src/routes/chatRoutes.js
import { Router } from 'express';
import { chatHandler } from '../controllers/chatController.js';
import { providerMiddleware } from '../middleware/providerMiddleware.js';

const router = Router();

router.post('/', providerMiddleware, chatHandler);

export default router;