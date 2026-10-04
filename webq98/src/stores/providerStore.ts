import { create } from 'zustand';
import type { ProviderInfo, ModelInfo, ModelDetail } from '@/types';

interface ProviderStore {
  providers: ProviderInfo[];
  currentProvider: 'ollama' | 'llama.cpp';
  models: ModelInfo[];
  currentModel: string | null;
  modelDetail: ModelDetail | null;
  currentContextLength: number | null;
  isLoadingModels: boolean;

  setProviders: (providers: ProviderInfo[]) => void;
  setCurrentProvider: (provider: 'ollama' | 'llama.cpp') => void;
  loadModels: (provider: string) => Promise<void>;
  selectModel: (name: string) => void;
  refreshStatus: () => Promise<void>;
  getModelInfo: () => Promise<void>;
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
  },

  async loadModels(provider: string) {
    set({ isLoadingModels: true });
    try {
      const data = await fetch('/api/models', {
        headers: { 'X-Provider': provider },
      }).then((r) => r.json());

      if (data.connected && data.models) {
        const models: ModelInfo[] = (data.models as Array<{ name: string; size: number; contextLength?: number; type?: string }>).map((m) => ({
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
      const detail = await fetch('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Provider': provider },
        body: JSON.stringify({ name }),
      }).then((r) => r.json());

      const contextLength =
        detail?.details?.context_length ||
        detail?.parameters?.context_length ||
        get().models.find((m) => m.name === name)?.contextLength ||
        null;

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
      const data = await fetch('/api/providers/status').then((r) => r.json());
      const providers: ProviderInfo[] = (data || []).map((p: { name: string; status: string; latencyMs?: number; error?: string }) => ({
        name: p.name as 'ollama' | 'llama.cpp',
        status: (p.status === 'connected' ? 'connected' : p.status === 'checking' ? 'checking' : 'disconnected') as ProviderInfo['status'],
        latencyMs: p.latencyMs,
        error: p.error,
        url: '',
        enabled: true,
      }));
      set({ providers });

      const current = providers.find((p) => p.name === get().currentProvider);
      if (current && current.status !== 'connected') {
        const fallback = providers.find((p) => p.status === 'connected');
        if (fallback && fallback.name !== get().currentProvider) {
          // Auto-suggest fallback via toast (handled by uiStore)
        }
      }
    } catch {
      // ignore
    }
  },

  async getModelInfo() {
    const { currentModel, currentProvider } = get();
    if (!currentModel) return;

    try {
      const detail = await fetch('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Provider': currentProvider },
        body: JSON.stringify({ name: currentModel }),
      }).then((r) => r.json());

      const contextLength =
        detail?.details?.context_length ||
        detail?.parameters?.context_length ||
        get().models.find((m) => m.name === currentModel)?.contextLength ||
        null;

      set({ modelDetail: detail, currentContextLength: contextLength });
    } catch {
      // ignore
    }
  },
}));
