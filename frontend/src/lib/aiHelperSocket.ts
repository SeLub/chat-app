import type { AITranscript } from '@/types';

export interface AiHelperSocketCallbacks {
  onTranscript: (role: AITranscript['role'], text: string) => void;
  onHintToken: (token: string) => void;
  onHintDone: () => void;
  onError: (message: string) => void;
  onStatusChange: (status: 'connected' | 'disconnected') => void;
}

export interface AiHelperSocket {
  connect: (url?: string) => void;
  disconnect: () => void;
  sendAudioChunk: (role: AITranscript['role'], audio: Float32Array, sampleRate?: number) => void;
  requestHint: () => void;
  sendEndSession: () => void;
}

const RECONNECT_DELAY_MS = 2000;
const BASE64_CHUNK_SIZE = 0x8000;

export function float32ToInt16Base64(audio: Float32Array): string {
  const int16 = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.floor(s * 0x7fff);
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + BASE64_CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function buildWsUrl(url?: string): string {
  if (url) return url;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/ai-helper`;
}

export function createAiHelperSocket(callbacks: AiHelperSocketCallbacks): AiHelperSocket {
  let ws: WebSocket | null = null;
  let intentionalClose = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const openSocket = (url?: string) => {
    intentionalClose = false;
    ws = new WebSocket(buildWsUrl(url));

    ws.onopen = () => {
      callbacks.onStatusChange('connected');
    };

    ws.onclose = () => {
      callbacks.onStatusChange('disconnected');
      if (!intentionalClose && reconnectTimer === null) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          openSocket(url);
        }, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      callbacks.onStatusChange('disconnected');
      callbacks.onError('WebSocket connection failed');
    };

    ws.onmessage = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const msg = data as { type?: string; role?: string; text?: string; token?: string; message?: string };
      switch (msg.type) {
        case 'transcript':
          if (msg.role === 'user' || msg.role === 'interlocutor') {
            callbacks.onTranscript(msg.role, msg.text ?? '');
          }
          break;
        case 'hint_token':
          callbacks.onHintToken(msg.token ?? '');
          break;
        case 'hint_done':
          callbacks.onHintDone();
          break;
        case 'error':
          callbacks.onError(msg.message ?? 'Unknown error');
          break;
      }
    };
  };

  const WS_OPEN = 1;

  const send = (payload: Record<string, unknown>) => {
    if (!ws || ws.readyState !== WS_OPEN) {
      console.warn('aiHelperSocket: not connected, message dropped');
      return;
    }
    ws.send(JSON.stringify(payload));
  };

  return {
    connect(url?: string) {
      if (ws) {
        intentionalClose = true;
        ws.close();
        ws = null;
      }
      openSocket(url);
    },
    disconnect() {
      intentionalClose = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
    },
    sendAudioChunk(role, audio, sampleRate = 16000) {
      send({
        type: 'audio_chunk',
        role,
        audioBase64: float32ToInt16Base64(audio),
        sampleRate,
        format: 'pcm16',
        timestamp: Date.now(),
      });
    },
    requestHint() {
      send({ type: 'request_hint' });
    },
    sendEndSession() {
      send({ type: 'end_session' });
    },
  };
}
