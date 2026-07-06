// src/providers/LlamaCppProvider.js
// Реализация провайдера llama.cpp

import fetch from 'node-fetch';
import { BaseProvider } from './BaseProvider.js';
import { extractLlamaCppMetrics } from '../services/metricsService.js';

export class LlamaCppProvider extends BaseProvider {
  constructor(name, config) {
    super(name, config);
  }

  /**
   * Получает список доступных моделей через /slots
   * llama.cpp server обычно загружает одну модель, но мы адаптируем интерфейс
   */
  async getModels() {
    try {
      console.log('Checking llama.cpp connection...');
      
      // Пробуем получить информацию через /slots
      const slotsResponse = await fetch(`${this.url}/slots`);
      
      if (!slotsResponse.ok) {
        // Если /slots недоступен, пробуем /props
        const propsResponse = await fetch(`${this.url}/props`);
        
        if (!propsResponse.ok) {
          throw new Error('llama.cpp server not responding');
        }
        
        const props = await propsResponse.json();
        
        // Создаём виртуальный список моделей на основе загруженной модели
        const models = [{
          name: props.model || 'llama-cpp-model',
          size: 0, // llama.cpp не всегда возвращает размер
          status: 'running',
          type: 'text', // По умолчанию текстовая модель
          contextLength: props.n_ctx || 2048
        }];
        
        return { models, connected: true };
      }
      
      const slots = await slotsResponse.json();
      
      // Извлекаем информацию о загруженных моделях из slots
      const models = slots.map((slot, index) => ({
        name: slot.model || `llama-cpp-slot-${index}`,
        size: 0,
        status: slot.is_processing ? 'running' : 'available',
        type: this.detectModelType(slot.model || ''),
        contextLength: slot.n_ctx || 2048
      }));
      
      // Если нет слотов, создаём виртуальную модель
      if (models.length === 0) {
        models.push({
          name: 'llama-cpp-model',
          size: 0,
          status: 'running',
          type: 'text',
          contextLength: 2048
        });
      }
      
      return { models, connected: true };
    } catch (error) {
      console.error('llama.cpp models API error:', error.message);
      return { models: [], connected: false };
    }
  }

  /**
   * Получает детальную информацию о модели через /props
   */
  async showModel(name) {
    try {
      const response = await fetch(`${this.url}/props`);
      
      if (!response.ok) {
        throw new Error('Failed to get model information');
      }
      
      const props = await response.json();
      
      // Контекст: если n_ctx установлен — показываем его, иначе null (UI покажет "-")
      const contextLength = props.n_ctx || null;
      
      return {
        model: props.model || name,
        parameters: {
          context_length: contextLength,
          n_gpu_layers: props.n_gpu_layers || 0,
          n_batch: props.n_batch || 512
        },
        template: props.chat_template || '',
        modelfile: `# llama.cpp model\n${props.model || 'Unknown'}`
      };
    } catch (error) {
      console.error('Show model error:', error);
      throw error;
    }
  }

  /**
   * Генерирует ответ на промпт через /completion
   */
  async generate({ model, prompt, stream = false }) {
    try {
      console.log('Sending request to llama.cpp...');
      
      const response = await fetch(`${this.url}/completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          n_predict: -1, // Без лимита токенов
          stream: stream,
          temperature: 0.7,
          top_k: 40,
          top_p: 0.95,
          repeat_penalty: 1.1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('llama.cpp response not ok:', response.statusText, errorText);
        throw new Error(`Model error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('llama.cpp response:', data);

      return {
        response: data.content,
        metrics: extractLlamaCppMetrics(data)
      };
    } catch (error) {
      console.error('Generate error:', error);
      throw error;
    }
  }

  /**
   * Отправляет чат-сообщение через /v1/chat/completions (OpenAI-совместимый API)
   */
  async chat({ model, messages, stream = false }) {
    try {
      console.log('Sending chat request to llama.cpp...');
      
      // llama.cpp поддерживает OpenAI-совместимый API
      const response = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          stream: stream,
          temperature: 0.7,
          max_tokens: -1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('llama.cpp chat response not ok:', response.statusText, errorText);
        throw new Error(`Chat error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('llama.cpp chat response:', data);

      // OpenAI-совместимый формат ответа
      const content = data.choices?.[0]?.message?.content || '';
      
      return {
        response: content,
        metrics: extractLlamaCppMetrics(data)
      };
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    }
  }

  /**
   * Проверяет доступность провайдера через /health
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.url}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Определяет тип модели по имени
   */
  detectModelType(modelName) {
    const embedModels = ['embed', 'embedding'];
    const visionModels = ['vision', 'llava', 'gemma3-vision'];

    const isEmbed = embedModels.some(type => modelName.toLowerCase().includes(type));
    const isVision = visionModels.some(type => modelName.toLowerCase().includes(type));

    if (isEmbed) return 'embedding';
    if (isVision) return 'vision';
    return 'text';
  }

  /**
   * Нормализует метрики llama.cpp
   */
  normalizeMetrics(raw) {
    return extractLlamaCppMetrics(raw);
  }
}