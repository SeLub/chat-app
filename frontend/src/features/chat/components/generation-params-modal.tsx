import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useGenerationParamsStore } from '@/stores/generationParamsStore';
import {
  GENERATION_PARAM_SPECS,
  GENERATION_PARAM_KEYS,
  PRESETS,
  type GenerationParamKey,
  type PresetName,
} from '@/lib/generationParams';

const PRESET_LABELS: Record<PresetName, string> = {
  coding: 'Coding',
  creative: 'Creative',
  deep_reasoning: 'Deep Reasoning',
};

export function GenerationParamsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const params = useGenerationParamsStore((s) => s.params);
  const activePreset = useGenerationParamsStore((s) => s.activePreset);
  const fieldError = useGenerationParamsStore((s) => s.fieldError);
  const setParam = useGenerationParamsStore((s) => s.setParam);
  const applyPreset = useGenerationParamsStore((s) => s.applyPreset);
  const resetToDefaults = useGenerationParamsStore((s) => s.resetToDefaults);
  const clearFieldError = useGenerationParamsStore((s) => s.clearFieldError);

  // Local state for numeric inputs (controlled by store, but we need local
  // string state for in-progress typing before commit)
  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  const handleOpenChange = (next: boolean) => {
    if (!next) clearFieldError();
    onOpenChange(next);
  };

  const getLocalValue = (key: GenerationParamKey): string => {
    if (key in localValues) return localValues[key];
    const v = params[key];
    return v === undefined ? '' : String(v);
  };

  const handleNumberChange = (key: GenerationParamKey, raw: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: raw }));
    const n = Number(raw);
    if (raw === '') {
      setParam(key, undefined);
    } else if (Number.isFinite(n)) {
      setParam(key, n);
    }
  };

  const handleRangeChange = (key: GenerationParamKey, raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setParam(key, n);
      setLocalValues((prev) => ({ ...prev, [key]: raw }));
    }
  };

  const handleRemove = (key: GenerationParamKey) => {
    setParam(key, undefined);
    setLocalValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>⚙ Generation Parameters</DialogTitle>
          <DialogDescription>
            Not-set parameters use llama-server defaults (from bash-script).
          </DialogDescription>
        </DialogHeader>

        {/* Preset chips */}
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(PRESETS) as PresetName[]).map((name) => (
            <Button
              key={name}
              variant={activePreset === name ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => applyPreset(name)}
            >
              {PRESET_LABELS[name]}
            </Button>
          ))}
          <Button
            variant={activePreset === null && Object.keys(params).length > 0 ? 'default' : 'outline'}
            size="sm"
            className="text-xs"
            onClick={() => {
              // Custom: just clear activePreset, keep params
              if (activePreset !== null) {
                useGenerationParamsStore.setState({ activePreset: null });
              }
            }}
          >
            Custom
          </Button>
        </div>

        {/* Parameter fields */}
        <div className="space-y-3">
          {GENERATION_PARAM_KEYS.map((key) => {
            const spec = GENERATION_PARAM_SPECS[key];
            const value = params[key];
            const isSet = value !== undefined;
            const isNpredict = key === 'n_predict';
            const hasError = fieldError === key;

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{spec.label}</label>
                  <span className="text-xs text-muted-foreground">
                    {isSet ? value : '— server default'}
                  </span>
                  {isSet && (
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleRemove(key)}
                      title="Reset to server default"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {isNpredict ? (
                  <input
                    type="number"
                    min={spec.min}
                    max={spec.max}
                    step={1}
                    value={getLocalValue(key)}
                    onChange={(e) => handleNumberChange(key, e.target.value)}
                    className={cn(
                      'w-full rounded-md border bg-transparent px-3 py-1.5 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring',
                      hasError && 'border-destructive',
                    )}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={spec.min}
                      max={spec.max}
                      step="any"
                      value={value ?? spec.min}
                      onChange={(e) => handleRangeChange(key, e.target.value)}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      min={spec.min}
                      max={spec.max}
                      step="any"
                      value={getLocalValue(key)}
                      onChange={(e) => handleNumberChange(key, e.target.value)}
                      className={cn(
                        'w-20 rounded-md border bg-transparent px-2 py-1 text-sm font-mono',
                        'focus:outline-none focus:ring-2 focus:ring-ring',
                        hasError && 'border-destructive',
                      )}
                    />
                  </div>
                )}

                {isNpredict && (
                  <p className="text-xs text-muted-foreground">
                    -1 = until context stop (may truncate); 0 not allowed
                  </p>
                )}

                {hasError && (
                  <p className="text-xs text-destructive">
                    {spec.label} must be a number between {spec.min} and {spec.max}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={resetToDefaults}>
            Reset to Server Defaults
          </Button>
          <Button size="sm" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
