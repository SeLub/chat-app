import { Search } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGateway } from '@/lib/apiGateway';

interface SessionItem {
  id: string;
  title: string;
  category: string;
  model?: string;
  created_at: string;
}

export function CommandPalette() {
  const commandPaletteOpen = useUIStore((s: { commandPaletteOpen: boolean }) => s.commandPaletteOpen);
  const toggleCommandPalette = useUIStore((s: { toggleCommandPalette: () => void }) => s.toggleCommandPalette);
  const switchToViewing = useSessionStore((s: { switchToViewing: (id: string) => Promise<void> }) => s.switchToViewing);

  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSessions, setShowSessions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [commandPaletteOpen]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (query.length >= 2) {
      loadSessions();
    } else {
      setShowSessions(false);
    }
  }, [query]); // loadSessions is stable (createContextualApi)
  /* eslint-enable react-hooks/exhaustive-deps */

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiGateway.sessions.list({ search: query });
      if (data) {
        setSessions(data);
        setShowSessions(true);
        setSelectedIndex(0);
      }
    } catch {
      // ignore
    }
  }, [query]);

  const handleSelect = async (sessionId: string) => {
    await switchToViewing(sessionId);
    toggleCommandPalette();
    setQuery('');
  };

  const handleClose = () => {
    toggleCommandPalette();
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, sessions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && showSessions && sessions[selectedIndex]) {
      e.preventDefault();
      handleSelect(sessions[selectedIndex].id);
    } else if (e.key === 'Escape') {
      handleClose();
    }
  };

  if (!commandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          <button
            onClick={handleClose}
            className="px-1.5 py-0.5 text-xs bg-muted rounded text-muted-foreground"
          >
            ESC
          </button>
        </div>

        {showSessions && sessions.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            {sessions.map((session: SessionItem, idx: number) => (
              <button
                key={session.id}
                onClick={() => handleSelect(session.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  idx === selectedIndex ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                }`}
              >
                <span className="flex-1 text-left truncate">{session.title}</span>
                <span className="text-xs text-muted-foreground">
                  {session.model?.slice(0, 20)}
                </span>
              </button>
            ))}
          </div>
        )}

        {query.length >= 2 && showSessions && sessions.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No sessions found
          </div>
        )}

        {query.length < 2 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            Type at least 2 characters to search
          </div>
        )}
      </div>
    </div>
  );
}
