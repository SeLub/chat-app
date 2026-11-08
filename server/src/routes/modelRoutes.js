// src/routes/modelRoutes.js
import { Router } from 'express';
import { getModelsHandler, showModelHandler } from '../controllers/modelController.js';
import { providerMiddleware } from '../middleware/providerMiddleware.js';

const router = Router();

router.get('/', providerMiddleware, getModelsHandler);
router.post('/show', providerMiddleware, showModelHandler);

export default router;