// src/config/providers.js
// Конфигурация провайдеров. Читает из ENV, иначе — дефолты.

const config = {
  defaultProvider: process.env.DEFAULT_PROVIDER || 'ollama',

  providers: {
    ollama: {
      type: 'ollama',
      url: process.env.OLLAMA_URL || 'http://localhost:11434',
      enabled: process.env.OLLAMA_ENABLED !== 'false',
    },
    llama_cpp: {
      type: 'llama_cpp',
      url: process.env.LLAMA_CPP_URL || 'http://0.0.0.0:8080',
      enabled: process.env.LLAMA_CPP_ENABLED === 'true', // по умолчанию выключен
    },
  },
};

export default config;