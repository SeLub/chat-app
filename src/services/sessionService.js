// src/services/sessionService.js
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionService');

const sessions = new Map();

let cleanupInterval = null;

export function startSessionCleanup() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        const THIRTY_MINUTES = 30 * 60 * 1000;
        for (const [id, session] of sessions.entries()) {
            if (now - session.lastAccess > THIRTY_MINUTES) {
                sessions.delete(id);
                log.info('Cleaned up expired session', { sessionId: id.slice(0, 8) });
            }
        }
    }, 5 * 60 * 1000);
}

export function stopSessionCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

function generateId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function createSession() {
    const sessionId = generateId();
    sessions.set(sessionId, {
        messages: [],
        createdAt: Date.now(),
        lastAccess: Date.now()
    });
    log.info('Created session', { sessionId: sessionId.slice(0, 8) });
    return { sessionId };
}

export function storeMessage(sessionId, { role, content, model }) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error(`Session '${sessionId.slice(0, 8)}...' not found`);
    }
    session.messages.push({ role, content, model });
    session.lastAccess = Date.now();
    return [...session.messages];
}

export function getHistory(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error(`Session '${sessionId.slice(0, 8)}...' not found`);
    }
    session.lastAccess = Date.now();
    return [...session.messages];
}

export function clearSession(sessionId) {
    const exists = sessions.has(sessionId);
    sessions.delete(sessionId);
    log.info('Cleared session', { sessionId: sessionId.slice(0, 8), existed: exists });
    return exists;
}

export function truncateToContext(history, contextLength) {
    const maxChars = contextLength * 4;
    const safetyMargin = maxChars * 0.8;

    let totalChars = history.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    if (totalChars <= safetyMargin) {
        return history;
    }

    while (history.length > 2 && totalChars > maxChars) {
        const removed = history.shift();
        totalChars -= (removed.content?.length || 0);
    }

    return history;
}
