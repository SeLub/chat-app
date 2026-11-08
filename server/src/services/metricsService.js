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
 *     "prompt_n": 10,
 *     "prompt_ms": 150.5,
 *     "predicted_n": 50,
 *     "predicted_ms": 1200.3
 *   }
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
  
  return {
    tps: parseFloat(tps.toFixed(2)),                    // Скорость генерации (tok/s)
    promptTps: parseFloat(promptTps.toFixed(2)),        // Скорость чтения промпта (tok/s)
    inputTokens: timings.prompt_n || 0,                 // Токенов во входе
    outputTokens: timings.predicted_n || 0,             // Токенов на выходе
    totalTime: parseFloat(totalTime.toFixed(2)),        // Общее время (сек)
    ttft: parseFloat(promptSec.toFixed(2)),             // Время до первого слова (сек)
    loadTime: 0                                          // llama.cpp не возвращает время загрузки
  };
}