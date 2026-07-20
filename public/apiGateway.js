// public/apiGateway.js
// API Gateway — единая точка входа для всех backend вызовов
// Реализует API Gateway pattern для инкапсуляции сетевой логики

const apiLog = window.logger || console;

// ============================================================
// === Базовый HTTP клиент ===
// ============================================================

class ApiError extends Error {
    constructor(status, message, details = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
    }
}

async function request(method, path, options = {}) {
    const { body, headers = {}, provider } = options;

    // Формируем headers
    const fetchHeaders = { ...headers };
    
    // Content-Type для JSON body (не для FormData)
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
        fetchHeaders['Content-Type'] = 'application/json';
    }
    
    // X-Provider header для провайдер-зависимых эндпоинтов
    if (provider) {
        fetchHeaders['X-Provider'] = provider;
    }

    // Формируем body
    let requestBody = undefined;
    if (body instanceof FormData) {
        requestBody = body;
    } else if (body !== undefined) {
        requestBody = JSON.stringify(body);
    }

    try {
        const response = await fetch(path, {
            method,
            headers: fetchHeaders,
            body: requestBody
        });

        // Обработка HTTP ошибок
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
            
            apiLog.error(`API ${method} ${path} failed`, {
                status: response.status,
                error: errorMessage
            });
            
            throw new ApiError(response.status, errorMessage, errorData);
        }

        // Пустой ответ (например, DELETE)
        if (response.status === 204) {
            return null;
        }

        return await response.json();
    } catch (error) {
        // Network error (не HTTP ошибка)
        if (error instanceof ApiError) {
            throw error;
        }
        
        apiLog.error(`Network error: ${method} ${path}`, error);
        throw new ApiError(0, `Network error: ${error.message}`, error);
    }
}

// ============================================================
// === Sessions API ===
// ============================================================

const sessionsApi = {
    /**
     * Получить список всех сессий
     * @param {Object} options - { mode, limit, offset, search }
     */
    list(options = {}) {
        const params = new URLSearchParams();
        if (options.mode) params.append('mode', options.mode);
        if (options.limit) params.append('limit', options.limit);
        if (options.offset) params.append('offset', options.offset);
        if (options.search) params.append('search', options.search);
        
        const queryString = params.toString();
        return request('GET', `/api/sessions${queryString ? '?' + queryString : ''}`);
    },

    /**
     * Получить метаданные сессии
     * @param {string} id - UUID сессии
     */
    get(id) {
        return request('GET', `/api/sessions/${id}`);
    },

    /**
     * Получить историю сообщений сессии
     * @param {string} id - UUID сессии
     */
    getMessages(id) {
        return request('GET', `/api/sessions/${id}/messages`);
    },

    /**
     * Получить Q&A пары сессии (для ручного режима контекста)
     * @param {string} id - UUID сессии
     */
    getQAPairs(id) {
        return request('GET', `/api/sessions/${id}/qa-pairs`);
    },

    /**
     * Получить конфигурацию контекста сессии
     * @param {string} id - UUID сессии
     */
    getContextConfig(id) {
        return request('GET', `/api/sessions/${id}/context-config`);
    },

    /**
     * Обновить конфигурацию контекста сессии
     * @param {string} id - UUID сессии
     * @param {Object} config - { mode, trimPercent, manualInclude }
     */
    updateContextConfig(id, config) {
        return request('PATCH', `/api/sessions/${id}/context-config`, { body: config });
    },

    /**
     * Создать новую сессию
     * @param {string} title - название (опционально)
     * @param {string} mode - 'chat' | 'project'
     * @param {string} projectId - UUID проекта (для project mode)
     */
    create(title = null, mode = 'chat', projectId = null) {
        const body = {};
        if (title) body.title = title;
        if (mode) body.mode = mode;
        if (projectId) body.project_id = projectId;
        
        return request('POST', '/api/sessions', { body });
    },

    /**
     * Обновить метаданные сессии
     * @param {string} id - UUID сессии
     * @param {Object} updates - { title, category, model, provider }
     */
    update(id, updates) {
        return request('PATCH', `/api/sessions/${id}`, { body: updates });
    },

    /**
     * Удалить сессию (каскадно удаляет сообщения и attachments)
     * @param {string} id - UUID сессии
     */
    delete(id) {
        return request('DELETE', `/api/sessions/${id}`);
    },

    /**
     * Удалить Q&A pair из сессии
     * @param {string} sessionId - UUID сессии
     * @param {string} questionId - ID вопроса (q_1_1234567890)
     */
    deleteQAPair(sessionId, questionId) {
        return request('DELETE', `/api/sessions/${sessionId}/messages/${questionId}`);
    }
};

// ============================================================
// === Attachments API ===
// ============================================================

const attachmentsApi = {
    /**
     * Извлечь текст из файлов по путям
     * @param {string[]} paths - массив абсолютных путей к файлам
     * @param {string} sessionId - UUID сессии
     * @returns {{ results: Array, errors: Array }}
     */
    extract(paths, sessionId) {
        return request('POST', '/api/attachments/extract', {
            body: { paths, sessionId }
        });
    },

    /**
     * Получить извлечённый текст файла
     * @param {string} fileId - UUID файла
     */
    get(fileId) {
        return request('GET', `/api/attachments/${fileId}`);
    }
};

// ============================================================
// === Chat API ===
// ============================================================

const chatApi = {
    /**
     * Отправить сообщение в чат
     * @param {Object} data - { sessionId, message, model, attachments, questionId, contextLength, retainPercent }
     * @param {string} provider - 'ollama' | 'llama.cpp'
     */
    send(data, provider) {
        return request('POST', '/api/chat', {
            body: data,
            provider
        });
    }
};

// ============================================================
// === Models API ===
// ============================================================

const modelsApi = {
    /**
     * Получить список моделей от провайдера
     * @param {string} provider - 'ollama' | 'llama.cpp'
     */
    list(provider) {
        return request('GET', '/api/models', { provider });
    },

    /**
     * Получить детальную информацию о модели
     * @param {string} name - название модели
     * @param {string} provider - 'ollama' | 'llama.cpp'
     */
    show(name, provider) {
        return request('POST', '/api/show', {
            body: { name },
            provider
        });
    }
};

// ============================================================
// === Providers API ===
// ============================================================

const providersApi = {
    /**
     * Получить список всех провайдеров
     */
    list() {
        return request('GET', '/api/providers');
    },

    /**
     * Получить статус всех провайдеров
     */
    status() {
        return request('GET', '/api/providers/status');
    }
};

// ============================================================
// === Экспорт для использования в других модулях ===
// ============================================================


// Для использования через <script> тег (не ES modules)
if (typeof window !== 'undefined') {
    window.apiGateway = {
        sessions: sessionsApi,
        attachments: attachmentsApi,
        chat: chatApi,
        models: modelsApi,
        providers: providersApi,
        ApiError
    };
}
