// src/controllers/chatController.js
//
// ТЗ «один system, [Материалы] / [Ранее] / [Вопрос]»: промпт строит
// buildLLMContext (contextBuilder.js) — РОВНО один system (sysprompt) +
// user-разделители [Материалы] (filesContext из реестра attachments) и
// [Ранее в этой сессии] (+ обрезанная история). chatController добавляет
// последнее user-сообщение [Вопрос] (в vision-ветке — с images).
// - message = только текст пользователя (после URL-extract); файлы НЕ инлайнятся
//   в message — они в реестре attachments и входят в промпт через [Материалы].
//   processDocument/processCodeFiles (fileService) демонтированы; невалидный
//   документ — warn + строка реестра без extracted_text (не 400).
// - Vision-ветка (isImageFile) использует ту же архитектуру buildLLMContext
//   (до ТЗ — регрессия: без system, без истории). base64-картинка крепится
//   к [Вопрос]: m.images — Ollama native; llama.cpp /v1/chat/completions поле
//   images не стандартизовано (см. TODO в LlamaCppProvider) — не блокер.
// - info.* (excludedIndices, includedQAPairs, …) — контракт с фронтом не изменён.
//
// ТЗ Project mode A (§3.8): ветка по session.mode ('chat' legacy → research).
// PROJECT: multipart-вложения (file/codeFiles, включая картинки) НЕ принимаются —
// только reference через attach; currentAttachments — текущий пул reference
// из реестра; buildLLMContext(mode='project') читает файлы с диска (mtime-кэш);
// contextInfo += mode/filesAttached/filesMissing/filesTooLarge.
// RESEARCH-ветка не изменена.

import fs from 'fs';
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

    // ТЗ attachment-cascade: fileIds строк реестра, созданных ЭТОЙ отправкой (RESEARCH).
    // PROJECT-ветка строки не создаёт (reference — пул сессии): claim/cleanup к ней неприменимы.
    let sentFileIds = [];

    try {
        // TZ-B.1: при diskStorage у файлов нет буфера — восстанавливаем из файла на диске.
        if (file?.path) file.buffer = await fs.promises.readFile(file.path);
        for (const cf of codeFiles) {
            if (cf?.path) cf.buffer = await fs.promises.readFile(cf.path);
        }

        // === Обработка URL ===
        const { processedText } = await processUrlsFromText(message);
        message = processedText;

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

        // === Режим сессии (ТЗ Project mode A §3.8): legacy 'chat' трактуется как research ===
        const mode = session.mode === 'project' ? 'project' : 'research';

        // PROJECT: multipart-файлы не поддерживаются — только reference через attach
        // (§10.1: явная ошибка лучше тихого игнора; картинки — RESEARCH-only в этом ТЗ)
        if (mode === 'project' && (file || codeFiles.length > 0)) {
            return res.status(400).json({ error: 'Use /api/projects/:id/attach for files in Project mode' });
        }

        // === Классификация вложений ===
        const isImage = file && isImageFile(file.mimetype);
        if (isImage && modelType !== 'vision') {
            return res.status(400).json({ error: 'Images require vision models (llama3.2-vision, llava, gemma3, etc.)' });
        }

        // === Шаг 1. Все вложения — в единый реестр attachments ===
        // PROJECT: currentAttachments — текущий пул reference сессии (attach);
        // attachments_meta сообщения — снимок на момент отправки (§3.8.4).
        const currentAttachments = [];
        if (mode === 'project') {
            const refs = attachmentService.listSessionAttachments(sessionId, 'reference');
            for (const r of refs) {
                currentAttachments.push({
                    fileId: r.id,
                    name: r.filename,
                    size: r.file_size,
                    kind: 'reference',
                    language: r.language
                });
            }
        } else {
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

            // ТЗ attachment-cascade: claim/cleanup касаются только строк, созданных этой
            // отправкой; PROJECT-reference — пул сессии (message_id всегда NULL).
            sentFileIds = currentAttachments.map((a) => a.fileId).filter(Boolean);
        }

        // === Шаг 2. Контекст-конфиг — общий для chat и vision веток ===
        contextLength = parseInt(contextLength, 10) || 65536;

        const config = getContextConfig(sessionId);
        let rp = parseInt(retainPercent, 10);
        retainPercent = (isNaN(rp) ? (config.retainPercent ?? 80) : rp);

        // Дополнительная защита от некорректных значений
        retainPercent = Math.min(Math.max(retainPercent, 10), 100);

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

        // === Vision-ветка (есть картинка) — единая архитектура buildLLMContext ===
        // До ТЗ one-system: [{ role:'user', content, images }] — без system и истории
        // (регрессия: sysprompt не применялся, файлы/история терялись).
        if (isImage) {
            const imageMeta = currentAttachments.find((a) => a.kind === 'image');
            const base64Image = file.buffer.toString('base64');
            const visionQuestionId = questionId || `q_${Date.now()}`;

            try {
                log.info('Sending image to vision model', { model });

                const contextResult = await sessionService.buildContext(
                    sessionId,
                    currentAttachments,
                    contextLength,
                    retainPercent,
                    parsedIncludeIds,
                    mode
                );

                // system + [Материалы]? + [Ранее]? + history + user[Вопрос] с images;
                // картинка НЕ попадает в [Материалы] (фильтр kind != 'image' в contextBuilder).
                const contextMessages = [
                    ...contextResult.conversation,
                    {
                        role: 'user',
                        content: `[Вопрос]\n${message || 'What is in this image?'}`,
                        images: [base64Image],
                    },
                ];

                const result = await req.provider.chat({
                    model,
                    messages: contextMessages,
                    stream: false,
                });

                const userMsgId = sessionService.addMessage(sessionId, {
                    role: 'user',
                    content: message || 'What is in this image?',
                    model,
                    questionId: visionQuestionId,
                    attachmentsMeta: currentAttachments
                });
                // ТЗ attachment-cascade: строки реестра принадлежат сообщению —
                // удаление Q&A чистит их каскадом БД (файлы на диске остаются — File Manager).
                attachmentService.claimAttachments(sentFileIds, userMsgId);
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
                // ТЗ attachment-cascade: проваленная отправка не оставляет строк в реестре
                attachmentService.deleteUnclaimedAttachments(sentFileIds);
                return res.status(500).json({ error: error.message || 'Vision model connection failed' });
            }
        }

        // === Обычный chat (без картинки) ===
        try {

            const contextResult = await sessionService.buildContext(
                sessionId,
                currentAttachments,
                contextLength,
                retainPercent,
                parsedIncludeIds,
                mode
            );

            // ТЗ one-system: последнее user-сообщение — [Вопрос] с чистым текстом
            // (файлы не инлайнятся — они в [Материалы] через реестр)
            const contextMessages = [...contextResult.conversation, { role: 'user', content: `[Вопрос]\n${message}` }];

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
            const userMsgId = sessionService.addMessage(sessionId, {
                role: 'user',
                content: message,
                model,
                questionId: finalQuestionId,
                attachmentsMeta: currentAttachments
            });
            // ТЗ attachment-cascade: строки реестра принадлежат сообщению (см. vision-ветку)
            attachmentService.claimAttachments(sentFileIds, userMsgId);
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
                    totalQAPairs: contextResult.info.totalQAPairs,
                    // ТЗ Project mode A (§3.8.6): новые поля — опциональны для фронта
                    mode: contextResult.info.mode,
                    filesAttached: currentAttachments.length,
                    filesMissing: contextResult.info.filesMissing || [],
                    filesTooLarge: contextResult.info.filesTooLarge || []
                }
            });
        } catch (error) {
            log.error('Chat error', { error: error.message, code: error.code });
            // ТЗ attachment-cascade: проваленная отправка не оставляет строк в реестре
            attachmentService.deleteUnclaimedAttachments(sentFileIds);
            res.status(500).json({ error: error.message || 'Connection failed' });
        }
    } catch (error) {
        log.error('Error processing URLs', { error: error.message });
        // ТЗ attachment-cascade: реестр не переживает проваленную отправку
        // (ветка context-config вне inner-try — строки уже вставлены)
        attachmentService.deleteUnclaimedAttachments(sentFileIds);
        res.status(500).json({ error: 'Failed to process message' });
    } finally {
        // TZ-B.3: cleanup временных файлов — сама директория uploads/tmp сохраняется
        await Promise.all(tmpFilePaths.map((p) => fs.promises.unlink(p).catch(() => {})));
    }
}
