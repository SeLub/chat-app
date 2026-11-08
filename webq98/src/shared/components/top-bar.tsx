/* DEPRECATED: скелет логики перенесён в load-modal.tsx (ТЗ-2.3), файл оставлен для истории. Не монтировать. */
import { MessageSquare, LayoutDashboard, Settings2, Sparkles, Palette } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/app/ThemeProvider';
import type { Theme, Mode } from '@/app/ThemeProvider';

const themes: { value: Theme; label: string }[] = [
  { value: 'leteem', label: 'Leteem' },
  { value: 'besafe', label: 'Besafe' },
  { value: 'minimal', label: 'Minimal' },
];

const modes: { value: Mode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function TopBar() {
  const navigate = useNavigate();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleAiHelper = useUIStore((s) => s.toggleAiHelper);
  const openSaveModal = useUIStore((s) => s.openSaveModal);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const currentSessionTitle = useSessionStore((s) => s.currentSessionTitle);
  const currentModel = useProviderStore((s) => s.currentModel);

  const { theme, mode, setTheme, setMode } = useTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCommandPalette, toggleSidebar]);

  return (
    <TooltipProvider delayDuration={0}>
      <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card min-h-12">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Toggle sidebar">
                <MessageSquare className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
          </Tooltip>
          <span className="font-semibold text-sm text-foreground truncate max-w-[200px]">
            {currentSessionTitle || 'Chat'}
          </span>
          {currentModel && (
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
              {currentModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} aria-label="Dashboard">
                <LayoutDashboard className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Dashboard</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleAiHelper} aria-label="AI Helper">
                <Sparkles className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">AI Helper</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={openSaveModal} aria-label="Save">
                <Settings2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Save</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Theme">
                    <Palette className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Theme</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                {themes.map((t) => (
                  <DropdownMenuItem
                    key={t.value}
                    className="justify-between"
                    onClick={() => setTheme(t.value)}
                  >
                    {t.label}
                    {theme === t.value && (
                      <span className="text-primary">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Mode</DropdownMenuLabel>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {modes.map((m) => (
                        <DropdownMenuItem
                          key={m.value}
                          className="justify-between"
                          onClick={() => setMode(m.value)}
                        >
                          {m.label}
                          {mode === m.value && (
                            <span className="text-primary">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
}
