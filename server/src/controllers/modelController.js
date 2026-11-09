// src/controllers/modelController.js
// Контроллер для работы с моделями

import { createLogger } from '../utils/logger.js';
const log = createLogger('ModelController');


/**
 * Получает список доступных моделей
 */
export async function getModelsHandler(req, res) {
  try {
    const result = await req.provider.getModels();
    res.json(result);
  } catch (error) {
    log.error('Get models error:', error);
    res.json({ models: [], connected: false });
  }
}

/**
 * Получает детальную информацию о модели
 */
export async function showModelHandler(req, res) {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    const data = await req.provider.showModel(name);
    res.json(data);
  } catch (error) {
    log.error('Show model error:', error);
    
    // Обработка специфических ошибок
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to get model information' });
  }
}