import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GenerationParams, GenerationParamKey, PresetName } from '@/lib/generationParams';
import { PRESETS, sanitizeGenerationParams, matchPreset } from '@/lib/generationParams';

interface GenerationParamsState {
  params: GenerationParams;
  activePreset: PresetName | null;
  fieldError: GenerationParamKey | null;

  setParam: (key: GenerationParamKey, value: number | undefined) => void;
  applyPreset: (name: PresetName) => void;
  resetToDefaults: () => void;
  setFieldError: (field: GenerationParamKey | null) => void;
  clearFieldError: () => void;
}

export const useGenerationParamsStore = create<GenerationParamsState>()(
  persist(
    (set, get) => ({
      params: {},
      activePreset: null,
      fieldError: null,

      setParam: (key, value) => {
        const params = { ...get().params };
        if (value === undefined) {
          delete params[key];
        } else {
          params[key] = value;
        }
        set({ params, activePreset: null, fieldError: null });
      },

      applyPreset: (name) => {
        set({ params: { ...PRESETS[name] }, activePreset: name, fieldError: null });
      },

      resetToDefaults: () => {
        set({ params: {}, activePreset: null, fieldError: null });
      },

      setFieldError: (field) => {
        set({ fieldError: field });
      },

      clearFieldError: () => {
        set({ fieldError: null });
      },
    }),
    {
      name: 'generation-params-v1',
      partialize: (state) => ({ params: state.params, activePreset: state.activePreset }),
      merge: (persisted, current) => {
        const p = persisted as { params?: unknown; activePreset?: PresetName | null } | undefined;
        const safeParams = sanitizeGenerationParams(p?.params);
        const safePreset =
          p?.activePreset && matchPreset(safeParams) === p.activePreset
            ? p.activePreset
            : null;
        return { ...current, params: safeParams, activePreset: safePreset };
      },
    },
  ),
);
