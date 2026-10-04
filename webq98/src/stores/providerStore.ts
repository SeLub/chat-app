import { create } from 'zustand';
import type { ProviderInfo, ModelInfo } from '@/types';
import { apiGateway } from '@/lib/apiGateway';
import { useUIStore } from './uiStore';

let previousStatuses: Record<string, string> = {};
let pollingIntervalId: number | null = null;
let initialized = false;

interface ProviderStore {
  providers: ProviderInfo[];
  currentProvider: 'ollama' | 'llama.cpp';
  models: ModelInfo[];
  currentModel: string | null;
  modelDetail: { details?: { size?: number; parent_model?: string; format?: string; family?: string } } | null;
  currentContextLength: number | null;
  isLoadingModels: boolean;

  setProviders: (providers: ProviderInfo[]) => void;
  setCurrentProvider: (provider: 'ollama' | 'llama.cpp') => void;
  loadModels: (provider: string) => Promise<void>;
  selectModel: (name: string) => void;
  refreshStatus: () => Promise<void>;
  init: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

function extractContextLength(detail: unknown, modelName: string, models: ModelInfo[]): number | null {
  if (!detail || typeof detail !== 'object') {
    return (models.find(m => m.name === modelName)?.contextLength) || null;
  }

  const d = detail as Record<string, unknown>;

  // 1) scan model_info for any key containing 'context_length' (case-insensitive)
  if (d.model_info && typeof d.model_info === 'object') {
    const info = d.model_info as Record<string, unknown>;
    for (const key of Object.keys(info)) {
      if (/context_length/i.test(key)) {
        const val = info[key];
        if (typeof val === 'number') return val;
      }
    }
  }

  // 2) parameters.context_length
  if (d.parameters && typeof d.parameters === 'object') {
    const params = d.parameters as { context_length?: number };
    if (typeof params.context_length === 'number') return params.context_length;
  }

  // 3) fall back to models list
  return (models.find(m => m.name === modelName)?.contextLength) || null;
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  currentProvider: 'ollama',
  models: [],
  currentModel: null,
  modelDetail: null,
  currentContextLength: null,
  isLoadingModels: false,

  setProviders(providers) {
    set({ providers });
  },

  setCurrentProvider(provider) {
    set({ currentProvider: provider });
    localStorage.setItem('selectedProvider', provider);
    get().loadModels(provider);
  },

  async loadModels(provider: string) {
    set({ isLoadingModels: true });
    try {
      const data = await apiGateway.models.list(provider);

      if (data?.connected && data.models) {
        const models: ModelInfo[] = data.models.map((m) => ({
          name: m.name,
          size: m.size || 0,
          contextLength: m.contextLength || 0,
          type: m.type === 'vision' ? 'vision' : 'chat',
          provider: provider as 'ollama' | 'llama.cpp',
        }));
        set({ models });
      }
    } catch (e) {
      console.error(`Failed to load models from ${provider}`, e);
    } finally {
      set({ isLoadingModels: false });
    }
  },

  async selectModel(name: string) {
    if (!name) {
      set({ currentModel: null, modelDetail: null, currentContextLength: null });
      return;
    }

    const provider = get().currentProvider;
    set({ currentModel: name });
    localStorage.setItem('selectedModel', name);
    localStorage.setItem('selectedProvider', provider);

    try {
      const detail = await apiGateway.models.show(name, provider);
      const contextLength = extractContextLength(detail, name, get().models);

      set({
        modelDetail: detail,
        currentContextLength: contextLength,
      });
    } catch {
      set({ modelDetail: null, currentContextLength: null });
    }
  },

  async refreshStatus() {
    try {
      const data = await apiGateway.providers.status();
      const rawProviders = data?.providers || [];

      const currentMap: Record<string, string> = {};
      const providers: ProviderInfo[] = rawProviders.map((p) => {
        const name = p.name as 'ollama' | 'llama.cpp';
        const status = (p.status === 'connected' ? 'connected' : p.status === 'checking' ? 'checking' : 'disconnected') as ProviderInfo['status'];
        currentMap[name] = status;

        const oldStatus = previousStatuses[name];
        if (oldStatus === 'connected' && status !== 'connected') {
          const fallback = rawProviders.find((r) => r.status === 'connected' && r.name !== name);
          const msg = fallback
            ? `${name} недоступен. 💡 Переключись на ${fallback.name} для продолжения`
            : `${name} недоступен`;
          useUIStore.getState().addToast(msg, 'error');
        }

        return {
          name,
          status,
          latencyMs: p.latencyMs,
          error: p.error,
          url: undefined,
          enabled: undefined,
        };
      });

      previousStatuses = currentMap;
      set({ providers });
    } catch {
      // ignore
    }
  },

  async init() {
    if (initialized) return;
    initialized = true;

    await get().refreshStatus();
    const savedProvider = localStorage.getItem('selectedProvider');
    if (savedProvider === 'ollama' || savedProvider === 'llama.cpp') {
      if (savedProvider !== get().currentProvider) {
        set({ currentProvider: savedProvider as 'ollama' | 'llama.cpp' });
      }
    }
    await get().loadModels(get().currentProvider);

    // Restore selected model
    const savedModel = localStorage.getItem('selectedModel');
    if (savedModel) {
      const models = get().models;
      if (models.some((m) => m.name === savedModel)) {
        get().selectModel(savedModel);
      }
    }
  },

  startPolling() {
    if (pollingIntervalId !== null) return;
    pollingIntervalId = window.setInterval(() => {
      get().refreshStatus();
    }, 30000);
  },

  stopPolling() {
    if (pollingIntervalId !== null) {
      window.clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  },
}));
