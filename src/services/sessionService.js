// src/services/sessionService.js
import * as sessionRepo from '../db/sessionRepo.js';
import * as messageRepo from '../db/messageRepo.js';
import * as attachmentRepo from '../db/attachmentRepo.js';
import { buildLLMContext } from './contextBuilder.js';

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

export function addMessage(sessionId, message) {
    return messageRepo.addMessage(sessionId, message);
}

export function deleteMessagesByQuestionId(questionId) {
    return messageRepo.deleteMessagesByQuestionId(questionId);
}

// === Context ===
export async function buildContext(sessionId, currentAttachments = []) {
    return await buildLLMContext(sessionId, currentAttachments);
}

// === Attachments ===
export async function extractFiles(paths, sessionId) {
    return await attachmentRepo.extractFromPaths(paths, sessionId);
}

export function getAttachment(fileId) {
    return attachmentRepo.getAttachment(fileId);
}