// src/utils/imageUtils.js
// Утилиты для работы с изображениями

export function getMimeType(extension) {
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  return mimeTypes[extension.toLowerCase()] || 'image/jpeg';
}

export function isImageFile(mimetype) {
  return mimetype && mimetype.startsWith('image/');
}