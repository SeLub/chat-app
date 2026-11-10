// src/routes/projectRoutes.js — ТЗ Project mode A (§3.3–3.5).
//
// POST   /api/projects              — регистрация/поиск проекта + привязка к сессии
// GET    /api/projects/:id          — информация о проекте (восстановление CurrentProject в UI)
// GET    /api/projects/:id/files    — browse-список файлов (filter, лимит 500)
// POST   /api/projects/:id/attach   — attach reference-файлов (идемпотентно)
//
// Session-scoped эндпоинты (GET /api/sessions/:id/attachments, DELETE
// /api/sessions/:id/project) живут в sessionRoutes.js — монтируются на /api/sessions.

import { Router } from 'express';
import {
    createProjectHandler,
    listProjectFilesHandler,
    getProjectHandler,
    attachHandler,
} from '../controllers/projectController.js';

const router = Router();

router.post('/', createProjectHandler);
router.get('/:id', getProjectHandler);
router.get('/:id/files', listProjectFilesHandler);
router.post('/:id/attach', attachHandler);

export default router;
