// src/routes/chatRoutes.js
import { Router } from 'express';
import { chatHandler } from '../controllers/chatController.js';
import { upload } from '../middleware/uploadMiddleware.js';
import { providerMiddleware } from '../middleware/providerMiddleware.js';
import { createSession, clearSession, seedMessages } from '../services/sessionService.js';

const router = Router();

router.post('/session', (req, res) => {
    const { sessionId } = createSession();
    res.json({ sessionId });
});

router.delete('/session', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    const exists = clearSession(sessionId);
    res.json({ ok: true });
});

router.post('/seed', (req, res) => {
    const { sessionId, messages } = req.body;
    if (!sessionId || !messages) {
        return res.status(400).json({ error: 'sessionId and messages are required' });
    }
    try {
        seedMessages(sessionId, messages);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/',
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'codeFiles', maxCount: 50 }]),
  providerMiddleware,
  chatHandler
);

export default router;