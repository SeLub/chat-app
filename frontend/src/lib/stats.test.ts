import { describe, it, expect } from 'vitest';
import { computeContextLoadPct, formatSizeGb } from './stats';

describe('computeContextLoadPct', () => {
  it('считает токены сессии / контекст — кейс владельца (37200+603)/98304 → 38%', () => {
    expect(computeContextLoadPct(37200 + 603, 98304)).toBe(38);
  });

  it('кап 100% — накопительная сумма может превысить окно при тримминге', () => {
    expect(computeContextLoadPct(150000, 98304)).toBe(100);
  });

  it('округляет до целого', () => {
    expect(computeContextLoadPct(1000, 3000)).toBe(33);
  });

  it('0 токенов → 0%', () => {
    expect(computeContextLoadPct(0, 98304)).toBe(0);
  });

  it('null/0 контекст → null (в UI «–»)', () => {
    expect(computeContextLoadPct(5000, null)).toBeNull();
    expect(computeContextLoadPct(5000, 0)).toBeNull();
    expect(computeContextLoadPct(5000, undefined)).toBeNull();
  });
});

describe('formatSizeGb', () => {
  it('переводит байты в ГБ с одним знаком', () => {
    expect(formatSizeGb(2 * 1024 * 1024 * 1024 + 400 * 1024 * 1024)).toBe('2.4');
  });

  it('0 / отрицательное / undefined → «–»', () => {
    expect(formatSizeGb(0)).toBe('–');
    expect(formatSizeGb(-5)).toBe('–');
    expect(formatSizeGb(undefined)).toBe('–');
    expect(formatSizeGb(null)).toBe('–');
  });

  it('меньше 0.05 ГБ округляется к «0.0», но не «–»', () => {
    expect(formatSizeGb(1)).toBe('0.0');
  });
});
