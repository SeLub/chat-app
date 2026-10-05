import { create } from 'zustand';
import type { AITranscript } from '@/types';
import { createAiHelperSocket, type AiHelperSocket } from '@/lib/aiHelperSocket';

export type AiHelperStatus = 'disconnected' | 'connected';

interface AiHelperState {
  status: AiHelperStatus;
  isCapturing: boolean;
  transcripts: AITranscript[];
  hintStreaming: boolean;
  hintText: string;
  requestHintPending: boolean;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  startCapture: () => void;
  stopCapture: () => void;
  requestHint: () => void;

  _onTranscript: (role: AITranscript['role'], text: string) => void;
  _onHintToken: (token: string) => void;
  _onHintDone: () => void;
  _onError: (message: string) => void;
}

let socket: AiHelperSocket | null = null;

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
  error: null,

  connect: () => {
    getSocket().connect();
  },

  disconnect: () => {
    getSocket().disconnect();
    set({ status: 'disconnected' });
  },

  startCapture: () => {
    if (!get().isCapturing) {
      set({ isCapturing: true });
    }
    if (get().status === 'disconnected') {
      getSocket().connect();
    }
  },

  stopCapture: () => {
    set({ isCapturing: false });
  },

  requestHint: () => {
    set({ hintText: '', hintStreaming: true, requestHintPending: true });
    getSocket().requestHint();
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
  },
}));
