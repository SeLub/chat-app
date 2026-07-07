// src/controllers/chatController.js
import { processDocument, processCodeFiles } from '../services/fileService.js';
import { processUrlsFromText } from '../services/webService.js';
import { saveImageFiles } from '../services/imageService.js';
import { isImageFile } from '../utils/imageUtils.js';
import { createLogger } from '../utils/logger.js';
import { storeMessage, getHistory, truncateToContext } from '../services/sessionService.js';

const log = createLogger('ChatController');

export async function chatHandler(req, res) {
    let { message, model } = req.body;
    const file = req.files?.file?.[0];
    const codeFiles = req.files?.codeFiles || [];

    log.info('Received message', {
        model,
        provider: req.providerName,
        hasFile: !!file,
        codeFiles: codeFiles.length
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

        if (modelType === 'vision' && !file) {
            return res.status(400).json({ error: 'Vision models require image inputs' });
        }

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

                        return res.json({
                            response: result.response,
                            model,
                            imageData,
                            metrics: result.metrics
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

        const sessionId = req.body.sessionId;
        const contextLength = parseInt(req.body.contextLength, 10) || 131072;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required. Create a session via POST /api/chat/session first.' });
        }

        try {
            storeMessage(sessionId, { role: 'user', content: message, model });

            let messages = getHistory(sessionId);
            messages = truncateToContext(messages, contextLength);

            const result = await req.provider.chat({
                model,
                messages,
                stream: false
            });

            storeMessage(sessionId, { role: 'assistant', content: result.response, model });

            res.json({
                response: result.response,
                model,
                metrics: result.metrics
            });
        } catch (error) {
            log.error('Chat error', { error: error.message, code: error.code });
            res.status(500).json({ error: error.message || 'Connection failed' });
        }
    } catch (error) {
        log.error('Error processing URLs', { error: error.message });
        // Продолжаем без веб-контента
    }
}