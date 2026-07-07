// public/logger.js
// Простой логгер для фронтенда с уровнями и модульной привязкой

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[localStorage.getItem('logLevel') || 'info'];

function createLogger(moduleName) {
    const prefix = `[${moduleName}]`;
    
    return {
        debug: (message, ...args) => {
            if (CURRENT_LEVEL <= LOG_LEVELS.debug) {
                console.debug(`${prefix} ${message}`, ...args);
            }
        },
        info: (message, ...args) => {
            if (CURRENT_LEVEL <= LOG_LEVELS.info) {
                console.info(`${prefix} ${message}`, ...args);
            }
        },
        warn: (message, ...args) => {
            if (CURRENT_LEVEL <= LOG_LEVELS.warn) {
                console.warn(`${prefix} ${message}`, ...args);
            }
        },
        error: (message, ...args) => {
            if (CURRENT_LEVEL <= LOG_LEVELS.error) {
                console.error(`${prefix} ${message}`, ...args);
            }
        },
    };
}

// Глобальный логгер
window.logger = createLogger('App');

// Управление уровнем из консоли браузера:
// localStorage.setItem('logLevel', 'debug') — включить всё
// localStorage.setItem('logLevel', 'error') — только ошибки