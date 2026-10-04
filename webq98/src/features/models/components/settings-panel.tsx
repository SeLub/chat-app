import {
  Settings2,
  RefreshCw,
  Info,
  Loader2,
  Brain,
  Cpu,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useState, useEffect } from 'react';

export function SettingsPanel() {
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
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
  const updateSysprompt = useSessionStore((s) => s.updateSysprompt);
  const contextConfig = useSessionStore((s) => s.contextConfig);
  const updateContextConfig = useSessionStore((s) => s.updateContextConfig);

  const [syspromptInput, setSyspromptInput] = useState(sysprompt);
  const [trimPercent, setTrimPercent] = useState(contextConfig.trimPercent);
  const [contextMode, setContextMode] = useState<'standard' | 'manual'>(contextConfig.mode as 'standard' | 'manual');
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setSyspromptInput(sysprompt);
  }, [sysprompt]);

  useEffect(() => {
    setTrimPercent(contextConfig.trimPercent);
  }, [contextConfig.trimPercent]);

  useEffect(() => {
    setContextMode(contextConfig.mode as 'standard' | 'manual');
  }, [contextConfig.mode]);

  const handleSyspromptChange = (val: string) => {
    setSyspromptInput(val);
  };

  const handleSyspromptSave = async () => {
    await updateSysprompt(syspromptInput);
  };

  const handleTrimChange = (val: number) => {
    setTrimPercent(val);
    updateContextConfig({ trimPercent: val });
  };

  const handleContextModeChange = (mode: 'standard' | 'manual') => {
    setContextMode(mode);
    updateContextConfig({ mode });
  };

  return (
    <aside
      className={`${
        rightPanelOpen ? 'w-80' : 'w-0'
      } border-l border-border bg-card transition-all duration-200 overflow-hidden flex flex-col`}
    >
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
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                  currentProvider === p.name
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'hover:bg-accent text-muted-foreground'
                }`}
              >
                <span className="font-medium">{p.name}</span>
                <div className="flex items-center gap-1.5">
                  {p.status === 'checking' && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span className={`w-2 h-2 rounded-full ${
                    p.status === 'connected' ? 'bg-success' : p.status === 'checking' ? 'bg-warning' : 'bg-destructive'
                  }`} />
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
                {showDetail ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
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
            onBlur={handleSyspromptSave}
            className="w-full h-32 px-3 py-2 text-xs bg-secondary border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Enter system prompt..."
          />
        </div>

        {/* Context Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Context</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Mode</label>
              <div className="flex gap-1">
                <button
                  onClick={() => handleContextModeChange('standard')}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                    contextMode === 'standard'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-secondary hover:bg-accent'
                  }`}
                >
                  Standard
                </button>
                <button
                  onClick={() => handleContextModeChange('manual')}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                    contextMode === 'manual'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-secondary hover:bg-accent'
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Retain: {trimPercent}%
              </label>
              <input
                type="range"
                min={10}
                max={100}
                value={trimPercent}
                onChange={(e) => handleTrimChange(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
