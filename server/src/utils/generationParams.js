/**
 * Dynamic generation parameters — validation (P0.1).
 *
 * Contract: "not sent — not forwarded". The client sends only the params it
 * wants to override; absent/null/'' fields are treated as "use server
 * default" and are NOT forwarded to the provider.
 *
 * This module is the single source of truth for the param contract on the
 * server side. The frontend keeps a mirror in
 * frontend/src/lib/generationParams.ts — update BOTH places when changing
 * specs (same pattern as messageCap.ts).
 */

/**
 * Spec per param:
 *  - type:      'number' | 'integer'
 *  - min/max:   inclusive bounds
 *  - disallowZero: true → value 0 is rejected with a dedicated message
 */
export const GENERATION_PARAM_SPECS = {
  temperature:     { type: 'number',  min: 0,    max: 2,     disallowZero: false },
  top_p:           { type: 'number',  min: 0,    max: 1,     disallowZero: false },
  top_k:           { type: 'integer', min: 0,    max: 200,   disallowZero: false },
  min_p:           { type: 'number',  min: 0,    max: 1,     disallowZero: false },
  n_predict:       { type: 'integer', min: -1,   max: 32768, disallowZero: true },
  presence_penalty:{ type: 'number',  min: -2,   max: 2,     disallowZero: false },
  repeat_penalty:  { type: 'number',  min: 0,    max: 2,     disallowZero: false },
};

export const GENERATION_PARAM_KEYS = Object.keys(GENERATION_PARAM_SPECS);

/**
 * Parse and validate raw generation params (from req.body — strings from
 * multipart FormData).
 *
 * Rules (per ТЗ P0.1 §2.3):
 *  - absent / null / undefined / '' → param is simply absent (not validated,
 *    not forwarded).
 *  - non-number / NaN / Infinity → 400 invalid_generation_param.
 *  - out of [min, max] → 400 with field/value/min/max.
 *  - integer fields: fractional value → 400.
 *  - disallowZero (n_predict): 0 → 400.
 *  - unknown keys are ignored (forward-compat).
 *
 * @param {Record<string, unknown> | undefined} raw
 * @returns {{ok: true, params: Record<string, number>} | {ok: false, error: {field: string, value: unknown, min: number, max: number, message: string}}}
 */
export function parseGenerationParams(raw) {
  const params = {};

  for (const key of GENERATION_PARAM_KEYS) {
    const value = raw?.[key];

    // absent / null / undefined / '' → not sent → skip
    if (value === undefined || value === null || value === '') continue;

    const spec = GENERATION_PARAM_SPECS[key];
    const num = Number(value);

    if (!Number.isFinite(num)) {
      return {
        ok: false,
        error: {
          field: key,
          value,
          min: spec.min,
          max: spec.max,
          message: `${key} must be a number between ${spec.min} and ${spec.max}`,
        },
      };
    }

    if (spec.type === 'integer' && !Number.isInteger(num)) {
      return {
        ok: false,
        error: {
          field: key,
          value,
          min: spec.min,
          max: spec.max,
          message: `${key} must be an integer between ${spec.min} and ${spec.max}`,
        },
      };
    }

    if (spec.disallowZero && num === 0) {
      return {
        ok: false,
        error: {
          field: key,
          value,
          min: spec.min,
          max: spec.max,
          message: `${key} must be between ${spec.min} and ${spec.max} (0 is not allowed)`,
        },
      };
    }

    if (num < spec.min || num > spec.max) {
      return {
        ok: false,
        error: {
          field: key,
          value,
          min: spec.min,
          max: spec.max,
          message: `${key} must be a number between ${spec.min} and ${spec.max}`,
        },
      };
    }

    params[key] = num;
  }

  return { ok: true, params };
}
