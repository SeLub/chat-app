// public/ai-helper.js
(function () {
    'use strict';

    const WS_URL = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws/ai-helper';

    let ws = null;
    let micRecorder = null;
    let sysRecorder = null;
    let isCapturing = false;
    let hintStreaming = false;
    let audioCtx = null; // Инициализируется при первом клике

    const overlay = document.getElementById('aiHelperOverlay');
    const header = document.getElementById('aiHelperHeader');
    const closeBtn = document.getElementById('aiHelperClose');
    const startBtn = document.getElementById('aiHelperStartBtn');
    const stopBtn = document.getElementById('aiHelperStopBtn');
    const hintBtn = document.getElementById('aiHelperHintBtn');
    const transcriptEl = document.getElementById('aiHelperTranscript');
    const hintAreaEl = document.getElementById('aiHelperHintArea');
    const statusDot = document.getElementById('aiHelperStatusDot');
    const statusText = document.getElementById('aiHelperStatusText');

    // === Drag-and-Drop ===
    let dragOffsetX = 0, dragOffsetY = 0, isDragging = false;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragOffsetX = e.clientX - overlay.offsetLeft;
        dragOffsetY = e.clientY - overlay.offsetTop;
        overlay.classList.add('dragging');
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        overlay.style.left = (e.clientX - dragOffsetX) + 'px';
        overlay.style.top = (e.clientY - dragOffsetY) + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        overlay.classList.remove('dragging');
        document.body.style.userSelect = '';
    });

    // === bufferToWave (проверенная утилита) ===
    function bufferToWave(abuffer, len) {
        const numOfChan = abuffer.numberOfChannels;
        const length = len * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const channels = [];
        let i, sample, offset = 0, pos = 0;

        const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

        setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66);
        setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16);
        setUint32(0x61746164); setUint32(length - pos - 4);

        for (i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

        while (pos < length) {
            for (i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }

    // === Обработка и отправка чанка ===
    async function processAndSendChunk(blob, role) {
        if (!ws || ws.readyState !== WebSocket.OPEN || blob.size < 100) return;

        try {
            // Инициализируем AudioContext при первом использовании (требование браузеров)
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }

            const arrayBuffer = await blob.arrayBuffer();
            const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const wavBlob = bufferToWave(decodedBuffer, decodedBuffer.length);
            
            // Конвертация в base64
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                ws.send(JSON.stringify({
                    type: 'audio_chunk',
                    role: role, // 'user' или 'interlocutor'
                    audioBase64: base64,
                    timestamp: Date.now()
                }));
            };
            reader.readAsDataURL(wavBlob);
        } catch (err) {
            console.error('[AI Helper] Failed to process audio chunk:', err);
        }
    }

    // === WebSocket ===
    function connectWS() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            setStatus('active', '🟢 Захват активен');
            console.log('[AI Helper] WebSocket connected');
        };

        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }

            switch (data.type) {
                case 'transcript':
                    appendTranscript(data.role, data.text);
                    break;
                case 'hint_token':
                    streamHintToken(data.token);
                    break;
                case 'hint_done':
                    finishHintStream();
                    break;
                case 'error':
                    showToast('AI Helper: ' + (data.message || 'Ошибка'));
                    break;
            }
        };

        ws.onclose = () => {
            setStatus('inactive', '⚪ Ожидание');
            console.log('[AI Helper] WebSocket disconnected');
        };
    }

    // === Audio Capture ===
    async function startCapture() {
        try {
            // 1. Захват системного звука (в Chrome обязательно video: true, чтобы получить доступ к audio)
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            // 2. Проверяем, поделился ли пользователь звуком (самая частая причина ошибок)
            const sysAudioTrack = displayStream.getAudioTracks()[0];
            if (!sysAudioTrack) {
                showToast('Ошибка: Вы не поставили галочку "Поделиться звуком вкладки/системы". Попробуйте снова.');
                displayStream.getTracks().forEach(t => t.stop());
                return;
            }

            // Создаем поток ТОЛЬКО с аудиодорожкой (игнорируем видео)
            const sysStream = new MediaStream([sysAudioTrack]);

            // 3. Захват микрофона
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
            });

            // 4. Безопасное определение mimeType (избегаем NotSupportedError)
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;

            // 5. Настройка рекордеров строго для аудио-потоков
            micRecorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
            sysRecorder = new MediaRecorder(sysStream, mimeType ? { mimeType } : undefined);

            micRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) processAndSendChunk(event.data, 'user');
            };

            sysRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) processAndSendChunk(event.data, 'interlocutor');
            };

            // Запускаем нарезку каждые 4 секунды
            micRecorder.start(4000);
            sysRecorder.start(4000);

            // Обработка закрытия вкладки захвата пользователем через системную кнопку "Закрыть доступ"
            displayStream.getVideoTracks()[0].addEventListener('ended', () => {
                stopCapture();
            });

            isCapturing = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            hintBtn.disabled = false;
            console.log('[AI Helper] Dual audio capture started');

        } catch (err) {
            console.error('[AI Helper] Capture error:', err);
            // Если пользователь нажал "Отмена" в диалоге выбора окна
            if (err.name === 'NotAllowedError' || err.name === 'NotReadableError') {
                showToast('Доступ к захвату экрана или микрофону отклонен');
            } else {
                showToast('Ошибка захвата: ' + (err.message || 'Неизвестная ошибка'));
            }
            stopCapture();
        }
    }

    function stopCapture() {
        if (micRecorder && micRecorder.state !== 'inactive') micRecorder.stop();
        if (sysRecorder && sysRecorder.state !== 'inactive') sysRecorder.stop();

        // Останавливаем все треки
        if (micRecorder) micRecorder.stream.getTracks().forEach(t => t.stop());
        if (sysRecorder) sysRecorder.stream.getTracks().forEach(t => t.stop());

        isCapturing = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        hintBtn.disabled = true;
        console.log('[AI Helper] Capture stopped');
    }

    // === UI Updates ===
    function appendTranscript(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-helper-msg ' + role;
        
        const label = document.createElement('div');
        label.className = 'ai-helper-msg-label';
        label.textContent = role === 'user' ? '[Я]' : '[Собеседник]';
        
        const textEl = document.createElement('div');
        textEl.className = 'ai-helper-msg-text';
        textEl.textContent = text;
        
        msgDiv.appendChild(label);
        msgDiv.appendChild(textEl);
        transcriptEl.appendChild(msgDiv);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function streamHintToken(token) {
        if (!hintStreaming) {
            hintStreaming = true;
            hintAreaEl.innerHTML = '';
        }
        const span = document.createElement('span');
        span.className = 'hint-char';
        span.textContent = token;
        hintAreaEl.appendChild(span);
        
        // Плавное появление через requestAnimationFrame + CSS
        requestAnimationFrame(() => span.classList.add('visible'));
        hintAreaEl.scrollTop = hintAreaEl.scrollHeight;
    }

    function finishHintStream() {
        hintStreaming = false;
        hintBtn.disabled = false;
    }

    function setStatus(state, text) {
        statusDot.className = 'ai-helper-status-dot ' + state;
        statusText.textContent = text;
    }

    function showToast(message) {
        const existing = document.getElementById('aiHelperToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'aiHelperToast';
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;z-index:99999;pointer-events:none;transition:opacity 0.3s;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // === Event Handlers ===
    startBtn.addEventListener('click', () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) connectWS();
        startCapture();
    });

    stopBtn.addEventListener('click', stopCapture);

    hintBtn.addEventListener('click', () => {
        if (hintStreaming || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'request_hint' }));
        hintBtn.disabled = true;
        hintAreaEl.innerHTML = '<span style="color:#666">Генерация...</span>';
    });

    closeBtn.addEventListener('click', () => {
        if (isCapturing) stopCapture();
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        overlay.classList.add('ai-helper-overlay-hidden'); // Используем класс из HTML
    });

    // Инициализация при загрузке
    connectWS();
    console.log('[AI Helper] Initialized');
})();