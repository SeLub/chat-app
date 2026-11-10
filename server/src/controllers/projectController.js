// src/controllers/projectController.js — ТЗ Project mode A (§3.3–3.5, §10.7–10.8).
//
// Тонкий слой: projectService возвращает { status, body } — контроллер маппит
// на res. Все проверки (CONTEXT_BASE_DIR, traversal, идемпотентность, лимиты)
// — в projectService (тестируются напрямую + через маршруты).

import * as projectService from '../services/projectService.js';

export function createProjectHandler(req, res) {
    try {
        const { sessionId, relativePath } = req.body || {};
        const { status, body } = projectService.createProject(sessionId, relativePath);
        return res.status(status).json(body);
    } catch (error) {
        console.error('Error in POST /api/projects:', error);
        return res.status(500).json({ error: error.message });
    }
}

export function listProjectFilesHandler(req, res) {
    try {
        const filter = typeof req.query.filter === 'string' ? req.query.filter : '';
        const { status, body } = projectService.listProjectFiles(req.params.id, filter);
        return res.status(status).json(body);
    } catch (error) {
        console.error('Error in GET /api/projects/:id/files:', error);
        return res.status(500).json({ error: error.message });
    }
}

export function getProjectHandler(req, res) {
    try {
        // ТЗ Project mode A: форма эндпоинта не задана; нужен фронту для восстановления
        // CurrentProject после перезагрузки (session.project_id → имя/путь проекта).
        const { status, body } = projectService.getProjectInfo(req.params.id);
        return res.status(status).json(body);
    } catch (error) {
        console.error('Error in GET /api/projects/:id:', error);
        return res.status(500).json({ error: error.message });
    }
}

export function attachHandler(req, res) {
    try {
        const { sessionId, relativePaths } = req.body || {};
        const { status, body } = projectService.attachReferenceFiles(req.params.id, sessionId, relativePaths);
        return res.status(status).json(body);
    } catch (error) {
        console.error('Error in POST /api/projects/:id/attach:', error);
        return res.status(500).json({ error: error.message });
    }
}

export function unlinkProjectHandler(req, res) {
    try {
        // §10.8 Remove project: отвязка сессии (project_id=NULL, mode='research', detach reference).
        const { status, body } = projectService.unlinkProject(req.params.id);
        return res.status(status).json(body);
    } catch (error) {
        console.error('Error in DELETE /api/sessions/:id/project:', error);
        return res.status(500).json({ error: error.message });
    }
}

export function sessionAttachmentsHandler(req, res) {
    try {
        // §3.7 GET /api/sessions/:id/attachments?kind=reference — бейджи missing/mtimeStale.
        const attachments = projectService.getSessionReferenceAttachments(req.params.id);
        return res.json({ attachments });
    } catch (error) {
        console.error('Error in GET /api/sessions/:id/attachments:', error);
        return res.status(500).json({ error: error.message });
    }
}
