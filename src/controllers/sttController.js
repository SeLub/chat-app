// src/controllers/sttController.js
import { createLogger } from '../utils/logger.js';
import FormData from 'form-data';
import fetch from 'node-fetch'; // Убедись, что node-fetch установлен, или используй встроенный fetch в Node 18+

const log = createLogger('STTController');

// Адрес твоего локального whisper.cpp сервера
const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL || 'http://127.0.0.1:8081/inference';

export async function transcribeHandler(req, res) {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Audio file is required' });
        }

        log.info('Received audio for transcription', { 
            filename: file.originalname, 
            size: file.size, 
            mimetype: file.mimetype 
        });

        // Формируем FormData для отправки в whisper.cpp
        const formData = new FormData();
        formData.append('file', file.buffer, {
            filename: 'recording.wav', // Whisper.cpp ожидает .wav
            contentType: 'audio/wav'
        });
        formData.append('language', 'ru');
        formData.append('response_format', 'json');

        log.info('Sending to whisper.cpp...');
        const startTime = Date.now();

        const response = await fetch(WHISPER_SERVER_URL, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders() // Важно для корректной границы multipart
        });

        const latency = Date.now() - startTime;
        log.info(`Whisper.cpp responded in ${latency}ms`, { status: response.status });

        if (!response.ok) {
            const errorText = await response.text();
            log.error('Whisper.cpp error', { status: response.status, body: errorText });
            return res.status(response.status).json({ error: 'STT processing failed', details: errorText });
        }

        const data = await response.json();
        
        log.info('Transcription successful', { text: data.text?.substring(0, 50) + '...' });

        res.json({
            text: data.text || '',
            latencyMs: latency
        });

    } catch (error) {
        log.error('STT transcription error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Internal STT error', details: error.message });
    }
}