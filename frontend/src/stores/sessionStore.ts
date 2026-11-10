import { create } from 'zustand';
import type { ChatMessage, ResponseMetrics } from '@/types';
import { apiGateway, ApiError } from '@/lib/apiGateway';
import { useProviderStore } from './providerStore';
import { useUIStore } from './uiStore';

const DEFAULT_SYSPROMPT =
  'Ты Senior Developer. Отвечай четко, структурированно и по существу. Ты мыслишь архитектурно, производительность, системность.';

// ── Loose JSON parser: field may be stringified JSON or already parsed ──
function parseLoose<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') return value as T;
  return fallback;
}

// ── Map Q&A pairs from GET /sessions/:id/messages → ChatMessage[] ──
// Финальное ТЗ: image_data демонтирован — превью строится из attachments_meta
// (первый kind='image' с thumbnailUrl), которую возвращает реестр attachments.
type QAPairImageMeta = { kind?: string; thumbnailUrl?: string; fullUrl?: string; name?: string };

function mapQAPairsToMessages(
  pairs: Array<{
    questionId: string;
    questionText: string;
    answerText?: string;
    model?: string;
    attachments_meta?: unknown;
    attachmentsMeta?: unknown;
    metrics?: unknown;
  }>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const m of pairs) {
    const attachmentsMeta = parseLoose(
      m.attachments_meta ?? m.attachmentsMeta,
      [],
    ) as unknown as ChatMessage['attachmentsMeta'];
    const metrics = parseLoose(m.metrics, undefined);

    const metaList = Array.isArray(attachmentsMeta) ? (attachmentsMeta as QAPairImageMeta[]) : [];
    const imageMeta = metaList.find((a) => a?.kind === 'image' && a?.thumbnailUrl);
    const imageData = imageMeta
      ? {
          thumbnailUrl: imageMeta.thumbnailUrl!,
          fullUrl: imageMeta.fullUrl!,
          filename: imageMeta.name!,
        }
      : undefined;

    // user message from every pair
    messages.push({
      role: 'user',
      content: m.questionText,
      questionId: m.questionId,
      model: m.model || 'unknown',
      attachmentsMeta: (attachmentsMeta ?? []) as ChatMessage['attachmentsMeta'],
      imageData,
    });

    // assistant message only if answerText is non-empty
    if (m.answerText && m.answerText.trim().length > 0) {
      messages.push({
        role: 'assistant',
        content: m.answerText,
        questionId: m.questionId,
        model: m.model || 'unknown',
        metrics: metrics as ResponseMetrics | undefined,
        attachmentsMeta: (attachmentsMeta ?? []) as ChatMessage['attachmentsMeta'],
        imageData,
      });
    }
  }
  return messages;
}

interface SessionStore {
  activeSessionId: string | null;
  viewingSessionId: string | null;
  currentSessionTitle: string;
  messages: ChatMessage[];
  sysprompt: string;
  syspromptDirty: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  questionCounter: number;
  contextMode: 'standard' | 'manual';
  selectedQuestionIds: string[];
  retainPercent: number;
  contextInfo?: { contextSize: number; totalChars: number; includedQAPairs: number; totalQAPairs: number };

  init: () => Promise<void>;
  switchToViewing: (sessionId: string) => Promise<void>;
  returnToCurrent: () => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  addBotMessage: (
    content: string,
    model: string,
    metrics?: ResponseMetrics,
    excludedIndices?: number[],
    contextInfo?: SessionStore['contextInfo'],
  ) => void;
  updateSysprompt: (sysprompt: string) => Promise<void>;
  setSysprompt: (sysprompt: string) => void;
  deleteMessage: (questionId: string) => Promise<void>;
  clearChat: () => Promise<void>;
  exportConversation: () => void;
  loadViewingSession: () => Promise<void>;
  saveConversation: (title: string, category: string) => Promise<void>;
  sendMessage: (
    message: string,
    files?: { file?: File; codeFiles?: File[] },
  ) => Promise<void>;

  // context state
  saveContextState: () => void;
  loadContextState: () => void;
  resetContextState: () => void;
  toggleContextMode: () => void;
  toggleQuestionSelection: (id: string) => void;
  selectAllQuestions: () => void;
  deselectAllQuestions: () => void;
  setRetainPercent: (v: number) => void;
  purgeSessionKeys: (sessionId: string) => void;
  startFreshAfterDelete: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<'deleted' | 'fresh' | 'error'>;
}

// ── localStorage helpers with try/catch ──
function persistContextKey(sessionId: string, key: string, value: unknown) {
  try {
    localStorage.setItem(`contextMode_${sessionId}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function persistSelectedKey(sessionId: string, value: unknown) {
  try {
    localStorage.setItem(`selectedIds_${sessionId}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function loadContextMode(sessionId: string): 'standard' | 'manual' | null {
  try {
    const raw = localStorage.getItem(`contextMode_${sessionId}`);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return parsed === 'manual' ? 'manual' : 'standard';
  } catch {
    return null;
  }
}

function loadSelectedIds(sessionId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`selectedIds_${sessionId}`);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const initialSessionState: Omit<SessionStore, 'init' | 'switchToViewing' | 'returnToCurrent' | 'addMessage' | 'addBotMessage' | 'updateSysprompt' | 'setSysprompt' | 'deleteMessage' | 'clearChat' | 'exportConversation' | 'loadViewingSession' | 'saveConversation' | 'sendMessage' | 'saveContextState' | 'loadContextState' | 'resetContextState' | 'toggleContextMode' | 'toggleQuestionSelection' | 'selectAllQuestions' | 'deselectAllQuestions' | 'setRetainPercent' | 'purgeSessionKeys' | 'startFreshAfterDelete' | 'deleteSession'> = {
  activeSessionId: null,
  viewingSessionId: null,
  currentSessionTitle: '',
  messages: [],
  sysprompt: DEFAULT_SYSPROMPT,
  syspromptDirty: false,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  questionCounter: 0,
  contextMode: 'standard',
  selectedQuestionIds: [],
  retainPercent: 80,
  contextInfo: undefined,
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialSessionState,

  init: async () => {
    const savedActive = localStorage.getItem('activeSessionId');
    const savedViewing = localStorage.getItem('viewingSessionId');
    const savedRetain = localStorage.getItem('retainPercent');

    if (savedRetain) {
      try {
        const parsed = parseInt(savedRetain, 10);
        if (!isNaN(parsed)) {
          set({ retainPercent: parsed });
        }
      } catch {
        /* ignore */
      }
    }

    // Handle URL parameter ?session=<id>
    const params = new URLSearchParams(window.location.search);
    const urlSession = params.get('session');
    if (urlSession) {
      // Ensure active is set before switchToViewing
      if (savedActive) {
        set({ activeSessionId: savedActive });
      } else {
        try {
          const data = await apiGateway.sessions.create();
          if (data) {
            set({ activeSessionId: data.id });
            localStorage.setItem('activeSessionId', data.id);
          }
        } catch {
          /* ignore */
        }
      }
      await get().switchToViewing(urlSession);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (savedActive) {
      try {
        const session = await apiGateway.sessions.get(savedActive);
        if (session) {
          const viewing = savedViewing || savedActive;
          set({
            activeSessionId: savedActive,
            viewingSessionId: viewing,
            currentSessionTitle: session.title || '',
            sysprompt: session.sysprompt?.trim() || DEFAULT_SYSPROMPT,
          });

          // restore context state
          set({ contextMode: 'standard', selectedQuestionIds: [] });
          get().loadContextState();

          const rawMessages = await apiGateway.sessions.getMessages(savedActive);
          if (rawMessages && Array.isArray(rawMessages)) {
            const normalized = mapQAPairsToMessages(rawMessages);
            const questionCount = normalized.filter((m) => m.role === 'user').length;
            set({
              messages: normalized,
              questionCounter: questionCount,
            });
          }
          return;
        }
      } catch {
        localStorage.removeItem('activeSessionId');
        localStorage.removeItem('viewingSessionId');
      }
    }

    // No valid saved session — create new
    try {
      const data = await apiGateway.sessions.create();
      if (data) {
        set({
          activeSessionId: data.id,
          viewingSessionId: data.id,
          currentSessionTitle: data.title || '',
          sysprompt: DEFAULT_SYSPROMPT,
        });
        localStorage.setItem('activeSessionId', data.id);
        localStorage.setItem('viewingSessionId', data.id);
      }
    } catch {
      console.error('Failed to create session');
    }
  },

  switchToViewing: async (sessionId: string) => {
    // Force standard mode when viewing a historical session
    set({
      viewingSessionId: sessionId,
      contextMode: 'standard',
      selectedQuestionIds: [],
    });
    localStorage.setItem('viewingSessionId', sessionId);

    // Load metadata
    try {
      const session = await apiGateway.sessions.get(sessionId);
      if (session) {
        set({
          currentSessionTitle: session.title || '',
          sysprompt: session.sysprompt?.trim() || DEFAULT_SYSPROMPT,
        });
      }
    } catch {
      set({ currentSessionTitle: '' });
    }

    // Load messages — do NOT call loadContextState (already forced standard + empty selected)
    const rawMessages = await apiGateway.sessions.getMessages(sessionId);
    if (rawMessages && Array.isArray(rawMessages)) {
      const normalized = mapQAPairsToMessages(rawMessages);
      const questionCount = normalized.filter((m) => m.role === 'user').length;
      set({
        messages: normalized,
        questionCounter: questionCount,
      });
    }
  },

  returnToCurrent: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    set({ viewingSessionId: activeSessionId });
    localStorage.setItem('viewingSessionId', activeSessionId);

    try {
      const session = await apiGateway.sessions.get(activeSessionId);
      if (session) {
        set({
          currentSessionTitle: session.title || '',
          sysprompt: session.sysprompt || DEFAULT_SYSPROMPT,
        });
      }
    } catch {
      set({ currentSessionTitle: '' });
    }

    await get().loadViewingSession();
    get().loadContextState();
  },

  addMessage: (msg: ChatMessage) => {
    set((state) => ({
      messages: [...state.messages, msg],
      questionCounter: state.questionCounter + 1,
    }));
  },

  addBotMessage(
    content: string,
    model: string,
    metrics?: ResponseMetrics,
    excludedIndices?: number[],
    contextInfo?: SessionStore['contextInfo'],
  ) {
    const inputTokens = metrics?.inputTokens || 0;
    const outputTokens = metrics?.outputTokens || 0;

    set((state) => {
      const lastUserMsg = [...state.messages].reverse().find((m) => m.role === 'user');
      const updatedMessages = [
        ...state.messages,
        {
          role: 'assistant' as const,
          content,
          questionId: lastUserMsg?.questionId || '',
          model,
          metrics,
          excludedIndices,
        },
      ];

      return {
        messages: updatedMessages,
        totalInputTokens: state.totalInputTokens + inputTokens,
        totalOutputTokens: state.totalOutputTokens + outputTokens,
        contextInfo,
      };
    });
  },

  setSysprompt: (sysprompt: string) => {
    set({ sysprompt, syspromptDirty: true });
  },

  updateSysprompt: async (sysprompt: string) => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    set({ sysprompt, syspromptDirty: false });
    try {
      await apiGateway.sessions.update(viewingSessionId, { sysprompt });
    } catch {
      // ignore
    }
  },

  deleteMessage: async (questionId: string) => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    try {
      await apiGateway.sessions.deleteQAPair(viewingSessionId, questionId);
      set((state) => ({
        messages: state.messages.filter((m) => m.questionId !== questionId),
        selectedQuestionIds: state.selectedQuestionIds.filter((id) => id !== questionId),
      }));
      if (get().viewingSessionId === get().activeSessionId) {
        get().saveContextState();
      }
      useUIStore.getState().addToast('Q&A pair deleted', 'success');
    } catch {
      console.error('Failed to delete message');
      useUIStore.getState().addToast('Failed to delete', 'error');
    }
  },

  clearChat: async () => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    // Archive current session
    try {
      const allSessions = await apiGateway.sessions.list();
      const session = allSessions?.find((s) => s.id === viewingSessionId);
      const unsavedPrefix = 'unsavedSession';
      const unsavedSessions = allSessions?.filter(
        (s) => !s.title || s.title.startsWith(unsavedPrefix),
      ) || [];

      let newTitle: string | undefined;
      if (!session?.title || session.title.startsWith(unsavedPrefix)) {
        const count = unsavedSessions.length;
        newTitle = `${unsavedPrefix} ${count + 1}`;
      }

      if (newTitle) {
        await apiGateway.sessions.update(viewingSessionId, { title: newTitle });
      }
    } catch {
      // ignore archive errors
    }

    // Create new session
    const newSession = await apiGateway.sessions.create();
    if (!newSession) return;

    const oldActive = viewingSessionId;
    set({
      activeSessionId: newSession.id,
      viewingSessionId: newSession.id,
      currentSessionTitle: newSession.title || '',
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      questionCounter: 0,
      contextMode: 'standard',
      selectedQuestionIds: [],
      sysprompt: DEFAULT_SYSPROMPT,
      syspromptDirty: false,
      contextInfo: undefined,
    });
    localStorage.setItem('activeSessionId', newSession.id);
    localStorage.setItem('viewingSessionId', newSession.id);

    // Reset context state for old session
    try {
      localStorage.removeItem(`contextMode_${oldActive}`);
      localStorage.removeItem(`selectedIds_${oldActive}`);
    } catch {
      /* ignore */
    }
  },

  exportConversation: () => {
    const { messages, viewingSessionId } = get();
    if (messages.length === 0) return;

    const data = JSON.stringify(messages, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${viewingSessionId?.slice(0, 8)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  loadViewingSession: async () => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    try {
      const session = await apiGateway.sessions.get(viewingSessionId);
      if (session) {
        set({
          currentSessionTitle: session.title || '',
          sysprompt: session.sysprompt?.trim() || DEFAULT_SYSPROMPT,
        });
      }

      const rawMessages = await apiGateway.sessions.getMessages(viewingSessionId);
      if (rawMessages && Array.isArray(rawMessages)) {
        const normalized = mapQAPairsToMessages(rawMessages);
        const questionCount = normalized.filter((m) => m.role === 'user').length;
        set({
          messages: normalized,
          questionCounter: questionCount,
        });
      }
    } catch {
      console.error('Failed to load viewing session');
    }
  },

  saveConversation: async (title: string, category: string) => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    try {
      await apiGateway.sessions.update(viewingSessionId, { title, category });
      set({ currentSessionTitle: title });
    } catch {
      console.error('Failed to save conversation');
    }
  },

  // ── sendMessage contract (§3.1) ──
  sendMessage: async (message: string, files?: { file?: File; codeFiles?: File[] }) => {
    const { viewingSessionId, questionCounter, messages } = get();

    // Guards
    if (!viewingSessionId) {
      throw new Error('No viewing session');
    }
    const { currentModel, currentProvider } = useProviderStore.getState();
    if (!currentModel) {
      throw new Error('No model selected');
    }

    // Generate questionId
    const n = questionCounter + 1;
    const questionId = `q_${n}_${Date.now()}`;

    // attachmentsMeta for optimistic message
    const attachmentsMeta = files
      ? [
          ...(files.file ? [{ name: files.file.name, size: files.file.size, type: files.file.type }] : []),
          ...(files.codeFiles ?? []).map((f) => ({ name: f.name, size: f.size, type: f.type })),
        ]
      : [];

    // Optimistic user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: message,
      questionId,
      model: currentModel,
      attachmentsMeta,
    };
    get().addMessage(userMsg);

    // sysprompt-sync: if dirty, PATCH before send
    if (get().syspromptDirty) {
      try {
        await get().updateSysprompt(get().sysprompt);
      } catch {
        // continue even if sysprompt save fails
      }
    }

    // includeQuestionIds
    let includeQuestionIds: string[];
    if (get().contextMode === 'standard') {
      // ALL user messages including the new one
      includeQuestionIds = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.questionId);
      includeQuestionIds.push(questionId);
    } else {
      // manual: selectedQuestionIds AS IS (new question may not be selected)
      includeQuestionIds = [...get().selectedQuestionIds];
    }

    // Call API
    let result: Awaited<ReturnType<typeof apiGateway.chat.send>>;
    try {
      result = await apiGateway.chat.send(
        {
          sessionId: viewingSessionId,
          message,
          model: currentModel,
          questionId,
          contextLength: useProviderStore.getState().currentContextLength ?? undefined,
          retainPercent: get().retainPercent,
          includeQuestionIds,
        },
        currentProvider,
        files,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        get().addBotMessage(
          `⚠️ **${currentProvider} is unavailable**\n\n${e.message}\n\nПроверь статус провайдера или смени провайдера.`,
          currentModel,
        );
        useProviderStore.getState().refreshStatus();
        return;
      }
      if (e instanceof ApiError) {
        get().addBotMessage(`❌ **Error ${e.status}**\n\n${e.message}`, currentModel);
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      get().addBotMessage(
        `❌ **Network error**\n\n${msg}\n\nПроверь соединение с сервером.`,
        currentModel,
      );
      return;
    }

    if (!result) {
      // null response — network error already logged by apiGateway
      get().addBotMessage(
        '⚠️ **Request failed**\n\nNo response received from the server.',
        currentModel,
      );
      // After failed send at viewing ≠ active, don't sync active
      return;
    }

    // Handle response
    if (result.error) {
      let errorMsg: string;
      if (result.error.includes('ECONNREFUSED')) {
        errorMsg =
          '⚠️ **Connection refused**\n\n' +
          'The backend server is not running or the URL is incorrect.\n' +
          'Make sure the server (port 3000) is started and accessible.';
      } else {
        errorMsg = `❌ **Error**\n\n${result.error}`;
      }
      const providers = useProviderStore.getState().providers;
      const fallback = providers.find((p) => p.status === 'connected' && p.name !== currentProvider);
      if (fallback) {
        errorMsg += `\n\n💡 Switch to ${fallback.name} to continue.`;
      }
      get().addBotMessage(errorMsg, currentModel);
      useProviderStore.getState().refreshStatus();
      return;
    }

    // Accumulate tokens
    const metrics = result.metrics
      ? {
          inputTokens: result.metrics.inputTokens || 0,
          outputTokens: result.metrics.outputTokens || 0,
          tps: result.metrics.tps,
          promptTps: result.metrics.promptTps,
          ttft: result.metrics.ttft,
          loadTime: result.metrics.loadTime,
          totalTime: result.metrics.totalTime,
        }
      : undefined;

    get().addBotMessage(
      result.response,
      currentModel,
      metrics,
      result.excludedIndices,
      result.contextInfo,
    );

    // After successful send at viewing ≠ active, sync active
    if (get().viewingSessionId !== get().activeSessionId) {
      const newActive = get().viewingSessionId!;
      set({ activeSessionId: newActive });
      localStorage.setItem('activeSessionId', newActive);
    }
  },

  // ── Context state persistence ──
  saveContextState: () => {
    const { activeSessionId, contextMode, selectedQuestionIds } = get();
    if (!activeSessionId) return;
    persistContextKey(activeSessionId, 'contextMode', contextMode);
    persistSelectedKey(activeSessionId, selectedQuestionIds);
  },

  loadContextState: () => {
    const { activeSessionId, messages } = get();
    if (!activeSessionId) return;

    const mode = loadContextMode(activeSessionId);
    const selected = loadSelectedIds(activeSessionId);

    if (mode !== null) {
      set({ contextMode: mode });
    }

    if (selected !== null) {
      set({ selectedQuestionIds: selected });
    } else {
      // No saved selection → default = all question ids
      const allIds = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.questionId);
      set({ selectedQuestionIds: allIds });
    }
  },

  resetContextState: () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    try {
      localStorage.removeItem(`contextMode_${activeSessionId}`);
      localStorage.removeItem(`selectedIds_${activeSessionId}`);
    } catch {
      /* ignore */
    }
  },

  // ── Context actions ──
  toggleContextMode: () => {
    if (get().viewingSessionId !== get().activeSessionId) return;
    set((state) => {
      const newMode = state.contextMode === 'standard' ? 'manual' : 'standard';
      // Switching to standard → select all
      const newSelected =
        newMode === 'standard'
          ? state.messages
              .filter((m) => m.role === 'user')
              .map((m) => m.questionId)
          : state.selectedQuestionIds;
      return { contextMode: newMode, selectedQuestionIds: newSelected };
    });
    get().saveContextState();
  },

  toggleQuestionSelection: (id: string) => {
    if (get().viewingSessionId !== get().activeSessionId) return;
    if (get().contextMode === 'standard') return;
    set((state) => {
      const exists = state.selectedQuestionIds.includes(id);
      return {
        selectedQuestionIds: exists
          ? state.selectedQuestionIds.filter((x) => x !== id)
          : [...state.selectedQuestionIds, id],
      };
    });
    get().saveContextState();
  },

  selectAllQuestions: () => {
    if (get().viewingSessionId !== get().activeSessionId) return;
    if (get().contextMode === 'standard') return;
    const allIds = get().messages
      .filter((m) => m.role === 'user')
      .map((m) => m.questionId);
    set({ selectedQuestionIds: allIds });
    get().saveContextState();
  },

  deselectAllQuestions: () => {
    if (get().viewingSessionId !== get().activeSessionId) return;
    if (get().contextMode === 'standard') return;
    set({ selectedQuestionIds: [] });
    get().saveContextState();
  },

  setRetainPercent: (v: number) => {
    set({ retainPercent: v });
    try {
      localStorage.setItem('retainPercent', String(v));
    } catch {
      /* ignore */
    }
  },

  purgeSessionKeys: (sessionId: string) => {
    try {
      localStorage.removeItem(`contextMode_${sessionId}`);
      localStorage.removeItem(`selectedIds_${sessionId}`);
    } catch {
      /* ignore */
    }
  },

  startFreshAfterDelete: async () => {
    const newSession = await apiGateway.sessions.create();
    if (!newSession) return;

    set({
      activeSessionId: newSession.id,
      viewingSessionId: newSession.id,
      currentSessionTitle: newSession.title || '',
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      questionCounter: 0,
      contextMode: 'standard',
      selectedQuestionIds: [],
      sysprompt: DEFAULT_SYSPROMPT,
      syspromptDirty: false,
      contextInfo: undefined,
    });
    localStorage.setItem('activeSessionId', newSession.id);
    localStorage.setItem('viewingSessionId', newSession.id);
  },

  deleteSession: async (sessionId: string) => {
    try {
      await apiGateway.sessions.delete(sessionId);
    } catch {
      useUIStore.getState().addToast('Failed to delete', 'error');
      return 'error';
    }

    get().purgeSessionKeys(sessionId);

    if (sessionId === get().activeSessionId) {
      await get().startFreshAfterDelete();
      return 'fresh';
    }
    if (sessionId === get().viewingSessionId) {
      await get().returnToCurrent();
      return 'deleted';
    }

    return 'deleted';
  },
}));
