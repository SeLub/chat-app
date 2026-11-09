import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAiHelperSocket, float32ToInt16Base64 } from './aiHelperSocket';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState: number;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(public url: string) {
    this.readyState = 0; // CONNECTING
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  }

  simulateMessage(obj: unknown) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
  }

  simulateError() {
    if (this.onerror) this.onerror();
  }

  simulateClose() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function makeCallbacks() {
  return {
    onTranscript: vi.fn(),
    onHintToken: vi.fn(),
    onHintDone: vi.fn(),
    onError: vi.fn(),
    onStatusChange: vi.fn(),
  };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('float32ToInt16Base64', () => {
  it('converts [0, 0.5, -1] to Int16 little-endian bytes', () => {
    const audio = new Float32Array([0, 0.5, -1]);
    const b64 = float32ToInt16Base64(audio);
    const bytes = decodeBase64ToBytes(b64);
    const int16 = new Int16Array(bytes.buffer);
    expect(Array.from(int16)).toEqual([0, 16383, -32768]);
  });

  it('handles arrays larger than the base64 chunk size without throwing', () => {
    const audio = new Float32Array(0x8000 + 100).fill(0.25);
    const b64 = float32ToInt16Base64(audio);
    const bytes = decodeBase64ToBytes(b64);
    expect(bytes.length).toBe((0x8000 + 100) * 2);
    const int16 = new Int16Array(bytes.buffer);
    expect(int16[0]).toBe(8191);
    expect(int16[0x8000 + 99]).toBe(8191);
  });

  it('clamps out-of-range samples', () => {
    const audio = new Float32Array([1.5, -1.5]);
    const b64 = float32ToInt16Base64(audio);
    const bytes = decodeBase64ToBytes(b64);
    const int16 = new Int16Array(bytes.buffer);
    expect(Array.from(int16)).toEqual([32767, -32768]);
  });
});

describe('createAiHelperSocket', () => {
  it('connects to /ws/ai-helper and reports connected on open', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:3000/ws/ai-helper');

    MockWebSocket.instances[0].simulateOpen();
    expect(cb.onStatusChange).toHaveBeenCalledWith('connected');
  });

  it('sendAudioChunk sends the protocol JSON with decodable pcm16 base64', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    MockWebSocket.instances[0].simulateOpen();

    socket.sendAudioChunk('user', new Float32Array([0, 0.5, -1]));

    expect(MockWebSocket.instances[0].sent).toHaveLength(1);
    const msg = JSON.parse(MockWebSocket.instances[0].sent[0]);
    expect(msg.type).toBe('audio_chunk');
    expect(msg.role).toBe('user');
    expect(msg.sampleRate).toBe(16000);
    expect(msg.format).toBe('pcm16');
    expect(typeof msg.timestamp).toBe('number');

    const bytes = decodeBase64ToBytes(msg.audioBase64);
    const int16 = new Int16Array(bytes.buffer);
    expect(Array.from(int16)).toEqual([0, 16383, -32768]);
  });

  it('requestHint sends {type: "request_hint"}', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    MockWebSocket.instances[0].simulateOpen();

    socket.requestHint();

    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({ type: 'request_hint' });
  });

  it('sendEndSession sends {type: "end_session"}', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    MockWebSocket.instances[0].simulateOpen();

    socket.sendEndSession();

    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({ type: 'end_session' });
  });

  it('dispatches incoming transcript, hint_token, hint_done and error messages', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({ type: 'transcript', role: 'user', text: 'hi' });
    expect(cb.onTranscript).toHaveBeenCalledWith('user', 'hi');

    ws.simulateMessage({ type: 'hint_token', token: 'Hel' });
    ws.simulateMessage({ type: 'hint_token', token: 'lo' });
    expect(cb.onHintToken).toHaveBeenNthCalledWith(1, 'Hel');
    expect(cb.onHintToken).toHaveBeenNthCalledWith(2, 'lo');

    ws.simulateMessage({ type: 'hint_done' });
    expect(cb.onHintDone).toHaveBeenCalledTimes(1);

    ws.simulateMessage({ type: 'error', message: 'boom' });
    expect(cb.onError).toHaveBeenCalledWith('boom');
  });

  it('reconnects 2s after an unexpected close, but not after disconnect()', () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateClose();
    expect(cb.onStatusChange).toHaveBeenLastCalledWith('disconnected');
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // intentional close: no reconnect
    MockWebSocket.instances[1].simulateOpen();
    socket.disconnect();
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does not throw when sending while not open', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    // readyState is CONNECTING (0) — guard must swallow the send
    expect(() => socket.sendAudioChunk('user', new Float32Array([1]))).not.toThrow();
    expect(MockWebSocket.instances[0].sent).toHaveLength(0);
  });

  it('reports disconnected and calls onError on error event', () => {
    const cb = makeCallbacks();
    const socket = createAiHelperSocket(cb);
    socket.connect();
    MockWebSocket.instances[0].simulateError();
    expect(cb.onStatusChange).toHaveBeenCalledWith('disconnected');
    expect(cb.onError).toHaveBeenCalledWith('WebSocket connection failed');
  });
});
