// src/utils/fileUtils.js
// Утилиты для работы с файлами

export function generateImageId() {
  return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

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