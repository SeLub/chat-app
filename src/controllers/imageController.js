// src/controllers/imageController.js
// Контроллер для работы с изображениями

import fs from 'fs';
import { getImagePath, getMimeType, deleteImages } from '../services/imageService.js';

/**
 * Отдаёт изображение по ID
 */
export function getImageHandler(req, res) {
  const { imageId, type } = req.params;

  try {
    const filePath = getImagePath(imageId, type);

    if (!filePath) {
      return res.status(400).json({ error: 'Invalid image type' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set appropriate headers
    const ext = filePath.toLowerCase().split('.').pop();
    res.setHeader('Content-Type', getMimeType(`.${ext}`));
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache

    const imageStream = fs.createReadStream(filePath);
    imageStream.pipe(res);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
}

/**
 * Удаляет изображения из разговора
 */
export async function deleteImagesHandler(req, res) {
  try {
    const { imageUrls } = req.body;
    if (!imageUrls || !Array.isArray(imageUrls)) {
      return res.status(400).json({ error: 'Invalid image URLs array' });
    }

    const result = await deleteImages(imageUrls);
    res.json(result);
  } catch (error) {
    console.error('Error deleting images:', error);
    res.status(500).json({ error: 'Failed to delete images' });
  }
}