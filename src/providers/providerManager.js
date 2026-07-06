// src/providers/providerManager.js
// Единая точка доступа к провайдерам.

import config from '../config/providers.js';

// Ленивая регистрация: классы подгружаются только при первом обращении,
// чтобы не падать, если какой-то провайдер ещё не реализован.
const registry = {
  ollama: () => import('./OllamaProvider.js').then(m => m.OllamaProvider),
  llama_cpp: () => import('./LlamaCppProvider.js').then(m => m.LlamaCppProvider),
};

const instances = {};

/**
 * Получить (или создать) инстанс провайдера.
 * @param {string} [name] — имя провайдера; если не указано — defaultProvider.
 */
export async function getProvider(name = config.defaultProvider) {
  if (!instances[name]) {
    const loader = registry[name];
    if (!loader) {
      throw new Error(`Unknown provider: "${name}". Available: ${Object.keys(registry).join(', ')}`);
    }
    const ProviderClass = await loader();
    const providerConfig = config.providers[name];
    if (!providerConfig) {
      throw new Error(`No config for provider: "${name}"`);
    }
    instances[name] = new ProviderClass(name, providerConfig);
  }
  return instances[name];
}

/**
 * Список включённых провайдеров (для UI).
 */
export function listProviders() {
  return Object.entries(config.providers)
    .filter(([, cfg]) => cfg.enabled)
    .map(([name, cfg]) => ({ name, type: cfg.type, url: cfg.url }));
}

/**
 * Получить имя провайдера по умолчанию.
 */
export function getDefaultProviderName() {
  return config.defaultProvider;
}