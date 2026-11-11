// src/services/metricsService.js
// Нормализация метрик производительности

/**
 * Извлекает метрики производительности из ответа Ollama.
 * Работает как для /api/generate, так и для /api/chat.
 */
export function extractMetrics(data) {
  // Переводим наносекунды в секунды
  const evalDurationSec = (data.eval_duration || 0) / 1e9;
  const promptEvalDurationSec = (data.prompt_eval_duration || 0) / 1e9;
  const totalDurationSec = (data.total_duration || 0) / 1e9;
  const loadDurationSec = (data.load_duration || 0) / 1e9;

  // Считаем TPS (токены в секунду)
  const tps = evalDurationSec > 0 ? (data.eval_count / evalDurationSec) : 0;
  const promptTps = promptEvalDurationSec > 0 ? (data.prompt_eval_count / promptEvalDurationSec) : 0;

  return {
    tps: parseFloat(tps.toFixed(2)),                    // Скорость генерации (tok/s)
    promptTps: parseFloat(promptTps.toFixed(2)),        // Скорость чтения промпта (tok/s)
    inputTokens: data.prompt_eval_count || 0,           // Токенов во входе
    outputTokens: data.eval_count || 0,                 // Токенов на выходе
    totalTime: parseFloat(totalDurationSec.toFixed(2)), // Общее время (сек)
    ttft: parseFloat(promptEvalDurationSec.toFixed(2)), // Приближенное время до первого слова (сек)
    loadTime: parseFloat(loadDurationSec.toFixed(2))    // Время загрузки модели в RAM/VRAM (сек)
  };
}

/**
 * Извлекает метрики производительности из ответа llama.cpp.
 * llama.cpp возвращает статистику в формате:
 * {
 *   "timings": {
 *     "cache_n": 236,       // number of prompt tokens reused from cache
 *     "prompt_n": 1,        // number of prompt tokens being processed (без кэш-хитов!)
 *     "prompt_ms": 150.5,
 *     "predicted_n": 50,
 *     "predicted_ms": 1200.3
 *   },
 *   "usage": { "prompt_tokens": ..., "completion_tokens": ... }  // OpenAI-совместимый
 * }
 */
export function extractLlamaCppMetrics(data) {
  const timings = data.timings || {};

  // Конвертируем миллисекунды в секунды
  const promptSec = (timings.prompt_ms || 0) / 1000;
  const predictedSec = (timings.predicted_ms || 0) / 1000;

  // Считаем TPS
  const tps = predictedSec > 0 ? (timings.predicted_n / predictedSec) : 0;
  const promptTps = promptSec > 0 ? (timings.prompt_n / promptSec) : 0;

  // Общее время (если есть)
  const totalTime = timings.total_ms ? timings.total_ms / 1000 : (promptSec + predictedSec);

  // ТЗ adaptive-context-budget (№3): inputTokens = ПОЛНЫЙ размер промпта.
  // timings.prompt_n — только вновь обработанные токены: при включённом
  // слот-кэше (cache_prompt в llama-server по умолчанию) он измеряет ХВОСТ
  // промпта, и плотность chars/токен по нему завышается на порядки. Цепочка
  // источников полного счётчика:
  //   1) usage.prompt_tokens — llama.cpp ставит slot.n_prompt_tokens (полный
  //      промпт; то же поле, что в теле 400 exceed_context_size_error);
  //   2) timings.prompt_n + timings.cache_n (обработанные + из кэша);
  //   3) timings.prompt_n — сборки без usage/cache_n (там prompt_n полный).
  // Скоростные метрики (promptTps) остаются на timings.prompt_n — они про
  // ОБРАБОТАННЫЕ токены, а не про размер промпта.
  const usagePromptTokens = Number(data.usage?.prompt_tokens);
  const promptN = Number(timings.prompt_n);
  const cacheN = Number(timings.cache_n);

  let inputTokens = 0;
  if (Number.isFinite(usagePromptTokens) && usagePromptTokens > 0) {
    inputTokens = usagePromptTokens;
  } else if (Number.isFinite(promptN) && Number.isFinite(cacheN) && promptN + cacheN > 0) {
    inputTokens = promptN + cacheN;
  } else if (Number.isFinite(promptN) && promptN > 0) {
    inputTokens = promptN;
  }

  const cachedTokens = Number.isFinite(cacheN) && cacheN > 0 ? cacheN : 0;

  return {
    tps: parseFloat(tps.toFixed(2)),                    // Скорость генерации (tok/s)
    promptTps: parseFloat(promptTps.toFixed(2)),        // Скорость чтения промпта (tok/s)
    inputTokens,                                        // Токенов во входе (ПОЛНЫЙ промпт)
    cachedTokens,                                       // Токенов, переиспользованных из KV-кэша
    outputTokens: timings.predicted_n || 0,             // Токенов на выходе
    totalTime: parseFloat(totalTime.toFixed(2)),        // Общее время (сек)
    ttft: parseFloat(promptSec.toFixed(2)),             // Время до первого слова (сек)
    loadTime: 0                                          // llama.cpp не возвращает время загрузки
  };
}