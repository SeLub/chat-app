// src/ws/aiHelperWs.js
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import * as aiHelperController from '../controllers/aiHelperController.js';
import * as aiHelperRepo from '../db/aiHelperRepo.js';

const log = createLogger('AIHelperWS');

export function setupAIHelperWsServer(httpServer) {
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws/ai-helper',
    });

    wss.on('error', (error) => {
        log.error('WebSocket server error', { error: error.message });
    });

    wss.on('connection', async (ws) => {
        const sessionId = crypto.randomUUID();
        log.info('AI Helper client connected', { sessionId: sessionId.slice(0, 8) });

        try {
            await aiHelperRepo.createSession(sessionId);

            ws.on('message', async (data) => {
                try {
                    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

                    if (parsed.type === 'audio_chunk') {
                        const { role, audioBase64, timestamp } = parsed;
                        
                        if (!role || !audioBase64 || timestamp === undefined) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Missing role, audioBase64, or timestamp' }));
                            return;
                        }

                        const { text } = await aiHelperController.processAudioChunk(sessionId, role, audioBase64, timestamp);
                        
                        if (text) {
                            ws.send(JSON.stringify({ type: 'transcript', role, text, timestamp }));
                        }
                    } 
                    else if (parsed.type === 'request_hint') {
                        await aiHelperController.generateHint(sessionId, ws);
                    } 
                    else if (parsed.type === 'end_session') {
                        await aiHelperRepo.clearSession(sessionId);
                        ws.close(1000, 'Session ended');
                    } 
                    else {
                        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${parsed.type}` }));
                    }
                } catch (error) {
                    log.error('WS message handler error', { sessionId: sessionId.slice(0, 8), error: error.message });
                    ws.send(JSON.stringify({ type: 'error', message: 'Internal error processing message' }));
                }
            });

            ws.on('close', () => {
                log.info('AI Helper client disconnected', { sessionId: sessionId.slice(0, 8) });
            });
        } catch (error) {
            log.error('Failed to initialize AI Helper session', { error: error.message });
            ws.close(1011, 'Failed to initialize session');
        }
    });

    log.info('AI Helper WebSocket server configured on /ws/ai-helper');
}