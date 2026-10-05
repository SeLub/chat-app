import { create } from 'zustand';
import type { AITranscript } from '@/types';
import { createAiHelperSocket, type AiHelperSocket } from '@/lib/aiHelperSocket';
import { startDualVad, type VadController } from '@/lib/vadManager';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';

export type AiHelperStatus = 'disconnected' | 'connected';

interface AiHelperState {
  status: AiHelperStatus;
  isCapturing: boolean;
  transcripts: AITranscript[];
  hintStreaming: boolean;
  hintText: string;
  requestHintPending: boolean;
  isSendingLocal: boolean;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  requestHint: () => void;
  buildTranscriptText: () => string;
  sendTranscriptsToChat: () => Promise<boolean>;

  _onTranscript: (role: AITranscript['role'], text: string) => void;
  _onHintToken: (token: string) => void;
  _onHintDone: () => void;
  _onError: (message: string) => void;
}

let socket: AiHelperSocket | null = null;
let controller: VadController | null = null;

function getSocket(): AiHelperSocket {
  if (!socket) {
    socket = createAiHelperSocket({
      onTranscript: (role, text) => useAiHelperStore.getState()._onTranscript(role, text),
      onHintToken: (token) => useAiHelperStore.getState()._onHintToken(token),
      onHintDone: () => useAiHelperStore.getState()._onHintDone(),
      onError: (message) => useAiHelperStore.getState()._onError(message),
      onStatusChange: (status) => useAiHelperStore.setState({ status }),
    });
  }
  return socket;
}

export const useAiHelperStore = create<AiHelperState>((set, get) => ({
  status: 'disconnected',
  isCapturing: false,
  transcripts: [],
  hintStreaming: false,
  hintText: '',
  requestHintPending: false,
  isSendingLocal: false,
  error: null,

  connect: () => {
    getSocket().connect();
  },

  disconnect: () => {
    getSocket().disconnect();
    set({ status: 'disconnected' });
  },

  startCapture: async () => {
    if (get().isCapturing) return;
    if (get().status === 'disconnected') {
      getSocket().connect();
    }
    set({ isCapturing: true });
    try {
      controller = await startDualVad({
        onSpeechChunk: (role, audio) => {
          getSocket().sendAudioChunk(role, audio);
        },
        onError: (message) => {
          useAiHelperStore.getState()._onError(message);
        },
        onStateChange: (s) => {
          set({ isCapturing: s === 'capturing' });
        },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const message =
        name === 'NotAllowedError' || name === 'NotReadableError'
          ? 'Доступ к захвату экрана или микрофона отклонен'
          : `Ошибка захвата: ${err instanceof Error ? err.message : 'Отменено'}`;
      useAiHelperStore.getState()._onError(message);
      set({ isCapturing: false });
    }
  },

  stopCapture: () => {
    if (get().status === 'connected') {
      getSocket().sendEndSession();
    }
    controller?.stop();
    controller = null;
    set({ isCapturing: false });
  },

  requestHint: () => {
    set({ hintText: '', hintStreaming: true, requestHintPending: true });
    getSocket().requestHint();
  },

  buildTranscriptText: () => {
    return get()
      .transcripts.filter((t) => t.text.trim().length > 0)
      .map((t) => `[${t.role === 'user' ? 'Я' : 'Собеседник'}]: ${t.text}`)
      .join('\n');
  },

  sendTranscriptsToChat: async () => {
    const text = get().buildTranscriptText();
    if (!text) {
      useUIStore.getState().addToast('Нет транскриптов для отправки', 'info');
      return false;
    }
    const snapshot = [...get().transcripts];
    void snapshot;
    set({ isSendingLocal: true });
    try {
      await useSessionStore.getState().sendMessage(text);
      set({ transcripts: [], isSendingLocal: false });
      return true;
    } catch {
      set({ isSendingLocal: false });
      return false;
    }
  },

  _onTranscript: (role, text) => {
    const entry: AITranscript = { role, text, timestamp: Date.now() };
    set((s) => ({ transcripts: [...s.transcripts, entry] }));
  },

  _onHintToken: (token) => {
    set((s) => ({ hintText: s.hintText + token }));
  },

  _onHintDone: () => {
    set({ hintStreaming: false, requestHintPending: false });
  },

  _onError: (message) => {
    set({ error: message });
    useUIStore.getState().addToast(message, 'error');
  },
}));
