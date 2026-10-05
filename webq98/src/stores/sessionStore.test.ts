import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionStore, initialSessionState } from './sessionStore';

// vi.mock is hoisted to top of file, so we must define mocks inline
// See: https://vitest.dev/api/vi.html#vi-mock

vi.mock('@/lib/apiGateway', () => ({
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

vi.mock('@/stores/providerStore', () => ({
  useProviderStore: {
    getState: vi.fn(() => ({
      currentModel: 'test-model',
      currentProvider: 'llama_cpp' as const,
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
    Object.defineProperty(window, 'location', {
      value: { search: '?session=hist1', pathname: '/' },
      writable: false,
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
