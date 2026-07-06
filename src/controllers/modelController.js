// src/controllers/modelController.js
// Контроллер для работы с моделями

/**
 * Получает список доступных моделей
 */
export async function getModelsHandler(req, res) {
  try {
    const result = await req.provider.getModels();
    res.json(result);
  } catch (error) {
    console.error('Get models error:', error);
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
    console.error('Show model error:', error);
    res.status(500).json({ error: 'Failed to get model information' });
  }
}