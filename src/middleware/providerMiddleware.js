// src/middleware/providerMiddleware.js
// Middleware для определения активного провайдера

import { getProvider, getDefaultProviderName } from '../providers/providerManager.js';

/**
 * Определяет провайдера из запроса и добавляет его в req.provider
 */
export async function providerMiddleware(req, res, next) {
  try {
    // Провайдер может быть передан через заголовок или в body
    const providerName = req.headers['x-provider'] || req.body?.provider || getDefaultProviderName();
    
    const provider = await getProvider(providerName);
    req.provider = provider;
    req.providerName = providerName;
    
    next();
  } catch (error) {
    console.error('Provider middleware error:', error);
    res.status(400).json({ error: `Invalid provider: ${error.message}` });
  }
}