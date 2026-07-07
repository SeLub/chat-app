// src/middleware/providerMiddleware.js
import { getProvider, getDefaultProviderName, listProviders } from '../providers/providerManager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ProviderMiddleware');

// Кэш результатов health check (чтобы не дёргать API на каждый запрос)
const healthCache = new Map();
const HEALTH_CACHE_TTL = 10_000; // 10 секунд

/**
 * Проверяет доступность провайдера с учётом кэша
 */
async function checkProviderHealth(provider) {
    const cached = healthCache.get(provider.name);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < HEALTH_CACHE_TTL) {
        return cached.isAlive;
    }
    
    try {
        const isAlive = await provider.healthCheck();
        healthCache.set(provider.name, { isAlive, timestamp: now });
        return isAlive;
    } catch (error) {
        log.error(`Health check failed for ${provider.name}`, { error: error.message });
        healthCache.set(provider.name, { isAlive: false, timestamp: now });
        return false;
    }
}

/**
 * Ищет первый живой провайдер из списка
 * @param {Array} providers - список провайдеров
 * @param {string} excludeName - имя провайдера, который нужно исключить (чтобы не зациклиться)
 */
async function findFirstHealthyProvider(providers, excludeName = null) {
    for (const p of providers) {
        if (p.name === excludeName) continue;
        
        try {
            const provider = await getProvider(p.name);
            const isAlive = await checkProviderHealth(provider);
            if (isAlive) {
                log.info(`Found healthy fallback provider: ${p.name}`);
                return provider;
            }
        } catch (error) {
            log.warn(`Cannot check provider ${p.name}`, { error: error.message });
        }
    }
    return null;
}

export async function providerMiddleware(req, res, next) {
    try {
        const requestedProvider = req.headers['x-provider'] || req.body?.provider;
        let providerName = requestedProvider || getDefaultProviderName();
        
        // 1. Валидация: существует ли провайдер в конфиге
        const available = listProviders();
        const providerConfig = available.find(p => p.name === providerName);
        
        if (!providerConfig) {
            log.warn(`Unknown provider requested: ${providerName}, falling back to default`);
            providerName = getDefaultProviderName();
        }
        
        // 2. Получаем провайдер
        let provider;
        try {
            provider = await getProvider(providerName);
        } catch (error) {
            log.error(`Failed to instantiate provider ${providerName}`, { error: error.message });
            return res.status(500).json({ 
                error: `Failed to initialize provider "${providerName}"`,
                availableProviders: available.map(p => p.name)
            });
        }
        
        // 3. Проверка здоровья
        const isAlive = await checkProviderHealth(provider);
        
        if (!isAlive) {
            log.warn(`Provider ${providerName} is not responding, attempting fallback`);
            
            // 3a. Если запрошенный провайдер = default, ищем другой живой
            const fallbackProvider = await findFirstHealthyProvider(available, providerName);
            
            if (fallbackProvider) {
                log.info(`Switching to fallback provider: ${fallbackProvider.name}`);
                req.provider = fallbackProvider;
                req.providerName = fallbackProvider.name;
                req.providerFallback = true; // Флаг для UI
                return next();
            }
            
            // 3b. Все провайдеры мертвы
            log.error('All providers are unavailable');
            return res.status(503).json({
                error: 'All providers are currently unavailable.',
                hint: 'Check if provider servers are running and URLs are correct.',
                checkedProviders: available.map(p => ({ name: p.name, url: p.url })),
            });
        }
        
        // 4. Всё ок — провайдер жив
        req.provider = provider;
        req.providerName = providerName;
        req.providerFallback = false;
        next();
        
    } catch (error) {
        log.error('Provider middleware error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Internal server error in provider middleware' });
    }
}