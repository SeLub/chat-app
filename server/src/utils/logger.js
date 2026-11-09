// src/utils/logger.js
// Единый логгер с модульной привязкой, цветами и гибким форматированием

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase() || 'info'] ?? LOG_LEVELS.info;

// Отключение цветов через ENV (для продакшена или логов в файл)
const USE_COLORS = process.env.LOG_COLORS !== 'false';

const COLORS = USE_COLORS ? {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
    cyan: '\x1b[36m',
} : {
    reset: '', red: '', yellow: '', green: '', blue: '', gray: '', cyan: '',
};

const LEVEL_COLORS = {
    debug: COLORS.gray,
    info: COLORS.green,
    warn: COLORS.yellow,
    error: COLORS.red,
};

const LEVEL_LABELS = {
    debug: 'DEBUG',
    info: 'INFO ',
    warn: 'WARN ',
    error: 'ERROR',
};

/**
 * Форматирует данные для вывода
 * - undefined/null → ''
 * - Error → message + stack
 * - Object → JSON
 * - Primitive → toString
 */
function formatData(data) {
    if (data === undefined || data === null) return '';
    if (data instanceof Error) return `${data.message}\n${data.stack}`;
    if (typeof data === 'object') {
        try {
            return JSON.stringify(data, null, 2);
        } catch {
            return String(data);
        }
    }
    return String(data);
}

/**
 * Создаёт логгер для конкретного модуля
 * @param {string} moduleName - имя модуля (отображается в логах)
 */
export function createLogger(moduleName) {
    const moduleLabel = moduleName.padEnd(18); // выравнивание для читаемости
    
    function logMessage(level, message, data) {
        if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
        
        const timestamp = new Date().toISOString();
        const levelColor = LEVEL_COLORS[level];
        const levelLabel = LEVEL_LABELS[level];
        
        const prefix = `${COLORS.gray}${timestamp}${COLORS.reset} ` +
                       `${levelColor}[${levelLabel}]${COLORS.reset} ` +
                       `${COLORS.blue}[${moduleLabel}]${COLORS.reset}`;
        
        const formattedData = formatData(data);
        const fullMessage = formattedData ? `${message}\n${formattedData}` : message;
        
        const output = `${prefix} ${fullMessage}`;
        
        switch (level) {
            case 'debug': console.debug(output); break;
            case 'info':  console.info(output);  break;
            case 'warn':  console.warn(output);  break;
            case 'error': console.error(output); break;
        }
    }
    
    return {
        debug: (message, data) => logMessage('debug', message, data),
        info:  (message, data) => logMessage('info',  message, data),
        warn:  (message, data) => logMessage('warn',  message, data),
        error: (message, data) => logMessage('error', message, data),
        
        // Удобные алиасы
        child: (childName) => createLogger(`${moduleName}:${childName}`),
    };
}

// Корневой логгер для приложения
export const rootLogger = createLogger('app');

// Экспорт по умолчанию — для быстрого использования без создания
export default rootLogger;