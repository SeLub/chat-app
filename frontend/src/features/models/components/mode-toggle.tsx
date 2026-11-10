import { FlaskConical, FolderTree } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionMode } from '@/types';

// ТЗ Project mode A (§4): переключатель Research/Project в шапке правой панели.
// Переключение — PATCH /api/sessions/:id { mode } через sessionStore.setMode.
interface ModeToggleProps {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  const base = cn(
    'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  );
  return (
    <div
      role="group"
      aria-label="Session mode"
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <button
        type="button"
        aria-pressed={mode === 'research'}
        disabled={disabled}
        onClick={() => onChange('research')}
        className={cn(
          base,
          mode === 'research'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <FlaskConical className="w-3.5 h-3.5" />
        Research
      </button>
      <button
        type="button"
        aria-pressed={mode === 'project'}
        disabled={disabled}
        onClick={() => onChange('project')}
        className={cn(
          base,
          mode === 'project'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <FolderTree className="w-3.5 h-3.5" />
        Project
      </button>
    </div>
  );
}
