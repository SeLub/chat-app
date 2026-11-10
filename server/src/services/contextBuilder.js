// src/services/contextBuilder.js
import { getDb } from '../db/init.js';

// ============================================================
// === cutContext — чистая математика обрезки Q&A истории ===
// ============================================================
/**
 * Обрезает историю Q&A пар.
 * @param {Array} qaHistory - массив сообщений из БД (только user и assistant)
 * @param {number} targetChars - доступный бюджет в символах для истории
 * @param {string[]|null} includeQuestionIds - массив ID для Manual режима (null = все)
 * @returns {{ truncatedHistory: Array, info: Object }}
 */
export function cutContext(qaHistory, targetChars, includeQuestionIds = null) {
    // 1. Группируем сообщения в пары с помощью Map (ключ = questionId)
    const qaMap = new Map();
    
    for (const msg of qaHistory) {
        if (msg.role === 'user' && msg.question_id) {
            qaMap.set(msg.question_id, {
                question: msg,
                answer: null,
                totalChars: msg.content.length,
                questionId: msg.question_id,
                sortOrder: msg.sort_order
            });
        } else if (msg.role === 'assistant' && msg.question_id) {
            const pair = qaMap.get(msg.question_id);
            if (pair) {
                pair.answer = msg;
                pair.totalChars += msg.content.length;
            }
        }
    }

    // Преобразуем Map в массив и сортируем по порядку (sortOrder)
    let qaPairs = Array.from(qaMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    const totalQAPairs = qaPairs.length;

    // 2. Фильтрация для Manual режима
    // TZ-A.7: Array.isArray различает null (не задано → все пары) и [] (задано пустым
    // в Manual-режиме → 0 пар, только system prompt + новый вопрос).
    // Проверка length > 0 здесь ошибочна: пустой массив — валидное значение «ничего не включать».
    let filteredPairs = qaPairs;
    if (Array.isArray(includeQuestionIds)) {
        filteredPairs = qaPairs.filter(pair => includeQuestionIds.includes(pair.questionId));
    }

    // 3. LIFO обрезка (идём с конца, от новых к старым)
    const selected = [];
    let currentSum = 0;
    
    for (let i = filteredPairs.length - 1; i >= 0; i--) {
        const pair = filteredPairs[i];
        if (currentSum + pair.totalChars <= targetChars) {
            selected.unshift(pair); // Добавляем в начало, чтобы сохранить хронологический порядок
            currentSum += pair.totalChars
        } else {
            break; // Строгий LIFO: если текущая не влезает, старые тем более
        }
    }

    // 4. Собираем итоговый плоский массив сообщений для LLM
    const truncatedHistory = [];
    for (const pair of selected) {
        truncatedHistory.push(pair.question);
        if (pair.answer) {
            truncatedHistory.push(pair.answer);
        }
    }

    // 5. Вычисляем excludedIndices (1-based номера вопросов, которых НЕТ в selected)
    // Мы смотрим на исходный массив qaPairs, чтобы нумерация Q1, Q2... была сквозной
    const excludedIndices = [];
    for (let i = 0; i < qaPairs.length; i++) {
        if (!selected.includes(qaPairs[i])) {
            excludedIndices.push(i + 1);
        }
    }
    excludedIndices.sort((a, b) => a - b);

    return {
        truncatedHistory,
        info: {
            targetChars,
            actualHistoryChars: currentSum,
            totalQAPairs,
            includedQAPairs: selected.length,
            removedQAPairs: filteredPairs.length - selected.length,
            removedChars: filteredPairs.reduce((sum, p) => sum + p.totalChars, 0) - currentSum,
            excludedIndices
        }
    };
}

// ============================================================
// === Build LLM Context (основная функция) ===
// ============================================================
/**
 * Строит контекст для LLM из истории сессии.
 * @param {string} sessionId
 * @param {Array}  currentAttachments - файлы, прикреплённые к текущему сообщению
 * @param {number} contextSize        - контекст модели в токенах (например, 65536)
 * @param {number} retainPercent      - % доступного бюджета для истории (0-100)
 * @returns {{ conversation: Array, contextSize: number, retainPercent: number, info: Object }}
 */
// ============================================================
// === Build LLM Context (основная функция) ===
// ============================================================
export async function buildLLMContext(sessionId, currentAttachments = [], contextSize = 65536, retainPercent = 80, includeQuestionIds = null) {
    const db = getDb();
    
    // 1. Получаем системный промпт
    const session = db.prepare('SELECT sysprompt FROM sessions WHERE id = ?').get(sessionId);
    const sysprompt = (session?.sysprompt && session.sysprompt.trim() !== '') 
        ? session.sysprompt.trim() 
        : "Ты — полезный и компетентный ИИ-ассистент. Отвечай четко, структурированно и по существу.";

    // 2. Получаем историю из БД (только user и assistant)
    const messages = db.prepare(
        'SELECT role, content, attachments_meta, question_id, sort_order FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);

    // 3. Собираем файлы
    const allFileIds = new Set();
    for (const msg of messages) {
        const meta = JSON.parse(msg.attachments_meta || '[]');
        meta.forEach(m => { if (m.fileId) allFileIds.add(m.fileId); });
    }
    currentAttachments.forEach(a => { if (a.fileId) allFileIds.add(a.fileId); });

    let filesContext = '';
    if (allFileIds.size > 0) {
        const placeholders = [...allFileIds].map(() => '?').join(',');
        // Финальное ТЗ: изображения (kind='image', extracted_text='') НЕ инлайнсятся в LLM-контекст —
        // они идут в vision-модель отдельно. Пустые extracted_text тоже пропускаем.
        const rows = db.prepare(
            `SELECT id, filename, extracted_text FROM attachments WHERE id IN (${placeholders}) AND kind != 'image' AND extracted_text != ''`
        ).all(...[...allFileIds]);
        
        filesContext = 'The user has shared the following files:\n\n';
        for (const r of rows) {
            filesContext += `--- FILE: ${r.filename} ---\n${r.extracted_text}\n\n`;
        }
    }

    // 4. Расчёт бюджетов
    const fixedChars = sysprompt.length + filesContext.length;
    const maxChars = contextSize * 4;
    const availableChars = Math.max(maxChars - fixedChars, 0);
    const targetChars = Math.floor(availableChars * (retainPercent / 100));

    // 5. Вызываем чистую функцию обрезки истории
    const { truncatedHistory, info } = cutContext(messages, targetChars, includeQuestionIds);

    // 6. Собираем финальный контекст
    const finalConversation = [];
    finalConversation.push({ role: 'system', content: sysprompt });
    
    if (filesContext) {
        finalConversation.push({ role: 'system', content: filesContext });
    }
    
    // Добавляем обрезанную историю
    finalConversation.push(...truncatedHistory);

    // Примечание: Текущий вопрос (prompt) добавляется в chatController.js ПОСЛЕ этой функции!

    return {
        conversation: finalConversation,
        contextSize,
        retainPercent,
        info: {
            ...info,
            fixedChars,
            availableChars,
            targetChars
        }
    };
}

// ============================================================
// === Вспомогательные функции для ручного режима ===
// ============================================================

/**
 * Получить Q&A пары сессии для отображения в UI
 * @param {string} sessionId
 * @returns {Array} массив { questionId, questionText, answerText, questionChars, answerChars, totalChars, sortOrder, model, attachments_meta, metrics }
 */
export function getQAPairs(sessionId) {
    const db = getDb();
    // Финальное ТЗ: image_data демонтирован — единственный источник вложений это
    // attachments_meta (реестр attachments). Фронт строит imageData из kind='image' в meta.
    const messages = db.prepare(
        'SELECT role, content, question_id, sort_order, model, attachments_meta, metrics FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);

    const qaPairs = [];
    let currentQuestion = null;

    for (const msg of messages) {
        if (msg.role === 'user') {
            currentQuestion = {
                questionId: msg.question_id,
                questionText: msg.content,
                answerText: '',
                questionChars: msg.content.length,
                answerChars: 0,
                totalChars: msg.content.length,
                sortOrder: msg.sort_order,
                model: msg.model || 'unknown', // === ИЗМЕНЕНО: сохраняем модель вопроса ===
                attachments_meta: msg.attachments_meta || '[]'
            };
        } else if (msg.role === 'assistant' && currentQuestion) {
            currentQuestion.answerText = msg.content;
            currentQuestion.answerChars = msg.content.length;
            currentQuestion.totalChars = currentQuestion.questionChars + msg.content.length;
            // Если у ассистента есть модель, обновляем (на случай, если она отличается, но обычно она та же)
            if (msg.model) currentQuestion.model = msg.model;
            currentQuestion.metrics = msg.metrics || '{}';

            qaPairs.push(currentQuestion);
            currentQuestion = null;
        }
    }
    return qaPairs;
}

/**
 * Удалить Q&A пары из контекста (физически из БД)
 * @param {string} sessionId
 * @param {Array} questionIds - массив questionId для удаления
 * @returns {{ removedCount: number, removedChars: number }}
 */
export function removeQAPairs(sessionId, questionIds) {
    const db = getDb();
    if (!questionIds || questionIds.length === 0) {
        return { removedCount: 0, removedChars: 0 };
    }

    const placeholders = questionIds.map(() => '?').join(',');
    const messages = db.prepare(
        `SELECT content FROM messages WHERE session_id = ? AND question_id IN (${placeholders})`
    ).all(sessionId, ...questionIds);

    const removedChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    // Удаляем сообщения
    db.prepare(
        `DELETE FROM messages WHERE session_id = ? AND question_id IN (${placeholders})`
    ).run(sessionId, ...questionIds);

    // Пересчитываем sort_order
    db.prepare(
        `UPDATE messages SET sort_order = (
            SELECT COUNT(*) FROM messages m2
            WHERE m2.session_id = messages.session_id AND m2.sort_order < messages.sort_order
        ) WHERE session_id = ?`
    ).run(sessionId);

    // Обновляем message_count
    db.prepare(`
        UPDATE sessions
        SET message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?),
            updated_at = datetime('now')
        WHERE id = ?
    `).run(sessionId, sessionId);

    return { removedCount: questionIds.length, removedChars };
}

/**
 * Обновить конфигурацию контекста (для ручного режима)
 * @param {string} sessionId
 * @param {Object} config - { mode: 'standard'|'manual', retainPercent: number, manualInclude: string[] }
 * @returns {Object} updated config
 */
export function updateContextConfig(sessionId, config) {
    const db = getDb();
    // context_config создаётся при инициализации БД в initializeSchema()

    const mode = config.mode || 'standard';
    const retainPercent = Math.min(Math.max(config.retainPercent ?? 80, 10), 100);
    const manualInclude = config.manualInclude || [];

    db.prepare(`
        INSERT INTO context_config (session_id, mode, retain_percent, manual_include, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(session_id) DO UPDATE SET
            mode = excluded.mode,
            retain_percent = excluded.retain_percent,
            manual_include = excluded.manual_include,
            updated_at = datetime('now')
    `).run(sessionId, mode, retainPercent, JSON.stringify(manualInclude));

    return { mode, retainPercent, manualInclude };
}

/**
 * Получить конфигурацию контекста для сессии
 * @param {string} sessionId
 * @returns {Object} { mode, retainPercent, manualInclude }
 */
export function getContextConfig(sessionId) {
    const db = getDb();
    const config = db.prepare(
        'SELECT mode, retain_percent, manual_include FROM context_config WHERE session_id = ?'
    ).get(sessionId);
    if (!config) {
        return { mode: 'standard', retainPercent: 80, manualInclude: [] };
    }
    return {
        mode: config.mode || 'standard',
        retainPercent: config.retain_percent ?? 80,
        manualInclude: JSON.parse(config.manual_include || '[]')
    };
}
