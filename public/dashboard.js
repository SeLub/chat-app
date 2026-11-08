// public/dashboard.js
// Dashboard logic with API Gateway

const dashLog = window.logger || console;

let selectedSessions = new Set();
let allSessions = [];
let sessionToDelete = null;

// === Initialize ===
window.addEventListener('DOMContentLoaded', async () => {
    dashLog.info('Dashboard initializing');
    await loadDashboard();
    setupEventListeners();
});

// === Dashboard Loading ===

async function loadDashboard() {
    const container = document.getElementById('conversationsContainer');
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">Loading conversations...</div>';

    try {
        allSessions = await window.apiGateway.sessions.list();
        renderDashboard(allSessions);
        updateStats();
        dashLog.info(`Loaded ${allSessions.length} sessions`);
    } catch (error) {
        dashLog.error('Failed to load dashboard', error);
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44;">Failed to load conversations</div>';
    }
}

function renderDashboard(sessions) {
    const container = document.getElementById('conversationsContainer');

    if (sessions.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">No conversations found</div>';
        return;
    }

    const grouped = {};
    sessions.forEach(s => {
        const category = s.category || 'General';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(s);
    });

    let html = '';
    for (const [category, categorySessions] of Object.entries(grouped)) {
        const categoryCount = categorySessions.length;
        const categoryMessages = categorySessions.reduce((sum, s) => sum + (s.message_count || 0), 0);

        html += `
            <div class="category-section">
                <div class="category-header" onclick="toggleCategory('${escapeHtml(category)}')">
                    <div class="category-info">
                        <span class="category-icon">📂</span>
                        <span class="category-name">${escapeHtml(category)}</span>
                        <span class="category-count">${categoryCount} conversations • ${categoryMessages} messages</span>
                    </div>
                    <span class="category-toggle">▼</span>
                </div>
                <div class="category-content" id="category-${escapeHtml(category)}">
                    <div class="conversation-grid">
                        ${categorySessions.map(session => renderSessionCard(session)).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderSessionCard(session) {
    const isSelected = selectedSessions.has(session.id);
    const isUnsaved = session.title && session.title.startsWith('unsavedSession');

    return `
        <div class="conversation-card ${isSelected ? 'selected' : ''}" data-session-id="${session.id}">
            <div class="card-checkbox">
                <input type="checkbox" 
                       ${isSelected ? 'checked' : ''} 
                       onchange="toggleSessionSelection('${session.id}')">
            </div>
            <div class="card-content" onclick="openConversation('${session.id}')">
                <div class="card-title">
                    ${isUnsaved ? '📝 ' : ''}${escapeHtml(session.title || 'Untitled')}
                </div>
                <div class="card-meta">
                    <span>${session.message_count || 0} messages</span>
                    <span>${new Date(session.updated_at).toLocaleDateString()}</span>
                </div>
                ${session.model ? `<div class="card-model">🤖 ${escapeHtml(session.model)}</div>` : ''}
            </div>
            <div class="card-actions">
                <button class="card-action-btn" onclick="event.stopPropagation(); renameConversation('${session.id}', '${escapeHtml(session.title || '')}')" title="Rename">️</button>
                <button class="card-action-btn" onclick="event.stopPropagation(); exportSingleConversation('${session.id}')" title="Export">📤</button>
                <button class="card-action-btn delete-btn" onclick="event.stopPropagation(); confirmDeleteConversation('${session.id}')" title="Delete">🗑️</button>
            </div>
        </div>
    `;
}

function updateStats() {
    const totalConversations = allSessions.length;
    const totalMessages = allSessions.reduce((sum, s) => sum + (s.message_count || 0), 0);
    const selectedCount = selectedSessions.size;

    document.getElementById('totalConversations').textContent = totalConversations;
    document.getElementById('totalMessages').textContent = totalMessages;
    document.getElementById('selectedCount').textContent = selectedCount;
}

// === Category Management ===

function toggleCategory(category) {
    const content = document.getElementById(`category-${category}`);
    const header = content.previousElementSibling;
    const toggle = header.querySelector('.category-toggle');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.textContent = '▼';
    } else {
        content.style.display = 'none';
        toggle.textContent = '▶';
    }
}

// === Selection Management ===

function toggleSessionSelection(sessionId) {
    if (selectedSessions.has(sessionId)) {
        selectedSessions.delete(sessionId);
    } else {
        selectedSessions.add(sessionId);
    }

    const card = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (card) {
        card.classList.toggle('selected');
    }

    updateStats();
    updateBulkActions();
}

function clearSelection() {
    selectedSessions.clear();
    document.querySelectorAll('.conversation-card.selected').forEach(card => {
        card.classList.remove('selected');
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = false;
    });
    updateStats();
    updateBulkActions();
}

function updateBulkActions() {
    const bulkActions = document.getElementById('bulkActions');
    if (bulkActions) {
        bulkActions.style.display = selectedSessions.size > 0 ? 'flex' : 'none';
    }
}

// === Conversation Actions ===

function openConversation(sessionId) {
    window.location.href = `/?session=${sessionId}`;
}

async function renameConversation(sessionId, currentTitle) {
    const newTitle = prompt('Enter new name:', currentTitle);
    if (!newTitle || newTitle === currentTitle) return;

    try {
        await window.apiGateway.sessions.update(sessionId, { title: newTitle });
        showToast('Conversation renamed', 'success');
        await loadDashboard();
    } catch (error) {
        dashLog.error('Failed to rename conversation', error);
        showToast('Failed to rename', 'error');
    }
}

async function exportSingleConversation(sessionId) {
    try {
        const messages = await window.apiGateway.sessions.getMessages(sessionId);
        const data = JSON.stringify(messages, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${sessionId.slice(0, 8)}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Conversation exported', 'success');
    } catch (error) {
        dashLog.error('Failed to export conversation', error);
        showToast('Failed to export', 'error');
    }
}

function confirmDeleteConversation(sessionId) {
    sessionToDelete = sessionId;
    document.getElementById('confirmDeleteModal').classList.add('active');
}

function closeConfirmDeleteModal() {
    document.getElementById('confirmDeleteModal').classList.remove('active');
    sessionToDelete = null;
}

async function executeDelete() {
    if (!sessionToDelete) return;

    try {
        await window.apiGateway.sessions.delete(sessionToDelete);
        showToast('Conversation deleted', 'success');
        selectedSessions.delete(sessionToDelete);
        closeConfirmDeleteModal();
        await loadDashboard();
    } catch (error) {
        dashLog.error('Failed to delete conversation', error);
        showToast('Failed to delete', 'error');
        closeConfirmDeleteModal();
    }
}

// === Bulk Actions ===

async function exportSelected() {
    if (selectedSessions.size === 0) {
        showToast('No conversations selected', 'error');
        return;
    }

    try {
        const allMessages = [];
        for (const sessionId of selectedSessions) {
            const messages = await window.apiGateway.sessions.getMessages(sessionId);
            allMessages.push({ sessionId, messages });
        }

        const data = JSON.stringify(allMessages, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversations-bulk-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`${selectedSessions.size} conversation(s) exported`, 'success');
    } catch (error) {
        dashLog.error('Failed to export selected', error);
        showToast('Failed to export', 'error');
    }
}

async function deleteSelected() {
    if (selectedSessions.size === 0) {
        showToast('No conversations selected', 'error');
        return;
    }

    if (!confirm(`Delete ${selectedSessions.size} conversation(s)? This cannot be undone.`)) return;

    try {
        const count = selectedSessions.size;
        for (const sessionId of selectedSessions) {
            await window.apiGateway.sessions.delete(sessionId);
        }
        selectedSessions.clear();
        showToast(`${count} conversation(s) deleted`, 'success');
        await loadDashboard();
    } catch (error) {
        dashLog.error('Failed to delete selected', error);
        showToast('Failed to delete', 'error');
    }
}

// === Search ===

async function searchConversations(query) {
    try {
        const sessions = await window.apiGateway.sessions.list({ search: query });
        renderDashboard(sessions);
    } catch (error) {
        dashLog.error('Failed to search conversations', error);
        showToast('Search failed', 'error');
    }
}

// === Utility Functions ===

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchConversations(e.target.value);
            }, 300);
        });
    }

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadDashboard();
            showToast('Dashboard refreshed', 'success');
        });
    }

    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', clearSelection);
    }

    const exportSelectedBtn = document.getElementById('exportSelectedBtn');
    if (exportSelectedBtn) {
        exportSelectedBtn.addEventListener('click', exportSelected);
    }

    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', deleteSelected);
    }

    document.addEventListener('click', (e) => {
        const modal = document.getElementById('confirmDeleteModal');
        if (e.target === modal) {
            closeConfirmDeleteModal();
        }
    });
}