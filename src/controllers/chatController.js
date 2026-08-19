// src/controllers/chatController.js
import { processDocument, processCodeFiles } from '../services/fileService.js';
import { processUrlsFromText } from '../services/webService.js';
import { saveImageFiles } from '../services/imageService.js';
import { isImageFile } from '../utils/imageUtils.js';
import { createLogger } from '../utils/logger.js';
import * as sessionService from '../services/sessionService.js';
import { getContextConfig } from '../services/contextBuilder.js';

const log = createLogger('ChatController');

export async function chatHandler(req, res) {
    // === Деструктуризация параметров запроса ===
    let { message, model, sessionId, attachments: attachmentMeta, questionId, contextLength, retainPercent, includeQuestionIds } = req.body;

    const file = req.files?.file?.[0];
    const codeFiles = req.files?.codeFiles || [];

    log.info('Received message', {
        model,
        sessionId: sessionId?.slice(0, 8),
        provider: req.providerName,
        hasFile: !!file,
        codeFiles: codeFiles.length,
        attachmentsCount: attachmentMeta?.length || 0,
        questionId
    });

    try {
        // === Обработка URL ===
        const { processedText } = await processUrlsFromText(message);
        message = processedText;

        if (!model) {
            return res.status(400).json({ error: 'Model not specified' });
        }

        const modelType = req.provider.detectModelType(model);
        if (modelType === 'embedding') {
            return res.status(400).json({ error: 'Embedding models cannot generate text responses' });
        }

        // === Обработка файлов ===
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
                            questionId: visionQuestionId
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

    // === Валидация ===
        contextLength = parseInt(contextLength, 10) || 65536;
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        const session = sessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const config = getContextConfig(sessionId);
        let rp = parseInt(retainPercent, 10);
        retainPercent = (isNaN(rp) ? (config.retainPercent ?? 80) : rp);

        // Дополнительная защита от некорректных значений
        retainPercent = Math.min(Math.max(retainPercent, 10), 100);

        try {
            // === Строим контекст из истории сессии с обрезкой ===
            // buildContext теперь делает всё: загружает файлы, группирует Q&A, обрезает

            let parsedIncludeIds = null;
                    if (req.body.includeQuestionIds) {
                        try {
                            parsedIncludeIds = typeof req.body.includeQuestionIds === 'string' 
                                ? JSON.parse(req.body.includeQuestionIds) 
                                : req.body.includeQuestionIds;
                        } catch (e) {
                            log.warn('Failed to parse includeQuestionIds', e);
                        }
                    }
            
            log.info('📤 IncludeQuestionIds parsed', { 
                hasIds: !!parsedIncludeIds, 
                count: parsedIncludeIds?.length || 0,
                ids: parsedIncludeIds 
            });


            const currentAttachments = attachmentMeta || [];
            const contextResult = await sessionService.buildContext(
                sessionId,
                currentAttachments,
                contextLength,
                retainPercent,
                parsedIncludeIds // === Передаем массив ID ===
            );

            const contextMessages = [...contextResult.conversation, { role: 'user', content: message }];
            
            log.info('Context built', {
                contextSize: contextResult.contextSize,
                retainPercent: contextResult.retainPercent,
                fixedChars: contextResult.info?.fixedChars ?? 0,
                totalQAPairs: contextResult.info?.totalQAPairs ?? 0,
                includedQAPairs: contextResult.info?.includedQAPairs ?? 0,
                removedQAPairs: contextResult.info?.removedQAPairs ?? 0,
                excludedIndices: contextResult.info?.excludedIndices ?? [] // Логируем для отладки
            });

            let totalQAPairs = contextResult.info?.totalQAPairs ?? 0

            // В chatController.js
            const isManualMode = parsedIncludeIds && parsedIncludeIds.length < totalQAPairs;

            const result = await req.provider.chat({
                model,
                messages: contextMessages,
                stream: false,
                cache_prompt: !isManualMode,  // Кэш только в Standard
                n_keep: isManualMode ? 0 : undefined
            });

            const finalQuestionId = questionId || `q_${Date.now()}`;
            sessionService.addMessage(sessionId, {
                role: 'user',
                content: message,
                model,
                questionId: finalQuestionId,
                attachmentsMeta: currentAttachments
            });
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
                questionId: finalQuestionId,
                excludedIndices: contextResult.info.excludedIndices || [],
                contextInfo: {
                    contextSize: contextResult.contextSize,
                    fixedChars: contextResult.info.fixedChars,
                    actualHistoryChars: contextResult.info.actualHistoryChars,
                    totalChars: contextResult.info.fixedChars + contextResult.info.actualHistoryChars,
                    targetChars: contextResult.info.targetChars,
                    includedQAPairs: contextResult.info.includedQAPairs,
                    totalQAPairs: contextResult.info.totalQAPairs
                }
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
