import { describe, it, expect } from 'vitest';
import { ApiError } from './apiGateway';
import {
  buildSendErrorInfo,
  buildPersistedSendErrorInfo,
  findLatestFileQAPairId,
  isInjectingFileMeta,
  formatSendErrorTime,
  formatTokensCompact,
} from './sendError';

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

  // ТЗ adaptive-context-budget (№4): 400 message_too_long (путь прямых
  // запросов — композер блокирует раньше) → понятный баннер с числами капа
  it('400 code=message_too_long → «Слишком длинный ввод», числа messageLength/maxMessageChars в detail', () => {
    const info = buildSendErrorInfo(
      new ApiError(400, 'Message is too long: 64001 chars, limit is 64000.', {
        error: 'Message is too long: 64001 chars, limit is 64000.',
        code: 'message_too_long',
        messageLength: 64001,
        maxMessageChars: 64000,
      }),
      baseCtx,
    );
    expect(info.kind).toBe('server'); // это не переполнение контекста модели
    expect(info.title).toBe('Слишком длинный ввод');
    expect(info.detail).toContain('64 001');
    expect(info.detail).toContain('64 000');
    expect(info.detail).toContain('вынеси часть в файл');
    expect(info.failedText).toBe('Вопрос');
    expect(info.sessionId).toBe('sess-1');
  });

  it('message_too_long без чисел → общий текст подсказки (без форматирования)', () => {
    const info = buildSendErrorInfo(
      new ApiError(400, 'Message is too long', { error: 'Message is too long', code: 'message_too_long' }),
      baseCtx,
    );
    expect(info.title).toBe('Слишком длинный ввод');
    expect(info.detail).toBe('Сообщение превышает лимит длины — сократи текст или вынеси часть в файл.');
  });
});

// ТЗ send-error-persist (№3): персистентная плашка из sessions.last_send_error —
// единственный след провальной отправки после F5 (сервер не пишет messages).
describe('buildPersistedSendErrorInfo', () => {
  it('строка JSON пре-флайта → context_overflow с числами + failedText (кейс владельца)', () => {
    const raw = JSON.stringify({
      kind: 'context_overflow',
      providerName: 'llama_cpp',
      failedText: 'Проанализируй отчёт',
      fileNames: ['report.pdf'],
      estimatedTokens: 3937667,
      contextLength: 98304,
      at: '2026-11-11T09:30:00.000Z',
    });
    const info = buildPersistedSendErrorInfo(raw, 'sess-1');

    expect(info).not.toBeNull();
    expect(info!.kind).toBe('context_overflow');
    expect(info!.title).toBe('Контекст переполнен');
    expect(info!.detail).toContain('3.94M');
    expect(info!.detail).toContain('98K');
    expect(info!.detail).toContain('report.pdf');
    expect(info!.failedText).toBe('Проанализируй отчёт');
    expect(info!.estimatedTokens).toBe(3937667);
    expect(info!.contextLength).toBe(98304);
    expect(info!.sessionId).toBe('sess-1');
    expect(info!.at).toBe('2026-11-11T09:30:00.000Z');
  });

  it('жёсткий 400 llama.cpp (nPromptTokens/nCtxTokens) → те же числа токенизатора', () => {
    const raw = JSON.stringify({
      kind: 'context_overflow',
      failedText: 'Вопрос',
      nPromptTokens: 3937667,
      nCtxTokens: 98304,
    });
    const info = buildPersistedSendErrorInfo(raw, 'sess-1');

    expect(info!.kind).toBe('context_overflow');
    expect(info!.estimatedTokens).toBe(3937667);
    expect(info!.contextLength).toBe(98304);
    expect(info!.detail).toContain('токенов превышает контекст');
  });

  it('kind=server → «Отправка не удалась» с raw-сообщением провайдера', () => {
    const raw = JSON.stringify({
      kind: 'server',
      providerName: 'llama_cpp',
      failedText: 'Вопрос',
      message: 'connect ECONNREFUSED 127.0.0.1:8080',
    });
    const info = buildPersistedSendErrorInfo(raw, 'sess-1');

    expect(info!.kind).toBe('server');
    expect(info!.title).toBe('Отправка не удалась');
    expect(info!.detail).toContain('ECONNREFUSED');
    expect(info!.failedText).toBe('Вопрос');
  });

  it('context_overflow БЕЗ чисел (битый снапшот) → fallback в server-kind плашку', () => {
    const raw = JSON.stringify({ kind: 'context_overflow', failedText: 'Вопрос' });
    const info = buildPersistedSendErrorInfo(raw, 'sess-1');

    expect(info!.kind).toBe('server');
    expect(info!.failedText).toBe('Вопрос');
  });

  it('мусор в столбце → null (нет плашки): null, не-JSON, массив, число', () => {
    expect(buildPersistedSendErrorInfo(null, 's')).toBeNull();
    expect(buildPersistedSendErrorInfo(undefined, 's')).toBeNull();
    expect(buildPersistedSendErrorInfo('', 's')).toBeNull();
    expect(buildPersistedSendErrorInfo('{not-json', 's')).toBeNull();
    expect(buildPersistedSendErrorInfo(JSON.stringify([1, 2]), 's')).toBeNull();
    expect(buildPersistedSendErrorInfo(JSON.stringify('weird'), 's')).toBeNull();
    expect(buildPersistedSendErrorInfo(42, 's')).toBeNull();
  });

  it('fileNames с мусором фильтруются, пустой список не попадает в info', () => {
    const raw = JSON.stringify({ kind: 'server', failedText: 'q', fileNames: ['a.pdf', '', 42, null] });
    const info = buildPersistedSendErrorInfo(raw, 's');
    expect(info!.failedFileNames).toEqual(['a.pdf']);

    const empty = buildPersistedSendErrorInfo(JSON.stringify({ kind: 'server', fileNames: [] }), 's');
    expect(empty!.failedFileNames).toBeUndefined();
  });
});

// ТЗ send-error-persist (№4): «Удалить пару с файлом» — последняя user-пара,
// чьи вложения инжектятся в [Материалы] (document/code). Картинки/reference не считаются.
describe('findLatestFileQAPairId / isInjectingFileMeta', () => {
  it('DB-мета: kind document/code считаются, image/reference нет', () => {
    expect(isInjectingFileMeta({ kind: 'document', name: 'a.pdf' })).toBe(true);
    expect(isInjectingFileMeta({ kind: 'code', name: 'a.py' })).toBe(true);
    expect(isInjectingFileMeta({ kind: 'image', name: 'a.png' })).toBe(false);
    expect(isInjectingFileMeta({ kind: 'reference', name: 'a.ts' })).toBe(false);
  });

  it('optimistic-мета без kind: не-картинка считается, image/* нет', () => {
    expect(isInjectingFileMeta({ name: 'a.pdf', size: 1, type: 'application/pdf' })).toBe(true);
    expect(isInjectingFileMeta({ name: 'a.py', size: 1, type: '' })).toBe(true);
    expect(isInjectingFileMeta({ name: 'a.png', size: 1, type: 'image/png' })).toBe(false);
    expect(isInjectingFileMeta(null)).toBe(false);
    expect(isInjectingFileMeta('str')).toBe(false);
  });

  it('последняя user-пара с файлом, assistant и пустые user пропускаются', () => {
    const messages = [
      { role: 'user', questionId: 'q_1', attachmentsMeta: [{ kind: 'document', name: 'old.pdf' }] },
      { role: 'assistant', questionId: 'q_1', attachmentsMeta: [{ kind: 'document' }] },
      { role: 'user', questionId: 'q_2', attachmentsMeta: [] },
      { role: 'assistant', questionId: 'q_2' },
      { role: 'user', questionId: 'q_3', attachmentsMeta: [{ kind: 'image', name: 'pic.png' }] },
      { role: 'user', questionId: 'q_4', attachmentsMeta: [{ kind: 'code', name: 'fix.py' }] },
    ];
    expect(findLatestFileQAPairId(messages)).toBe('q_4');
  });

  it('только картинки → null (кнопка скрыта)', () => {
    const messages = [
      { role: 'user', questionId: 'q_1', attachmentsMeta: [{ kind: 'image' }] },
    ];
    expect(findLatestFileQAPairId(messages)).toBeNull();
    expect(findLatestFileQAPairId([])).toBeNull();
  });
});

describe('formatSendErrorTime', () => {
  it('валидный ISO → строка ДД.ММ, ЧЧ:ММ (ru-RU)', () => {
    const s = formatSendErrorTime('2026-11-11T09:30:00.000Z');
    expect(s).not.toBeNull();
    expect(s).toMatch(/^\d{2}\.\d{2},\s+\d{2}:\d{2}$/);
  });

  it('мусор/пустота → null', () => {
    expect(formatSendErrorTime(undefined)).toBeNull();
    expect(formatSendErrorTime('')).toBeNull();
    expect(formatSendErrorTime('not-a-date')).toBeNull();
  });
});
