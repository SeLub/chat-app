// src/routes/imageRoutes.js
import { Router } from 'express';
import { getImageHandler, deleteImagesHandler } from '../controllers/imageController.js';

const router = Router();

router.get('/:imageId/:type', getImageHandler);
router.delete('/conversation-images', deleteImagesHandler);

export default router;