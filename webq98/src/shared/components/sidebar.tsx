/* DEPRECATED: скелет логики перенесён в load-modal.tsx (ТЗ-2.3), файл оставлен для истории. Не монтировать. */
import {
  Search,
  Plus,
  MessageSquare,
  FolderOpen,
  Trash2,
  Edit3,
  Loader2,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGateway } from '@/lib/apiGateway';

interface SessionItem {
  id: string;
  title: string;
  category: string;
  model?: string;
  provider?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export function Sidebar() {
  const sidebarOpen = useUIStore((s: { sidebarOpen: boolean }) => s.sidebarOpen);
  const viewingSessionId = useSessionStore((s: { viewingSessionId: string | null }) => s.viewingSessionId);
  const switchToViewing = useSessionStore((s: { switchToViewing: (id: string) => Promise<void> }) => s.switchToViewing);
  const returnToCurrent = useSessionStore((s: { returnToCurrent: () => Promise<void> }) => s.returnToCurrent);
  const refreshStatus = useProviderStore((s: { refreshStatus: () => Promise<void> }) => s.refreshStatus);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showNewSession, setShowNewSession] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    loadSessions();
  }, [searchQuery]); // loadSessions намеренно исключён из deps: эффект триггерится только сменой searchQuery
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingId]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGateway.sessions.list({ search: searchQuery || undefined });
      if (data) setSessions(data);
    } catch (e) {
      console.error('Failed to load sessions', e);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const handleCreateSession = async () => {
    try {
      const data = await apiGateway.sessions.create();
      if (data) {
        loadSessions();
        switchToViewing(data.id);
        setShowNewSession(false);
        refreshStatus();
      }
    } catch (e) {
      console.error('Failed to create session', e);
    }
  };

  const handleSelectSession = async (id: string) => {
    await switchToViewing(id);
    refreshStatus();
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await apiGateway.sessions.delete(id);
      if (viewingSessionId === id) {
        returnToCurrent();
      }
      loadSessions();
    } catch (e) {
      console.error('Failed to delete session', e);
    }
  };

  const handleStartEdit = (session: SessionItem) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    try {
      await apiGateway.sessions.update(editingId, { title: editTitle.trim() });
      setEditingId(null);
      loadSessions();
    } catch (e) {
      console.error('Failed to update session', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const grouped = filteredSessions.reduce<Record<string, SessionItem[]>>((acc, s) => {
    const cat = s.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <aside
      className={`${
        sidebarOpen ? 'w-72' : 'w-0'
      } border-r border-border bg-card transition-all duration-200 overflow-hidden flex flex-col`}
    >
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateSession}
            className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No sessions found
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-3">
              <div className="flex items-center gap-1.5 py-1.5 px-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <FolderOpen className="w-3.5 h-3.5" />
                {category}
              </div>
              <div className="space-y-0.5">
                {items.map((session) => (
                  <div
                    key={session.id}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
                      viewingSessionId === session.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-accent'
                    }`}
                    onClick={() => handleSelectSession(session.id)}
                  >
                    <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                    {editingId === session.id ? (
                      <input
                        ref={editInputRef}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={handleKeyDown}
                        className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-sm"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 truncate">
                        {session.title || 'Untitled'}
                      </span>
                    )}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(session);
                        }}
                        className="p-0.5 hover:bg-muted rounded"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                        className="p-0.5 hover:bg-muted rounded text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{sessions.length} sessions</span>
          <span>{useProviderStore.getState().currentProvider}</span>
        </div>
      </div>
    </aside>
  );
}
