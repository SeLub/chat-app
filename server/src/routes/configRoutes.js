// src/routes/configRoutes.js — ТЗ Project mode A (§3.1): GET /api/config.
//
// Статус CONTEXT_BASE_DIR для фронтенда: !ok → красный баннер + disabled Projects;
// RESEARCH работает. Проверка на каждый запрос (fs.existsSync дешёвый).

import { Router } from 'express';
import { getContextBaseDirStatus } from '../config/paths.js';

const router = Router();

router.get('/', (req, res) => {
    try {
        res.json({ contextBaseDir: getContextBaseDirStatus() });
    } catch (error) {
        console.error('Error in GET /api/config:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
