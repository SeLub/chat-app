import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocked = vi.hoisted(() => ({
  createAiHelperSocket: vi.fn(),
  startDualVad: vi.fn(),
  useSessionStore: { getState: vi.fn() },
  useUIStore: { getState: vi.fn() },
}));

vi.mock('@/lib/aiHelperSocket', () => mocked);
vi.mock('@/lib/vadManager', () => mocked);
vi.mock('@/stores/sessionStore', () => ({ useSessionStore: mocked.useSessionStore }));
vi.mock('@/stores/uiStore', () => ({ useUIStore: mocked.useUIStore }));

import { useAiHelperStore } from './aiHelperStore';

function resetStore() {
  useAiHelperStore.setState({
    status: 'disconnected',
    isCapturing: false,
    transcripts: [],
    hintStreaming: false,
    hintText: '',
    requestHintPending: false,
    isSendingLocal: false,
    error: null,
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('aiHelperStore — send-to-chat bridge', () => {
  it('1. buildTranscriptText joins chronologically with role labels, skipping empty text', () => {
    useAiHelperStore.setState({
      transcripts: [
        { role: 'user', text: 'a', timestamp: 1 },
        { role: 'interlocutor', text: 'b', timestamp: 2 },
        { role: 'user', text: '', timestamp: 3 },
        { role: 'user', text: 'c', timestamp: 4 },
      ],
    });

    expect(useAiHelperStore.getState().buildTranscriptText()).toBe(
      '[Я]: a\n[Собеседник]: b\n[Я]: c',
    );
  });

  it('2. sendTranscriptsToChat sends the joined text and clears transcripts on success', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    mocked.useSessionStore.getState.mockReturnValue({ sendMessage });

    useAiHelperStore.setState({
      transcripts: [
        { role: 'user', text: 'a', timestamp: 1 },
        { role: 'interlocutor', text: 'b', timestamp: 2 },
      ],
    });

    const ok = await useAiHelperStore.getState().sendTranscriptsToChat();

    expect(ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('[Я]: a\n[Собеседник]: b');
    expect(useAiHelperStore.getState().transcripts).toEqual([]);
    expect(useAiHelperStore.getState().isSendingLocal).toBe(false);
  });

  it('3. empty transcripts → false, sendMessage NOT called, transcripts untouched', async () => {
    const sendMessage = vi.fn();
    mocked.useSessionStore.getState.mockReturnValue({ sendMessage });
    const addToast = vi.fn();
    mocked.useUIStore.getState.mockReturnValue({ addToast });

    useAiHelperStore.setState({
      transcripts: [{ role: 'user', text: '', timestamp: 1 }],
    });

    const ok = await useAiHelperStore.getState().sendTranscriptsToChat();

    expect(ok).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('Нет транскриптов для отправки', 'info');
    expect(useAiHelperStore.getState().transcripts).toEqual([
      { role: 'user', text: '', timestamp: 1 },
    ]);
  });

  it('4. sendMessage reject → transcripts preserved, false', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('network'));
    mocked.useSessionStore.getState.mockReturnValue({ sendMessage });

    useAiHelperStore.setState({
      transcripts: [
        { role: 'user', text: 'a', timestamp: 1 },
        { role: 'interlocutor', text: 'b', timestamp: 2 },
      ],
    });

    const ok = await useAiHelperStore.getState().sendTranscriptsToChat();

    expect(ok).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(useAiHelperStore.getState().transcripts).toEqual([
      { role: 'user', text: 'a', timestamp: 1 },
      { role: 'interlocutor', text: 'b', timestamp: 2 },
    ]);
    expect(useAiHelperStore.getState().isSendingLocal).toBe(false);
  });
});
