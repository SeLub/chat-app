// src/providers/OllamaProvider.js
import fetch from 'node-fetch';
import { BaseProvider } from './BaseProvider.js';
import { extractMetrics } from '../services/metricsService.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OllamaProvider');

export class OllamaProvider extends BaseProvider {
    constructor(name, config) {
        super(name, config);
    }

    /**
     * Получает список моделей через /api/tags + /api/ps для статуса
     */
    async getModels() {
        try {
            log.info('Checking Ollama connection...');

            const [tagsResponse, psResponse] = await Promise.all([
                fetch(`${this.url}/api/tags`),
                fetch(`${this.url}/api/ps`)
            ]);

            if (!tagsResponse.ok) {
                throw new Error(`Ollama API error: ${tagsResponse.statusText}`);
            }

            const tagsData = await tagsResponse.json();
            let runningNames = new Set();

            if (psResponse.ok) {
                const psData = await psResponse.json();
                runningNames = new Set(
                    (psData.models || []).map(m => m.name)
                );
            }

            const models = (tagsData.models || []).map(model => ({
                name: model.name,
                size: model.size || 0,
                status: runningNames.has(model.name) ? 'running' : 'available',
                type: this.detectModelType(model.name),
                contextLength: null, // будет получено через /api/show
                meta: {
                    digest: model.digest || null,
                    details: model.details || {},
                    modifiedAt: model.modified_at || null,
                }
            })).sort((a, b) => a.name.localeCompare(b.name));

            log.info(`Found ${models.length} model(s) in Ollama`, {
                models: models.map(m => `${m.name} (${m.status})`)
            });

            return { models, connected: true };
        } catch (error) {
            log.error('Ollama models API error', { error: error.message });
            return { models: [], connected: false };
        }
    }

    async showModel(name) {
        try {
            const response = await fetch(`${this.url}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Model '${name}' not found`);
                }
                throw new Error(`Failed to get model information: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            log.error('Show model error', { error: error.message });
            throw error;
        }
    }

    async generate({ model, prompt, stream = false }) {
        try {
            log.info('Sending request to Ollama', { model });

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);

            const response = await fetch(`${this.url}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt,
                    stream,
                    options: {
                        temperature: 0.7,
                        top_k: 40,
                        top_p: 0.95,
                        repeat_penalty: 1.1
                    }
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                log.error('Ollama response not ok', { status: response.status, body: errorText });
                throw new Error(`Model error: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                response: data.response,
                metrics: extractMetrics(data)
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request to Ollama timed out after 120 seconds');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to Ollama at ${this.url}. Is the server running?`);
            }
            throw error;
        }
    }

    async chat({ model, messages, stream = false }) {
        try {
            log.info('Sending chat request to Ollama', { model });

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);

            const response = await fetch(`${this.url}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages,
                    stream,
                    options: {
                        temperature: 0.7,
                        top_k: 40,
                        top_p: 0.95,
                        repeat_penalty: 1.1
                    }
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                log.error('Ollama chat response not ok', { status: response.status, body: errorText });
                throw new Error(`Chat error: ${response.statusText}`);
            }

            const data = await response.json();
            const content = data.message?.content || '';

            return {
                response: content,
                metrics: extractMetrics(data)
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request to Ollama timed out after 120 seconds');
            }
            if (error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to Ollama at ${this.url}. Is the server running?`);
            }
            throw error;
        }
    }

    /**
     * Health check: используем корневой endpoint (надёжнее чем /api/health)
     * Ollama отвечает на "/" строкой "Ollama is running"
     */
    async healthCheck() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${this.url}/`, {
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            return response.ok;
        } catch (error) {
            log.debug(`Health check failed for ${this.name}`, { error: error.message });
            return false;
        }
    }

    detectModelType(modelName) {
        const lower = modelName.toLowerCase();
        const embedModels = ['embed', 'embedding'];
        const visionModels = ['vision', 'llava', 'gemma3', 'qwen3-vl'];

        if (embedModels.some(t => lower.includes(t))) return 'embedding';
        if (visionModels.some(t => lower.includes(t))) return 'vision';
        return 'text';
    }

    normalizeMetrics(raw) {
        return extractMetrics(raw);
    }
}