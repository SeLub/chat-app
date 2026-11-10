import { create } from 'zustand';
import type { ProviderInfo, ModelInfo, ProviderName } from '@/types';
import { apiGateway } from '@/lib/apiGateway';
import { useUIStore } from './uiStore';

let previousStatuses: Record<string, string> = {};
let pollingIntervalId: number | null = null;
let initialized = false;

interface ProviderStore {
  providers: ProviderInfo[];
  currentProvider: ProviderName;
  models: ModelInfo[];
  currentModel: string | null;
  // ТЗ stats-size: llama.cpp showModel отдаёт размер файла верхним уровнем (size),
  // Ollama /api/show — объект details без size. Оба варианта опциональны.
  modelDetail: { size?: number; details?: { size?: number; parent_model?: string; format?: string; family?: string } } | null;
  currentContextLength: number | null;
  isLoadingModels: boolean;

  setProviders: (providers: ProviderInfo[]) => void;
  setCurrentProvider: (provider: ProviderName) => void;
  loadModels: (provider: ProviderName) => Promise<void>;
  selectModel: (name: string) => void;
  refreshStatus: () => Promise<void>;
  init: () => Promise<void>;
  // polling removed from UI (TZ-4.5), keep for now
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
    // TZ-A.1: сброс модели/деталей/контекста предыдущего провайдера ДО загрузки новых —
    // иначе старая модель «прилипает» к новому провайдеру
    set({
      currentProvider: provider,
      currentModel: null,
      modelDetail: null,
      currentContextLength: null,
    });
    localStorage.setItem('selectedProvider', provider);
    void get()
      .loadModels(provider)
      .then(() => {
        // TZ-A.1: единственная модель нового провайдера → авто-выбор (§7.93)
        if (get().currentModel === null) {
          const providerModels = get().models.filter((m) => m.provider === provider);
          if (providerModels.length === 1) {
            void get().selectModel(providerModels[0].name);
          }
        }
      });
  },

  async loadModels(provider: ProviderName) {
    set({ isLoadingModels: true });
    try {
      const data = await apiGateway.models.list(provider);

      if (data?.connected && data.models) {
        const models: ModelInfo[] = data.models.map((m) => ({
          name: m.name,
          size: m.size || 0,
          contextLength: m.contextLength || 0,
          type: m.type === 'vision' ? 'vision' : 'chat',
          provider,
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
        const name = p.name as ProviderName;
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

    // Resolve the live provider (§7.92): saved if connected, else first connected by priority
    const saved = localStorage.getItem('selectedProvider');
    const statusOf = (n: string) => get().providers.find((p) => p.name === n)?.status;
    const PRIORITY: ProviderName[] = ['llama_cpp', 'ollama'];
    let resolved: ProviderName | null = null;
    if (saved === 'ollama' || saved === 'llama_cpp') {
      if (statusOf(saved) === 'connected') resolved = saved;
    }
    if (!resolved) {
      resolved = PRIORITY.find((n) => statusOf(n) === 'connected') ?? null;
    }
    if (resolved && resolved !== get().currentProvider) {
      set({ currentProvider: resolved });
      localStorage.setItem('selectedProvider', resolved);
    }

    await get().loadModels(get().currentProvider);

    // Restore selected model; auto-select the only model (§7.93)
    const savedModel = localStorage.getItem('selectedModel');
    const models = get().models;
    if (savedModel && models.some((m) => m.name === savedModel)) {
      get().selectModel(savedModel);
    } else if (models.length === 1) {
      get().selectModel(models[0].name);
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
