// src/providers/BaseProvider.js
// Абстрактный базовый класс. Все провайдеры наследуются от него.

export class BaseProvider {
  constructor(name, config) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract and cannot be instantiated directly');
    }
    this.name = name;
    this.config = config;
    this.url = config.url;
  }

  /**
   * Список моделей.
   * @returns {Promise<Array<{name, size, contextLength, status, type}>>}
   */
  async getModels() {
    throw new Error(`getModels() not implemented in ${this.name}`);
  }

  /**
   * Детальная информация о модели.
   * @param {string} name
   */
  async showModel(name) {
    throw new Error(`showModel() not implemented in ${this.name}`);
  }

  /**
   * Генерация ответа (одиночный промпт, без истории).
   * @param {{model, prompt, stream}} params
   */
  async generate({ model, prompt, stream = false }) {
    throw new Error(`generate() not implemented in ${this.name}`);
  }

  /**
   * Чат с историей сообщений + опционально изображения.
   * @param {{model, messages, stream}} params
   */
  async chat({ model, messages, stream = false }) {
    throw new Error(`chat() not implemented in ${this.name}`);
  }

  /**
   * Проверка доступности провайдера.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    throw new Error(`healthCheck() not implemented in ${this.name}`);
  }

  /**
   * Нормализация сырых метрик провайдера в единый формат.
   * @param {object} raw
   * @returns {{tps, promptTps, inputTokens, outputTokens, totalTime, ttft, loadTime}}
   */
  normalizeMetrics(raw) {
    throw new Error(`normalizeMetrics() not implemented in ${this.name}`);
  }
}