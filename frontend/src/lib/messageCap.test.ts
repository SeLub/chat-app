import { describe, it, expect } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  MESSAGE_CAP_WARN_RATIO,
  isMessageOverCap,
  isMessageNearCap,
  formatChars,
} from './messageCap';

// ТЗ adaptive-context-budget (№4): кап длины message — мягкий кап в UI.
// MAX_MESSAGE_CHARS — дубликат серверной константы (chatController.js):
// при изменении обновлять ОБА места.

describe('messageCap: кап длины message (№4)', () => {
  it('константа совпадает с серверным капом (64000)', () => {
    expect(MAX_MESSAGE_CHARS).toBe(64000);
    expect(MESSAGE_CAP_WARN_RATIO).toBe(0.9);
  });

  it('isMessageOverCap: граница — ровно 64000 проходит, 64001 блокируется', () => {
    expect(isMessageOverCap(MAX_MESSAGE_CHARS)).toBe(false);
    expect(isMessageOverCap(MAX_MESSAGE_CHARS + 1)).toBe(true);
    expect(isMessageOverCap(1_000_000)).toBe(true);
    expect(isMessageOverCap(0)).toBe(false);
  });

  it('isMessageNearCap: зона >90% капа (57600 — нет, 57601 — да)', () => {
    expect(isMessageNearCap(MAX_MESSAGE_CHARS * MESSAGE_CAP_WARN_RATIO)).toBe(false);
    expect(isMessageNearCap(MAX_MESSAGE_CHARS * MESSAGE_CAP_WARN_RATIO + 1)).toBe(true);
    expect(isMessageNearCap(100)).toBe(false);
  });

  it('formatChars: 64000 → «64 000», 1000000 → «1 000 000», без Intl', () => {
    expect(formatChars(64000)).toBe('64 000');
    expect(formatChars(1_000_000)).toBe('1 000 000');
    expect(formatChars(123)).toBe('123');
    expect(formatChars(1000)).toBe('1 000');
  });
});
