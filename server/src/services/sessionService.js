// src/services/sessionService.js
import * as sessionRepo from '../db/sessionRepo.js';
import * as messageRepo from '../db/messageRepo.js';
import * as attachmentRepo from '../db/attachmentRepo.js';
import { buildLLMContext, getQAPairs, updateContextConfig, getContextConfig, removeQAPairs } from './contextBuilder.js';

// === Sessions ===
export function createNewSession(title = null, mode = 'research', projectId = null) {
    // ТЗ Project mode A (§2.3): default 'research' (legacy 'chat' трактуется как research в коде).
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

// ТЗ send-error-persist (№3 context-overflow-ux): персистентная плашка последней
// провальной отправки — пишется на провале (пре-флайт/catch), чистится на успехе
// и по dismiss. payload=null эквивалентен очистке.
export function setSessionSendError(id, payload) {
    return sessionRepo.setSendError(id, payload);
}

export function clearSessionSendError(id) {
    return sessionRepo.setSendError(id, null);
}

export function getSessionSendError(id) {
    return sessionRepo.getSendError(id);
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

/**
 * Построить контекст для LLM с обрезкой истории.
 * @param {string} sessionId
 * @param {Array}  currentAttachments - файлы, прикреплённые к текущему сообщению
 * @param {number} contextSize        - контекст модели в токенах (по умолчанию 65536)
 * @param {number} retainPercent      - % доступного бюджета для истории (0-100, по умолчанию 80)
 * @param {string[]|null} includeQuestionIds - массив ID вопросов, включенных в контекст (null = все)
 * @param {'research'|'project'} mode - режим сессии (ТЗ Project mode A §3.10; legacy 'chat' → 'research'
 *                                      нормализуется в chatController до вызова)
 * @returns {Promise<{ conversation: Array, contextSize: number, retainPercent: number, info: Object }>}
 */
export async function buildContext(sessionId, currentAttachments = [], contextSize = 65536, retainPercent = 80, includeQuestionIds = null, mode = 'research') {
    return await buildLLMContext(sessionId, currentAttachments, contextSize, retainPercent, includeQuestionIds, mode);
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

// ТЗ Project mode A: список вложений сессии по kind (reference — пул PROJECT).
export function listSessionAttachments(sessionId, kind = 'reference') {
    return attachmentRepo.listBySessionAndKind(sessionId, kind);
}

// ТЗ Project mode A (§3.6): detach — только строка реестра, файл на диске не трогаем.
export function deleteAttachment(fileId) {
    return attachmentRepo.deleteAttachment(fileId);
}
