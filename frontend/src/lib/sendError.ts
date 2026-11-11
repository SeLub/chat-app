import { ApiError } from './apiGateway';
// ТЗ adaptive-context-budget (№4): числа капа в баннере (formatChars —
// детерминированная группировка без Intl)
import { formatChars } from './messageCap';

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
  /** Для context_overflow: число токенов промпта и размер окна */
  estimatedTokens?: number;
  contextLength?: number;
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

    // №4 adaptive-context-budget: кап длины message (путь прямых запросов —
    // композер блокирует раньше). kind 'server': это не переполнение
    // контекста модели, «Повторить» без правок снова упрётся в кап.
    if (code === 'message_too_long') {
      const len = typeof d.messageLength === 'number' ? d.messageLength : undefined;
      const max = typeof d.maxMessageChars === 'number' ? d.maxMessageChars : undefined;
      return {
        ...base,
        kind: 'server',
        title: 'Слишком длинный ввод',
        detail:
          len != null && max != null
            ? `Сообщение ${formatChars(len)} символов превышает лимит ${formatChars(max)} — сократи текст или вынеси часть в файл.`
            : 'Сообщение превышает лимит длины — сократи текст или вынеси часть в файл.',
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
