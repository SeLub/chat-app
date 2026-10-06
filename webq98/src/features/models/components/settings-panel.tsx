import {
  Settings2,
  RefreshCw,
  Info,
  Loader2,
  Brain,
  Cpu,
} from 'lucide-react';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

export function SettingsPanel({ className }: { className?: string }) {
  const providers = useProviderStore((s) => s.providers);
  const currentProvider = useProviderStore((s) => s.currentProvider);
  const setCurrentProvider = useProviderStore((s) => s.setCurrentProvider);
  const selectModel = useProviderStore((s) => s.selectModel);
  const models = useProviderStore((s) => s.models);
  const currentModel = useProviderStore((s) => s.currentModel);
  const isLoadingModels = useProviderStore((s) => s.isLoadingModels);
  const modelDetail = useProviderStore((s) => s.modelDetail as { details?: { size?: number; parent_model?: string; format?: string; family?: string } } | null);
  const currentContextLength = useProviderStore((s) => s.currentContextLength);
  const refreshStatus = useProviderStore((s) => s.refreshStatus);
  const sysprompt = useSessionStore((s) => s.sysprompt);
  const setSysprompt = useSessionStore((s) => s.setSysprompt);
  const updateSysprompt = useSessionStore((s) => s.updateSysprompt);
  const retainPercent = useSessionStore((s) => s.retainPercent);
  const setRetainPercent = useSessionStore((s) => s.setRetainPercent);
  const totalInputTokens = useSessionStore((s) => s.totalInputTokens);
  const totalOutputTokens = useSessionStore((s) => s.totalOutputTokens);
  const messages = useSessionStore((s) => s.messages);

  const [syspromptInput, setSyspromptInput] = useState(sysprompt);
  const [retainInput, setRetainInput] = useState(retainPercent);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setSyspromptInput(sysprompt);
  }, [sysprompt]);

  useEffect(() => {
    setRetainInput(retainPercent);
  }, [retainPercent]);

  const handleSyspromptChange = (val: string) => {
    setSyspromptInput(val);
    setSysprompt(val);
  };

  const handleSyspromptBlur = async () => {
    await updateSysprompt(syspromptInput);
  };

  const handleRetainChange = (val: number) => {
    setRetainInput(val);
    setRetainPercent(val);
  };

  const userMsgCount = messages.filter((m) => m.role === 'user').length;

  const contextLoadPct =
    currentContextLength
      ? Math.round((totalInputTokens + totalOutputTokens) / currentContextLength * 100)
      : 0;

  const contextLoadColor =
    contextLoadPct <= 50
      ? 'text-success'
      : contextLoadPct <= 75
        ? 'text-warning'
        : 'text-destructive';

  return (
    <aside className={cn(`${className} glass border-l border-border flex flex-col`, className)}>
      <div className="p-4 space-y-6 overflow-y-auto flex-1">
        {/* Provider Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Provider</h3>
          </div>
          <div className="space-y-2">
            {providers.map((p) => (
              <button
                key={p.name}
                onClick={() => setCurrentProvider(p.name as 'ollama' | 'llama.cpp')}
                disabled={p.status !== 'connected' && p.status !== 'checking'}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
                  currentProvider === p.name
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'hover:bg-accent text-muted-foreground',
                )}
              >
                <span className="font-medium">{p.name}</span>
                <div className="flex items-center gap-1.5">
                  {p.status === 'checking' && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span className={cn(
                    'w-2 h-2 rounded-full',
                    p.status === 'connected' ? 'bg-success' : p.status === 'checking' ? 'bg-warning' : 'bg-destructive',
                  )} />
                </div>
              </button>
            ))}
            <button
              onClick={refreshStatus}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh Status
            </button>
          </div>
        </div>

        {/* Model Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Model</h3>
          </div>
          <div className="space-y-2">
            {isLoadingModels ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <select
                value={currentModel || ''}
                onChange={(e) => selectModel(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a model...</option>
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({(m.size / 1024 / 1024 / 1024).toFixed(1)}GB){m.type === 'vision' ? ' (vision)' : ''}
                  </option>
                ))}
              </select>
            )}
            {currentModel && (
              <button
                onClick={() => setShowDetail(!showDetail)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-accent rounded-md transition-colors"
              >
                <span>Model Details</span>
              </button>
            )}
            {showDetail && modelDetail && (
              <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-md p-3">
                <div>Size: {((modelDetail.details as { size?: number })?.size || 0) / 1024 / 1024 / 1024}GB</div>
                {(modelDetail.details as { parent_model?: string })?.parent_model && (
                  <div>Parent: {(modelDetail.details as { parent_model?: string }).parent_model}</div>
                )}
                {(modelDetail.details as { format?: string })?.format && (
                  <div>Format: {(modelDetail.details as { format?: string }).format}</div>
                )}
                {(modelDetail.details as { family?: string })?.family && (
                  <div>Family: {(modelDetail.details as { family?: string }).family}</div>
                )}
              </div>
            )}
            {currentContextLength && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3 h-3" />
                <span>Context length: {currentContextLength}</span>
              </div>
            )}
          </div>
        </div>

        {/* System Prompt Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">System Prompt</h3>
          </div>
          <textarea
            value={syspromptInput}
            onChange={(e) => handleSyspromptChange(e.target.value)}
            onBlur={handleSyspromptBlur}
            className="w-full h-32 px-3 py-2 text-xs bg-secondary border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Enter system prompt..."
          />
        </div>

        {/* Statistics Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Statistics</h3>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Questions</span>
              <span className="font-mono">{userMsgCount}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Input Tokens</span>
              <span className="font-mono">~{totalInputTokens}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Output Tokens</span>
              <span className="font-mono">~{totalOutputTokens}</span>
            </div>
            <div className={cn('flex justify-between text-xs', contextLoadColor)}>
              <span className="text-muted-foreground">Context Load</span>
              <span className="font-mono">{contextLoadPct}%</span>
            </div>
          </div>
        </div>

        {/* Retain Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Retain</h3>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Retain: {retainInput}%
            </label>
            <input
              type="range"
              min={10}
              max={100}
              value={retainInput}
              onChange={(e) => handleRetainChange(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
