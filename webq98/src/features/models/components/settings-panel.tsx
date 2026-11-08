/* DEPRECATED: не монтируется. Скелет для Project-режима. */
import { Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SettingsPanel({ className }: { className?: string }) {
  return (
    <aside className={cn(className, 'glass border-l border-border flex flex-col')}>
      <div className="h-[44px] flex items-center px-4 border-b border-border flex-shrink-0">
        <Settings2 className="w-4 h-4 text-muted-foreground mr-2" />
        <span className="text-sm font-semibold text-foreground">⚙ Settings</span>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="border border-dashed border-border rounded-lg p-4 h-[120px] w-full max-w-[240px] flex items-center justify-center">
          <span className="text-xs text-muted-foreground italic">Reserved for Project mode</span>
        </div>
      </div>
    </aside>
  );
}
