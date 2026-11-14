// duplicate of server src/utils/generationParams.js — update BOTH places
// (единого источника нет — паттерн MAX_MESSAGE_CHARS/DEFAULT_SYSPROMPT)

export type GenerationParamKey =
  | 'temperature' | 'top_p' | 'top_k' | 'min_p'
  | 'n_predict' | 'presence_penalty' | 'repeat_penalty';

export interface GenerationParamSpec {
  type: 'number' | 'integer';
  min: number;
  max: number;
  disallowZero?: boolean;
  label: string;
}

export const GENERATION_PARAM_SPECS: Record<GenerationParamKey, GenerationParamSpec> = {
  temperature:      { type: 'number',  min: 0,   max: 2,     label: 'Temperature' },
  top_p:            { type: 'number',  min: 0,   max: 1,     label: 'Top P' },
  top_k:            { type: 'integer', min: 0,   max: 200,   label: 'Top K' },
  min_p:            { type: 'number',  min: 0,   max: 1,     label: 'Min P' },
  n_predict:        { type: 'integer', min: -1,  max: 32768, disallowZero: true, label: 'N Predict' },
  presence_penalty: { type: 'number',  min: -2,  max: 2,     label: 'Presence Penalty' },
  repeat_penalty:   { type: 'number',  min: 0,   max: 2,     label: 'Repeat Penalty' },
};

export const GENERATION_PARAM_KEYS = Object.keys(GENERATION_PARAM_SPECS) as GenerationParamKey[];

export type GenerationParams = Partial<Record<GenerationParamKey, number>>;

export type PresetName = 'coding' | 'creative' | 'deep_reasoning';

export const PRESETS: Record<PresetName, GenerationParams> = {
  coding: {
    temperature: 0.2, top_p: 0.95, top_k: 40, min_p: 0.05,
    n_predict: 4096, presence_penalty: 0.0, repeat_penalty: 1.05,
  },
  creative: {
    temperature: 1.1, top_p: 0.98, top_k: 80, min_p: 0.02,
    n_predict: 2048, presence_penalty: 0.3, repeat_penalty: 1.1,
  },
  deep_reasoning: {
    // ВАЖНО: n_predict НЕ ставим — работает серверный --n-predict 8192
    temperature: 0.4, top_p: 0.9, top_k: 40, min_p: 0.0,
    presence_penalty: 0.0, repeat_penalty: 1.0,
  },
};

/** Валидация params при загрузке из localStorage: невалидные ключи отбрасываются */
export function sanitizeGenerationParams(raw: unknown): GenerationParams {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: GenerationParams = {};
  for (const key of GENERATION_PARAM_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    const spec = GENERATION_PARAM_SPECS[key];
    if (spec.type === 'integer' && !Number.isInteger(n)) continue;
    if (n < spec.min || n > spec.max) continue;
    if (spec.disallowZero && n === 0) continue;
    result[key] = n;
  }
  return result;
}

/** Совпадает ли набор params с пресетом (для восстановления activePreset) */
export function matchPreset(params: GenerationParams): PresetName | null {
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const preset = PRESETS[name];
    const presetKeys = Object.keys(preset) as GenerationParamKey[];
    const paramKeys = Object.keys(params) as GenerationParamKey[];
    if (presetKeys.length !== paramKeys.length) continue;
    let match = true;
    for (const k of presetKeys) {
      if (params[k] !== preset[k]) { match = false; break; }
    }
    if (match) return name;
  }
  return null;
}
