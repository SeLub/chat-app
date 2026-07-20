// src/services/sessionService.js
import * as sessionRepo from '../db/sessionRepo.js';
import * as messageRepo from '../db/messageRepo.js';
import * as attachmentRepo from '../db/attachmentRepo.js';
import { buildLLMContext, getQAPairs, updateContextConfig, getContextConfig, removeQAPairs } from './contextBuilder.js';

// === Sessions ===
export function createNewSession(title = null, mode = 'chat', projectId = null) {
    return sessionRepo.createSession(title, mode, projectId);
}

export function getSession(id) {
    return sessionRepo.getSession(id);
}

export function listSessions(options = {}) {
    return sessionRepo.listSessions(options);
}

export function updateSessionMeta(id, updates) {
    return sessionRepo.updateSession(id, updates);
}

export function deleteSession(id) {
    return sessionRepo.deleteSession(id);
}

export function archiveSession(id, newTitle) {
    return sessionRepo.archiveSession(id, newTitle);
}

// === Messages ===
export function getMessagesBySession(sessionId) {
    return messageRepo.getMessagesBySession(sessionId);
}

// === НОВОЕ: Возвращает сгруппированные Q&A пары (Вариант B) ===
// Используется для /api/sessions/:id/messages, чтобы фронтенд получал 
// и список вопросов (keys), и ответы (values) из одного источника.
export function getGroupedMessages(sessionId) {
    return getQAPairs(sessionId);
}

export function addMessage(sessionId, message) {
    return messageRepo.addMessage(sessionId, message);
}

export function deleteMessagesByQuestionId(questionId) {
    return messageRepo.deleteMessagesByQuestionId(questionId);
}

// === Context ===
/**
 * Построить контекст для LLM с обрезкой истории.
 * @param {string} sessionId
 * @param {Array}  currentAttachments - файлы, прикреплённые к текущему сообщению
 * @param {number} contextSize        - контекст модели в токенах
 * @param {number} retainPercent      - % доступного бюджета для истории (0-100)
 * @returns {{ conversation: Array, contextSize: number, retainPercent: number, info: Object }}
 */
export async function buildContext(sessionId, currentAttachments = [], contextSize = 65536, retainPercent = 80) {
    return await buildLLMContext(sessionId, currentAttachments, contextSize, retainPercent);
}

export function getQAPairsForSession(sessionId) {
    return getQAPairs(sessionId);
}

export function updateSessionContextConfig(sessionId, config) {
    return updateContextConfig(sessionId, config);
}

export function getSessionContextConfig(sessionId) {
    return getContextConfig(sessionId);
}

export function removeSessionQAPairs(sessionId, questionIds) {
    return removeQAPairs(sessionId, questionIds);
}

// === Attachments ===
export async function extractFiles(paths, sessionId) {
    return await attachmentRepo.extractFromPaths(paths, sessionId);
}

export function getAttachment(fileId) {
    return attachmentRepo.getAttachment(fileId);
}
