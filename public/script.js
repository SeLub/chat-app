// public/script.js
// Основной скрипт фронтенда — с API Gateway и двух-указательной системой

const log = window.logger || console;

// === Global State ===
let currentModel = null;
let currentProvider = 'ollama';
let allModels = [];
let questions = [];
let currentConversation = [];
let uploadedFile = null;
let uploadedImages = [];
let uploadedCodeFiles = [];
let questionCounter = 0;
let statusRefreshInterval = null;
let currentContextLength = null;
let currentRetainPercent = 100;

// === Token Accumulation ===
let totalInputTokens = 0;
let totalOutputTokens = 0;

// === Two-Pointer System ===
let activeSessionId = null;   // Буфер (рабочая сессия)
let viewingSessionId = null;  // Отображаемая сессия
let currentSessionTitle = '';

// === Initialize ===
window.addEventListener('DOMContentLoaded', async () => {
    log.info('Initializing application');
    loadSelectedProvider();
    loadModels();
    await ensureSession();

    // Handle URL parameter ?session=... (переход с Dashboard)
    const urlParams = new URLSearchParams(window.location.search);
    const urlSessionId = urlParams.get('session');
    if (urlSessionId) {
        log.info('Loading session from URL parameter', { sessionId: urlSessionId.slice(0, 8) });
        await loadConversation(urlSessionId);
        window.history.replaceState({}, '', window.location.pathname);
    } else {
        await loadViewingSession();
    }

    setupEventListeners();

    refreshProviderStatus();
    statusRefreshInterval = setInterval(refreshProviderStatus, 30000);
    log.info('Provider status refresh started (every 30s)');
});



// ============================================================
// === Session Lifecycle (API Gateway) ===
// ============================================================

async function ensureSession() {
    const savedId = localStorage.getItem('activeSessionId');
    const savedViewingId = localStorage.getItem('viewingSessionId');

    if (savedId) {
        try {
            const session = await window.apiGateway.sessions.get(savedId);
            if (session) {
                activeSessionId = savedId;
                viewingSessionId = savedViewingId || savedId;

                if (viewingSessionId === activeSessionId) {
                    currentSessionTitle = session.title;
                } else if (savedViewingId) {
                    const viewingSession = await window.apiGateway.sessions.get(savedViewingId);
                    currentSessionTitle = viewingSession?.title;
                }
                updateChatHeaderTitle();
                log.info('Restored session', {
                    active: savedId.slice(0, 8),
                    viewing: viewingSessionId.slice(0, 8)
                });
                return;
            }
        } catch (error) {
            log.warn('Saved session not found, creating new one');
        }
    }

    try {
        const data = await window.apiGateway.sessions.create();
        activeSessionId = data.id;
        viewingSessionId = data.id;
        currentSessionTitle = data.title || '';
        updateChatHeaderTitle();
        localStorage.setItem('activeSessionId', activeSessionId);
        localStorage.setItem('viewingSessionId', viewingSessionId);
        log.info('Created new session', { sessionId: activeSessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to create session', error);
        showToast('Failed to initialize session', 'error');
    }
}

async function loadViewingSession() {
    if (!viewingSessionId) return;

    try {
        const messages = await window.apiGateway.sessions.getMessages(viewingSessionId);
        renderMessagesFromAPI(messages);
        updateReturnButtonVisibility();
        log.info(`Loaded ${messages.length} messages from viewing session ${viewingSessionId.slice(0, 8)}`);
    } catch (error) {
        log.error('Failed to load viewing session', error);
    }
}

function updateReturnButtonVisibility() {
    const btn = document.querySelector('[data-action="return-to-current"]');
    if (!btn) return;

    if (viewingSessionId !== activeSessionId) {
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

function updateChatHeaderTitle() {
    const titleEl = document.getElementById('chatHeaderTitle');
    if (!titleEl) return;

    const title = currentSessionTitle || 'Chat';
    titleEl.textContent = title;
}

// ============================================================
// === Нормализация сообщений из БД ===
// ============================================================

function normalizeMessage(msg) {
    if (!msg) return msg;

    return {
        id: msg.id,
        sessionId: msg.session_id || msg.sessionId,
        questionId: msg.question_id || msg.questionId,
        role: msg.role,
        content: msg.content,
        model: msg.model,
        attachmentsMeta: (() => {
            const raw = msg.attachments_meta || msg.attachmentsMeta || '[]';
            if (typeof raw === 'string') {
                try { return JSON.parse(raw); }
                catch { return []; }
            }
            return Array.isArray(raw) ? raw : [];
        })(),
        metrics: (() => {
            const raw = msg.metrics || '{}';
            if (typeof raw === 'string') {
                try { return JSON.parse(raw); }
                catch { return {}; }
            }
            return raw;
        })(),
        imageData: (() => {
            const raw = msg.image_data || msg.imageData || null;
            if (!raw) return null;
            if (typeof raw === 'string') {
                try { return JSON.parse(raw); }
                catch { return null; }
            }
            return raw;
        })(),
        sortOrder: msg.sort_order || msg.sortOrder,
        createdAt: msg.created_at || msg.createdAt
    };
}

// ============================================================
// === Render Messages from API ===
// ============================================================

function renderMessagesFromAPI(messages) {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    questions = [];
    currentConversation = [];
    questionCounter = 0;

    if (messages.length === 0) {
        chatMessages.innerHTML = `
            <div class="message bot-message">
                <div class="message-content">
                    <div class="message-header">
                        <div class="message-model">🤖 AI Chat</div>
                    </div>
                    <div class="message-text">Welcome! Select a model and start chatting.</div>
                </div>
            </div>
        `;
        updateQuestionsList();
        return;
    }

    for (const rawMsg of messages) {
        const msg = normalizeMessage(rawMsg);
        questionCounter++;
        const questionId = msg.questionId || `q_${questionCounter}_restored`;

        if (msg.role === 'user') {
            questions.push({
                id: questionId,
                text: msg.content,
                model: msg.model,
                number: questionCounter
            });

            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';
            messageDiv.dataset.questionId = questionId;

            let attachmentsHtml = '';
            if (msg.attachmentsMeta && msg.attachmentsMeta.length > 0) {
                attachmentsHtml = '<div class="message-attachments">' +
                    msg.attachmentsMeta.map(a =>
                        `<span class="file-badge">📎 ${escapeHtml(a.name)} (${formatSize(a.size)}) [${escapeHtml(a.type)}]</span>`
                    ).join('') +
                    '</div>';
            }

            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <div class="message-model">Q${questionCounter} • You • ${escapeHtml(msg.model || 'unknown')}</div>
                        <div class="message-nav-buttons">
                            <button class="nav-btn prev-btn" onclick="jumpToPreviousQuestion('${questionId}')">↑ Prev</button>
                            <button class="nav-btn next-btn" onclick="jumpToNextQuestion('${questionId}')">Next ↓</button>
                        </div>
                    </div>
                    <div class="message-text">${escapeHtml(msg.content)}</div>
                    ${attachmentsHtml}
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="copyQuestion('${questionId}')">📋 Copy Question</button>
                        <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
                    </div>
                </div>
            `;
            chatMessages.appendChild(messageDiv);
        } else if (msg.role === 'assistant') {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message bot-message';
            messageDiv.dataset.questionId = questionId;

            let imageHtml = '';
            if (msg.imageData && msg.imageData.thumbnailUrl) {
                imageHtml = `
                    <div class="image-preview-container">
                        <img src="${msg.imageData.thumbnailUrl}" class="image-preview" onclick="showFullImage('${msg.imageData.fullUrl}')">
                        <div class="image-filename">${escapeHtml(msg.imageData.filename || '')}</div>
                    </div>
                `;
            }

            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <div class="message-model">🤖 ${escapeHtml(msg.model || 'unknown')}</div>
                    </div>
                    ${imageHtml}
                    <div class="message-text">${formatMarkdown(msg.content)}</div>
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="jumpToQuestion('${questionId}')">🔼 Question</button>
                        <button class="message-action-btn" onclick="copyQAPair('${questionId}')">📋 Copy Q&A</button>
                        <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
                    </div>
                </div>
            `;
            chatMessages.appendChild(messageDiv);
        }

        currentConversation.push({
            role: msg.role,
            content: msg.content,
            questionId: questionId,
            model: msg.model
        });
    }

    updateQuestionsList();
}

// ============================================================
// === Provider Management ===
// ============================================================

function loadSelectedProvider() {
    const saved = localStorage.getItem('selectedProvider');
    if (saved) {
        currentProvider = saved;
        const radio = document.querySelector(`input[name="provider"][value="${saved}"]`);
        if (radio) radio.checked = true;
        log.info(`Restored provider: ${saved}`);
    }
}

function saveSelectedProvider() {
    localStorage.setItem('selectedProvider', currentProvider);
}

function handleProviderChange() {
    const selectedRadio = document.querySelector('input[name="provider"]:checked');
    if (selectedRadio) {
        const newProvider = selectedRadio.value;
        log.info(`Provider changed: ${currentProvider} → ${newProvider}`);
        currentProvider = newProvider;
        saveSelectedProvider();
        loadModels();
        refreshProviderStatus();
    }
}

async function refreshProviderStatus() {
    try {
        const data = await window.apiGateway.providers.status();

        data.providers.forEach(p => {
            const indicator = document.getElementById(`status-${p.name}`);
            const label = document.querySelector(`.radio-label[data-provider="${p.name}"]`);
            if (!indicator || !label) return;

            const dot = indicator.querySelector('.status-dot');
            dot.className = 'status-dot ' + p.status;

            let tooltip = `${p.name}: ${p.status}`;
            if (p.latencyMs) tooltip += ` (${p.latencyMs}ms)`;
            if (p.error) tooltip += `\n${p.error}`;
            indicator.title = tooltip;

            if (p.status !== 'connected') {
                label.classList.add('unavailable');
            } else {
                label.classList.remove('unavailable');
            }
        });

        checkCurrentProviderAvailability(data.providers);
    } catch (error) {
        log.error('Failed to refresh provider status', error);
    }
}

function checkCurrentProviderAvailability(providers) {
    const current = providers.find(p => p.name === currentProvider);
    if (!current) return;
    if (current.status === 'connected') return;

    const fallback = providers.find(p => p.status === 'connected');
    let message = `⚠️ ${current.name} is unavailable`;
    if (current.error) message += `\n${current.error}`;
    if (fallback) message += `\n💡 Switch to ${fallback.name} to continue.`;
    showToast(message, 'error');
}

// ============================================================
// === Model Management ===
// ============================================================

async function loadModels() {
    const dropdown = document.getElementById('modelDropdown');
    dropdown.innerHTML = '<option value="">Loading models...</option>';
    allModels = [];

    try {
        log.info(`Loading models from ${currentProvider}`);
        const data = await window.apiGateway.models.list(currentProvider);

        if (data.connected && data.models) {
            allModels = data.models.map(model => ({
                ...model,
                provider: currentProvider
            }));
            log.info(`Loaded ${allModels.length} models from ${currentProvider}`);
        }
    } catch (error) {
        log.error(`Error loading models from ${currentProvider}`, error);
    }

    if (allModels.length === 0) {
        dropdown.innerHTML = '<option value="">No models available</option>';
        return;
    }

    dropdown.innerHTML = '<option value="">Select a model...</option>';
    allModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = `${model.name}${model.type === 'vision' ? ' ️' : ''}`;
        option.dataset.provider = model.provider;
        option.dataset.size = model.size;
        option.dataset.contextLength = model.contextLength || '-';
        dropdown.appendChild(option);
    });

    const savedModel = localStorage.getItem('selectedModel');
    const savedProvider = localStorage.getItem('selectedProvider');
    if (savedModel && savedProvider === currentProvider) {
        const modelExists = allModels.some(m => m.name === savedModel);
        if (modelExists) {
            dropdown.value = savedModel;
            handleModelSelect();
            log.info(`Restored model: ${savedModel}`);
        }
    }
}

function handleModelSelect() {
    const dropdown = document.getElementById('modelDropdown');
    const selectedOption = dropdown.options[dropdown.selectedIndex];

    if (!selectedOption || !selectedOption.value) {
        currentModel = null;
        currentContextLength = null;
        updateModelInfo();
        return;
    }

    currentModel = selectedOption.value;
    currentProvider = selectedOption.dataset.provider;
    localStorage.setItem('selectedModel', currentModel);
    localStorage.setItem('selectedProvider', currentProvider);
    log.info(`Model selected: ${currentModel} (${currentProvider})`);
    updateModelInfo();
}

function extractContextLength(data) {
    if (!data || !data.model_info) return null;
    for (const key of Object.keys(data.model_info)) {
        if (key.toLowerCase().includes('context_length')) {
            return data.model_info[key];
        }
    }
    return null;
}

async function updateModelInfo() {
    const modelNameEl = document.getElementById('selectedModelName');
    const modelSizeEl = document.getElementById('modelSize');
    const modelContextEl = document.getElementById('modelContext');

    if (!currentModel) {
        modelNameEl.textContent = 'No model selected';
        modelSizeEl.textContent = '-';
        modelContextEl.textContent = '-';
        const bar = document.getElementById('chatContextBar');
        if (bar) bar.classList.remove('active');
        return;
    }

    modelNameEl.textContent = currentModel.split('/').pop().replace('.gguf', '');

    try {
        const data = await window.apiGateway.models.show(currentModel, currentProvider);

        if (data.details && data.details.size) {
            modelSizeEl.textContent = `${(data.details.size / 1024 / 1024 / 1024).toFixed(2)} GB`;
        } else {
            const model = allModels.find(m => m.name === currentModel);
            if (model && model.size) {
                modelSizeEl.textContent = `${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB`;
            } else {
                modelSizeEl.textContent = '-';
            }
        }

        let contextLength = extractContextLength(data);
        if (!contextLength && data.parameters && data.parameters.context_length) {
            contextLength = data.parameters.context_length;
        }
        if (!contextLength) {
            const model = allModels.find(m => m.name === currentModel);
            if (model && model.contextLength) contextLength = model.contextLength;
        }

        modelContextEl.textContent = contextLength ? contextLength : '-';
        currentContextLength = contextLength || null;
    } catch (error) {
        log.error('Error loading model info', error);
        modelSizeEl.textContent = '-';
        modelContextEl.textContent = '-';
        currentContextLength = null;
    }

    updateContextBar();
}

// ============================================================
// === Chat Functionality ===
// ============================================================

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    if (!currentModel) {
        showToast('Please select a model first', 'error');
        return;
    }

    input.value = '';

    // Генерируем questionId на фронтенде
    questionCounter++;
    const questionId = `q_${questionCounter}_${Date.now()}`;

    // Добавляем вопрос в UI
    addQuestion(message, currentModel, questionId);

    // Формируем FormData для отправки файлов
    const formData = new FormData();
    formData.append('message', message);
    formData.append('model', currentModel);
    formData.append('sessionId', viewingSessionId);
    formData.append('questionId', questionId);
    
    if (currentContextLength) {
        formData.append('contextLength', currentContextLength);
    }

    if (currentRetainPercent !== 100) {
        formData.append('retainPercent', currentRetainPercent);
    }

    // Добавляем загруженные файлы
    if (uploadedFile) {
        formData.append('file', uploadedFile);
    }

    // Добавляем code files
    uploadedCodeFiles.forEach((file) => {
        formData.append('codeFiles', file);
    });

    try {
        log.info(`Sending message to ${currentProvider}/${currentModel}`, {
            hasFile: !!uploadedFile,
            codeFilesCount: uploadedCodeFiles.length
        });

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'X-Provider': currentProvider },
            body: formData
        });

        if (response.status === 503) {
            const data = await response.json();
            addBotMessage(
                `⚠️ **${currentProvider} is unavailable**\n\n${data.error}\n\nPlease check the provider status or switch to another provider.`,
                currentModel, null, null, questionId
            );
            refreshProviderStatus();
            return;
        }

        if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Unknown error' }));
            addBotMessage(
                `❌ **Error ${response.status}**\n\n${data.error || response.statusText}`,
                currentModel, null, null, questionId
            );
            return;
        }

        const data = await response.json();

        if (data.error) {
            let errorMessage = data.error;
            if (data.error.includes('ECONNREFUSED')) {
                errorMessage = `Cannot connect to ${currentProvider} server.\n\n**Possible reasons:**\n- Server is not running\n- Wrong URL in configuration\n- Firewall blocking the connection`;
            }
            addBotMessage(`❌ ${errorMessage}`, currentModel, null, null, questionId);
            return;
        }

        addBotMessage(data.response, currentModel, data.metrics, data.imageData, questionId);
        log.info(`Response received from ${currentModel}`, { metrics: data.metrics });

    } catch (error) {
        log.error('Network error sending message', error);
        addBotMessage(
            `❌ **Network error**\n\n${error.message}\n\nPlease check your connection and try again.`,
            currentModel, null, null, questionId
        );
    }

    // Reset file state
    uploadedFile = null;
    uploadedCodeFiles = [];
    const preview = document.getElementById('filePreview');
    if (preview) {
        preview.classList.remove('active');
        preview.innerHTML = '';
    }
}

function addQuestion(message, model, questionId = null) {
    if (!questionId) {
        questionCounter++;
        questionId = `q_${questionCounter}_${Date.now()}`;
    }

    questions.push({
        id: questionId,
        text: message,
        model: model,
        number: questionCounter
    });
    updateQuestionsList();

    const chatMessages = document.getElementById('chatMessages');

    const welcomeMsg = chatMessages.querySelector('.bot-message');
    if (welcomeMsg && questions.length === 1) {
        const welcomeText = welcomeMsg.querySelector('.message-text');
        if (welcomeText && welcomeText.textContent.includes('Welcome')) {
            welcomeMsg.remove();
        }
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.dataset.questionId = questionId;

    let attachmentsHtml = '';
    if (uploadedCodeFiles.length > 0) {
        attachmentsHtml = '<div class="message-attachments">' +
            uploadedCodeFiles.map(f =>
                `<span class="file-badge">📎 ${escapeHtml(f.name)} (${formatSize(f.size)}) [${escapeHtml(f.type || 'file')}]</span>`
            ).join('') +
            '</div>';
    }

    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-header">
                <div class="message-model">Q${questionCounter} • You • ${escapeHtml(model)}</div>
                <div class="message-nav-buttons">
                    <button class="nav-btn prev-btn" onclick="jumpToPreviousQuestion('${questionId}')" title="Previous question">↑ Prev</button>
                    <button class="nav-btn next-btn" onclick="jumpToNextQuestion('${questionId}')" title="Next question">Next ↓</button>
                </div>
            </div>
            <div class="message-text">${escapeHtml(message)}</div>
            ${attachmentsHtml}
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyQuestion('${questionId}')">📋 Copy Question</button>
                <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">️ Delete</button>
            </div>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return questionId;
}

function addBotMessage(message, model, metrics = null, imageData = null, questionId = null) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    if (questionId) messageDiv.dataset.questionId = questionId;

    let imageHtml = '';
    if (imageData && imageData.thumbnailUrl) {
        imageHtml = `
            <div class="image-preview-container">
                <img src="${imageData.thumbnailUrl}" class="image-preview" onclick="showFullImage('${imageData.fullUrl}')">
                <div class="image-filename">${escapeHtml(imageData.filename || '')}</div>
            </div>
        `;
    }

    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-header">
                <div class="message-model">🤖 ${escapeHtml(model || 'unknown')}</div>
            </div>
            ${imageHtml}
            <div class="message-text">${formatMarkdown(message)}</div>
            <div class="message-actions">
                <button class="message-action-btn" onclick="jumpToQuestion('${questionId}')">🔼 Question</button>
                <button class="message-action-btn" onclick="copyQAPair('${questionId}')">📋 Copy Q&A</button>
                <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
            </div>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Accumulate tokens from this response
    if (metrics && (metrics.inputTokens || metrics.outputTokens)) {
        totalInputTokens += metrics.inputTokens || 0;
        totalOutputTokens += metrics.outputTokens || 0;
        updateStats(metrics);
    }
}

// ============================================================
// === Question Navigation ===
// ============================================================

function jumpToNextQuestion(currentQuestionId) {
    const currentIndex = questions.findIndex(q => q.id === currentQuestionId);
    if (currentIndex === -1 || currentIndex >= questions.length - 1) {
        showToast('No more questions', 'info');
        return;
    }
    jumpToQuestion(questions[currentIndex + 1].id);
}

function jumpToPreviousQuestion(currentQuestionId) {
    const currentIndex = questions.findIndex(q => q.id === currentQuestionId);
    if (currentIndex <= 0) {
        showToast('No previous question', 'info');
        return;
    }
    jumpToQuestion(questions[currentIndex - 1].id);
}

function jumpToQuestion(questionId) {
    const chatMessages = document.getElementById('chatMessages');
    const el = chatMessages.querySelector(`.user-message[data-question-id="${questionId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        highlightMessage(el);
    }
}

function highlightMessage(element) {
    element.style.transition = 'background-color 0.3s';
    element.style.backgroundColor = '#fff3cd';
    setTimeout(() => { element.style.backgroundColor = ''; }, 2000);
}

// ============================================================
// === Copy Functions ===
// ============================================================

function copyQuestion(questionId) {
    const question = questions.find(q => q.id === questionId);
    if (!question) { showToast('Question not found', 'error'); return; }
    navigator.clipboard.writeText(question.text).then(() => {
        showToast('Question copied!', 'success');
    }).catch(() => showToast('Failed to copy', 'error'));
}

function copyQAPair(questionId) {
    const question = questions.find(q => q.id === questionId);
    const answer = currentConversation.find(m => m.role === 'assistant' && m.questionId === questionId);
    if (!question || !answer) { showToast('Q&A pair not found', 'error'); return; }
    const qaMarkdown = `## Question\n\n${question.text}\n\n## Answer\n\n${answer.content}`;
    navigator.clipboard.writeText(qaMarkdown).then(() => {
        showToast('Q&A copied as Markdown!', 'success');
    }).catch(() => showToast('Failed to copy', 'error'));
}

// ============================================================
// === Delete Q&A Pair ===
// ============================================================

async function deleteQAPair(questionId) {
    if (!confirm('Delete this question and answer?')) return;

    try {
        const result = await window.apiGateway.sessions.deleteQAPair(viewingSessionId, questionId);
        log.info('Q&A deleted from backend', {
            questionId,
            deletedMessages: result.deletedMessages,
            deletedAttachments: result.deletedAttachments
        });
    } catch (error) {
        log.error('Failed to delete Q&A pair', error);
        showToast('Failed to delete from server', 'error');
        return;
    }

    const chatMessages = document.getElementById('chatMessages');
    const userMsg = chatMessages.querySelector(`.user-message[data-question-id="${questionId}"]`);
    const botMsg = chatMessages.querySelector(`.bot-message[data-question-id="${questionId}"]`);
    if (userMsg) userMsg.remove();
    if (botMsg) botMsg.remove();

    questions = questions.filter(q => q.id !== questionId);
    currentConversation = currentConversation.filter(msg => msg.questionId !== questionId);

    questionCounter = 0;
    questions.forEach((q) => {
        questionCounter++;
        q.number = questionCounter;
        const userMsgEl = chatMessages.querySelector(`.user-message[data-question-id="${q.id}"] .message-model`);
        if (userMsgEl) {
            userMsgEl.innerHTML = `Q${questionCounter} • You • ${q.model}`;
        }
    });

    updateQuestionsList();
    showToast('Q&A pair deleted', 'success');
}

// ============================================================
// === Conversation Management ===
// ============================================================

async function saveConversation() {
    const targetSessionId = viewingSessionId || activeSessionId;

    try {
        const session = await window.apiGateway.sessions.get(targetSessionId);
        const currentTitle = session?.title || '';
        const currentCategory = session?.category || 'General';

        const nameInput = document.getElementById('conversationName');
        const categoryInput = document.getElementById('conversationCategory');
        nameInput.value = currentTitle;
        categoryInput.value = currentCategory;
    } catch (error) {
        log.error('Failed to load session data for save modal', error);
        const nameInput = document.getElementById('conversationName');
        const categoryInput = document.getElementById('conversationCategory');
        nameInput.value = currentSessionTitle || '';
        categoryInput.value = 'General';
    }

    document.getElementById('saveModal').classList.add('active');
}

function closeSaveModal() {
    document.getElementById('saveModal').classList.remove('active');
}

async function confirmSave() {
    const name = document.getElementById('conversationName').value.trim();
    const category = document.getElementById('conversationCategory').value.trim();

    if (!name) {
        showToast('Please enter a conversation name', 'error');
        return;
    }

    const targetSessionId = viewingSessionId || activeSessionId;

    try {
        const session = await window.apiGateway.sessions.get(targetSessionId);
        const oldTitle = session?.title || '';
        const oldCategory = session?.category || 'General';

        const updates = {};
        if (name !== oldTitle) {
            updates.title = name;
        }
        if (category && category !== oldCategory) {
            updates.category = category;
        }

        if (Object.keys(updates).length > 0) {
            await window.apiGateway.sessions.update(targetSessionId, updates);
        }

        currentSessionTitle = name;
        updateChatHeaderTitle();
        showToast('Conversation saved!', 'success');
        closeSaveModal();
        log.info(`Conversation saved: ${name}`);
    } catch (error) {
        log.error('Failed to save conversation', error);
        showToast('Failed to save', 'error');
    }
}

async function showLoadModal() {
    const list = document.getElementById('savedConversationsList');
    list.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">Loading...</div>';
    document.getElementById('loadModal').classList.add('active');

    try {
        const sessions = await window.apiGateway.sessions.list();

        if (sessions.length === 0) {
            list.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">No saved conversations</div>';
            return;
        }

        list.innerHTML = sessions.map(session => `
            <div class="dropdown-item" onclick="loadConversation('${session.id}')">
                <strong>${escapeHtml(session.title || 'Untitled')}</strong><br>
                <small>${escapeHtml(session.category || 'General')} • ${session.message_count || 0} messages • ${new Date(session.updated_at).toLocaleDateString()}</small>
            </div>
        `).join('');
    } catch (error) {
        log.error('Failed to load sessions list', error);
        list.innerHTML = '<div style="color: #f44; text-align: center; padding: 20px;">Failed to load conversations</div>';
    }
}

function closeLoadModal() {
    document.getElementById('loadModal').classList.remove('active');
}

async function loadConversation(sessionId) {
    if (!sessionId) return;

    viewingSessionId = sessionId;
    localStorage.setItem('viewingSessionId', viewingSessionId);

    updateReturnButtonVisibility();

    try {
        const session = await window.apiGateway.sessions.get(sessionId);
        currentSessionTitle = session?.title || '';
        updateChatHeaderTitle();
    } catch (e) {
        currentSessionTitle = '';
        updateChatHeaderTitle();
    }

    try {
        const messages = await window.apiGateway.sessions.getMessages(sessionId);
        renderMessagesFromAPI(messages);
        closeLoadModal();
        showToast('Conversation loaded!', 'success');
        log.info(`Loaded conversation ${sessionId.slice(0, 8)} (viewing, buffer preserved: ${activeSessionId.slice(0, 8)})`);
    } catch (error) {
        log.error('Failed to load conversation', error);
        showToast('Failed to load conversation', 'error');
    }
}

async function returnToCurrent() {
    if (viewingSessionId === activeSessionId) {
        showToast('You are already on the current chat', 'info');
        return;
    }

    try {
        const session = await windаow.apiGateway.sessions.get(activeSessionId);
        currentSessionTitle = session?.title || '';
    } catch (e) {
        currentSessionTitle = '';
    }
    updateChatHeaderTitle();

    viewingSessionId = activeSessionId;
    localStorage.setItem('viewingSessionId', viewingSessionId);
    updateReturnButtonVisibility();

    try {
        const messages = await window.apiGateway.sessions.getMessages(activeSessionId);
        renderMessagesFromAPI(messages);
        showToast('Returned to current conversation', 'success');
        log.info(`Returned to buffer ${activeSessionId.slice(0, 8)}`);
    } catch (error) {
        log.error('Failed to return to current', error);
        showToast('Failed to load current conversation', 'error');
    }
}

async function clearChat() {
    if (!confirm('Clear current chat and start new?')) return;

    try {
        const currentSessionId = localStorage.getItem('viewingSessionId');
        const currentSession = await window.apiGateway.sessions.get(currentSessionId);
        let newArchiveTitle = '';
        if (currentSession && !currentSession.title.startsWith('unsavedSession')) {
            newArchiveTitle = currentSession.title;
        } else {
            const sessions = await window.apiGateway.sessions.list();
            const unsavedCount = sessions.filter(s => s.title && s.title.startsWith('unsavedSession')).length;
            newArchiveTitle = `unsavedSession ${unsavedCount + 1}`;
            await window.apiGateway.sessions.update(currentSessionId, { title: newArchiveTitle });
        }

        const newSession = await window.apiGateway.sessions.create();
        activeSessionId = currentSessionId;
        viewingSessionId = newSession.id;
        currentSessionTitle = newSession.title || '';
        updateChatHeaderTitle();
        localStorage.setItem('activeSessionId', activeSessionId);
        localStorage.setItem('viewingSessionId', viewingSessionId);

        questions = [];
        questionCounter = 0;
        currentConversation = [];
        totalInputTokens = 0;
        totalOutputTokens = 0;
        document.getElementById('chatMessages').innerHTML = `
            <div class="message bot-message">
                <div class="message-content">
                    <div class="message-header"><div class="message-model">🤖 AI Chat</div></div>
                    <div class="message-text">Chat cleared. Start a new conversation!</div>
                </div>
            </div>
        `;
        updateQuestionsList();
        updateReturnButtonVisibility();

        showToast(`Chat cleared. Previous chat archived as "${newArchiveTitle}".`, 'success');
        log.info(`Chat cleared. Old buffer archived as "${newArchiveTitle}". New buffer: ${activeSessionId.slice(0, 8)}`);
    } catch (error) {
        log.error('Failed to clear chat', error);
        showToast('Failed to clear chat', 'error');
    }
}

async function exportConversation() {
    if (!viewingSessionId) return;

    try {
        const messages = await window.apiGateway.sessions.getMessages(viewingSessionId);
        if (messages.length === 0) {
            showToast('No messages to export', 'info');
            return;
        }

        const data = JSON.stringify(messages, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${viewingSessionId.slice(0, 8)}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        log.info('Conversation exported');
        showToast('Conversation exported!', 'success');
    } catch (error) {
        log.error('Failed to export conversation', error);
        showToast('Failed to export', 'error');
    }
}

// ============================================================
// === Utility Functions ===
// ============================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    if (!text) return '';
    
    // 1. Сначала извлекаем блоки кода и заменяем на placeholder
    // Это защищает код от markdown-парсинга и от замены \n на <br>
    const codeBlocks = [];
    text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const index = codeBlocks.length;
        const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
        const encodedCode = encodeURIComponent(code.trim());
        
        // ВАЖНО: весь шаблон в ОДНУ СТРОКУ, без переносов!
        codeBlocks.push(`<div class="code-block-wrapper"><div class="code-block-header">${langLabel}<button class="copy-code-btn" onclick="copyCodeBlock(this)" title="Copy code"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span></button></div><pre><code data-raw-code="${encodedCode}">${escapeHtml(code.trim())}</code></pre></div>`);
        
        return `__CODE_BLOCK_${index}__`;
    });
    
    // 2. Парсим Markdown таблицы
    const tables = [];
    text = text.replace(/((?:^[\s]*\|.+\|[\s]*\n)+)/gm, (match) => {
        const index = tables.length;
        const html = renderMarkdownTable(match.trim());
        tables.push(html);
        return `__TABLE_${index}__`;
    });

    // 2. Обрабатываем markdown (теперь код и таблицы защищены placeholder'ами)
    let result = text
        // Inline код (важно ДО жирного/курсива)
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
        // Жирный текст
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Курсив (с негативным lookahead, чтобы не трогать **)
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
        // Переносы строк
        .replace(/\n/g, '<br>');
    
    // 3. Возвращаем блоки кода из placeholder'ов
    codeBlocks.forEach((block, index) => {
        result = result.replace(`__CODE_BLOCK_${index}__`, block);
    });

    // 4. Возвращаем таблицы из placeholder'ов
    tables.forEach((tableHtml, index) => {
        result = result.replace(`__TABLE_${index}__`, tableHtml);
    });

    return result;
}

// ============================================================
// === Markdown Table to HTML ===
// ============================================================

function renderMarkdownTable(markdown) {
    const lines = markdown.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return `<pre>${escapeHtml(markdown)}</pre>`;

    const headerLine = lines[0];
    const headerCells = parseTableRow(headerLine);
    if (headerCells.length === 0) return `<pre>${escapeHtml(markdown)}</pre>`;

    const separatorLine = lines[1];
    const isSeparator = /^[\s\-:|]+$/.test(separatorLine) && separatorLine.includes('-');

    const dataLines = isSeparator ? lines.slice(2) : lines.slice(1);
    const rows = dataLines.map(line => parseTableRow(line)).filter(cells => cells.length > 0);

    const separatorCells = parseTableRow(separatorLine);
    const alignments = separatorCells.map(cell => {
        const trimmed = cell.trim();
        if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
        if (trimmed.endsWith(':')) return 'right';
        return 'left';
    });

    let html = '<table class="markdown-table"><thead><tr>';
    headerCells.forEach((cell, i) => {
        const align = alignments[i] || 'left';
        html += `<th align="${align}">${formatTableCell(cell)}</th>`;
    });
    html += '</tr></thead><tbody>';

    rows.forEach(row => {
        html += '<tr>';
        row.forEach((cell, i) => {
            const align = alignments[i] || 'left';
            html += `<td align="${align}">${formatTableCell(cell)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    return `<div class="markdown-table-wrapper">${html}</div>`;
}

function parseTableRow(line) {
    let trimmed = line.replace(/^\|[\s]*/, '').replace(/[\s]*\|$/, '');
    return trimmed.split('|').map(cell => cell.trim());
}

function formatTableCell(text) {
    let formatted = escapeHtml(text);
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    return formatted;
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function updateStats(metrics) {
    if (!metrics) return;
    const el = id => document.getElementById(id);
    if (el('tps')) el('tps').textContent = metrics.tps ? `${metrics.tps} tok/s` : '-';
    if (el('promptSpeed')) el('promptSpeed').textContent = metrics.promptTps ? `${metrics.promptTps} tok/s` : '-';
    if (el('ttft')) el('ttft').textContent = metrics.ttft ? `${metrics.ttft}s` : '-';
    if (el('loadTime')) el('loadTime').textContent = metrics.loadTime ? `${metrics.loadTime}s` : '-';
    if (el('totalTime')) el('totalTime').textContent = metrics.totalTime ? `${metrics.totalTime}s` : '-';

    // Display accumulated totals (not just the last response)
    if (el('inputTokens')) el('inputTokens').textContent = `~${totalInputTokens}`;
    if (el('outputTokens')) el('outputTokens').textContent = `~${totalOutputTokens}`;
    if (el('contextLoad')) {
        const totalUsed = totalInputTokens + totalOutputTokens;
        const pct = currentContextLength ? Math.round((totalUsed / currentContextLength) * 100) : 0;
        el('contextLoad').textContent = `${pct}%`;
    }

    updateContextBar();
    updateStatsModal(metrics);
}

function updateContextBar() {
    const bar = document.getElementById('chatContextBar');
    const fill = document.getElementById('chatContextFill');
    const value = document.getElementById('chatContextValue');
    if (!bar || !fill || !value) return;

    if (!currentModel) {
        bar.classList.remove('active');
        fill.style.width = '0%';
        value.textContent = '0 / -';
        return;
    }

    bar.classList.add('active');

    const used = totalInputTokens + totalOutputTokens;
    const total = currentContextLength || 0;
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;

    fill.style.width = pct + '%';

    if (pct <= 50) {
        fill.style.backgroundColor = '#10b981';
    } else if (pct <= 75) {
        fill.style.backgroundColor = '#f59e0b';
    } else {
        fill.style.backgroundColor = '#ef4444';
    }

    value.textContent = `${used} / ${total}`;
}

function updateStatsModal(metrics) {
    if (!metrics) return;
    const el = id => document.getElementById(id);
    // Per-response performance metrics (unchanged)
    el('modalTps').textContent = metrics.tps ? `${metrics.tps} tok/s` : '-';
    el('modalPromptSpeed').textContent = metrics.promptTps ? `${metrics.promptTps} tok/s` : '-';
    el('modalTtft').textContent = metrics.ttft ? `${metrics.ttft}s` : '-';
    el('modalLoadTime').textContent = metrics.loadTime ? `${metrics.loadTime}s` : '-';
    el('modalTotalTime').textContent = metrics.totalTime ? `${metrics.totalTime}s` : '-';
    // Accumulated session totals
    const totalUsed = totalInputTokens + totalOutputTokens;
    el('modalInputTokens').textContent = `~${totalInputTokens}`;
    el('modalOutputTokens').textContent = `~${totalOutputTokens}`;
    el('modalContextLoad').textContent = currentContextLength ? `${Math.round((totalUsed / currentContextLength) * 100)}%` : '0%';
    el('modalQuestionCount').textContent = questions.length;
}

function openStatsModal() {
    document.getElementById('statsModal').classList.add('active');
}

function closeStatsModal() {
    document.getElementById('statsModal').classList.remove('active');
}

function updateQuestionsList() {
    const questionsList = document.getElementById('questionsList');
    const countEl = document.getElementById('questionCount');
    if (countEl) countEl.textContent = questions.length;

    if (questions.length === 0) {
        questionsList.innerHTML = '<div style="color: #999; font-size: 0.9em; text-align: center; padding: 20px;">No questions yet</div>';
        return;
    }

    questionsList.innerHTML = questions.map(q => `
        <div class="question-item" onclick="jumpToQuestion('${q.id}')">
            <div class="question-number">Q${q.number} • ${escapeHtml(q.model.split('/').pop().replace('.gguf', ''))}</div>
            <div class="question-text">${escapeHtml(q.text)}</div>
        </div>
    `).join('');
}

function copyCodeBlock(button) {
    const wrapper = button.closest('.code-block-wrapper');
    if (!wrapper) return;
    
    const codeElement = wrapper.querySelector('pre code');
    if (!codeElement) return;
    
    // Берём исходный код из data-атрибута (сохраняет ВСЕ переносы и отступы)
    let codeText;
    if (codeElement.dataset.rawCode) {
        codeText = decodeURIComponent(codeElement.dataset.rawCode);
    } else {
        // Fallback для старых сообщений без data-атрибута
        codeText = codeElement.textContent;
    }
    
    // Используем textarea для надёжного копирования с сохранением форматирования
    // (clipboard API иногда теряет переносы строк)
    const textarea = document.createElement('textarea');
    textarea.value = codeText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    let success = false;
    try {
        success = document.execCommand('copy');
    } catch (err) {
        success = false;
    }
    document.body.removeChild(textarea);
    
    // Fallback на clipboard API
    if (!success) {
        navigator.clipboard.writeText(codeText).then(() => {
            showCopiedFeedback(button);
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
        return;
    }
    
    showCopiedFeedback(button);
}

function showCopiedFeedback(button) {
    const originalHTML = button.innerHTML;
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied!</span>';
    button.classList.add('copied');
    
    setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('copied');
    }, 2000);
    
    showToast('Code copied!', 'success');
}

// ============================================================
// === File Handling ===
// ============================================================

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    uploadedFile = file;
    showFilePreview(file.name, file.size);
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    uploadedFile = file;
    showFilePreview(file.name, file.size);
}

function handleCodeUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    uploadedCodeFiles = [...uploadedCodeFiles, ...files];
    showFilePreview(`${uploadedCodeFiles.length} code file(s)`, files.reduce((sum, f) => sum + f.size, 0));
}

function showFilePreview(name, size) {
    const preview = document.getElementById('filePreview');
    if (!preview) return;
    preview.innerHTML = `📎 ${escapeHtml(name)} (${formatSize(size)})`;
    preview.classList.add('active');
}

function showFullImage(url) {
    window.open(url, '_blank');
}

// ============================================================
// === Modal Functions ===
// ============================================================

function showMultilineModal() {
    document.getElementById('multilineModal').classList.add('active');
}

function closeMultilineModal() {
    document.getElementById('multilineModal').classList.remove('active');
}

function sendMultilineMessage() {
    const input = document.getElementById('multilineInput');
    document.getElementById('chatInput').value = input.value;
    input.value = '';
    closeMultilineModal();
    sendMessage();
}

function toggleDropdown() {
    document.getElementById('dropdownMenu').classList.toggle('show');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

function setupEventListeners() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            const menu = document.getElementById('dropdownMenu');
            if (menu) menu.classList.remove('show');
        }
    });

    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    const multilineInput = document.getElementById('multilineInput');
    if (multilineInput) {
        multilineInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                sendMultilineMessage();
            }
        });
    }
}