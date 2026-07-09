// public/script.js
// Основной скрипт фронтенда

const log = window.logger || console;

// Global state
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
    loadCurrentConversation();
    setupEventListeners();
    
    await ensureSession();
    await rebuildSession();
    
    // Запускаем периодическое обновление статуса провайдеров
    refreshProviderStatus();
    statusRefreshInterval = setInterval(refreshProviderStatus, 30000);
    log.info('Provider status refresh started (every 30s)');
});

async function ensureSession() {
    const saved = localStorage.getItem('sessionId');
    if (saved) {
        currentSessionId = saved;
        log.info('Restored session', { sessionId: saved.slice(0, 8) });
        return;
    }
    try {
        const response = await fetch('/api/chat/session', { method: 'POST' });
        const data = await response.json();
        currentSessionId = data.sessionId;
        localStorage.setItem('sessionId', currentSessionId);
        log.info('Created new session', { sessionId: currentSessionId.slice(0, 8) });
    } catch (error) {
        log.error('Failed to create session', error);
    }
}

// === Provider Management ===
function loadSelectedProvider() {
    const saved = localStorage.getItem('selectedProvider');
    if (saved) {
        currentProvider = saved;
        const radio = document.querySelector(`input[name="provider"][value="${saved}"]`);
        if (radio) radio.checked = true;
        log.info(`Restored provider from localStorage: ${saved}`);
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
        refreshProviderStatus(); // Сразу обновляем статус после смены
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
        log.debug('Provider status refreshed', data.providers);
        
    } catch (error) {
        log.error('Failed to refresh provider status', error);
    }
}

function checkCurrentProviderAvailability(providers) {
    const current = providers.find(p => p.name === currentProvider);
    
    if (!current) {
        log.warn(`Current provider "${currentProvider}" not found in status response`);
        return;
    }
    
    if (current.status === 'connected') {
        return;
    }
    
    const fallback = providers.find(p => p.status === 'connected');
    let message = `⚠️ ${current.name} is unavailable`;
    if (current.error) message += `\n${current.error}`;
    if (fallback) message += `\n💡 Switch to ${fallback.name} to continue.`;
    
    log.warn(`Provider ${currentProvider} unavailable`, { fallback: fallback?.name });
    showToast(message, 'error');
}

// === Model Management ===
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
        } else {
            log.warn(`No models available from ${currentProvider}`);
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
    
    // Restore previously selected model if available
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
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // === SIZE ===
        if (data.details && data.details.size) {
            const sizeGB = (data.details.size / 1024 / 1024 / 1024).toFixed(2);
            modelSizeEl.textContent = `${sizeGB} GB`;
        } else {
            const model = allModels.find(m => m.name === currentModel);
            if (model && model.size) {
                const sizeGB = (model.size / 1024 / 1024 / 1024).toFixed(2);
                modelSizeEl.textContent = `${sizeGB} GB`;
            } else {
                modelSizeEl.textContent = '-';
            }
        }
        
        // === CONTEXT ===
        let contextLength = extractContextLength(data);
        
        if (!contextLength && data.parameters && data.parameters.context_length) {
            contextLength = data.parameters.context_length;
        }
        
        if (!contextLength && data.model_info && data.model_info.context_length) {
            contextLength = data.model_info.context_length;
        }
        
        if (!contextLength) {
            const model = allModels.find(m => m.name === currentModel);
            if (model && model.contextLength) {
                contextLength = model.contextLength;
            }
        }
        
        modelContextEl.textContent = contextLength ? contextLength : '-';
        currentContextLength = contextLength || null;
        log.debug('Model info updated', { size: modelSizeEl.textContent, ctx: modelContextEl.textContent });
        
    } catch (error) {
        log.error('Error loading model info', error);
        modelSizeEl.textContent = '-';
        modelContextEl.textContent = '-';
        currentContextLength = null;
    }
}

// === Chat Functionality ===
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    if (!currentModel) {
        showToast('Please select a model first', 'error');
        return;
    }
    
    input.value = '';
    const questionId = addQuestion(message, currentModel);
    
    const formData = new FormData();
    formData.append('message', message);
    formData.append('model', currentModel);
    if (currentSessionId) {
        formData.append('sessionId', currentSessionId);
    }
    if (currentContextLength) {
        formData.append('contextLength', currentContextLength);
    }
    
    if (uploadedFile) {
        formData.append('file', uploadedFile);
    }
    
    uploadedCodeFiles.forEach((file) => {
        formData.append('codeFiles', file);
    });
    
    try {
        log.info(`Sending message to ${currentProvider}/${currentModel}`);
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
        updateStats(data.metrics);
        log.info(`Response received from ${currentModel}`, { metrics: data.metrics });
        
    } catch (error) {
        log.error('Network error sending message', error);
        addBotMessage(
            `❌ **Network error**\n\n${error.message}\n\nPlease check your connection and try again.`,
            currentModel, null, null, questionId
        );
    }
    
    uploadedFile = null;
    uploadedCodeFiles = [];
    document.getElementById('filePreview').classList.remove('active');
}

function addQuestion(message, model) {
    questionCounter++;
    const questionId = `q_${questionCounter}_${Date.now()}`;
    
    questions.push({ 
        id: questionId,
        text: message, 
        model: model,
        number: questionCounter
    });
    updateQuestionsList();
    
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.dataset.questionId = questionId;
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-header">
                <div class="message-model">
                    Q${questionCounter} • You • ${model}
                </div>
                <div class="message-nav-buttons">
                    <button class="nav-btn prev-btn" onclick="jumpToPreviousQuestion('${questionId}')" title="Jump to previous question">
                        ↑ Prev
                    </button>
                    <button class="nav-btn next-btn" onclick="jumpToNextQuestion('${questionId}')" title="Jump to next question">
                        Next ↓
                    </button>
                </div>
            </div>
            <div class="message-text">${escapeHtml(message)}</div>
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyQuestion('${questionId}')">📋 Copy Question</button>
                <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
            </div>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    currentConversation.push({ 
        role: 'user', 
        content: message,
        questionId: questionId,
        model: model
    });
    saveCurrentConversation();
    
    return questionId;
}

function addBotMessage(message, model, metrics = null, imageData = null, questionId = null) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    messageDiv.dataset.questionId = questionId;
    
    let imageHtml = '';
    if (imageData) {
        imageHtml = `
            <div class="image-preview-container">
                <img src="${imageData.thumbnailUrl}" class="image-preview" onclick="showFullImage('${imageData.fullUrl}')">
                <div class="image-filename">${imageData.filename}</div>
            </div>
        `;
    }
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-header">
                <div class="message-model">
                    🤖 ${model}
                </div>
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
    
    currentConversation.push({ 
        role: 'assistant', 
        content: message, 
        model: model,
        questionId: questionId
    });
    saveCurrentConversation();
}

// === Question Navigation ===
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
    const messages = chatMessages.querySelectorAll(`.user-message[data-question-id="${questionId}"]`);
    
    if (messages.length > 0) {
        messages[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
        highlightMessage(messages[0]);
    }
}

function highlightMessage(element) {
    element.style.transition = 'background-color 0.3s';
    element.style.backgroundColor = '#fff3cd';
    setTimeout(() => {
        element.style.backgroundColor = '';
    }, 2000);
}

// === Copy Functions ===
function copyQuestion(questionId) {
    const question = questions.find(q => q.id === questionId);
    if (!question) {
        showToast('Question not found', 'error');
        return;
    }
    
    navigator.clipboard.writeText(question.text).then(() => {
        showToast('Question copied!', 'success');
    }).catch(err => {
        log.error('Failed to copy question', err);
        showToast('Failed to copy', 'error');
    });
}

function copyQAPair(questionId) {
    const question = questions.find(q => q.id === questionId);
    const answer = currentConversation.find(m => m.role === 'assistant' && m.questionId === questionId);
    
    if (!question || !answer) {
        showToast('Q&A pair not found', 'error');
        return;
    }
    
    const qaMarkdown = `## Question\n\n${question.text}\n\n## Answer\n\n${answer.content}`;
    
    navigator.clipboard.writeText(qaMarkdown).then(() => {
        showToast('Q&A copied as Markdown!', 'success');
    }).catch(err => {
        log.error('Failed to copy Q&A', err);
        showToast('Failed to copy', 'error');
    });
}

// === Delete Functions ===
function deleteQAPair(questionId) {
    if (!confirm('Delete this question and answer?')) return;
    
    const chatMessages = document.getElementById('chatMessages');
    
    const userMsg = chatMessages.querySelector(`.user-message[data-question-id="${questionId}"]`);
    const botMsg = chatMessages.querySelector(`.bot-message[data-question-id="${questionId}"]`);
    
    if (userMsg) userMsg.remove();
    if (botMsg) botMsg.remove();
    
    questions = questions.filter(q => q.id !== questionId);
    currentConversation = currentConversation.filter(msg => msg.questionId !== questionId);
    
    // Renumber questions
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
    saveCurrentConversation();
    
    showToast('Q&A pair deleted', 'success');
}

// === Utility Functions ===
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    return text
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

function updateStats(metrics) {
    if (!metrics) return;
    
    document.getElementById('tps').textContent = metrics.tps ? `${metrics.tps} tok/s` : '-';
    document.getElementById('promptSpeed').textContent = metrics.promptTps ? `${metrics.promptTps} tok/s` : '-';
    document.getElementById('ttft').textContent = metrics.ttft ? `${metrics.ttft}s` : '-';
    document.getElementById('loadTime').textContent = metrics.loadTime ? `${metrics.loadTime}s` : '-';
    document.getElementById('totalTime').textContent = metrics.totalTime ? `${metrics.totalTime}s` : '-';
    
    const inputTokens = metrics.inputTokens || 0;
    const outputTokens = metrics.outputTokens || 0;
    document.getElementById('inputTokens').textContent = `~${inputTokens}`;
    document.getElementById('outputTokens').textContent = `~${outputTokens}`;
}

function updateQuestionsList() {
    const questionsList = document.getElementById('questionsList');
    document.getElementById('questionCount').textContent = questions.length;
    
    if (questions.length === 0) {
        questionsList.innerHTML = '<div style="color: #999; font-size: 0.9em; text-align: center; padding: 20px;">No questions yet</div>';
        return;
    }
    
    questionsList.innerHTML = questions.map((q) => `
        <div class="question-item" onclick="jumpToQuestion('${q.id}')">
            <div class="question-number">Q${q.number} • ${q.model}</div>
            <div class="question-text">${escapeHtml(q.text)}</div>
        </div>
    `).join('');
}

// === File Handling ===
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
    uploadedCodeFiles = [...uploadedCodeFiles, ...files];
    showFilePreview(`${uploadedCodeFiles.length} code file(s)`, files.reduce((sum, f) => sum + f.size, 0));
}

function showFilePreview(name, size) {
    const preview = document.getElementById('filePreview');
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    preview.innerHTML = `📎 ${name} (${sizeMB} MB)`;
    preview.classList.add('active');
}

// === Conversation Management ===
function saveCurrentConversation() {
    localStorage.setItem('currentConversation', JSON.stringify(currentConversation));
    localStorage.setItem('currentQuestions', JSON.stringify(questions));
    localStorage.setItem('questionCounter', questionCounter.toString());
    localStorage.setItem('currentModel', currentModel || '');
    localStorage.setItem('currentProvider', currentProvider || 'ollama');
    localStorage.setItem('currentSessionId', currentSessionId || '');
}

function renderMessage(msg) {
    const chatMessages = document.getElementById('chatMessages');
    
    if (msg.role === 'user') {
        const q = questions.find(q => q.id === msg.questionId);
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        messageDiv.dataset.questionId = msg.questionId;
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <div class="message-model">
                        Q${q ? q.number : '?'} • You • ${msg.model || 'unknown'}
                    </div>
                    <div class="message-nav-buttons">
                        <button class="nav-btn prev-btn" onclick="jumpToPreviousQuestion('${msg.questionId}')" title="Jump to previous question">↑ Prev</button>
                        <button class="nav-btn next-btn" onclick="jumpToNextQuestion('${msg.questionId}')" title="Jump to next question">Next ↓</button>
                    </div>
                </div>
                <div class="message-text">${escapeHtml(msg.content)}</div>
                <div class="message-actions">
                    <button class="message-action-btn" onclick="copyQuestion('${msg.questionId}')">📋 Copy Question</button>
                    <button class="message-action-btn" onclick="deleteQAPair('${msg.questionId}')">🗑️ Delete</button>
                </div>
            </div>
        `;
        chatMessages.appendChild(messageDiv);
    } else {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot-message';
        messageDiv.dataset.questionId = msg.questionId;
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <div class="message-model">🤖 ${msg.model || 'unknown'}</div>
                </div>
                <div class="message-text">${formatMarkdown(msg.content)}</div>
                <div class="message-actions">
                    <button class="message-action-btn" onclick="jumpToQuestion('${msg.questionId}')">🔼 Question</button>
                    <button class="message-action-btn" onclick="copyQAPair('${msg.questionId}')">📋 Copy Q&A</button>
                    <button class="message-action-btn" onclick="deleteQAPair('${msg.questionId}')">🗑️ Delete</button>
                </div>
            </div>
        `;
        chatMessages.appendChild(messageDiv);
    }
}

function loadCurrentConversation() {
    const saved = localStorage.getItem('currentConversation');
    if (!saved) return;
    
    currentConversation = JSON.parse(saved);
    questions = JSON.parse(localStorage.getItem('currentQuestions') || '[]');
    questionCounter = parseInt(localStorage.getItem('questionCounter') || '0');
    
    const savedModel = localStorage.getItem('currentModel');
    const savedProvider = localStorage.getItem('currentProvider') || 'ollama';
    if (savedModel) {
        currentModel = savedModel;
        currentProvider = savedProvider;
    }
    
    const savedSessionId = localStorage.getItem('currentSessionId');
    if (savedSessionId && !currentSessionId) {
        currentSessionId = savedSessionId;
    }
    
    updateQuestionsList();
    
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    
    currentConversation.forEach(msg => renderMessage(msg));
    
    log.info(`Restored conversation from localStorage: ${currentConversation.length} messages, ${questions.length} questions`);
}

async function rebuildSession() {
    if (!currentSessionId || currentConversation.length === 0) return;
    try {
        await fetch('/api/chat/seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId, messages: currentConversation })
        });
        log.info(`Rebuilt session with ${currentConversation.length} messages`);
    } catch (error) {
        log.error('Failed to rebuild session', error);
    }
}

async function clearChat() {
    if (!confirm('Clear current chat?')) return;
    
    currentConversation = [];
    questions = [];
    questionCounter = 0;
    
    if (currentSessionId) {
        try {
            const response = await fetch('/api/chat/session', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: currentSessionId })
            });
        } catch (error) {
            log.error('Failed to clear session', error);
        }
    }
    
    localStorage.removeItem('sessionId');
    localStorage.removeItem('currentSessionId');
    currentSessionId = null;
    
    try {
        const sessionResponse = await fetch('/api/chat/session', { method: 'POST' });
        const sessionData = await sessionResponse.json();
        currentSessionId = sessionData.sessionId;
        localStorage.setItem('sessionId', currentSessionId);
    } catch (error) {
        log.error('Failed to create new session after clear', error);
    }
    
    saveCurrentConversation();
    
    document.getElementById('chatMessages').innerHTML = `
        <div class="message bot-message">
            <div class="message-content">
                <div class="message-header">
                    <div class="message-model">🤖 AI Chat</div>
                </div>
                <div class="message-text">Chat cleared. Start a new conversation!</div>
            </div>
        </div>
    `;
    
    updateQuestionsList();
    log.info('Chat cleared');
}

// === Modal Functions ===
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

function saveConversation() {
    document.getElementById('saveModal').classList.add('active');
}

function closeSaveModal() {
    document.getElementById('saveModal').classList.remove('active');
}

function confirmSave() {
    const name = document.getElementById('conversationName').value;
    const category = document.getElementById('conversationCategory').value;
    
    if (!name) {
        showToast('Please enter a conversation name', 'error');
        return;
    }
    
    const saved = JSON.parse(localStorage.getItem('savedConversations') || '[]');
    saved.push({
        name,
        category: category || 'General',
        conversation: currentConversation,
        questions: questions,
        questionCounter: questionCounter,
        sessionId: currentSessionId || '',
        timestamp: Date.now()
    });
    localStorage.setItem('savedConversations', JSON.stringify(saved));
    
    showToast('Conversation saved!', 'success');
    closeSaveModal();
    log.info(`Conversation saved: ${name}`);
}

function showLoadModal() {
    const saved = JSON.parse(localStorage.getItem('savedConversations') || '[]');
    const list = document.getElementById('savedConversationsList');
    
    if (saved.length === 0) {
        list.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">No saved conversations</div>';
    } else {
        list.innerHTML = saved.map((conv, index) => `
            <div class="dropdown-item" onclick="loadConversation(${index})">
                <strong>${conv.name}</strong><br>
                <small>${conv.category} • ${new Date(conv.timestamp).toLocaleDateString()}</small>
            </div>
        `).join('');
    }
    
    document.getElementById('loadModal').classList.add('active');
}

function closeLoadModal() {
    document.getElementById('loadModal').classList.remove('active');
}

function loadConversation(index) {
    const saved = JSON.parse(localStorage.getItem('savedConversations') || '[]');
    const conv = saved[index];
    if (!conv) return;
    
    currentConversation = conv.conversation || [];
    questions = conv.questions || [];
    questionCounter = conv.questionCounter !== undefined ? conv.questionCounter : questions.length;
    currentSessionId = conv.sessionId || null;

    log.info(`Loading conversation "${conv.name}": ${currentConversation.length} messages, ${questions.length} questions, sessionId: ${currentSessionId ? currentSessionId.slice(0, 8) : 'none'}`);
    
    localStorage.setItem('currentConversation', JSON.stringify(currentConversation));
    localStorage.setItem('currentQuestions', JSON.stringify(questions));
    localStorage.setItem('questionCounter', questionCounter.toString());
    if (currentSessionId) {
        localStorage.setItem('sessionId', currentSessionId);
        localStorage.setItem('currentSessionId', currentSessionId);
    }
    
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    
    currentConversation.forEach(msg => renderMessage(msg));
    
    rebuildSession();
    
    updateQuestionsList();
    closeLoadModal();
    showToast('Conversation loaded!', 'success');
    log.info(`Conversation loaded: ${conv.name}`);
}

function returnToCurrent() {
    loadCurrentConversation();
    showToast('Returned to current conversation', 'success');
}

function exportConversation() {
    const data = JSON.stringify(currentConversation, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log.info('Conversation exported');
}

function toggleDropdown() {
    document.getElementById('dropdownMenu').classList.toggle('show');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function setupEventListeners() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.getElementById('dropdownMenu').classList.remove('show');
        }
    });
    
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    document.getElementById('multilineInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            sendMultilineMessage();
        }
    });
}