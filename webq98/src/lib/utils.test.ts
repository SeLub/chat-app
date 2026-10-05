import { describe, it, expect } from 'vitest';
import { formatSize } from './utils';

describe('formatSize', () => {
  it('0 → "0 B"', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  it('undefined → "0 B"', () => {
    expect(formatSize(undefined)).toBe('0 B');
  });

  it('500 → "500 B"', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('2048 → "2.00 KB"', () => {
    expect(formatSize(2048)).toBe('2.00 KB');
  });

  it('5*1024*1024 → "5.00 MB"', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});
