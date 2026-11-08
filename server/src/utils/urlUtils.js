// src/utils/urlUtils.js
// Утилиты для работы с URL

export function extractUrls(text) {
  const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
  return text.match(urlRegex) || [];
}