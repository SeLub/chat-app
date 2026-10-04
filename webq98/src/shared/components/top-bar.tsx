import { MessageSquare, LayoutDashboard, Settings2, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { useEffect } from 'react';

export function TopBar() {
  const navigate = useNavigate();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const toggleAiHelper = useUIStore((s) => s.toggleAiHelper);
  const openSaveModal = useUIStore((s) => s.openSaveModal);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const currentSessionTitle = useSessionStore((s) => s.currentSessionTitle);
  const currentModel = useProviderStore((s) => s.currentModel);

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
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card min-h-12">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Toggle sidebar"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
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
        <button
          onClick={() => navigate('/dashboard')}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Dashboard"
        >
          <LayoutDashboard className="w-4 h-4" />
        </button>
        <button
          onClick={toggleRightPanel}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Toggle settings"
        >
          {rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
        <button
          onClick={toggleAiHelper}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="AI Helper"
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <button
          onClick={openSaveModal}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Save"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
