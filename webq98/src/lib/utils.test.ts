import { describe, it, expect } from 'vitest';
import { formatSize, getLanguageFromClassName, isMermaid, shortModel } from './utils';

describe('shortModel', () => {
  it('gguf path → basename without .gguf', () => {
    expect(shortModel('/home/selub/Documents/progs/models/Qwen3.8-27B-Q4_K_XL.gguf')).toBe('Qwen3.8-27B-Q4_K_XL');
  });

  it('ollama tag → name without registry prefix', () => {
    expect(shortModel('ollama/qwen2.5:7b')).toBe('qwen2.5:7b');
  });

  it('plain name unchanged', () => {
    expect(shortModel('llama3.1')).toBe('llama3.1');
  });
});

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

describe('getLanguageFromClassName', () => {
  it("'language-ts' → 'ts'", () => {
    expect(getLanguageFromClassName('language-ts')).toBe('ts');
  });

  it('undefined → null', () => {
    expect(getLanguageFromClassName(undefined)).toBeNull();
  });

  it("'language-python highlight' → 'python'", () => {
    expect(getLanguageFromClassName('language-python highlight')).toBe('python');
  });
});

describe('isMermaid', () => {
  it("'mermaid' → true", () => {
    expect(isMermaid('mermaid')).toBe(true);
  });

  it('undefined → false', () => {
    expect(isMermaid(undefined)).toBe(false);
  });
});
