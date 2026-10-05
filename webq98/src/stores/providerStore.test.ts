import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useProviderStore } from './providerStore';

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

vi.mock('@/stores/uiStore', () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      addToast: vi.fn(),
    })),
  },
}));

import { apiGateway } from '@/lib/apiGateway';

type FnMock = ReturnType<typeof vi.fn>;

function getProvidersMock() {
  return apiGateway.providers as unknown as { status: FnMock };
}

function getModelsMock() {
  return apiGateway.models as unknown as { list: FnMock; show: FnMock };
}

function resetStore() {
  // Reset module-level state by re-importing
  // Since providerStore uses module-level vars (previousStatuses, initialized),
  // we need to reset them. We do this by setting the store to defaults manually.
  const store = useProviderStore.getState();
  store.setProviders([]);
  store.setCurrentProvider('ollama');
  store.selectModel('');
  // Reset module-level flags by reassigning — we can't access them directly,
  // so we use the init guard: set initialized=true and then call init() which
  // will return early. But we can't reset the flag. Instead, we reset by
  // calling stopPolling and clearing any interval.
  store.stopPolling();
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('providerStore — refreshStatus and selectModel', () => {
  it('1. refreshStatus: providers.status returns wrapped object → state.providers[0].status', async () => {
    getProvidersMock().status.mockResolvedValue({
      providers: [{ name: 'ollama', status: 'connected' }],
    });

    await useProviderStore.getState().refreshStatus();

    const state = useProviderStore.getState();
    expect(state.providers[0].name).toBe('ollama');
    expect(state.providers[0].status).toBe('connected');
  });

  it('2. selectModel: show returns model_info with context_length → currentContextLength', async () => {
    getModelsMock().show.mockResolvedValue({
      model_info: { 'llama.context_length': 4096 },
    });

    await useProviderStore.getState().selectModel('test-model');

    const state = useProviderStore.getState();
    expect(state.currentContextLength).toBe(4096);
  });

  it('3. selectModel: show returns parameters.context_length → 8192', async () => {
    getModelsMock().show.mockResolvedValue({
      parameters: { context_length: 8192 },
    });

    await useProviderStore.getState().selectModel('test-model');

    const state = useProviderStore.getState();
    expect(state.currentContextLength).toBe(8192);
  });

  it('4. selectModel: show returns {} with contextLength in models list → fallback', async () => {
    getModelsMock().show.mockResolvedValue({});

    // Pre-populate models list with a model that has contextLength
    const store = useProviderStore.getState();
    store.models = [
      { name: 'test-model', size: 0, contextLength: 2048, type: 'chat', provider: 'ollama' },
    ] as never;

    await store.selectModel('test-model');

    const state = useProviderStore.getState();
    expect(state.currentContextLength).toBe(2048);
  });
});

describe('providerStore — init', () => {
  it('5. init: bogus selectedProvider in localStorage ignored → stays ollama', async () => {
    localStorage.setItem('selectedProvider', 'bogus');
    getProvidersMock().status.mockResolvedValue({ providers: [] });
    getModelsMock().list.mockResolvedValue({ connected: true, models: [] });

    vi.resetModules();
    const { useProviderStore: freshStore } = await import('./providerStore');

    await freshStore.getState().init();

    expect(freshStore.getState().currentProvider).toBe('ollama');
  });
});
