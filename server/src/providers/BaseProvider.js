// src/providers/BaseProvider.js
import { createLogger } from '../utils/logger.js';
const log = createLogger('BaseProvider');

export class BaseProvider {
    constructor(name, config) {
        if (new.target === BaseProvider) {
            throw new Error('BaseProvider is abstract and cannot be instantiated directly');
        }
        this.name = name;
        this.config = config;
        this.url = config.url;
    }

    async getModels() {
        throw new Error(`getModels() not implemented in ${this.name}`);
    }

    async showModel(name) {
        throw new Error(`showModel() not implemented in ${this.name}`);
    }

    async generate({ model, prompt, stream = false }) {
        throw new Error(`generate() not implemented in ${this.name}`);
    }

    async chat({ model, messages, stream = false }) {
        throw new Error(`chat() not implemented in ${this.name}`);
    }

    async healthCheck() {
        throw new Error(`healthCheck() not implemented in ${this.name}`);
    }

    normalizeMetrics(raw) {
        throw new Error(`normalizeMetrics() not implemented in ${this.name}`);
    }

    detectModelType(modelName) {
        return 'text';
    }

    /**
     * Возвращает полный статус провайдера для UI
     */
    async getStatus() {
        const start = Date.now();
        try {
            const isAlive = await this.healthCheck();
            return {
                name: this.name,
                type: this.config.type,
                url: this.config.url,
                enabled: this.config.enabled,
                status: isAlive ? 'connected' : 'disconnected',
                latencyMs: Date.now() - start,
                error: null,
            };
        } catch (error) {
            return {
                name: this.name,
                type: this.config.type,
                url: this.config.url,
                enabled: this.config.enabled,
                status: 'error',
                latencyMs: Date.now() - start,
                error: error.message,
            };
        }
    }
}