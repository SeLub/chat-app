// src/services/contextBuilder.js
import { getDb } from '../db/init.js';

// ============================================================
// === cutContext — чистая математика обрезки Q&A истории ===
// ============================================================

/**
 * Обрезает историю Q&A пар до заданного процента от контекста модели.
 *
 * Логика (чистая математика, без предсказаний):
 *
 *   1. contextSize — контекст модели в токенах (например, 131072)
 *   2. fixedChars — всё, что НЕ обрезается:
 *        - системный промпт
 *        - извлечённый текст URL
 *        - извлечённый текст файлов/документов/кода
 *        - текст текущего вопроса
 *   3. availableChars = contextSize * 4 - fixedChars
 *   4. targetChars = availableChars * retainPercent / 100
 *   5. Берём Q&A пары с конца (новые), складываем, пока не упрёмся в targetChars
 *   6. Старые пары, которые не уложились — отбрасываются
 *
 * @param {Array} conversation   - полный массив сообщений [{role, content, questionId?}]
 * @param {number} contextSize   - контекст модели в токенах (например, 131072)
 * @param {number} retainPercent - сколько % от доступного бюджета оставить для истории (0-100)
 * @returns {{ conversation: Array, trimmed: boolean, info: Object }}
 */
export function cutContext(conversation, contextSize, retainPercent = 100) {
    // === Шаг 1: Разделяем неизменяемую часть и Q&A историю ===
    //
    // НЕИЗМЕНЯЕМАЯ ЧАСТЬ (fixedChars):
    //   - system-сообщения (системный промпт + file context)
    //   - последнее user-сообщение (текущий вопрос + URL + файлы)
    //
    // ИЗМЕНЯЕМАЯ ЧАСТЬ (Q&A история):
    //   - все user-сообщения кроме последнего
    //   - все assistant-сообщения

    let fixedChars = 0;
    const systemMessages = [];
    let lastUserIndex = -1;

    // Находим индекс последнего user-сообщения (текущий вопрос)
    for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].role === 'user') {
            lastUserIndex = i;
            break;
        }
    }

    // Считаем fixedChars и отделяем system-сообщения
    const qaMessages = [];  // Q&A история (подлежит обрезке)

    for (let i = 0; i < conversation.length; i++) {
        const msg = conversation[i];
        const chars = msg.content?.length || 0;

        if (msg.role === 'system') {
            // Системное сообщение = системный промпт или file context
            // Это НЕ обрезается
            fixedChars += chars;
            systemMessages.push(msg);
        } else if (i === lastUserIndex) {
            // Текущий вопрос пользователя — НЕ обрезается
            fixedChars += chars;
        } else if (msg.role === 'user' || msg.role === 'assistant') {
            // История Q&A — подлежит обрезке
            qaMessages.push({
                role: msg.role,
                content: msg.content,
                chars: chars,
                questionId: msg.questionId || null,
                index: i
            });
        }
    }

    // === Шаг 2: Группируем Q&A сообщения в пары (user + assistant) ===
    // Создаём Map: номер Q&A пары → { messages: [...], totalChars: N, questionId }
    const qaPairs = [];
    let currentPair = null;

    for (const msg of qaMessages) {
        if (msg.role === 'user') {
            currentPair = {
                messages: [msg],
                totalChars: msg.chars,
                questionId: msg.questionId,
                index: msg.index
            };
        } else if (msg.role === 'assistant' && currentPair) {
            currentPair.messages.push(msg);
            currentPair.totalChars += msg.chars;
            qaPairs.push(currentPair);
            currentPair = null;
        }
    }

    // Если есть незакрытый user (без ответа) — добавляем как отдельную пару
    if (currentPair) {
        qaPairs.push(currentPair);
    }

    // === Шаг 3: Чистая математика обрезки ===
    // contextSize в токенах → символы (умножаем на 4)
    const maxChars = contextSize * 4;

    // Доступный бюджет для истории (после вычета неизменяемой части)
    const availableChars = Math.max(maxChars - fixedChars, 0);

    // Целевой бюджет с учётом retainPercent
    const targetChars = Math.floor(availableChars * (retainPercent / 100));

    // Берём Q&A пары с конца (новые), пока не уложимся в targetChars
    const selected = [];
    let currentSum = 0;

    for (let i = qaPairs.length - 1; i >= 0; i--) {
        const pair = qaPairs[i];
        if (currentSum + pair.totalChars <= targetChars) {
            selected.unshift(pair);  // Добавляем в начало (хронологический порядок)
            currentSum += pair.totalChars;
        }
        // Если не укладывается — пропускаем (старые пары, которые обрезаются)
    }

    // === Шаг 4: Собираем результат ===
    const result = [];

    // 1. System-сообщения (неизменяемые)
    for (const msg of systemMessages) {
        result.push(msg);
    }

    // 2. Selected Q&A пары (история)
    for (const pair of selected) {
        for (const msg of pair.messages) {
            result.push(msg);
        }
    }

    // 3. Текущий вопрос (неизменяемый)
    if (lastUserIndex >= 0) {
        result.push(conversation[lastUserIndex]);
    }

    const trimmed = selected.length < qaPairs.length;
    const removedPairs = qaPairs.length - selected.length;
    const removedChars = qaPairs.reduce((sum, p) => sum + p.totalChars, 0) - currentSum;

    return {
        conversation: result,
        trimmed,
        info: {
            contextSize,
            maxChars,
            fixedChars,
            availableChars,
            targetChars,
            actualHistoryChars: currentSum,
            retainPercent,
            totalQAPairs: qaPairs.length,
            includedQAPairs: selected.length,
            removedQAPairs: removedPairs,
            removedChars
        }
    };
}

// ============================================================
// === Build LLM Context (основная функция) ===
// ============================================================

/**
 * Строит контекст для LLM из истории сессии.
 *
 * @param {string} sessionId
 * @param {Array}  currentAttachments - файлы, прикреплённые к текущему сообщению
 * @param {number} contextSize        - контекст модели в токенах (например, 131072)
 * @param {number} retainPercent      - % доступного бюджета для истории (0-100)
 * @returns {{ conversation: Array, contextSize: number, retainPercent: number, info: Object }}
 */
export async function buildLLMContext(sessionId, currentAttachments = [], contextSize = 131072, retainPercent = 100) {
    const db = getDb();

    // Загружаем сообщения из БД
    const messages = db.prepare(
        'SELECT role, content, attachments_meta, question_id FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);

    // Загружаем файлы
    const allFileIds = new Set();
    for (const msg of messages) {
        const meta = JSON.parse(msg.attachments_meta || '[]');
        meta.forEach(m => { if (m.fileId) allFileIds.add(m.fileId); });
    }
    currentAttachments.forEach(a => { if (a.fileId) allFileIds.add(a.fileId); });

    const fileContents = {};
    if (allFileIds.size > 0) {
        const placeholders = [...allFileIds].map(() => '?').join(',');
        const rows = db.prepare(
            `SELECT id, filename, extracted_text FROM attachments WHERE id IN (${placeholders})`
        ).all(...[...allFileIds]);
        rows.forEach(r => { fileContents[r.id] = { filename: r.filename, text: r.extracted_text }; });
    }

    // Формируем conversation массив
    const conversation = [];

    // File context (system role) — неизменяемая часть
    if (Object.keys(fileContents).length > 0) {
        let fileContext = 'The user has shared the following files:\n\n';
        for (const [fileId, file] of Object.entries(fileContents)) {
            fileContext += `--- FILE: ${file.filename} ---\n${file.text}\n\n`;
        }
        conversation.push({ role: 'system', content: fileContext });
    }

    // Add messages with questionId for grouping
    for (const msg of messages) {
        const enriched = { role: msg.role, content: msg.content };
        if (msg.question_id) enriched.questionId = msg.question_id;
        conversation.push(enriched);
    }

    // Вызываем cutContext — чистая математика
    const result = cutContext(conversation, contextSize, retainPercent);

    return {
        conversation: result.conversation,
        contextSize,
        retainPercent,
        info: result.info
    };
}

// ============================================================
// === Вспомогательные функции для ручного режима ===
// ============================================================

/**
 * Получить Q&A пары сессии для ручного режима контекста
 * @param {string} sessionId
 * @returns {Array} массив { questionId, questionText, answerText, questionChars, answerChars, totalChars, sortOrder }
 */
export function getQAPairs(sessionId) {
    const db = getDb();
    const messages = db.prepare(
        'SELECT role, content, question_id, sort_order FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
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
                sortOrder: msg.sort_order
            };
        } else if (msg.role === 'assistant' && currentQuestion) {
            currentQuestion.answerText = msg.content;
            currentQuestion.answerChars = msg.content.length;
            currentQuestion.totalChars = currentQuestion.questionChars + msg.content.length;
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
    const retainPercent = Math.min(Math.max(config.retainPercent ?? 100, 10), 100);
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
        return { mode: 'standard', retainPercent: 100, manualInclude: [] };
    }

    return {
        mode: config.mode || 'standard',
        retainPercent: config.retain_percent ?? 100,
        manualInclude: JSON.parse(config.manual_include || '[]')
    };
}
