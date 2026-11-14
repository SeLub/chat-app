import { describe, it, expect, beforeEach } from 'vitest';
import { useGenerationParamsStore } from './generationParamsStore';
import { PRESETS } from '@/lib/generationParams';

function resetStore() {
  useGenerationParamsStore.setState({ params: {}, activePreset: null, fieldError: null });
}

describe('generationParamsStore (P0.1)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('1. initial state: empty params, no preset, no error', () => {
    const s = useGenerationParamsStore.getState();
    expect(s.params).toEqual({});
    expect(s.activePreset).toBeNull();
    expect(s.fieldError).toBeNull();
  });

  it('2. setParam(number) sets value and clears preset', () => {
    useGenerationParamsStore.getState().applyPreset('coding');
    expect(useGenerationParamsStore.getState().activePreset).toBe('coding');

    useGenerationParamsStore.getState().setParam('temperature', 0.5);
    const s = useGenerationParamsStore.getState();
    expect(s.params.temperature).toBe(0.5);
    expect(s.activePreset).toBeNull();
    expect(s.fieldError).toBeNull();
  });

  it('3. setParam(undefined) removes key and clears preset', () => {
    useGenerationParamsStore.getState().setParam('temperature', 0.5);
    expect(useGenerationParamsStore.getState().params.temperature).toBe(0.5);

    useGenerationParamsStore.getState().setParam('temperature', undefined);
    const s = useGenerationParamsStore.getState();
    expect(s.params.temperature).toBeUndefined();
    expect(s.activePreset).toBeNull();
  });

  it('4. applyPreset sets params and activePreset', () => {
    useGenerationParamsStore.getState().applyPreset('creative');
    const s = useGenerationParamsStore.getState();
    expect(s.params).toEqual(PRESETS.creative);
    expect(s.activePreset).toBe('creative');
    expect(s.fieldError).toBeNull();
  });

  it('5. resetToDefaults clears everything', () => {
    useGenerationParamsStore.getState().applyPreset('coding');
    useGenerationParamsStore.getState().setFieldError('temperature');
    useGenerationParamsStore.getState().resetToDefaults();
    const s = useGenerationParamsStore.getState();
    expect(s.params).toEqual({});
    expect(s.activePreset).toBeNull();
    expect(s.fieldError).toBeNull();
  });

  it('6. setFieldError / clearFieldError', () => {
    useGenerationParamsStore.getState().setFieldError('top_p');
    expect(useGenerationParamsStore.getState().fieldError).toBe('top_p');

    useGenerationParamsStore.getState().clearFieldError();
    expect(useGenerationParamsStore.getState().fieldError).toBeNull();
  });

  it('7. setParam clears fieldError', () => {
    useGenerationParamsStore.getState().setFieldError('temperature');
    expect(useGenerationParamsStore.getState().fieldError).toBe('temperature');

    useGenerationParamsStore.getState().setParam('temperature', 0.5);
    expect(useGenerationParamsStore.getState().fieldError).toBeNull();
  });

  it('8. applyPreset clears fieldError', () => {
    useGenerationParamsStore.getState().setFieldError('top_k');
    useGenerationParamsStore.getState().applyPreset('coding');
    expect(useGenerationParamsStore.getState().fieldError).toBeNull();
  });
});
