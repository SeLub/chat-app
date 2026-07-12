// public/script.js
// Основной скрипт фронтенда — Фаза 3 (адаптация к SQLite backend)

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
let currentSessionId = null;
let currentContextLength = null;

// === Initialize ===
window.addEventListener('DOMContentLoaded', async () => {
    log.info('Initializing application');
    loadSelectedProvider();
    loadModels();
    await ensureSession();      // Создаёт/восстанавливает сессию через API
    await loadSessionFromAPI(); // Загружает историю из SQLite
    setupEventListeners();

    // Start provider status refresh
    refreshProviderStatus();
    statusRefreshInterval = setInterval(refreshProviderStatus, 30000);
    log.info('Provider status refresh started (every 30s)');
});

// ============================================================
// === Session API Functions (Phase 3: backend as source of truth) ===
// ============================================================

async function fetchSessions(search = '') {
    const url = search
        ? `/api/sessions?search=${encodeURIComponent(search)}`
        : '/api/sessions';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
}

async function fetchSessionMessages(sessionId) {
    const response = await fetch(`/api/sessions/${sessionId}/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
}

async function createSessionAPI(title = null) {
    const body = title ? { title } : {};
    const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Failed to create session');
    return response.json(); // { id, title }
}

async function updateSessionMeta(sessionId, updates) {
    const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error('Failed to update session');
    return response.json();
}

async function deleteSessionAPI(sessionId) {
    const response = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete session');
    return response.json();
}

// ============================================================
// === Session Lifecycle (Phase 3: replaces localStorage) ===
// ============================================================

async function ensureSession() {
    // Проверяем, есть ли сохранённый sessionId
    const savedId = localStorage.getItem('currentSessionId');

    if (savedId) {
        try {
            // Проверяем, что сессия существует на backend
            const response = await fetch(`/api/sessions/${savedId}`);
            if (response.ok) {
                currentSessionId = savedId;
                log.info('Restored session', { sessionId: savedId.slice(0, 8) });
                return;
            }
        } catch (error) {
            log.warn('Saved session not found on backend, creating new one');
        }
    }

    // Создаём новую сессию через API
    try {
        const data = await createSessionAPI();
        currentSessionId = data.id;
        localStorage.setItem('currentSessionId', currentSessionId);
        log.info('Created new session', { sessionId: currentSessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to create session', error);
        showToast('Failed to initialize session', 'error');
    }
}

async function loadSessionFromAPI() {
    if (!currentSessionId) return;

    try {
        const messages = await fetchSessionMessages(currentSessionId);
        renderMessagesFromAPI(messages);
        log.info(`Loaded ${messages.length} messages from session ${currentSessionId.slice(0, 8)}`);
    } catch (error) {
        log.error('Failed to load session messages', error);
    }
}

function renderMessagesFromAPI(messages) {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    questions = [];
    currentConversation = [];
    questionCounter = 0;

    if (messages.length === 0) {
        // Показываем приветственное сообщение
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

    for (const msg of messages) {
        questionCounter++;
        const questionId = msg.question_id || `q_${questionCounter}_restored`;

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

            // Render file badges from attachments_meta
            let attachmentsHtml = '';
            const attachments = msg.attachments_meta
                ? (typeof msg.attachments_meta === 'string' ? JSON.parse(msg.attachments_meta) : msg.attachments_meta)
                : [];
            if (attachments.length > 0) {
                attachmentsHtml = '<div class="message-attachments">' +
                    attachments.map(a =>
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
            const imageData = msg.image_data
                ? (typeof msg.image_data === 'string' ? JSON.parse(msg.image_data) : msg.image_data)
                : null;
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
// === Phase 3: saveCurrentConversation is now a NO-OP ===
// === Backend auto-saves every message to SQLite ===
// ============================================================

function saveCurrentConversation() {
    // NO-OP: backend автоматически сохраняет каждое сообщение в SQLite.
    // Frontend больше не дублирует данные в localStorage.
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

// === Provider Status ===

async function refreshProviderStatus() {
    try {
        const response = await fetch('/api/providers/status');
        const data = await response.json();

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
        const response = await fetch('/api/models', {
            headers: { 'X-Provider': currentProvider }
        });
        const data = await response.json();

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
        option.textContent = `${model.name}${model.type === 'vision' ? ' 👁️' : ''}`;
        option.dataset.provider = model.provider;
        option.dataset.size = model.size;
        option.dataset.contextLength = model.contextLength || '-';
        dropdown.appendChild(option);
    });

    // Restore previously selected model
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
        return;
    }

    modelNameEl.textContent = currentModel;

    try {
        const response = await fetch('/api/show', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Provider': currentProvider
            },
            body: JSON.stringify({ name: currentModel })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // === SIZE ===
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

        // === CONTEXT ===
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
}

// ============================================================
// === Chat Functionality (Phase 3: JSON body + pre-extract) ===
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

    // Generate questionId on frontend
    questionCounter++;
    const questionId = `q_${questionCounter}_${Date.now()}`;

    // Add question to UI immediately
    addQuestion(message, currentModel, questionId);

    // Phase 3: Pre-extract attachments from paths
    let attachmentsMeta = [];
    if (uploadedCodeFiles.length > 0) {
        try {
            const paths = uploadedCodeFiles.map(f => f.path || f.name);
            const res = await fetch('/api/attachments/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paths: paths,
                    sessionId: currentSessionId
                })
            });
            const data = await res.json();

            if (data.results) {
                attachmentsMeta = data.results;
            } else if (Array.isArray(data)) {
                attachmentsMeta = data;
            }

            if (data.errors && data.errors.length > 0) {
                log.warn('Some files failed to extract', data.errors);
                showToast(`Warning: ${data.errors.length} file(s) failed to load`, 'error');
            }
        } catch (error) {
            log.error('Failed to extract attachments', error);
            showToast('Failed to process attached files', 'error');
        }
    }

    // Determine if we should use JSON or FormData
    // Use JSON for text-only or path-based attachments
    // Use FormData for legacy file upload (images, documents)
    const hasLegacyFile = uploadedFile !== null;
    const hasImageUpload = uploadedFile && uploadedFile.type && uploadedFile.type.startsWith('image/');

    try {
        log.info(`Sending message to ${currentProvider}/${currentModel}`);

        let response;

        if (hasLegacyFile && !attachmentsMeta.length) {
            // Legacy FormData mode for image/document upload
            const formData = new FormData();
            formData.append('file', uploadedFile);
            formData.append('message', message);
            formData.append('model', currentModel);
            formData.append('sessionId', currentSessionId);
            if (currentContextLength) formData.append('contextLength', currentContextLength);

            response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'X-Provider': currentProvider },
                body: formData
            });
        } else {
            // JSON mode (new way with path-based attachments)
            response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Provider': currentProvider
                },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    message,
                    model: currentModel,
                    attachments: attachmentsMeta,
                    questionId,
                    contextLength: currentContextLength
                })
            });
        }

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
        updateStats(data.metrics);
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

    // Remove welcome message if present
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

    // Render file badges for current attachments
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
                <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
            </div>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // NO saveCurrentConversation() — backend auto-saves
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

    // NO saveCurrentConversation() — backend auto-saves
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
// === Delete Q&A Pair (Phase 3: API call) ===
// ============================================================

async function deleteQAPair(questionId) {
    if (!confirm('Delete this question and answer?')) return;

    try {
        await fetch(`/api/sessions/${currentSessionId}/messages/${questionId}`, { method: 'DELETE' });
    } catch (error) {
        log.error('Failed to delete Q&A pair from backend', error);
        showToast('Failed to delete from server', 'error');
    }

    // Remove from UI
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.querySelectorAll(`[data-question-id="${questionId}"]`).forEach(el => el.remove());

    // Remove from state
    questions = questions.filter(q => q.id !== questionId);
    currentConversation = currentConversation.filter(msg => msg.questionId !== questionId);

    // Renumber
    questionCounter = 0;
    questions.forEach(q => {
        questionCounter++;
        q.number = questionCounter;
        const modelEl = chatMessages.querySelector(`.user-message[data-question-id="${q.id}"] .message-model`);
        if (modelEl) modelEl.innerHTML = `Q${questionCounter} • You • ${escapeHtml(q.model)}`;
    });

    updateQuestionsList();
    showToast('Q&A pair deleted', 'success');
}

// ============================================================
// === Conversation Management (Phase 3: API-based) ===
// ============================================================

// --- Save: update session metadata via API ---
function saveConversation() {
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

    try {
        await updateSessionMeta(currentSessionId, {
            title: name,
            category: category || 'General'
        });
        showToast('Conversation saved!', 'success');
        closeSaveModal();
        log.info(`Conversation saved: ${name}`);
    } catch (error) {
        log.error('Failed to save conversation', error);
        showToast('Failed to save', 'error');
    }
}

// --- Load: fetch sessions from API ---
async function showLoadModal() {
    const list = document.getElementById('savedConversationsList');
    list.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">Loading...</div>';
    document.getElementById('loadModal').classList.add('active');

    try {
        const sessions = await fetchSessions();

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

// --- Load a specific conversation by sessionId ---
async function loadConversation(sessionId) {
    if (!sessionId) return;

    try {
        const messages = await fetchSessionMessages(sessionId);
        renderMessagesFromAPI(messages);
        closeLoadModal();
        showToast('Conversation loaded!', 'success');
        log.info(`Loaded conversation ${sessionId.slice(0, 8)}`);
    } catch (error) {
        log.error('Failed to load conversation', error);
        showToast('Failed to load conversation', 'error');
    }
}

// --- Return to Current: reload current session from API ---
async function returnToCurrent() {
    if (!currentSessionId) return;
    await loadSessionFromAPI();
    showToast('Returned to current conversation', 'success');
}

// --- Clear Chat: delete current session, create new ---
async function clearChat() {
    if (!confirm('Clear current chat and start new?')) return;

    try {
        // Delete current session from backend
        if (currentSessionId) {
            await deleteSessionAPI(currentSessionId);
        }

        // Create new session
        const newSession = await createSessionAPI();
        currentSessionId = newSession.id;
        localStorage.setItem('currentSessionId', currentSessionId);

        // Reset UI
        questions = [];
        questionCounter = 0;
        currentConversation = [];
        document.getElementById('chatMessages').innerHTML = `
            <div class="message bot-message">
                <div class="message-content">
                    <div class="message-header"><div class="message-model">🤖 AI Chat</div></div>
                    <div class="message-text">Chat cleared. Start a new conversation!</div>
                </div>
            </div>
        `;
        updateQuestionsList();
        showToast('Chat cleared, new session started', 'success');
        log.info(`Chat cleared. New session: ${currentSessionId.slice(0, 8)}`);
    } catch (error) {
        log.error('Failed to clear chat', error);
        showToast('Failed to clear chat', 'error');
    }
}

// --- Export: fetch from API, download as JSON ---
async function exportConversation() {
    if (!currentSessionId) return;

    try {
        const messages = await fetchSessionMessages(currentSessionId);
        if (messages.length === 0) {
            showToast('No messages to export', 'info');
            return;
        }

        const data = JSON.stringify(messages, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${currentSessionId.slice(0, 8)}-${Date.now()}.json`;
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
    return text
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
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

    const inputTokens = metrics.inputTokens || 0;
    const outputTokens = metrics.outputTokens || 0;
    if (el('inputTokens')) el('inputTokens').textContent = `~${inputTokens}`;
    if (el('outputTokens')) el('outputTokens').textContent = `~${outputTokens}`;
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
            <div class="question-number">Q${q.number} • ${escapeHtml(q.model)}</div>
            <div class="question-text">${escapeHtml(q.text)}</div>
        </div>
    `).join('');
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
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            const menu = document.getElementById('dropdownMenu');
            if (menu) menu.classList.remove('show');
        }
    });

    // Send on Enter (not Shift+Enter)
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Multiline: Ctrl+Enter to send
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