// public/ai-helper.js

(function () {
    'use strict';

    const WS_URL = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws/ai-helper';

    let ws = null;
    let micVad = null;
    let systemVad = null;
    let systemAudioCtx = null;
    let systemSourceNode = null;
    let displayStream = null;
    let isCapturing = false;
    let hintStreaming = false;

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
        isDragging = true; dragOffsetX = e.clientX - overlay.offsetLeft; dragOffsetY = e.clientY - overlay.offsetTop;
        overlay.classList.add('dragging'); document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        overlay.style.left = (e.clientX - dragOffsetX) + 'px';
        overlay.style.top = (e.clientY - dragOffsetY) + 'px';
    });
    document.addEventListener('mouseup', () => {
        isDragging = false; overlay.classList.remove('dragging'); document.body.style.userSelect = '';
    });

    // === WebSocket ===
    function connectWS() {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => {
            setStatus('active', '🟢 Захват активен (VAD)');
            console.log('[AI Helper] WebSocket connected');
        };
        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            switch (data.type) {
                case 'transcript': appendTranscript(data.role, data.text); break;
                case 'hint_token': streamHintToken(data.token); break;
                case 'hint_done': finishHintStream(); break;
                case 'error': showToast('AI Helper: ' + (data.message || 'Ошибка')); break;
            }
        };
        ws.onclose = () => {
            setStatus('inactive', '⚪ Ожидание');
            console.log('[AI Helper] WebSocket disconnected');
        };
    }

// === Отправка сырого PCM на сервер (ИСПРАВЛЕНО: нет переполнения стека) ===
function sendAudioChunkToServer(role, audioFloat32) {
    console.log('[AI Helper] sendAudioChunkToServer called', { role, samples: audioFloat32.length });
    
    if (!ws) {
        console.error('[AI Helper] WebSocket is null!');
        return;
    }
    
    if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[AI Helper] WebSocket not OPEN, state:', ws.readyState);
        return;
    }
    
    const int16Array = new Int16Array(audioFloat32.length);
    for (let i = 0; i < audioFloat32.length; i++) {
        const s = Math.max(-1, Math.min(1, audioFloat32[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    
    const message = {
        type: 'audio_chunk',
        role: role,
        audioBase64: base64,
        sampleRate: 16000,
        format: 'pcm16',
        timestamp: Date.now()
    };
    
    console.log('[AI Helper] Message to send:', {
        type: message.type,
        role: message.role,
        base64Length: message.audioBase64.length,
        timestamp: message.timestamp
    });
    
    const jsonString = JSON.stringify(message);
    console.log('[AI Helper] JSON string length:', jsonString.length);
    console.log('[AI Helper] First 200 chars:', jsonString.substring(0, 200));
    
    try {
        ws.send(jsonString);
        console.log('[AI Helper] Message sent successfully');
    } catch (err) {
        console.error('[AI Helper] Failed to send message:', err);
    }
}

// === Захват и VAD (ИСПРАВЛЕНО: убран несуществующий AudioNodeVAD) ===
async function startCapture() {
    try {
        // 1. СНАЧАЛА запрашиваем экран (чтобы при отказе микрофон не запрашивался)
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const sysAudioTrack = displayStream.getAudioTracks()[0];
        
        if (!sysAudioTrack) {
            showToast('Ошибка: Поставьте галочку "Поделиться звуком вкладки/системы"');
            displayStream.getTracks().forEach(t => t.stop());
            stopCapture();
            return;
        }
        const sysOnlyStream = new MediaStream([sysAudioTrack]);

        // 2. Общие опции для обоих VAD
        const vadOptions = {
            baseAssetPath: "/vad-assets/",
            onnxWASMBasePath: "/vad-assets/",
            model: "v5",
            // ИСПРАВЛЕНО: используем Ms (миллисекунды), а не Frames
            positiveSpeechThreshold: 0.5,
            negativeSpeechThreshold: 0.35,
            redemptionMs: 800,        // Пауза 800мс для завершения речи (было не указано)
            preSpeechPadMs: 300,      // Буфер перед речью 300мс (было preSpeechPadFrames)
            minSpeechMs: 300,         // Минимальная длина речи 300мс (было minSpeechFrames)
            ortConfig: (ort) => {
                ort.env.wasm.numThreads = 1;
                ort.env.wasm.simd = true;
            },
            // Добавляем логирование для отладки
            onSpeechStart: () => {
                console.log('[AI Helper] Speech START detected');
            },
            onSpeechEnd: (audio) => {
                console.log('[AI Helper] Speech END detected, audio length:', audio.length);
                sendAudioChunkToServer('user', audio);
            },
            onVADMisfire: () => {
                console.log('[AI Helper] VAD misfire (too short)');
            }
        };

        // 3. MicVAD для микрофона
        micVad = await vad.MicVAD.new({
            ...vadOptions,
            getStream: async () => await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    autoGainControl: true,
                    noiseSuppression: true
                }
            })
        });
        micVad.start();
        console.log('[AI Helper] MicVAD (микрофон) started');

        // 4. Второй MicVAD для системного звука (через кастомный getStream)
        const systemVadOptions = {
            ...vadOptions,
            onSpeechEnd: (audio) => {
                console.log('[AI Helper] System speech END detected, audio length:', audio.length);
                sendAudioChunkToServer('interlocutor', audio);
            }
        };
        systemVad = await vad.MicVAD.new({
            ...systemVadOptions,
            getStream: async () => sysOnlyStream
        });
        systemVad.start();
        console.log('[AI Helper] MicVAD (системный звук) started');

        displayStream.getVideoTracks()[0].addEventListener('ended', () => stopCapture());

        isCapturing = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        hintBtn.disabled = false;
        setStatus('active', '🟢 Захват активен (VAD)');
        console.log('[AI Helper] Dual VAD capture started successfully');
        
    } catch (err) {
        console.error('[AI Helper] Capture error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'NotReadableError') {
            showToast('Доступ к захвату экрана или микрофону отклонен');
        } else {
            showToast('Ошибка захвата: ' + (err.message || 'Отменено'));
        }
        stopCapture();
    }
}

function stopCapture() {
    if (micVad) { 
        try { micVad.pause(); micVad.destroy(); } catch (e) {}
        micVad = null; 
    }
    if (systemVad) { 
        try { systemVad.pause(); systemVad.destroy(); } catch (e) {}
        systemVad = null; 
    }
    if (displayStream) {
        displayStream.getTracks().forEach(t => t.stop());
        displayStream = null;
    }
    
    isCapturing = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    hintBtn.disabled = true;
    setStatus('inactive', '⚪ Ожидание');
    console.log('[AI Helper] Capture stopped');
}

    // === UI Updates ===
    function appendTranscript(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-helper-msg ' + role;
        msgDiv.innerHTML = `<div class="ai-helper-msg-label">${role === 'user' ? '[Я]' : '[Собеседник]'}</div><div class="ai-helper-msg-text">${escapeHtml(text)}</div>`;
        transcriptEl.appendChild(msgDiv);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function streamHintToken(token) {
        if (!hintStreaming) { hintStreaming = true; hintAreaEl.innerHTML = ''; }
        const span = document.createElement('span');
        span.className = 'hint-char';
        span.textContent = token;
        hintAreaEl.appendChild(span);
        requestAnimationFrame(() => span.classList.add('visible'));
    }

    function finishHintStream() {
        hintStreaming = false;
        hintBtn.disabled = false;
    }

    function setStatus(state, text) {
        statusDot.className = 'ai-helper-status-dot ' + state;
        statusText.textContent = text;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showToast(message) {
        const existing = document.getElementById('aiHelperToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'aiHelperToast';
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;z-index:99999;pointer-events:none;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
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
        overlay.classList.add('ai-helper-overlay-hidden');
    });

    connectWS();
    console.log('[AI Helper] Initialized with LOCAL VAD assets');
})();