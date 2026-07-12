// src/controllers/chatController.js
import { processDocument, processCodeFiles } from '../services/fileService.js';
import { processUrlsFromText } from '../services/webService.js';
import { saveImageFiles } from '../services/imageService.js';
import { isImageFile } from '../utils/imageUtils.js';
import { createLogger } from '../utils/logger.js';
import * as sessionService from '../services/sessionService.js';

const log = createLogger('ChatController');

export async function chatHandler(req, res) {
    let { message, model, sessionId, attachments: attachmentMeta, questionId, contextLength } = req.body;
    const file = req.files?.file?.[0];
    const codeFiles = req.files?.codeFiles || [];

    log.info('Received message', {
        model,
        sessionId: sessionId?.slice(0, 8),
        provider: req.providerName,
        hasFile: !!file,
        codeFiles: codeFiles.length,
        attachmentsCount: attachmentMeta?.length || 0
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
                        return res.status(400).json({ error: 'Images require vision models' });
                    }
                    const imageData = await saveImageFiles(file.buffer, file.originalname);
                    const base64Image = file.buffer.toString('base64');

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

                        // Generate questionId if not provided
                        if (!questionId) {
                            questionId = `q_${Date.now()}`;
                        }

                        // Save to SQLite
                        sessionService.addMessage(sessionId, {
                            role: 'user',
                            content: message || 'What is in this image?',
                            model,
                            questionId,
                            imageData: JSON.stringify(imageData)
                        });

                        sessionService.addMessage(sessionId, {
                            role: 'assistant',
                            content: result.response,
                            model,
                            questionId,
                            metrics: result.metrics
                        });

                        return res.json({
                            response: result.response,
                            model,
                            imageData,
                            metrics: result.metrics,
                            questionId
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

        // Verify session exists
        const session = sessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        try {
            // Build context from SQLite
            const currentAttachments = attachmentMeta || [];
            const messages = await sessionService.buildContext(sessionId, currentAttachments);

            // Add current user message
            const contextMessages = [...messages, { role: 'user', content: message }];

            // Truncate if needed
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

            // Generate questionId if not provided
            if (!questionId) {
                questionId = `q_${Date.now()}`;
            }

            // Save user message
            sessionService.addMessage(sessionId, {
                role: 'user',
                content: message,
                model,
                questionId,
                attachmentsMeta: currentAttachments
            });

            // Save assistant response
            sessionService.addMessage(sessionId, {
                role: 'assistant',
                content: result.response,
                model,
                questionId,
                metrics: result.metrics
            });

            res.json({
                response: result.response,
                model,
                metrics: result.metrics,
                questionId
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