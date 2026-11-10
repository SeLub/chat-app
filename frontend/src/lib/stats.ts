/**
 * Чистые хелперы расчёта статистики чата (футер + контекст-бар).
 * Вынесены из chat-area.tsx для юнит-тестирования.
 */

/**
 * Загрузка контекста, % — ЕДИНАЯ формула для контекст-бара (хедер) и
 * Detailed Statistics (диалог «TPS»): токены сессии / размер контекста модели.
 *
 * История: бар считал contextInfo.totalChars / (contextSize * 4) — серверную
 * char-эвристику «4 символа = 1 токен» (contextBuilder: maxChars = ctx * 4).
 * Для кириллицы и кода реальная плотность 1.3–2.5 символа/токен, поэтому бар
 * занижал в 1.5–3 раза (12% при реальных 38%). Теперь оба места считают по
 * одним данным (totalInputTokens + totalOutputTokens) и не могут разойтись.
 *
 * @param totalTokens    суммарные токены сессии (input + output)
 * @param contextLength  размер контекста модели (например 98304); null/0 — нет данных
 * @returns процент 0–100 (кап 100 — при тримминге сервером накопительная сумма
 *          растёт, а фактический контекст ограничен окном), null — нет контекста
 */
export function computeContextLoadPct(
  totalTokens: number,
  contextLength: number | null | undefined,
): number | null {
  if (!contextLength || contextLength <= 0) return null;
  return Math.min(100, Math.round((totalTokens / contextLength) * 100));
}

/**
 * Размер файла модели в ГБ для футера («Size: X.X GB»).
 *
 * История: React-версия читала только modelDetail.details.size — поля, которого
 * нет ни у одного провайдера (llama.cpp showModel отдаёт size верхним уровнем,
 * Ollama /api/show размера не отдаёт вовсе) → «Size: – GB» всегда. Оригинальный
 * public/script.js (строки 468–475) имел фолбэк на размер из списка моделей
 * (Ollama /api/tags → реальный размер; llama.cpp /v1/models meta.size) — при
 * переписывании на React он потерялся. Цепочка источников восстановлена:
 *   1) modelDetail.size          — llama.cpp showModel (верхний уровень)
 *   2) modelDetail.details.size  — legacy-форма (на случай будущих провайдеров)
 *   3) models list size          — фолбэк оригинального script.js
 *
 * @param bytes размер в байтах или отсутствующее значение
 * @returns «12.3» либо «–», если размер неизвестен
 */
export function formatSizeGb(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '–';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}
