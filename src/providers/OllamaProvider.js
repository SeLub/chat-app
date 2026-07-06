// src/providers/OllamaProvider.js
// Реализация провайдера Ollama

import fetch from 'node-fetch';
import { BaseProvider } from './BaseProvider.js';
import { extractMetrics } from '../services/metricsService.js';

export class OllamaProvider extends BaseProvider {
  constructor(name, config) {
    super(name, config);
  }

  /**
   * Получает список доступных моделей
   */
  async getModels() {
    try {
      console.log('Checking Ollama connection...');
      const [tagsResponse, psResponse] = await Promise.all([
        fetch(`${this.url}/api/tags`),
        fetch(`${this.url}/api/ps`)
      ]);

      console.log('Tags response status:', tagsResponse.status);
      console.log('PS response status:', psResponse.status);

      if (!tagsResponse.ok || !psResponse.ok) {
        throw new Error('Ollama service not responding');
      }

      const availableModels = await tagsResponse.json();
      const runningModels = await psResponse.json();

      console.log('Available models:', availableModels);
      console.log('Running models:', runningModels);

      // Check if Ollama is actually working by verifying we get valid data
      if (!availableModels || !availableModels.models) {
        throw new Error('Ollama returned invalid data');
      }

      const runningModelNames = new Set(
        runningModels.models?.map(rm => rm.name) || []
      );

      const models = availableModels.models?.map(model => ({
        name: model.name,
        size: model.size,
        status: runningModelNames.has(model.name) ? 'running' : 'available',
        type: this.detectModelType(model.name)
      })).sort((a, b) => a.name.localeCompare(b.name)) || [];

      return { models, connected: true };
    } catch (error) {
      console.error('Models API error:', error.message);
      console.error('Error type:', error.code || error.type);
      return { models: [], connected: false };
    }
  }

  /**
   * Получает детальную информацию о модели
   */
  async showModel(name) {
    try {
      const response = await fetch(`${this.url}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ollama show API error:', response.statusText, errorText);
        throw new Error(response.statusText);
      }

      return await response.json();
    } catch (error) {
      console.error('Show API error:', error);
      throw error;
    }
  }

  /**
   * Генерирует ответ на промпт
   */
  async generate({ model, prompt, stream = false }) {
    try {
      console.log('Sending request to Ollama...');
      const response = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: stream,
        }),
      });

      console.log('Ollama response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ollama response not ok:', response.statusText, errorText);
        throw new Error(`Model error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Ollama response:', data);

      return {
        response: data.response,
        metrics: extractMetrics(data)
      };
    } catch (error) {
      console.error('Generate error:', error);
      throw error;
    }
  }

  /**
   * Отправляет чат-сообщение с изображениями
   */
  async chat({ model, messages, stream = false }) {
    try {
      console.log('Sending chat request to Ollama...');
      const response = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: stream
        }),
      });

      console.log('Ollama chat response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ollama chat response not ok:', response.statusText, errorText);
        throw new Error(`Chat error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Ollama chat response:', data);

      return {
        response: data.message.content,
        metrics: extractMetrics(data)
      };
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    }
  }

  /**
   * Проверяет доступность провайдера
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.url}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Определяет тип модели по имени
   */
  detectModelType(modelName) {
    const embedModels = ['nomic-embed-text', 'embed'];
    const visionModels = ['vision', 'llava', 'gemma3', 'qwen3-vl'];

    const isEmbed = embedModels.some(type => modelName.includes(type));
    const isVision = visionModels.some(type => modelName.includes(type));

    if (isEmbed) return 'embedding';
    if (isVision) return 'vision';
    return 'text';
  }

  /**
   * Нормализует метрики (для Ollama уже есть extractMetrics)
   */
  normalizeMetrics(raw) {
    return extractMetrics(raw);
  }
}