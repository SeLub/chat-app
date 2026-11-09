// src/middleware/errorHandler.js
import { createLogger } from '../utils/logger.js';
const log = createLogger('ErrorHandler');

export function providerErrorHandler(err, req, res, next) {
  // Ошибки подключения к провайдеру
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    log.error(`Provider ${req.providerName || 'unknown'} is unreachable`, {
      code: err.code,
      url: req.provider?.url,
      message: err.message
    });
    
    return res.status(503).json({
      error: `Provider "${req.providerName}" is currently unavailable.`,
      details: err.message,
      code: err.code,
      hint: 'Check if the provider server is running and accessible.'
    });
  }
  
  // Ошибки таймаута
  if (err.type === 'request-timeout' || err.code === 'FETCH_TIMEOUT') {
    log.error(`Provider ${req.providerName} timed out`);
    return res.status(504).json({
      error: `Provider "${req.providerName}" did not respond in time.`,
      hint: 'The model may be loading or the server is overloaded.'
    });
  }
  
  // Прочие ошибки
  log.error('Unhandled provider error', { error: err.message, stack: err.stack });
  return res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
}