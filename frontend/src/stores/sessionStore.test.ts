import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionStore, initialSessionState } from './sessionStore';

// vi.mock is hoisted to top of file, so we must define mocks inline
// See: https://vitest.dev/api/vi.html#vi-mock

const mocked = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
    }
  },
  apiGateway: {
    sessions: {
      get: vi.fn(),
      getMessages: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      deleteQAPair: vi.fn(),
    },
    chat: { send: vi.fn() },
    models: { list: vi.fn(), show: vi.fn() },
    providers: { status: vi.fn() },
    stt: { transcribe: vi.fn() },
  },
}));

vi.mock('@/lib/apiGateway', () => mocked);

vi.mock('@/stores/providerStore', () => ({
  useProviderStore: {
    getState: vi.fn(() => ({
      currentModel: 'test-model',
      currentProvider: 'ollama' as const,
      currentContextLength: null,
      providers: [],
      refreshStatus: vi.fn(),
    })),
  },
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      addToast: vi.fn(),
    })),
  },
}));

// Access mocked modules after vi.mock
import { apiGateway } from '@/lib/apiGateway';
import { useProviderStore } from '@/stores/providerStore';

type FnMock = ReturnType<typeof vi.fn>;

function getSessionsMock() {
  return apiGateway.sessions as unknown as {
    get: FnMock;
    getMessages: FnMock;
    create: FnMock;
    update: FnMock;
    delete: FnMock;
    list: FnMock;
    deleteQAPair: FnMock;
  };
}

function resetStore() {
  useSessionStore.setState(initialSessionState as never);
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.clearAllMocks();
  window.history.replaceState = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function s() {
  return getSessionsMock();
}

describe('sessionStore — normalization and init', () => {
  it('1. Normalization via init: Q&A pairs → messages with attachmentsMeta/metrics parsed', async () => {
    localStorage.setItem('activeSessionId', 's1');
    localStorage.setItem('viewingSessionId', 's1');

    const sessionData = { id: 's1', title: 'T', category: '', sysprompt: '', message_count: 2, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);

    s().getMessages.mockResolvedValue([
      {
        questionId: 'q_1_1',
        questionText: 'Q1',
        answerText: 'A1',
        model: 'm',
        attachments_meta: '[{"name":"f.pdf","size":1}]',
        metrics: '{"tps":5}',
      },
      {
        questionId: 'q_2_2',
        questionText: 'Q2',
        answerText: '',
        model: 'm',
      },
    ]);

    await useSessionStore.getState().init();

    const state = useSessionStore.getState();
    expect(state.messages.length).toBe(3); // user+assistant+user
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toBe('Q1');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].content).toBe('A1');
    expect(state.messages[2].role).toBe('user');
    expect(state.messages[2].content).toBe('Q2');

    // attachmentsMeta parsed from JSON string
    const meta = state.messages[0].attachmentsMeta as unknown as { name: string; size: number }[];
    expect(meta).toEqual([{ name: 'f.pdf', size: 1 }]);

    // metrics parsed
    const metrics = state.messages[1].metrics as { tps: number };
    expect(metrics.tps).toBe(5);

    // questionCounter
    expect(state.questionCounter).toBe(2);
  });

  it('1b. TZ-B.5: attachments_meta с fileId (после Фазы B) — фронт не падает от лишнего поля, fileId доезжает до store', async () => {
    localStorage.setItem('activeSessionId', 's1b');
    localStorage.setItem('viewingSessionId', 's1b');

    const sessionData = { id: 's1b', title: 'T', category: '', sysprompt: '', message_count: 2, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);

    // Форма ответа после финального ТЗ: meta содержит fileId/kind; metrics — JSON-строка;
    // image_data демонтирован и больше не приходит
    s().getMessages.mockResolvedValue([
      {
        questionId: 'q_1_10',
        questionText: 'Q1',
        answerText: 'A1',
        model: 'm',
        attachments_meta: '[{"fileId":"file-abc","name":"doc.csv","size":42,"type":"text","kind":"document"}]',
        metrics: '{"tps":7}',
      },
    ]);

    await useSessionStore.getState().init();

    const state = useSessionStore.getState();
    expect(state.messages.length).toBe(2);

    const meta = state.messages[0].attachmentsMeta as unknown as { fileId?: string; name: string; size: number; type?: string; kind?: string }[];
    expect(meta).toEqual([{ fileId: 'file-abc', name: 'doc.csv', size: 42, type: 'text', kind: 'document' }]);
  });

  it('1c. Финальное ТЗ: imageData строится из attachments_meta (kind=image), image_data не нужен', async () => {
    localStorage.setItem('activeSessionId', 's1c');
    localStorage.setItem('viewingSessionId', 's1c');

    const sessionData = { id: 's1c', title: 'T', category: '', sysprompt: '', message_count: 2, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);

    s().getMessages.mockResolvedValue([
      {
        questionId: 'q_1_20',
        questionText: 'Что на картинке?',
        answerText: 'Кот',
        model: 'm',
        attachments_meta: JSON.stringify([
          { fileId: 'img-1', name: 'shot.png', size: 9, type: 'image', kind: 'image', fullUrl: '/api/attachments/img-1/raw', thumbnailUrl: '/api/attachments/img-1/thumb' },
          { fileId: 'file-2', name: 'util.ts', size: 5, type: 'typescript', kind: 'code' },
        ]),
        metrics: '{}',
      },
      {
        questionId: 'q_2_30',
        questionText: 'Без картинок',
        answerText: 'Ок',
        model: 'm',
        attachments_meta: '[{"fileId":"file-3","name":"doc.pdf","size":7,"type":"pdf","kind":"document"}]',
      },
    ]);

    await useSessionStore.getState().init();

    const state = useSessionStore.getState();

    // Пара 1: imageData выведен из meta
    expect(state.messages[0].imageData).toEqual({
      thumbnailUrl: '/api/attachments/img-1/thumb',
      fullUrl: '/api/attachments/img-1/raw',
      filename: 'shot.png',
    });
    expect(state.messages[1].imageData).toEqual({
      thumbnailUrl: '/api/attachments/img-1/thumb',
      fullUrl: '/api/attachments/img-1/raw',
      filename: 'shot.png',
    });

    // Пара 2: изображения нет → imageData undefined
    expect(state.messages[2].imageData).toBeUndefined();
    expect(state.messages[3].imageData).toBeUndefined();

    // Пустая/битая meta не роняет маппер
    expect(state.messages[2].attachmentsMeta).toEqual([{ fileId: 'file-3', name: 'doc.pdf', size: 7, type: 'pdf', kind: 'document' }]);
  });

  it('2. init without saved active (localStorage empty) → creates new session', async () => {
    s().create.mockResolvedValue({ id: 'new1', title: '' });

    await useSessionStore.getState().init();

    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe('new1');
    expect(state.viewingSessionId).toBe('new1');
    expect(localStorage.getItem('activeSessionId')).toBe('new1');
    expect(localStorage.getItem('viewingSessionId')).toBe('new1');
    // sysprompt = DEFAULT_SYSPROMPT (non-empty)
    expect(state.sysprompt.length).toBeGreaterThan(0);
  });

  it('3. init with broken active (get throws ApiError) → keys cleared, new session created', async () => {
    localStorage.setItem('activeSessionId', 'broken1');
    localStorage.setItem('viewingSessionId', 'broken1');

    s().get.mockRejectedValue(new Error('ApiError'));
    s().create.mockResolvedValue({ id: 'new2', title: '' });

    await useSessionStore.getState().init();

    const state = useSessionStore.getState();
    expect(localStorage.getItem('activeSessionId')).toBe('new2');
    expect(state.activeSessionId).toBe('new2');
    expect(state.viewingSessionId).toBe('new2');
  });

  it('4. init with ?session= URL → switchToViewing, URL cleared', async () => {
    // Подмена location с восстановлением (configurable:true + restore в конце) —
    // иначе подмена протекает в последующие init-тесты (ТЗ Project mode A).
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { search: '?session=hist1', pathname: '/' },
      writable: false,
      configurable: true,
    });

    const sessionData = { id: 'hist1', title: 'H', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);
    s().getMessages.mockResolvedValue([]);

    localStorage.setItem('activeSessionId', 'activeX');

    await useSessionStore.getState().init();

    const state = useSessionStore.getState();
    expect(state.viewingSessionId).toBe('hist1');
    expect(state.activeSessionId).toBe('activeX');
    expect(window.history.replaceState).toHaveBeenCalled();

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: false,
      configurable: true,
    });
  });

  it('5. switchToViewing does not touch active', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';

    const sessionData = { id: 'h1', title: 'H', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);
    s().getMessages.mockResolvedValue([]);

    await store.switchToViewing('h1');

    const state = useSessionStore.getState();
    expect(state.viewingSessionId).toBe('h1');
    expect(state.activeSessionId).toBe('a1');
    expect(state.contextMode).toBe('standard');
  });

  it('6. returnToCurrent: viewing → active, loadContextState reads localStorage', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'h1';

    localStorage.setItem('contextMode_a1', JSON.stringify('manual'));

    const sessionData = { id: 'a1', title: 'A', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);
    s().getMessages.mockResolvedValue([]);

    await store.returnToCurrent();

    const state = useSessionStore.getState();
    expect(state.viewingSessionId).toBe('a1');
    expect(state.contextMode).toBe('manual');
  });
});

describe('sessionStore — clearChat lifecycle', () => {
  it('1. clearChat: unsaved session gets renamed, new session created, pointers updated, keys removed', async () => {
    const store = useSessionStore.getState();
    store.viewingSessionId = 's1';
    store.activeSessionId = 's1';

    const allSessions = [
      { id: 's1', title: '', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' },
      { id: 's2', title: 'unsavedSession 46', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' },
      { id: 's3', title: 'unsavedSession 47', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' },
    ];
    s().list.mockResolvedValue(allSessions);
    s().create.mockResolvedValue({ id: 's2' });

    await store.clearChat();

    const state = useSessionStore.getState();
    expect(apiGateway.sessions.update).toHaveBeenCalledWith('s1', { title: 'unsavedSession 4' });
    expect(s().create).toHaveBeenCalled();
    expect(state.activeSessionId).toBe('s2');
    expect(state.viewingSessionId).toBe('s2');
    expect(localStorage.getItem('contextMode_s1')).toBeNull();
    expect(localStorage.getItem('selectedIds_s1')).toBeNull();
  });

  it('2. clearChat: named session (not unsaved) → no rename, new session created', async () => {
    const store = useSessionStore.getState();
    store.viewingSessionId = 's1';
    store.activeSessionId = 's1';

    const allSessions = [
      { id: 's1', title: 'My Work', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' },
    ];
    s().list.mockResolvedValue(allSessions);
    s().create.mockResolvedValue({ id: 's2' });

    await store.clearChat();

    expect(apiGateway.sessions.update).not.toHaveBeenCalled();
    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe('s2');
    expect(state.viewingSessionId).toBe('s2');
  });
});

describe('sessionStore — deleteSession lifecycle', () => {
  it('3. deleteSession: non-current session → deleted, pointers untouched, keys purged', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';

    localStorage.setItem('contextMode_x', '"standard"');
    localStorage.setItem('selectedIds_x', '[]');

    s().delete.mockResolvedValue({ ok: true });

    const result = await store.deleteSession('x');

    expect(result).toBe('deleted');
    expect(store.activeSessionId).toBe('a1');
    expect(store.viewingSessionId).toBe('a1');
    expect(localStorage.getItem('contextMode_x')).toBeNull();
    expect(localStorage.getItem('selectedIds_x')).toBeNull();
  });

  it('4. deleteSession: delete viewing session (viewing≠active), → returnToCurrent', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'h1';

    s().delete.mockResolvedValue({ ok: true });

    const sessionData = { id: 'a1', title: 'A', category: '', sysprompt: '', message_count: 0, created_at: '', updated_at: '' };
    s().get.mockResolvedValue(sessionData);
    s().getMessages.mockResolvedValue([]);

    const result = await store.deleteSession('h1');

    expect(result).toBe('deleted');
    expect(useSessionStore.getState().viewingSessionId).toBe('a1');
  });

  it('5. deleteSession: delete active session → fresh new session', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';

    s().delete.mockResolvedValue({ ok: true });
    s().create.mockResolvedValue({ id: 's9' });

    const result = await store.deleteSession('a1');

    expect(result).toBe('fresh');
    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe('s9');
    expect(state.viewingSessionId).toBe('s9');
  });

  it('6. deleteSession: API rejects → error, pointers unchanged, keys still present', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';

    localStorage.setItem('contextMode_a1', '"standard"');
    localStorage.setItem('selectedIds_a1', '[]');

    s().delete.mockRejectedValue(new Error('API fail'));

    const result = await store.deleteSession('a1');

    expect(result).toBe('error');
    expect(store.activeSessionId).toBe('a1');
    expect(store.viewingSessionId).toBe('a1');
    expect(localStorage.getItem('contextMode_a1')).not.toBeNull();
    expect(localStorage.getItem('selectedIds_a1')).not.toBeNull();
  });
});

describe('sessionStore — sendMessage lifecycle', () => {
  it('7. sendMessage: standard mode, 2 existing user questions → includeQuestionIds includes all + new', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [
      { role: 'user', content: 'Q1', questionId: 'q_1_1', model: 'm' },
      { role: 'assistant', content: 'A1', questionId: 'q_1_1', model: 'm' },
      { role: 'user', content: 'Q2', questionId: 'q_2_2', model: 'm' },
    ];
    store.questionCounter = 2;
    store.totalInputTokens = 0;
    store.totalOutputTokens = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    const sendResult = { response: 'OK', metrics: { inputTokens: 10, outputTokens: 5 } };
    (apiGateway.chat.send as FnMock).mockResolvedValue(sendResult);

    await store.sendMessage('Q3');

    const callArgs = (apiGateway.chat.send as FnMock).mock.calls[0];
    const requestData = callArgs[0] as { includeQuestionIds: string[] };
    expect(requestData.includeQuestionIds).toContain('q_1_1');
    expect(requestData.includeQuestionIds).toContain('q_2_2');
    expect(requestData.includeQuestionIds.length).toBe(3);

    const state = useSessionStore.getState();
    expect(state.messages.length).toBe(5); // 2 user+assistant + new user+assistant
    expect(state.totalInputTokens).toBe(10);
  });

  it('8. sendMessage: manual mode → selectedQuestionIds sent as-is, new question NOT included', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [
      { role: 'user', content: 'Q1', questionId: 'q_1_1', model: 'm' },
    ];
    store.questionCounter = 1;
    store.totalInputTokens = 0;
    store.totalOutputTokens = 0;
    store.contextMode = 'manual';
    store.selectedQuestionIds = ['q_1_1'];

    s().create.mockResolvedValue({ id: 'a1' });

    (apiGateway.chat.send as FnMock).mockResolvedValue({ response: 'OK' });

    await store.sendMessage('new Q');

    const callArgs = (apiGateway.chat.send as FnMock).mock.calls[0];
    const requestData = callArgs[0] as { includeQuestionIds: string[] };
    expect(requestData.includeQuestionIds).toEqual(['q_1_1']);
  });

  it('8b. TZ-A.7: manual + все галочки сняты (selectedQuestionIds=[]) → includeQuestionIds=[] как есть', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [
      { role: 'user', content: 'Q1', questionId: 'q_1_1', model: 'm' },
    ];
    store.questionCounter = 1;
    store.totalInputTokens = 0;
    store.totalOutputTokens = 0;
    store.contextMode = 'manual';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    (apiGateway.chat.send as FnMock).mockResolvedValue({ response: 'OK' });

    await store.sendMessage('new Q');

    const callArgs = (apiGateway.chat.send as FnMock).mock.calls[0];
    const requestData = callArgs[0] as { includeQuestionIds: string[] };
    expect(requestData.includeQuestionIds).toEqual([]);
  });

  it('9. sendMessage: syspromptDirty=true → sessions.update called BEFORE chat.send', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.syspromptDirty = true;
    store.messages = [];
    store.questionCounter = 0;
    store.totalInputTokens = 0;
    store.totalOutputTokens = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];
    store.sysprompt = 'custom prompt';

    s().create.mockResolvedValue({ id: 'a1' });
    s().update.mockResolvedValue({ id: 'a1' });

    (apiGateway.chat.send as FnMock).mockResolvedValue({ response: 'OK' });

    await store.sendMessage('Q');

    const updateCall = s().update.mock.invocationCallOrder[0];
    const sendCall = (apiGateway.chat.send as FnMock).mock.invocationCallOrder[0];
    expect(updateCall).toBeDefined();
    expect(sendCall).toBeDefined();
    expect(updateCall).toBeLessThan(sendCall);
    expect(useSessionStore.getState().syspromptDirty).toBe(false);
  });

  it('10. ТЗ context-overflow-ux: ApiError 503 → sendError kind=provider_unavailable, пары в чате нет, refreshStatus вызван', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [];
    store.questionCounter = 0;
    store.totalInputTokens = 0;
    store.totalOutputTokens = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    const providerRefresh = vi.fn();
    const mockProviderStore = {
      currentModel: 'test-model',
      currentProvider: 'ollama',
      currentContextLength: null,
      providers: [],
      refreshStatus: providerRefresh,
    };
    (useProviderStore.getState as ReturnType<typeof vi.fn>).mockReturnValue(mockProviderStore as never);

    (apiGateway.chat.send as FnMock).mockRejectedValue(new mocked.ApiError(503, 'provider unavailable'));

    await store.sendMessage('Q');

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.questionCounter).toBe(0);
    expect(state.sendError).not.toBeNull();
    expect(state.sendError?.kind).toBe('provider_unavailable');
    expect(state.sendError?.title).toBe('ollama недоступен');
    expect(state.sendError?.detail).toContain('provider unavailable');
    expect(state.sendError?.failedText).toBe('Q');
    expect(state.sendError?.sessionId).toBe('a1');
    expect(providerRefresh).toHaveBeenCalled();
  });

  it('11. ТЗ context-overflow-ux: ApiError 400 → sendError kind=server (title «Ошибка 400»), пары в чате нет', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [];
    store.questionCounter = 0;
    store.totalInputTokens = 0;
    store.totalOutputTokens = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    (apiGateway.chat.send as FnMock).mockRejectedValue(
      new mocked.ApiError(400, 'Images require vision models'),
    );

    await store.sendMessage('Q');

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.sendError?.kind).toBe('server');
    expect(state.sendError?.title).toBe('Ошибка 400');
    expect(state.sendError?.detail).toContain('Images require vision models');
    expect(state.sendError?.failedText).toBe('Q');
    expect(state.sendError?.kind).not.toBe('network');
  });

  it('12. ТЗ context-overflow-ux: пре-флайт 400 (code=context_overflow) → kind=context_overflow с числами', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [];
    store.questionCounter = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    (apiGateway.chat.send as FnMock).mockRejectedValue(
      new mocked.ApiError(400, 'Prompt (~3937667 tokens) exceeds the context size (98304 tokens)', {
        error: 'Prompt (~3937667 tokens) exceeds the context size (98304 tokens)',
        code: 'context_overflow',
        estimatedTokens: 3937667,
        contextLength: 98304,
      }),
    );

    await store.sendMessage('Разбери PDF');

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.sendError?.kind).toBe('context_overflow');
    expect(state.sendError?.title).toBe('Контекст переполнен');
    expect(state.sendError?.estimatedTokens).toBe(3937667);
    expect(state.sendError?.contextLength).toBe(98304);
    expect(state.sendError?.detail).toContain('3.94M');
    expect(state.sendError?.detail).toContain('98K');
    expect(state.sendError?.failedText).toBe('Разбери PDF');
  });

  it('13. ТЗ context-overflow-ux: жёсткий 400 llama.cpp (type=exceed_context_size_error) → числа проброшены в баннер', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [];
    store.questionCounter = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    (apiGateway.chat.send as FnMock).mockRejectedValue(
      new mocked.ApiError(500, 'request (3937667 tokens) exceeds the available context size (98304 tokens)', {
        error: 'request (3937667 tokens) exceeds the available context size (98304 tokens)',
        type: 'exceed_context_size_error',
        n_prompt_tokens: 3937667,
        n_ctx: 98304,
      }),
    );

    await store.sendMessage('Q');

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.sendError?.kind).toBe('context_overflow');
    expect(state.sendError?.estimatedTokens).toBe(3937667);
    expect(state.sendError?.contextLength).toBe(98304);
  });

  it('14. ТЗ context-overflow-ux: новая отправка гасит предыдущий sendError (успех — баннера нет)', async () => {
    const store = useSessionStore.getState();
    store.activeSessionId = 'a1';
    store.viewingSessionId = 'a1';
    store.messages = [];
    store.questionCounter = 0;
    store.contextMode = 'standard';
    store.selectedQuestionIds = [];

    s().create.mockResolvedValue({ id: 'a1' });

    // stale sendError от предыдущей провальной отправки
    useSessionStore.setState({
      sendError: {
        sessionId: 'a1',
        kind: 'network',
        title: 'Нет связи с сервером',
        detail: 'старая ошибка',
        failedText: 'старый вопрос',
      },
    });

    (apiGateway.chat.send as FnMock).mockResolvedValue({
      response: 'ok answer',
      model: 'test-model',
      metrics: { inputTokens: 10, outputTokens: 5 },
    });

    await store.sendMessage('Q');

    const state = useSessionStore.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('ok answer');
    expect(state.sendError).toBeNull();
  });
});

// ============================================================
// ТЗ Project mode A (§4): mode сессии + setMode (PATCH)
// ============================================================
describe('sessionStore.mode (ТЗ Project mode A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ ...initialSessionState, activeSessionId: 'sess-1' });
  });

  it('default mode research', () => {
    expect(useSessionStore.getState().mode).toBe('research');
  });

  it('setMode("project"): оптимистично ставит mode и PATCHает сессию', async () => {
    mocked.apiGateway.sessions.update.mockResolvedValue({ id: 'sess-1' });

    await useSessionStore.getState().setMode('project');

    expect(mocked.apiGateway.sessions.update).toHaveBeenCalledWith('sess-1', { mode: 'project' });
    expect(useSessionStore.getState().mode).toBe('project');
  });

  it('setMode: ошибка PATCH → mode откатывается', async () => {
    mocked.apiGateway.sessions.update.mockRejectedValue(new mocked.ApiError(400, 'bad mode'));

    await expect(useSessionStore.getState().setMode('project')).rejects.toThrow('bad mode');
    expect(useSessionStore.getState().mode).toBe('research');
  });

  it('init(): mode читается из session.mode (legacy chat → research)', async () => {
    mocked.apiGateway.sessions.get.mockResolvedValue({
      id: 'sess-1',
      title: 't',
      category: 'General',
      sysprompt: '',
      message_count: 0,
      created_at: '',
      updated_at: '',
      mode: 'project',
    });
    mocked.apiGateway.sessions.getMessages.mockResolvedValue([]);
    localStorage.setItem('activeSessionId', 'sess-1');
    // jsdom: location.search === '' и history.replaceState доступны — URL-ветка init() не сработает

    await useSessionStore.getState().init();

    expect(useSessionStore.getState().mode).toBe('project');
  });
});
