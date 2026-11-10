// src/controllers/chatController.js
//
// Финальное ТЗ «vision-картинки в истории»: единый реестр вложений (attachments)
// + attachments_meta. Три ветки обработки (картинка / документ / код) НЕ взаимоисключающие:
// file (картинка или документ) и codeFiles обрабатываются независимо, все вложения
// попадают в реестр и в историю. Порядок сборки сообщения: документ → код → текст.
// Legacy-поток imageService//api/images демонтирован; imageData в ответе — legacy-shape,
// заполняется из первого kind='image' в attachments_meta (фронт не меняется).

import fs from 'fs';
import { processDocument, processCodeFiles } from '../services/fileService.js';
import { processUrlsFromText } from '../services/webService.js';
import { createLogger } from '../utils/logger.js';
import * as sessionService from '../services/sessionService.js';
import * as attachmentService from '../services/attachmentService.js';
import { getContextConfig } from '../services/contextBuilder.js';

const log = createLogger('ChatController');

const isImageFile = (mimetype) => Boolean(mimetype && mimetype.startsWith('image/'));

export async function chatHandler(req, res) {
    let { message, model, sessionId, questionId, contextLength, retainPercent, includeQuestionIds } = req.body;

    const file = req.files?.file?.[0];
    const codeFiles = req.files?.codeFiles || [];

    log.info('Received message', {
        model,
        sessionId: sessionId?.slice(0, 8),
        provider: req.providerName,
        hasFile: !!file,
        codeFiles: codeFiles.length,
        questionId
    });

    // TZ-B.3: временные файлы (diskStorage, uploads/tmp) удаляются после обработки в любом исходе.
    // Это единственное разрешённое удаление — пользовательские файлы реестра не удаляются никогда.
    const tmpFilePaths = [file?.path, ...codeFiles.map((cf) => cf?.path)].filter(Boolean);

    try {
        // TZ-B.1: при diskStorage у файлов нет буфера — восстанавливаем из файла на диске.
        if (file?.path) file.buffer = await fs.promises.readFile(file.path);
        for (const cf of codeFiles) {
            if (cf?.path) cf.buffer = await fs.promises.readFile(cf.path);
        }

        // === Обработка URL ===
        const { processedText } = await processUrlsFromText(message);
        const originalMessage = processedText;
        message = originalMessage;

        // === Валидация ===
        if (!model) {
            return res.status(400).json({ error: 'Model not specified' });
        }

        const modelType = req.provider.detectModelType(model);
        if (modelType === 'embedding') {
            return res.status(400).json({ error: 'Embedding models cannot generate text responses' });
        }

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const session = sessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // === Классификация вложений ===
        const isImage = file && isImageFile(file.mimetype);
        if (isImage && modelType !== 'vision') {
            return res.status(400).json({ error: 'Images require vision models (llama3.2-vision, llava, gemma3, etc.)' });
        }

        // === Шаг 1. Все вложения — в единый реестр attachments ===
        const currentAttachments = [];
        try {
            if (isImage) {
                const meta = await attachmentService.addImageAttachment({
                    sessionId,
                    questionId: questionId || `q_${Date.now()}`,
                    buffer: file.buffer,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                });
                currentAttachments.push(meta);
            } else if (file) {
                const { results, errors } = await attachmentService.extractFiles([file.path], sessionId, 'document');
                if (errors.length > 0) log.warn('Document extraction errors', { errors });
                for (const r of results) currentAttachments.push({ fileId: r.fileId, name: r.name, size: r.size, type: r.type, kind: r.kind });
            }
            for (const cf of codeFiles) {
                if (!cf?.path) continue;
                const { results, errors } = await attachmentService.extractFiles([cf.path], sessionId, 'code');
                if (errors.length > 0) log.warn('Code extraction errors', { errors });
                for (const r of results) currentAttachments.push({ fileId: r.fileId, name: r.name, size: r.size, type: r.type, kind: r.kind });
            }
        } catch (error) {
            log.error('Attachment save error', { error: error.message });
            return res.status(500).json({ error: 'Failed to save attachments' });
        }

        // === Шаг 2. Извлечение текста (RESEARCH): документ → код → текст пользователя ===
        // PROJECT-режим пропускает инлайн (S.7 — отдельный PR); mode='chat' трактуется как research.
        const mode = session.mode === 'project' ? 'project' : 'research';
        if (mode === 'research') {
            let docPart = '';
            let codePart = '';
            if (file && !isImage) {
                try {
                    docPart = (await processDocument(file)).formattedMessage;
                } catch (error) {
                    log.error('Document processing error', { error: error.message });
                    return res.status(400).json({ error: 'Failed to process document file' });
                }
            }
            if (codeFiles.length > 0) {
                try {
                    codePart = (await processCodeFiles(codeFiles)).formattedMessage;
                } catch (error) {
                    log.error('Code file processing error', { error: error.message });
                    return res.status(400).json({ error: 'Failed to process code files' });
                }
            }
            message = docPart + codePart + originalMessage;
        }

        // === Vision-ветка (есть картинка) ===
        if (isImage) {
            const imageMeta = currentAttachments.find((a) => a.kind === 'image');
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

                sessionService.addMessage(sessionId, {
                    role: 'user',
                    content: message || 'What is in this image?',
                    model,
                    questionId: visionQuestionId,
                    attachmentsMeta: currentAttachments
                });
                sessionService.addMessage(sessionId, {
                    role: 'assistant',
                    content: result.response,
                    model,
                    questionId: visionQuestionId,
                    metrics: result.metrics
                });

                return res.json({
                    response: result.response,
                    model,
                    metrics: result.metrics,
                    questionId: visionQuestionId,
                    imageData: imageMeta ? {
                        thumbnailUrl: imageMeta.thumbnailUrl,
                        fullUrl: imageMeta.fullUrl,
                        filename: imageMeta.name,
                    } : undefined,
                    attachmentsMeta: currentAttachments,
                });
            } catch (error) {
                log.error('Vision model error', { error: error.message });
                return res.status(500).json({ error: error.message || 'Vision model connection failed' });
            }
        }

        // === Обычный chat (без картинки) ===
        contextLength = parseInt(contextLength, 10) || 65536;

        const config = getContextConfig(sessionId);
        let rp = parseInt(retainPercent, 10);
        retainPercent = (isNaN(rp) ? (config.retainPercent ?? 80) : rp);

        // Дополнительная защита от некорректных значений
        retainPercent = Math.min(Math.max(retainPercent, 10), 100);

        try {
            // === Строим контекст из истории сессии с обрезкой ===
            let parsedIncludeIds = null;
            if (includeQuestionIds) {
                try {
                    parsedIncludeIds = typeof includeQuestionIds === 'string'
                        ? JSON.parse(includeQuestionIds)
                        : includeQuestionIds;
                } catch (e) {
                    log.warn('Failed to parse includeQuestionIds', e);
                }
            }

            log.info('📤 IncludeQuestionIds parsed', {
                hasIds: !!parsedIncludeIds,
                count: parsedIncludeIds?.length || 0,
                ids: parsedIncludeIds
            });

            const contextResult = await sessionService.buildContext(
                sessionId,
                currentAttachments,
                contextLength,
                retainPercent,
                parsedIncludeIds
            );

            const contextMessages = [...contextResult.conversation, { role: 'user', content: message }];

            log.info('Context built', {
                contextSize: contextResult.contextSize,
                retainPercent: contextResult.retainPercent,
                fixedChars: contextResult.info?.fixedChars ?? 0,
                totalQAPairs: contextResult.info?.totalQAPairs ?? 0,
                includedQAPairs: contextResult.info?.includedQAPairs ?? 0,
                removedQAPairs: contextResult.info?.removedQAPairs ?? 0,
                excludedIndices: contextResult.info?.excludedIndices ?? []
            });

            const totalQAPairs = contextResult.info?.totalQAPairs ?? 0;
            const isManualMode = parsedIncludeIds && parsedIncludeIds.length < totalQAPairs;

            const result = await req.provider.chat({
                model,
                messages: contextMessages,
                stream: false,
                cache_prompt: !isManualMode,
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
                attachmentsMeta: currentAttachments,
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
    } finally {
        // TZ-B.3: cleanup временных файлов — сама директория uploads/tmp сохраняется
        await Promise.all(tmpFilePaths.map((p) => fs.promises.unlink(p).catch(() => {})));
    }
}
