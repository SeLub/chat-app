import { useState } from 'react';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/sessionStore';
import { ModeToggle } from './mode-toggle';
import { ProjectPanel } from './project-panel';
import { ResearchPanel } from './research-panel';

// ТЗ Project mode A (§4): правая панель — переключатель режима в шапке.
// Research: настройки (замена заглушки «Reserved for Project mode»).
// Project: ProjectPanel (баннер, CurrentProject, AttachList, attach/browse).
// Левая (Questions/Prompts) и центр (ChatArea) — без изменений.

export function SettingsPanel({ className }: { className?: string }) {
  const mode = useSessionStore((s: { mode: 'research' | 'project' }) => s.mode);
  const setMode = useSessionStore((s: { setMode: (m: 'research' | 'project') => Promise<void> }) => s.setMode);
  const [switching, setSwitching] = useState(false);

  const handleModeChange = async (next: 'research' | 'project') => {
    if (next === mode || switching) return;
    setSwitching(true);
    try {
      await setMode(next);
    } catch {
      toast.error('Не удалось переключить режим сессии');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <aside className={cn(className, 'glass border-l border-border flex flex-col')}>
      {/* Шапка: ModeToggle (ТЗ §4.8) */}
      <div className="h-[44px] flex items-center justify-between px-3 border-b border-border flex-shrink-0">
        <div className="flex items-center min-w-0">
          <Settings2 className="w-4 h-4 text-muted-foreground mr-2 shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">
            {mode === 'project' ? '📁 Project' : '⚙ Settings'}
          </span>
        </div>
        <ModeToggle mode={mode} onChange={handleModeChange} disabled={switching} />
      </div>

      {mode === 'project' ? (
        <ProjectPanel />
      ) : (
        <ResearchPanel />
      )}
    </aside>
  );
}
