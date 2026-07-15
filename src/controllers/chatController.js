// src/controllers/chatController.js
import { processDocument, processCodeFiles } from '../services/fileService.js';
import { processUrlsFromText } from '../services/webService.js';
import { saveImageFiles } from '../services/imageService.js';
import { isImageFile } from '../utils/imageUtils.js';
import { createLogger } from '../utils/logger.js';
import * as sessionService from '../services/sessionService.js';

const log = createLogger('ChatController');

export async function chatHandler(req, res) {
    // === ИСПРАВЛЕНИЕ 1: добавляем questionId в деструктуризацию ===
    let { message, model, sessionId, attachments: attachmentMeta, questionId, contextLength } = req.body;
    const file = req.files?.file?.[0];
    const codeFiles = req.files?.codeFiles || [];

    log.info('Received message', {
        model,
        sessionId: sessionId?.slice(0, 8),
        provider: req.providerName,
        hasFile: !!file,
        codeFiles: codeFiles.length,
        attachmentsCount: attachmentMeta?.length || 0,
        questionId  // ← логируем для отладки
    });

    try {
        const { processedText } = await processUrlsFromText(message);
        message = processedText;

        if (!model) {
            return res.status(400).json({ error: 'Model not specified' });
        }

        const modelType = req.provider.detectModelType(model);
        if (modelType === 'embedding') {
            return res.status(400).json({ error: 'Embedding models cannot generate text responses' });
        }

        // Legacy file upload support (FormData)
        if (codeFiles.length > 0) {
            try {
                const { formattedMessage } = await processCodeFiles(codeFiles);
                message = formattedMessage + message;
            } catch (error) {
                log.error('Code file processing error', { error: error.message });
                return res.status(400).json({ error: 'Failed to process code files' });
            }
        } else if (file) {
            try {
                if (isImageFile(file.mimetype)) {
                    if (modelType !== 'vision') {
                        return res.status(400).json({ error: 'Images require vision models (llama3.2-vision, llava, gemma3, etc.)' });
                    }
                    const imageData = await saveImageFiles(file.buffer, file.originalname);
                    const base64Image = file.buffer.toString('base64');

                    // === ИСПРАВЛЕНИЕ 2: используем questionId из request ===
                    const visionQuestionId = questionId || `q_${Date.now()}`;

                    try {
                        log.info('Sending image to vision model', { model });
                        const result = await req.provider.chat({
                            model,
                            messages: [{
                                role: 'user',
                                content: message || 'What is in this image?',
                                images: [base64Image]
                            }],
                            stream: false
                        });

                        // === ИСПРАВЛЕНИЕ 3: сохраняем vision сообщения в SQLite ===
                        if (sessionId) {
                            const session = sessionService.getSession(sessionId);
                            if (session) {
                                sessionService.addMessage(sessionId, {
                                    role: 'user',
                                    content: message || 'What is in this image?',
                                    model,
                                    questionId: visionQuestionId,
                                    imageData: JSON.stringify(imageData)
                                });

                                sessionService.addMessage(sessionId, {
                                    role: 'assistant',
                                    content: result.response,
                                    model,
                                    questionId: visionQuestionId,
                                    metrics: result.metrics
                                });
                            }
                        }

                        return res.json({
                            response: result.response,
                            model,
                            imageData,
                            metrics: result.metrics,
                            questionId: visionQuestionId  // ← возвращаем тот же questionId
                        });
                    } catch (error) {
                        log.error('Vision model error', { error: error.message });
                        return res.status(500).json({ error: error.message || 'Vision model connection failed' });
                    }
                } else {
                    const { formattedMessage } = await processDocument(file);
                    message = formattedMessage + message;
                }
            } catch (error) {
                log.error('Document processing error', { error: error.message });
                return res.status(400).json({ error: 'Failed to process document file' });
            }
        }

        contextLength = parseInt(contextLength, 10) || 131072;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        // Verify session exists in SQLite
        const session = sessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        try {
            // Build context from SQLite history
            const currentAttachments = attachmentMeta || [];
            const messages = await sessionService.buildContext(sessionId, currentAttachments);

            // Add current user message to context
            const contextMessages = [...messages, { role: 'user', content: message }];

            // Truncate context if needed
            let truncatedMessages = contextMessages;
            const maxChars = contextLength * 4;
            let totalChars = contextMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

            if (totalChars > maxChars) {
                const keepSystem = contextMessages[0]?.role === 'system';
                let i = keepSystem ? 1 : 0;
                while (i < contextMessages.length - 1 && totalChars > maxChars) {
                    totalChars -= (contextMessages[i].content?.length || 0);
                    i++;
                }
                truncatedMessages = [keepSystem ? contextMessages[0] : null, ...contextMessages.slice(i)].filter(Boolean);
            }

            const result = await req.provider.chat({
                model,
                messages: truncatedMessages,
                stream: false
            });

            // === ИСПРАВЛЕНИЕ 4: используем questionId из request ===
            const finalQuestionId = questionId || `q_${Date.now()}`;

            // Save user message to SQLite
            sessionService.addMessage(sessionId, {
                role: 'user',
                content: message,
                model,
                questionId: finalQuestionId,
                attachmentsMeta: currentAttachments
            });

            // Save assistant response to SQLite
            sessionService.addMessage(sessionId, {
                role: 'assistant',
                content: result.response,
                model,
                questionId: finalQuestionId,
                metrics: result.metrics
            });

            res.json({
                response: result.response,
                model,
                metrics: result.metrics,
                questionId: finalQuestionId  // ← возвращаем тот же questionId
            });
        } catch (error) {
            log.error('Chat error', { error: error.message, code: error.code });
            res.status(500).json({ error: error.message || 'Connection failed' });
        }
    } catch (error) {
        log.error('Error processing URLs', { error: error.message });
        res.status(500).json({ error: 'Failed to process message' });
    }
}