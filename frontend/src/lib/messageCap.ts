// ТЗ adaptive-context-budget (№4 из списка владельца): кап на длину message.
// Закрывает канал «мегабайты из поля ввода»: композер блокирует отправку
// раньше сервера (мягкий кап с пометкой в UI), сервер остаётся контрактом
// для прямых запросов (400 message_too_long в chatController).
// MAX_MESSAGE_CHARS — дубликат серверной константы (chatController.js):
// при изменении обновлять ОБА места (единого источника нет — паттерн
// DEFAULT_SYSPROMPT, см. WORKLOG).

/** Лимит длины message в символах (server: chatController.MAX_MESSAGE_CHARS) */
export const MAX_MESSAGE_CHARS = 64000;

/** Доля капа, после которой в композере появляется нейтральный счётчик */
export const MESSAGE_CAP_WARN_RATIO = 0.9;

/** Длина превышает кап — отправка блокируется */
export function isMessageOverCap(len: number): boolean {
  return Number.isFinite(len) && len > MAX_MESSAGE_CHARS;
}

/** Длина в «предупредительной» зоне (>90% капа) — показываем счётчик */
export function isMessageNearCap(len: number): boolean {
  return Number.isFinite(len) && len > MAX_MESSAGE_CHARS * MESSAGE_CAP_WARN_RATIO;
}

/** 64000 → «64 000»; группировка по 3 цифры пробелом (детерминированная — без Intl) */
export function formatChars(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
