import { ApiError } from './apiGateway';

// ТЗ context-overflow-ux (№2): структурированная ошибка отправки вместо
// транзитной пары «вопрос-ошибка» в чате. Баннер в ChatArea рендерит
// sendError (с кнопкой «Повторить»), вопрос возвращается в поле ввода
// (failedText) — при провале ничего не теряется. Пара в чате больше не
// создаётся, F5 больше не является «способом убрать ошибку».

export type SendErrorKind = 'context_overflow' | 'provider_unavailable' | 'network' | 'server';

export interface SendErrorInfo {
  /** Сессия, в которой произошла отправка — баннер показывается только в ней */
  sessionId: string | null;
  kind: SendErrorKind;
  title: string;
  detail: string;
  /** Исходный текст вопроса — ChatArea возвращает его в поле ввода */
  failedText: string;
  /** Исходные вложения — возвращаются в композер, чтобы «Повторить» был полным */
  failedFiles?: { file?: File; codeFiles?: File[] };
  /** ТЗ send-error-persist (№3): имена вложений провальной отправки после F5 —
      сами File-объекты браузер восстановить не может, показываем имена чипсами */
  failedFileNames?: string[];
  /** Для context_overflow: число токенов промпта и размер окна */
  estimatedTokens?: number;
  contextLength?: number;
  /** ТЗ send-error-persist (№3): когда произошёл провал (ISO, из sessions.last_send_error) */
  at?: string;
}

/** 3937667 → «3.94M», 98304 → «98K», 512 → «512»; нечисловое/отрицательное → «–» */
export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export interface BuildSendErrorCtx {
  sessionId: string | null;
  failedText: string;
  failedFiles?: { file?: File; codeFiles?: File[] };
  providerName: string;
  fallbackProvider?: string;
}

function withFallbackHint(detail: string, fallback?: string): string {
  return fallback ? `${detail} 💡 Доступен другой провайдер: ${fallback}.` : detail;
}

/**
 * Чистая функция: исключение из sendMessage → SendErrorInfo для баннера.
 * Разбор ApiError.details:
 *  - code 'context_overflow' — пре-флайт chatController (№1, chars/4 ДО вызова LLM);
 *  - type 'exceed_context_size_error' / n_prompt_tokens+n_ctx — жёсткий 400 от
 *    llama.cpp (реальные числа токенизатора, проброшены chatController'ом).
 */
export function buildSendErrorInfo(e: unknown, ctx: BuildSendErrorCtx): SendErrorInfo {
  const base = {
    sessionId: ctx.sessionId,
    failedText: ctx.failedText,
    ...(ctx.failedFiles ? { failedFiles: ctx.failedFiles } : {}),
  };

  if (e instanceof ApiError) {
    const d = (e.details && typeof e.details === 'object' ? e.details : {}) as Record<string, unknown>;
    const code = typeof d.code === 'string' ? d.code : '';
    const type = typeof d.type === 'string' ? d.type : '';
    const preEst = typeof d.estimatedTokens === 'number' ? d.estimatedTokens : undefined;
    const preCtx = typeof d.contextLength === 'number' ? d.contextLength : undefined;
    const promptTok = typeof d.n_prompt_tokens === 'number' ? d.n_prompt_tokens : undefined;
    const nCtxTok = typeof d.n_ctx === 'number' ? d.n_ctx : undefined;

    // №1: пре-флайт — промпт заведомо не влезает (оценка chars/4 до вызова LLM)
    if (code === 'context_overflow' && preEst != null && preCtx != null) {
      return {
        ...base,
        kind: 'context_overflow',
        title: 'Контекст переполнен',
        detail:
          `Промпт ≈ ${formatTokensCompact(preEst)} токенов не влезает в контекст ${formatTokensCompact(preCtx)} ток. ` +
          'Извлечённый текст вложений входит в каждый запрос целиком — удали Q&A-пару с этим файлом (Delete под вопросом) или начни новую сессию.',
        estimatedTokens: preEst,
        contextLength: preCtx,
      };
    }

    // Жёсткий 400 от llama.cpp: реальный счётчик токенизатора
    if (type === 'exceed_context_size_error' || (promptTok != null && nCtxTok != null)) {
      return {
        ...base,
        kind: 'context_overflow',
        title: 'Контекст переполнен',
        detail:
          `Запрос ${formatTokensCompact(promptTok ?? 0)} токенов превышает контекст ${formatTokensCompact(nCtxTok ?? 0)} ток. ` +
          'Удали Q&A-пару с большим файлом (Delete под вопросом) или начни новую сессию.',
        estimatedTokens: promptTok,
        contextLength: nCtxTok,
      };
    }

    if (e.status === 503) {
      return {
        ...base,
        kind: 'provider_unavailable',
        title: `${ctx.providerName} недоступен`,
        detail: withFallbackHint(
          `${e.message}. Проверь статус провайдера или смени провайдера.`,
          ctx.fallbackProvider,
        ),
      };
    }

    if (e.status === 0) {
      return {
        ...base,
        kind: 'network',
        title: 'Нет связи с сервером',
        detail: 'Бэкенд не отвечает. Проверь, что сервер запущен и доступен.',
      };
    }

    const msg = e.message.includes('ECONNREFUSED')
      ? 'Бэкенд не запущен или URL неверен. Проверь, что сервер (порт 3000) стартовал.'
      : e.message;
    return {
      ...base,
      kind: 'server',
      title: `Ошибка ${e.status}`,
      detail: withFallbackHint(msg, ctx.fallbackProvider),
    };
  }

  // Не-ApiError: строка result.error (старый контракт), обычный Error и пр.
  const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  return {
    ...base,
    kind: 'server',
    title: 'Ошибка запроса',
    detail: withFallbackHint(msg, ctx.fallbackProvider),
  };
}

// ── ТЗ send-error-persist (№3 context-overflow-ux) ──────────────────────────
// Персистентная плашка последней провальной отправки: провал не оставляет следов
// в messages/attachments, сервер пишет снапшот в sessions.last_send_error —
// единственное место, откуда после F5 можно узнать инцидент и вернуть вопрос
// в поле ввода. Здесь — сборка SendErrorInfo из этого снапшота.

/** Снапшот, который chatController пишет в sessions.last_send_error */
export interface PersistedSendErrorRaw {
  kind?: 'context_overflow' | 'server';
  providerName?: string;
  failedText?: string;
  fileNames?: string[];
  estimatedTokens?: number;
  contextLength?: number;
  nPromptTokens?: number;
  nCtxTokens?: number;
  message?: string;
  at?: string;
}

/**
 * Сырое значение столбца sessions.last_send_error (строка JSON | null | мусор)
 * → SendErrorInfo для персистентной плашки или null (нет записи / не распарсилось).
 * failedFiles здесь нет: File-объекты не переживают F5, только имена (failedFileNames).
 */
export function buildPersistedSendErrorInfo(
  raw: unknown,
  sessionId: string | null,
): SendErrorInfo | null {
  let d: PersistedSendErrorRaw | null = null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        d = parsed as PersistedSendErrorRaw;
      }
    } catch {
      return null;
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    d = raw as PersistedSendErrorRaw;
  }
  if (!d) return null;

  const failedText = typeof d.failedText === 'string' ? d.failedText : '';
  const failedFileNames = Array.isArray(d.fileNames)
    ? d.fileNames.filter((n): n is string => typeof n === 'string' && n.length > 0)
    : undefined;
  const base = {
    sessionId,
    ...(failedFileNames && failedFileNames.length > 0 ? { failedFileNames } : {}),
    ...(typeof d.at === 'string' && d.at ? { at: d.at } : {}),
  };
  const fileHint =
    failedFileNames && failedFileNames.length > 0
      ? `Вложения: ${failedFileNames.join(', ')}. `
      : '';

  const preEst = typeof d.estimatedTokens === 'number' ? d.estimatedTokens : undefined;
  const preCtx = typeof d.contextLength === 'number' ? d.contextLength : undefined;
  const promptTok = typeof d.nPromptTokens === 'number' ? d.nPromptTokens : undefined;
  const nCtxTok = typeof d.nCtxTokens === 'number' ? d.nCtxTokens : undefined;

  // Пре-флайт (числа chars/4-оценки) — та же семантика, что у транзитного баннера
  if (d.kind === 'context_overflow' && preEst != null && preCtx != null) {
    return {
      ...base,
      kind: 'context_overflow',
      title: 'Контекст переполнен',
      detail:
        `Последняя отправка: промпт ≈ ${formatTokensCompact(preEst)} токенов не влезает в контекст ${formatTokensCompact(preCtx)} ток. ` +
        fileHint +
        'Извлечённый текст вложений входит в каждый запрос целиком — удали Q&A-пару с файлом (кнопка ниже) или начни новую сессию.',
      failedText,
      estimatedTokens: preEst,
      contextLength: preCtx,
    };
  }

  // Жёсткий 400 llama.cpp (реальные числа токенизатора, camelCase в снапшоте)
  if (d.kind === 'context_overflow' && promptTok != null && nCtxTok != null) {
    return {
      ...base,
      kind: 'context_overflow',
      title: 'Контекст переполнен',
      detail:
        `Последняя отправка: запрос ${formatTokensCompact(promptTok)} токенов превышает контекст ${formatTokensCompact(nCtxTok)} ток. ` +
        fileHint +
        'Удали Q&A-пару с большим файлом (кнопка ниже) или начни новую сессию.',
      failedText,
      estimatedTokens: promptTok,
      contextLength: nCtxTok,
    };
  }

  const rawMessage = typeof d.message === 'string' && d.message ? d.message : undefined;
  return {
    ...base,
    kind: 'server',
    title: 'Отправка не удалась',
    detail:
      fileHint +
      (rawMessage
        ? `${rawMessage}. Проверь статус провайдера и повтори отправку.`
        : 'Проверь статус провайдера и повтори отправку.'),
    failedText,
  };
}

// ── ТЗ send-error-persist (№4 context-overflow-ux) ──────────────────────────
// Быстрое действие «Удалить пару с файлом»: находит последнюю Q&A-пару, чьи
// вложения инжектятся в [Материалы] (document/code — их extracted_text входит
// в каждый запрос). Картинки не считаются: они не попадают в [Материалы].
export interface FilePairCandidate {
  role: string;
  questionId?: string;
  attachmentsMeta?: unknown;
}

/** Элемент attachments_meta несёт инжектящийся файл (document/code, либо legacy-мета без kind не-картинка) */
export function isInjectingFileMeta(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as { kind?: unknown; type?: unknown };
  if (e.kind === 'document' || e.kind === 'code') return true;
  if (e.kind === 'image' || e.kind === 'reference') return false;
  // Optimistic-мета фронта kind не ставит: {name, size, type}. Картинка — mime image/*
  if (typeof e.type === 'string' && e.type.startsWith('image/')) return false;
  return true;
}

/** questionId последней user-пары с инжектящимся файлом или null */
export function findLatestFileQAPairId(messages: FilePairCandidate[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user' || !m.questionId) continue;
    const meta = Array.isArray(m.attachmentsMeta) ? m.attachmentsMeta : [];
    if (meta.some((entry) => isInjectingFileMeta(entry))) return m.questionId;
  }
  return null;
}

/** ISO-время провала → «11.11 14:32»; невалидное/пустое → null (бейдж не рисуем) */
export function formatSendErrorTime(at: string | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
