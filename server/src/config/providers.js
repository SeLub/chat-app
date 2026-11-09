// src/config/providers.js
// Конфигурация провайдеров с fallback на дефолтные значения

const config = {
    defaultProvider: process.env.DEFAULT_PROVIDER || 'ollama',

    providers: {
        ollama: {
            type: 'ollama',
            url: process.env.OLLAMA_URL || 'http://localhost:11434',
            enabled: process.env.OLLAMA_ENABLED !== 'false', // по умолчанию true
        },
        llama_cpp: {
            type: 'llama_cpp',
            url: process.env.LLAMA_CPP_URL || 'http://localhost:8080',
            enabled: process.env.LLAMA_CPP_ENABLED === 'true', // по умолчанию false
        },
    },
};

export default config;