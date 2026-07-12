// src/routes/sessionRoutes.js
import { Router } from 'express';
import * as sessionService from '../services/sessionService.js';

const router = Router();

// GET /api/sessions - List all sessions (lightweight metadata)
router.get('/', (req, res) => {
    try {
        const sessions = sessionService.listSessions({
            mode: req.query.mode,
            limit: parseInt(req.query.limit, 10) || 100,
            offset: parseInt(req.query.offset, 10) || 0,
            search: req.query.search
        });
        res.json(sessions);
    } catch (error) {
        console.error('Error in GET /api/sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/sessions/:id - Get single session metadata
router.get('/:id', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(session);
    } catch (error) {
        console.error('Error in GET /api/sessions/:id:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/sessions/:id/messages - Get full message history
router.get('/:id/messages', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const messages = sessionService.getMessagesBySession(req.params.id);
        res.json(messages);
    } catch (error) {
        console.error('Error in GET /api/sessions/:id/messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sessions - Create new empty session
router.post('/', (req, res) => {
    try {
        const { title, mode, project_id } = req.body;

        // Валидация mode
        if (mode && !['chat', 'project'].includes(mode)) {
            return res.status(400).json({ error: 'mode must be "chat" or "project"' });
        }

        const result = sessionService.createNewSession(title, mode, project_id);
        res.status(201).json(result);
    } catch (error) {
        console.error('Error in POST /api/sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/sessions/:id - Update session metadata
router.patch('/:id', (req, res) => {
    try {
        const allowedFields = ['title', 'category', 'model', 'provider'];
        const updates = {};

        // Фильтруем только разрешённые поля
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        // Проверка что есть что обновлять
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        // Проверка существования сессии
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        sessionService.updateSessionMeta(req.params.id, updates);
        res.json({ id: req.params.id, ...updates });
    } catch (error) {
        console.error('Error in PATCH /api/sessions/:id:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/sessions/:id - Delete session + cascade
router.delete('/:id', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        sessionService.deleteSession(req.params.id);
        res.json({ ok: true });
    } catch (error) {
        console.error('Error in DELETE /api/sessions/:id:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;