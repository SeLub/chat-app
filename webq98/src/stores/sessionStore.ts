import { create } from 'zustand';
import type { ContextConfig, ChatMessage, QAPair, ResponseMetrics, AttachmentMeta, ImageData } from '@/types';
import { apiGateway } from '@/lib/apiGateway';

const DEFAULT_SYSPROMPT =
  'Ты Senior Developer. Отвечай четко, структурированно и по существу. Ты мыслишь архитектурно, производительность, системность.';

interface SessionStore {
  activeSessionId: string | null;
  viewingSessionId: string | null;
  currentSessionTitle: string;
  messages: ChatMessage[];
  qaPairs: QAPair[];
  contextConfig: ContextConfig;
  sysprompt: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  questionCounter: number;

  init: () => Promise<void>;
  switchToViewing: (sessionId: string) => Promise<void>;
  returnToCurrent: () => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  addBotMessage: (
    content: string,
    model: string,
    metrics?: unknown,
    excludedIndices?: number[],
  ) => void;
  updateContextConfig: (config: Partial<ContextConfig>) => Promise<void>;
  updateSysprompt: (sysprompt: string) => Promise<void>;
  deleteQAPair: (questionId: string) => Promise<void>;
  clearChat: () => Promise<void>;
  exportConversation: () => void;
  loadViewingSession: () => Promise<void>;
  saveConversation: (title: string, category: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  activeSessionId: null,
  viewingSessionId: null,
  currentSessionTitle: '',
  messages: [],
  qaPairs: [],
  contextConfig: { mode: 'standard', trimPercent: 80, manualInclude: [] },
  sysprompt: DEFAULT_SYSPROMPT,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  questionCounter: 0,

  init: async () => {
    const savedActive = localStorage.getItem('activeSessionId');
    const savedViewing = localStorage.getItem('viewingSessionId');

    if (savedActive) {
      try {
        const session = await apiGateway.sessions.get(savedActive);
        if (session) {
          set({
            activeSessionId: savedActive,
            viewingSessionId: savedViewing || savedActive,
            currentSessionTitle: session.title || '',
            sysprompt: session.sysprompt?.trim() || DEFAULT_SYSPROMPT,
          });

          const config = await apiGateway.sessions.getContextConfig(savedActive);
          if (config) {
            set({
              contextConfig: {
                mode: (config.mode as 'standard' | 'manual') || 'standard',
                trimPercent: config.trimPercent ?? 80,
                manualInclude: config.manualInclude || [],
              },
            });
          }

          const messages = await apiGateway.sessions.getMessages(savedActive);
          if (messages) {
            const normalized: ChatMessage[] = (messages as Array<{ role?: string; content?: string; answerText?: string; questionId?: string; model?: string; metrics?: unknown; attachmentsMeta?: unknown; imageData?: unknown }>).map((m) => ({
              role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'assistant') as 'user' | 'assistant',
              content: m.content || m.answerText || '',
              questionId: m.questionId || `q_0`,
              model: m.model || 'unknown',
              metrics: m.metrics as ResponseMetrics | undefined,
              attachmentsMeta: m.attachmentsMeta as AttachmentMeta[] | undefined,
              imageData: m.imageData as ImageData | undefined,
            }));
            set({
              messages: normalized,
              qaPairs: normalized.map((m) => ({
                id: m.questionId,
                questionId: m.questionId,
                questionText: m.content,
                answerText: m.content,
                model: m.model,
                attachmentsMeta: m.attachmentsMeta || [],
                metrics: m.metrics,
                imageData: m.imageData,
                excludedFromContext: false,
              })),
            });
          }
          return;
        }
      } catch {
        localStorage.removeItem('activeSessionId');
        localStorage.removeItem('viewingSessionId');
      }
    }

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
    set({ viewingSessionId: sessionId, currentSessionTitle: '' });
    localStorage.setItem('viewingSessionId', sessionId);
    await get().loadViewingSession();
  },

  returnToCurrent: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    set({ viewingSessionId: activeSessionId });
    localStorage.setItem('viewingSessionId', activeSessionId);

    try {
      const session = await apiGateway.sessions.get(activeSessionId);
      if (session) {
        set({ currentSessionTitle: session.title || '', sysprompt: session.sysprompt || DEFAULT_SYSPROMPT });
      }
    } catch {
      set({ currentSessionTitle: '' });
    }

    await get().loadViewingSession();
  },

  addMessage: (msg: ChatMessage) => {
    set((state) => ({
      messages: [...state.messages, msg],
      questionCounter: state.questionCounter + 1,
    }));
  },

  addBotMessage: (content: string, model: string, metrics?: unknown, excludedIndices?: number[]) => {
    set((state) => {
      const m = metrics as ResponseMetrics | undefined;
      const inputTokens = m?.inputTokens || 0;
      const outputTokens = m?.outputTokens || 0;

      return {
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content,
            questionId: state.messages[state.messages.length - 1]?.questionId || '',
            model,
            metrics: m,
            excludedFromContext: excludedIndices && excludedIndices.length > 0,
          },
        ],
        totalInputTokens: state.totalInputTokens + inputTokens,
        totalOutputTokens: state.totalOutputTokens + outputTokens,
      };
    });
  },

  updateContextConfig: async (config: Partial<ContextConfig>) => {
    const { viewingSessionId, contextConfig } = get();
    if (!viewingSessionId) return;

    const updated = { ...contextConfig, ...config };
    set({ contextConfig: updated });

    try {
      await apiGateway.sessions.updateContextConfig(viewingSessionId, updated);
    } catch {
      // rollback
    }
  },

  updateSysprompt: async (sysprompt: string) => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    set({ sysprompt });
    try {
      await apiGateway.sessions.update(viewingSessionId, { sysprompt });
    } catch {
      // ignore
    }
  },

  deleteQAPair: async (questionId: string) => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    try {
      await apiGateway.sessions.deleteQAPair(viewingSessionId, questionId);
      set((state) => ({
        messages: state.messages.filter((m) => m.questionId !== questionId),
        qaPairs: state.qaPairs.filter((q) => q.questionId !== questionId),
      }));
    } catch {
      console.error('Failed to delete Q&A pair');
    }
  },

  clearChat: async () => {
    const { viewingSessionId } = get();
    if (!viewingSessionId) return;

    try {
      const session = await apiGateway.sessions.get(viewingSessionId);
      const newArchiveTitle =
        session?.title && !session.title.startsWith('unsavedSession')
          ? session.title
          : `unsavedSession ${Date.now()}`;

      if (session?.title && !session.title.startsWith('unsavedSession')) {
        await apiGateway.sessions.update(viewingSessionId, { title: newArchiveTitle });
      }

      const newSession = await apiGateway.sessions.create();
      if (newSession) {
        const activeSessionId = viewingSessionId;
        set({
          activeSessionId,
          viewingSessionId: newSession.id,
          currentSessionTitle: newSession.title || '',
          messages: [],
          qaPairs: [],
          totalInputTokens: 0,
          totalOutputTokens: 0,
          questionCounter: 0,
          contextConfig: { mode: 'standard', trimPercent: 80, manualInclude: [] },
          sysprompt: DEFAULT_SYSPROMPT,
        });
        localStorage.setItem('activeSessionId', activeSessionId);
        localStorage.setItem('viewingSessionId', newSession.id);
      }
    } catch {
      console.error('Failed to clear chat');
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

      const messages = await apiGateway.sessions.getMessages(viewingSessionId);
      if (messages) {
        const normalized: ChatMessage[] = (messages as Array<{ role?: string; content?: string; answerText?: string; questionId?: string; model?: string; metrics?: unknown; attachmentsMeta?: unknown; imageData?: unknown }>).map((m) => ({
          role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'assistant') as 'user' | 'assistant',
          content: m.content || m.answerText || '',
          questionId: m.questionId || `q_0`,
          model: m.model || 'unknown',
          metrics: m.metrics as ResponseMetrics | undefined,
          attachmentsMeta: m.attachmentsMeta as AttachmentMeta[] | undefined,
          imageData: m.imageData as ImageData | undefined,
        }));

        set({
          messages: normalized,
          qaPairs: normalized.map((m) => ({
            id: m.questionId,
            questionId: m.questionId,
            questionText: m.content,
             answerText: (m as { answerText?: string }).answerText || m.content || '',
            model: m.model || 'unknown',
            attachmentsMeta: m.attachmentsMeta || [],
            metrics: m.metrics,
            imageData: m.imageData,
            excludedFromContext: false,
          })),
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
}));
