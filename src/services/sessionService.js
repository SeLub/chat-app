// src/services/sessionService.js
import * as sessionRepo from '../db/sessionRepo.js';
import * as messageRepo from '../db/messageRepo.js';
import { buildLLMContext } from './contextBuilder.js';

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

export function getMessagesBySession(sessionId) {
    return messageRepo.getMessagesBySession(sessionId);
}

export function addMessage(sessionId, message) {
    return messageRepo.addMessage(sessionId, message);
}

export function deleteMessagesByQuestionId(questionId) {
    return messageRepo.deleteMessagesByQuestionId(questionId);
}

export async function buildContext(sessionId, currentAttachments = []) {
    return await buildLLMContext(sessionId, currentAttachments);
}