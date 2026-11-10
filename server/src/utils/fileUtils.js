// src/utils/fileUtils.js
// Утилиты для работы с файлами

// NB: generateImageId удалён вместе с legacy image-потоком (финальное ТЗ) —
// вложения идентифицируются UUID в реестре attachments.

export function getSupportedCodeExtensions() {
  return [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.html', '.css', '.scss',
    '.json', '.xml', '.yaml', '.yml', '.md', '.txt', '.sql', '.php', '.rb',
    '.go', '.rs', '.cpp', '.c', '.h', '.cs', '.swift', '.kt', '.scala',
    '.sh', '.bat', '.dockerfile', '.gitignore', '.env'
  ];
}

export function isCodeFile(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return getSupportedCodeExtensions().includes(`.${ext}`);
}