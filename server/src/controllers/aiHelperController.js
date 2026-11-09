// src/controllers/aiHelperController.js
import { createLogger } from '../utils/logger.js';
import * as aiHelperRepo from '../db/aiHelperRepo.js';
import path from 'path';
import fs from 'fs';

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
 * Создает минимальный WAV-заголовок для сырого PCM 16kHz Mono 16-bit
 */
function createWavHeader(dataLength) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, 16000, true); // Sample Rate
    view.setUint32(28, 32000, true); // Byte Rate (16000 * 1 * 2)
    view.setUint16(32, 2, true); // Block Align
    view.setUint16(34, 16, true); // Bits per sample
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    return Buffer.from(buffer);
}

/**
 * Обрабатывает аудио-чанк: добавляет WAV-заголовок, транскрибирует и сохраняет в БД
 */
export async function processAudioChunk(sessionId, role, audioBase64, timestampMs) {
    ensureTempDir();
    const tempFilePath = path.join(TEMP_AUDIO_DIR, `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

    try {
        // 1. Декодируем base64 в сырой PCM Buffer (Int16Array)
        const pcmBuffer = Buffer.from(audioBase64, 'base64');

        // 2. Создаем WAV-заголовок и объединяем с PCM-данными
        const wavHeader = createWavHeader(pcmBuffer.length);
        const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

        // 3. Сохраняем валидный WAV-файл (для отладки/аудита)
        fs.writeFileSync(tempFilePath, wavBuffer);

        // 4. Отправляем в Whisper (ИСПРАВЛЕНО: глобальный FormData + Blob)
        const url = WHISPER_URLS[role];
        if (!url) throw new Error(`Unsupported role: ${role}`);

        const startTime = Date.now();

        const form = new FormData();
        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        form.append('file', audioBlob, 'chunk.wav');
        form.append('language', 'ru');
        form.append('response_format', 'json');

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
        const text = result.text?.trim() || '';

        if (text.length > 0) {
            await aiHelperRepo.addMessage(sessionId, role, text, timestampMs);
            log.info('Transcript saved', {
                sessionId: sessionId.slice(0, 8),
                role,
                text: text.substring(0, 50),
                textLength: text.length,
                latencyMs
            });
        } else {
            log.debug('Empty transcript', { sessionId: sessionId.slice(0, 8), role, latencyMs });
        }

        return { text, latencyMs };
    } catch (error) {
        log.error('processAudioChunk failed', {
            sessionId: sessionId.slice(0, 8),
            role,
            error: error.message
        });
        throw error;
    } finally {
        try {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
            log.warn('Failed to remove temp audio file', {
                tempFilePath,
                error: cleanupError.message
            });
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

        if (!response.ok) throw new Error(`LLM returned ${response.status}: ${await response.text()}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(dataStr);
                    const token = parsed.choices?.[0]?.delta?.content;
                    if (token) ws.send(JSON.stringify({ type: 'hint_token', token }));
                } catch (e) { /* Игнорируем битые чанки */ }
            }
        }
        ws.send(JSON.stringify({ type: 'hint_done' }));
    } catch (error) {
        log.error('generateHint failed', { sessionId: sessionId.slice(0, 8), error: error.message });
        try { ws.send(JSON.stringify({ type: 'error', message: 'Ошибка генерации подсказки' })); } catch (e) {}
    }
}