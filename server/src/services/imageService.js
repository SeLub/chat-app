// src/services/imageService.js
// Работа с изображениями

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImageId } from '../utils/fileUtils.js';
import { getMimeType } from '../utils/imageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'images');
const thumbnailsDir = path.join(uploadsDir, 'thumbnails');

/**
 * Сохраняет изображение и создаёт миниатюру
 */
export async function saveImageFiles(buffer, originalName) {
  const imageId = generateImageId();
  const ext = path.extname(originalName).toLowerCase();
  const fullPath = path.join(uploadsDir, `${imageId}${ext}`);
  const thumbPath = path.join(thumbnailsDir, `${imageId}_thumb.jpg`);

  // Save original image
  await fs.promises.writeFile(fullPath, buffer);

  // Generate and save thumbnail
  await sharp(buffer)
    .resize(150, 150, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbPath);

  return {
    id: imageId,
    filename: originalName,
    fullUrl: `/api/images/${imageId}/full`,
    thumbnailUrl: `/api/images/${imageId}/thumb`
  };
}

/**
 * Удаляет изображения по их URL
 */
export async function deleteImages(imageUrls) {
  let deletedCount = 0;

  imageUrls.forEach(url => {
    // Extract image ID from URL (e.g., '/api/images/img_123_abc/full' -> 'img_123_abc')
    const match = url.match(/\/api\/images\/([^/]+)\/(full|thumb)/);
    if (match) {
      const imageId = match[1];

      // Find and delete original image
      const files = fs.readdirSync(uploadsDir);
      const originalFile = files.find(file => file.startsWith(imageId) && !file.includes('_thumb'));
      if (originalFile) {
        const imagePath = path.join(uploadsDir, originalFile);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          deletedCount++;
        }
      }

      // Delete thumbnail
      const thumbPath = path.join(thumbnailsDir, `${imageId}_thumb.jpg`);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    }
  });

  return { success: true, deletedCount };
}

/**
 * Получает путь к изображению
 */
export function getImagePath(imageId, type) {
  if (type === 'thumb') {
    return path.join(thumbnailsDir, `${imageId}_thumb.jpg`);
  } else if (type === 'full') {
    // Find the original file with any extension
    const files = fs.readdirSync(uploadsDir);
    const originalFile = files.find(file => file.startsWith(imageId) && !file.includes('_thumb'));
    if (!originalFile) {
      return null;
    }
    return path.join(uploadsDir, originalFile);
  }
  return null;
}

export { uploadsDir, thumbnailsDir, getMimeType };