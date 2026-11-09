import { Search, Edit3, FolderOpen, MessageSquare, Loader2 } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGateway } from '@/lib/apiGateway';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';

interface SessionItem {
  id: string;
  title: string;
  category: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export function LoadModal() {
  const loadModalOpen = useUIStore((s: { loadModalOpen: boolean }) => s.loadModalOpen);
  const closeLoadModal = useUIStore((s: { closeLoadModal: () => void }) => s.closeLoadModal);
  const viewingSessionId = useSessionStore((s: { viewingSessionId: string | null }) => s.viewingSessionId);
  const switchToViewing = useSessionStore((s: { switchToViewing: (id: string) => Promise<void> }) => s.switchToViewing);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (loadModalOpen) loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadModalOpen]);

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingId]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGateway.sessions.list({ search: debouncedSearch || undefined });
      if (data) setSessions(data);
    } catch (e) {
      console.error('Failed to load sessions', e);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  const handleSelectSession = async (id: string) => {
    // D.3: модалка не виснет при ошибке — finally закрывает, catch показывает toast (паритет с dashboard)
    try {
      await switchToViewing(id);
    } catch {
      useUIStore.getState().addToast('Failed to open conversation', 'error');
    } finally {
      closeLoadModal();
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
      setSessions((prev) =>
        prev.map((s) => (s.id === editingId ? { ...s, title: editTitle.trim() } : s)),
      );
      setEditingId(null);
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

  const grouped = sessions.reduce<Record<string, SessionItem[]>>((acc, s) => {
    const cat = s.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <Dialog open={loadModalOpen} onOpenChange={open => !open && closeLoadModal()}>
      <DialogContent className="max-w-lg p-0 flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Load Conversation</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="px-6 pb-3">
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

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 max-h-[60vh]">
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
                          {session.title || 'Untitled'}{session.title?.startsWith('unsavedSession') ? ' 📝' : ''}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
                        <span>{session.message_count} msgs</span>
                        <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(session);
                          }}
                          className="p-0.5 hover:bg-muted rounded"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-4 pt-2 border-t border-border">
          <DialogClose asChild>
            <button className="w-full px-4 py-2 text-sm bg-secondary border border-border rounded-md hover:bg-accent transition-colors">
              Cancel
            </button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
