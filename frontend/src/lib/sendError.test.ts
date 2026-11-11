import { describe, it, expect } from 'vitest';
import { ApiError } from './apiGateway';
import { buildSendErrorInfo, formatTokensCompact } from './sendError';

// ТЗ context-overflow-ux: чистая логика баннера ошибок отправки
// (№2) + форматирование чисел из пре-флайта (№1).

describe('formatTokensCompact', () => {
  it('кейс владельца: 3937667 → 3.94M', () => {
    expect(formatTokensCompact(3937667)).toBe('3.94M');
  });

  it('98304 → 98K', () => {
    expect(formatTokensCompact(98304)).toBe('98K');
  });

  it('границы: 512 / 1200 / 25000 / 1000000', () => {
    expect(formatTokensCompact(512)).toBe('512');
    expect(formatTokensCompact(1200)).toBe('1.2K');
    expect(formatTokensCompact(25000)).toBe('25K');
    expect(formatTokensCompact(1_000_000)).toBe('1.00M');
  });

  it('нечисловое/отрицательное → –', () => {
    expect(formatTokensCompact(NaN)).toBe('–');
    expect(formatTokensCompact(-5)).toBe('–');
  });
});

describe('buildSendErrorInfo — context_overflow', () => {
  const baseCtx = {
    sessionId: 'sess-1',
    failedText: 'Разбери PDF',
    providerName: 'llama_cpp',
  };

  it('пре-флайт chatController (code=context_overflow) → числа estimatedTokens/contextLength + подсказка', () => {
    const info = buildSendErrorInfo(
      new ApiError(400, 'Prompt (~3937667 tokens) exceeds the context size (98304 tokens)', {
        error: 'Prompt (~3937667 tokens) exceeds the context size (98304 tokens)',
        code: 'context_overflow',
        estimatedTokens: 3937667,
        contextLength: 98304,
      }),
      baseCtx,
    );

    expect(info.kind).toBe('context_overflow');
    expect(info.title).toBe('Контекст переполнен');
    expect(info.detail).toContain('3.94M');
    expect(info.detail).toContain('98K');
    expect(info.detail).toContain('удали Q&A-пару');
    expect(info.estimatedTokens).toBe(3937667);
    expect(info.contextLength).toBe(98304);
    expect(info.failedText).toBe('Разбери PDF');
    expect(info.sessionId).toBe('sess-1');
  });

  it('жёсткий 400 llama.cpp (type=exceed_context_size_error + n_prompt_tokens/n_ctx) → те же числа', () => {
    const info = buildSendErrorInfo(
      new ApiError(500, 'request (3937667 tokens) exceeds the available context size (98304 tokens)', {
        error: 'request (3937667 tokens) exceeds the available context size (98304 tokens)',
        type: 'exceed_context_size_error',
        n_prompt_tokens: 3937667,
        n_ctx: 98304,
      }),
      baseCtx,
    );

    expect(info.kind).toBe('context_overflow');
    expect(info.estimatedTokens).toBe(3937667);
    expect(info.contextLength).toBe(98304);
    expect(info.detail).toContain('токенов превышает контекст');
  });
});

describe('buildSendErrorInfo — остальные виды ошибок', () => {
  const baseCtx = {
    sessionId: 'sess-1',
    failedText: 'Вопрос',
    providerName: 'ollama',
  };

  it('503 → provider_unavailable, title с именем провайдера, fallback-подсказка', () => {
    const info = buildSendErrorInfo(new ApiError(503, 'provider unavailable'), {
      ...baseCtx,
      fallbackProvider: 'llama_cpp',
    });

    expect(info.kind).toBe('provider_unavailable');
    expect(info.title).toBe('ollama недоступен');
    expect(info.detail).toContain('provider unavailable');
    expect(info.detail).toContain('llama_cpp');
  });

  it('status 0 → network', () => {
    const info = buildSendErrorInfo(new ApiError(0, 'Network error: failed to fetch'), baseCtx);
    expect(info.kind).toBe('network');
    expect(info.title).toBe('Нет связи с сервером');
  });

  it('обычная ApiError → server, title «Ошибка 400», текст ошибки в detail', () => {
    const info = buildSendErrorInfo(new ApiError(400, 'Images require vision models'), baseCtx);
    expect(info.kind).toBe('server');
    expect(info.title).toBe('Ошибка 400');
    expect(info.detail).toContain('Images require vision models');
  });

  it('ECONNREFUSED в сообщении → понятный текст про бэкенд', () => {
    const info = buildSendErrorInfo(new ApiError(500, 'connect ECONNREFUSED 127.0.0.1:3000'), baseCtx);
    expect(info.kind).toBe('server');
    expect(info.detail).toContain('Бэкенд не запущен');
  });

  it('строка (result.error старого контракта) → server с текстом', () => {
    const info = buildSendErrorInfo('Connection refused', baseCtx);
    expect(info.kind).toBe('server');
    expect(info.title).toBe('Ошибка запроса');
    expect(info.detail).toContain('Connection refused');
  });

  it('failedFiles доходят до SendErrorInfo (возврат вложений в композер)', () => {
    const file = new File(['x'], 'doc.pdf');
    const info = buildSendErrorInfo(new ApiError(400, 'bad'), {
      ...baseCtx,
      failedFiles: { file, codeFiles: [] },
    });
    expect(info.failedFiles?.file).toBe(file);
  });
});
