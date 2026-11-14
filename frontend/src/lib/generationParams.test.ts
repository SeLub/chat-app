import { describe, it, expect } from 'vitest';
import {
  GENERATION_PARAM_SPECS,
  GENERATION_PARAM_KEYS,
  PRESETS,
  sanitizeGenerationParams,
  matchPreset,
  type GenerationParams,
} from './generationParams';

describe('generationParams (P0.1)', () => {
  it('1. GENERATION_PARAM_KEYS contains exactly 7 keys', () => {
    expect(GENERATION_PARAM_KEYS).toHaveLength(7);
    expect(GENERATION_PARAM_KEYS).toEqual([
      'temperature', 'top_p', 'top_k', 'min_p',
      'n_predict', 'presence_penalty', 'repeat_penalty',
    ]);
  });

  it('2. sanitizeGenerationParams: empty/null → {}', () => {
    expect(sanitizeGenerationParams(null)).toEqual({});
    expect(sanitizeGenerationParams(undefined)).toEqual({});
    expect(sanitizeGenerationParams({})).toEqual({});
    expect(sanitizeGenerationParams('garbage')).toEqual({});
    expect(sanitizeGenerationParams([1, 2, 3])).toEqual({});
  });

  it('3. sanitizeGenerationParams: valid values preserved', () => {
    const input: GenerationParams = {
      temperature: 0.5,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.1,
      n_predict: 4096,
      presence_penalty: -0.5,
      repeat_penalty: 1.1,
    };
    expect(sanitizeGenerationParams(input)).toEqual(input);
  });

  it('4. sanitizeGenerationParams: out-of-range dropped', () => {
    expect(sanitizeGenerationParams({ temperature: 2.5 })).toEqual({});
    expect(sanitizeGenerationParams({ temperature: -0.1 })).toEqual({});
    expect(sanitizeGenerationParams({ top_p: 1.5 })).toEqual({});
    expect(sanitizeGenerationParams({ top_k: 201 })).toEqual({});
    expect(sanitizeGenerationParams({ n_predict: -2 })).toEqual({});
    expect(sanitizeGenerationParams({ n_predict: 32769 })).toEqual({});
    expect(sanitizeGenerationParams({ presence_penalty: 2.5 })).toEqual({});
    expect(sanitizeGenerationParams({ repeat_penalty: -0.1 })).toEqual({});
  });

  it('5. sanitizeGenerationParams: fractional integer → dropped', () => {
    expect(sanitizeGenerationParams({ top_k: 1.5 })).toEqual({});
    expect(sanitizeGenerationParams({ n_predict: 4096.5 })).toEqual({});
  });

  it('6. sanitizeGenerationParams: n_predict=0 → dropped (disallowZero)', () => {
    expect(sanitizeGenerationParams({ n_predict: 0 })).toEqual({});
  });

  it('7. sanitizeGenerationParams: n_predict=-1 → valid', () => {
    expect(sanitizeGenerationParams({ n_predict: -1 })).toEqual({ n_predict: -1 });
  });

  it('8. sanitizeGenerationParams: NaN/Infinity → dropped', () => {
    expect(sanitizeGenerationParams({ temperature: NaN })).toEqual({});
    expect(sanitizeGenerationParams({ temperature: Infinity })).toEqual({});
    expect(sanitizeGenerationParams({ temperature: -Infinity })).toEqual({});
  });

  it('9. sanitizeGenerationParams: unknown keys ignored', () => {
    expect(sanitizeGenerationParams({ foo: 1, temperature: 0.5 })).toEqual({ temperature: 0.5 });
  });

  it('10. matchPreset: exact match → preset name', () => {
    expect(matchPreset(PRESETS.coding)).toBe('coding');
    expect(matchPreset(PRESETS.creative)).toBe('creative');
    expect(matchPreset(PRESETS.deep_reasoning)).toBe('deep_reasoning');
  });

  it('11. matchPreset: partial / modified → null', () => {
    expect(matchPreset({})).toBeNull();
    expect(matchPreset({ temperature: 0.2 })).toBeNull();
    const modified = { ...PRESETS.coding, temperature: 0.3 };
    expect(matchPreset(modified)).toBeNull();
  });

  it('12. matchPreset: deep_reasoning has no n_predict', () => {
    expect(PRESETS.deep_reasoning.n_predict).toBeUndefined();
    expect(matchPreset({ ...PRESETS.deep_reasoning, n_predict: 8192 })).toBeNull();
  });

  it('13. PRESETS values are within spec ranges', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const [key, value] of Object.entries(preset)) {
        const spec = GENERATION_PARAM_SPECS[key as keyof typeof GENERATION_PARAM_SPECS];
        expect(value).toBeGreaterThanOrEqual(spec.min);
        expect(value).toBeLessThanOrEqual(spec.max);
        if (spec.type === 'integer') expect(Number.isInteger(value)).toBe(true);
        if (spec.disallowZero) expect(value).not.toBe(0);
      }
    }
  });
});
