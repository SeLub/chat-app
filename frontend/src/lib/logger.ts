const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function getLevel(): number {
  const stored = localStorage.getItem('logLevel');
  return stored && stored in LOG_LEVELS ? LOG_LEVELS[stored as keyof typeof LOG_LEVELS] : LOG_LEVELS.info;
}

export function createLogger(moduleName: string) {
  const prefix = `[${moduleName}]`;

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (getLevel() <= LOG_LEVELS.debug) {
        console.debug(`${prefix} ${message}`, ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (getLevel() <= LOG_LEVELS.info) {
        console.info(`${prefix} ${message}`, ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (getLevel() <= LOG_LEVELS.warn) {
        console.warn(`${prefix} ${message}`, ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (getLevel() <= LOG_LEVELS.error) {
        console.error(`${prefix} ${message}`, ...args);
      }
    },
  };
}

export const logger = createLogger('App');
