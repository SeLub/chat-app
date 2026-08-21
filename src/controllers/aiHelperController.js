// src/controllers/aiHelperController.js
import { createLogger } from '../utils/logger.js';
import * as aiHelperRepo from '../db/aiHelperRepo.js';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';

const log = createLogger('AIHelperController');

const WHISPER_URLS = {
    user: process.env.WHISPER_USER_URL || 'http://127.0.0.1:8081/inference',
    interlocutor: process.env.WHISPER_INTERLOCUTOR_URL || 'http://127.0.0.1:8082/inference',
};

const TEMP_AUDIO_DIR = path.resolve(process.cwd(), 'temp_audio');

function ensureTempDir() {
    if (!fs.existsSync(TEMP_AUDIO_DIR)) {
        fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
    }
}

/**
 * Отправляет аудиофайл в Whisper-сервис для транскрипции
 * @param {string} tempFilePath - путь к сохраненному wav-файлу
 * @param {string} role - 'user' | 'interlocutor'
 * @returns {Promise<{text: string, latencyMs: number}>}
 */
async function sendToWhisper(tempFilePath, role) {
    const url = WHISPER_URLS[role];
    if (!url) {
        throw new Error(`Unsupported role for Whisper: ${role}`);
    }

    const startTime = Date.now();
    const form = new FormData();
    
    // Используем readStream для эффективной работы с form-data
    form.append('file', fs.createReadStream(tempFilePath), { 
        filename: 'chunk.wav', 
        contentType: 'audio/wav' 
    });
    form.append('language', 'ru');
    form.append('response_format', 'json');

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: form,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Whisper returned ${response.status}: ${errorBody}`);
        }

        const result = await response.json();
        const latencyMs = Date.now() - startTime;

        return { text: result.text?.trim() || '', latencyMs };
    } catch (error) {
        log.error('Whisper transcription failed', { role, error: error.message });
        throw error;
    }
}

/**
 * Обрабатывает аудио-чанк: декодирует, транскрибирует и сохраняет в БД
 */
export async function processAudioChunk(sessionId, role, audioBase64, timestampMs) {
    ensureTempDir();
    const tempFilePath = path.join(TEMP_AUDIO_DIR, `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

    try {
        // 1. Декодируем и сохраняем
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        fs.writeFileSync(tempFilePath, audioBuffer);

        // 2. Отправляем в Whisper
        const { text, latencyMs } = await sendToWhisper(tempFilePath, role);

        // 3. Сохраняем в БД, если текст не пустой
        if (text.length > 0) {
            await aiHelperRepo.addMessage(sessionId, role, text, timestampMs);
            log.info('Transcript saved', { sessionId: sessionId.slice(0, 8), role, textLength: text.length });
        }

        return { text, latencyMs };
    } catch (error) {
        log.error('processAudioChunk failed', { sessionId: sessionId.slice(0, 8), role, error: error.message });
        throw error;
    } finally {
        // 4. Гарантированная очистка
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (cleanupError) {
            log.warn('Failed to remove temp audio file', { tempFilePath, error: cleanupError.message });
        }
    }
}

/**
 * Генерирует подсказку на основе истории диалога и стримит токены через WebSocket
 */
export async function generateHint(sessionId, ws) {
    try {
        const messages = await aiHelperRepo.getRecentMessages(sessionId, 10);

        if (!messages || messages.length === 0) {
            ws.send(JSON.stringify({ type: 'hint_done', message: 'Нет данных для анализа' }));
            return;
        }

        const logLines = messages.map((m) => {
            const label = m.role === 'user' ? '[Я]' : '[Собеседник]';
            return `${label}: ${m.text}`;
        }).join('\n');

        const systemPrompt = `Ты опытный Senior Software Engineer и ментор. Тебе предоставлен фрагмент лога текущего диалога. 
Твоя задача: дать краткий (1-3 предложения), точный и профессиональный ответ или подсказку на последнюю реплику собеседника. 
Учитывай технический контекст. Отвечай по существу, без вводных слов.

Лог диалога:
${logLines}`;

        const chatUrl = process.env.LLAMA_CPP_URL || 'http://127.0.0.1:8080/v1/chat/completions';

        const response = await fetch(chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'Qwen3.6-35B-A3B-UD-Q4_K_XL',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Дай краткую подсказку на последнюю реплику.' },
                ],
                stream: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM returned ${response.status}: ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Оставляем неполную строку в буфере

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(dataStr);
                    const token = parsed.choices?.[0]?.delta?.content;
                    if (token) {
                        ws.send(JSON.stringify({ type: 'hint_token', token }));
                    }
                } catch (parseError) {
                    // Игнорируем ошибки парсинга отдельных битых чанков SSE
                }
            }
        }

        ws.send(JSON.stringify({ type: 'hint_done' }));
        log.info('Hint generation complete', { sessionId: sessionId.slice(0, 8) });
    } catch (error) {
        log.error('generateHint failed', { sessionId: sessionId.slice(0, 8), error: error.message });
        try {
            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка генерации подсказки' }));
        } catch (e) { /* Игнорируем, если сокет уже закрыт */ }
    }
}