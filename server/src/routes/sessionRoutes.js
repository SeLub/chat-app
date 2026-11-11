// src/routes/sessionRoutes.js
import { Router } from 'express';
import * as sessionService from '../services/sessionService.js';
import { getContextConfig, updateContextConfig } from '../services/contextBuilder.js';
import { sessionAttachmentsHandler, unlinkProjectHandler } from '../controllers/projectController.js';

const router = Router();

// GET /api/sessions - List all sessions
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
        // Используем getGroupedMessages вместо getMessagesBySession
        const messages = sessionService.getGroupedMessages(req.params.id);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === НОВОЕ: GET /api/sessions/:id/context-config ===
router.get('/:id/context-config', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const config = getContextConfig(req.params.id);
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === НОВОЕ: PATCH /api/sessions/:id/context-config ===
router.patch('/:id/context-config', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const { mode, trimPercent, manualInclude } = req.body;
        const config = updateContextConfig(req.params.id, {
            mode: mode || 'standard',
            trimPercent: trimPercent ?? 100,
            manualInclude: manualInclude || []
        });

        res.json({ ok: true, config });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === НОВОЕ: GET /api/sessions/:id/qa-pairs ===
router.get('/:id/qa-pairs', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const qaPairs = sessionService.getQAPairsForSession(req.params.id);
        res.json(qaPairs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === НОВОЕ: DELETE /api/sessions/:id/messages/:questionId ===
router.delete('/:id/messages/:questionId', (req, res) => {
    try {
        const { id: sessionId, questionId } = req.params;

        const session = sessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const result = sessionService.deleteMessagesByQuestionId(questionId);

        if (result.deletedMessages === 0) {
            return res.status(404).json({ error: 'Q&A pair not found' });
        }

        res.json({
            ok: true,
            deletedMessages: result.deletedMessages,
            deletedAttachments: result.deletedAttachments
        });
    } catch (error) {
        console.error('Error in DELETE /api/sessions/:id/messages/:questionId:', error);
        res.status(500).json({ error: error.message });
    }
});

// ТЗ send-error-persist (№3): явный dismiss персистентной плашки последней
// провальной отправки (крестик на плашке фронта). Автоматически плашка чистится
// ещё и при успешной отправке (chatController) и умирает вместе с сессией.
router.delete('/:id/send-error', (req, res) => {
    try {
        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        sessionService.clearSessionSendError(req.params.id);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sessions - Create new empty session
router.post('/', (req, res) => {
    try {
        const { title, mode, project_id } = req.body;
        const result = sessionService.createNewSession(title, mode, project_id);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/sessions/:id - Update session metadata
router.patch('/:id', (req, res) => {
    try {
        const updates = {};
        if (req.body.title !== undefined) updates.title = req.body.title;
        if (req.body.category !== undefined) updates.category = req.body.category;
        if (req.body.model !== undefined) updates.model = req.body.model;
        if (req.body.provider !== undefined) updates.provider = req.body.provider;
        // === НОВОЕ: Разрешаем обновление sysprompt ===
        if (req.body.sysprompt !== undefined) updates.sysprompt = req.body.sysprompt;
        // ТЗ Project mode A (§3.2): переключение режима сессии.
        // project_id НЕ сбрасывается ни в одну из сторон (пользователь может
        // вернуться в research и обратно — правило §3.2).
        if (req.body.mode !== undefined) {
            if (!['research', 'project'].includes(req.body.mode)) {
                return res.status(400).json({ error: 'mode must be "research" or "project"' });
            }
            updates.mode = req.body.mode;
        }

        const session = sessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        sessionService.updateSessionMeta(req.params.id, updates);
        res.json({ id: req.params.id, ...updates });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ТЗ Project mode A (§3.7): GET /api/sessions/:id/attachments?kind=reference —
// список reference-файлов сессии с бейджами missing / mtimeStale (для правой панели).
router.get('/:id/attachments', sessionAttachmentsHandler);

// ТЗ Project mode A (§10.8): DELETE /api/sessions/:id/project — Remove project:
// project_id = NULL, mode = 'research', авто-detach reference (файлы на диске не трогаем).
router.delete('/:id/project', unlinkProjectHandler);

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
        res.status(500).json({ error: error.message });
    }
});

export default router;
