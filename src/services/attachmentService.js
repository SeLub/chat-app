// src/services/attachmentService.js
import * as attachmentRepo from '../db/attachmentRepo.js';

export async function extractFiles(paths, sessionId) {
    return await attachmentRepo.extractFromPaths(paths, sessionId);
}

export function getAttachment(fileId) {
    return attachmentRepo.getAttachment(fileId);
}

export function getAttachmentsByIds(fileIds) {
    return attachmentRepo.getAttachmentsByIds(fileIds);
}