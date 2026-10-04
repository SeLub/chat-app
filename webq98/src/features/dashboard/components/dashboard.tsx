import {
  Search,
  Plus,
  Trash2,
  Edit3,
  FolderOpen,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGateway } from '@/lib/apiGateway';
import type { Session } from '@/types';

export function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
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
        navigate('/');
      }
    } catch (e) {
      console.error('Failed to create session', e);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await apiGateway.sessions.delete(id);
      loadSessions();
    } catch (e) {
      console.error('Failed to delete session', e);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) return;
    for (const id of selectedSessions) {
      await apiGateway.sessions.delete(id);
    }
    setSelectedSessions(new Set());
    loadSessions();
  };

  const handleStartEdit = (session: Session) => {
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

  const handleSelectSession = () => {
    navigate('/');
  };

  const toggleSelect = (id: string) => {
    setSelectedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedSessions.size === filteredSessions.length) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(filteredSessions.map((s) => s.id)));
    }
  };

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const grouped = filteredSessions.reduce<Record<string, Session[]>>((acc, s) => {
    const cat = s.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <button
            onClick={handleCreateSession}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {selectedSessions.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-2 px-4 py-2.5 bg-destructive text-destructive-foreground rounded-md text-sm hover:opacity-90 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
              Delete ({selectedSessions.size})
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">No sessions found</p>
            <p className="text-sm mt-1">Create a new chat to get started</p>
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-6">
              <button
                onClick={() => setGroupOpen((prev) => ({ ...prev, [category]: !prev[category] }))}
                className="flex items-center gap-2 py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider"
              >
                {groupOpen[category] ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                <FolderOpen className="w-4 h-4" />
                {category} ({items.length})
              </button>

              {groupOpen[category] && (
                <div className="space-y-1 mt-2">
                  {items.map((session) => (
                    <div
                      key={session.id}
                      className={`group flex items-center gap-3 px-4 py-3 rounded-md cursor-pointer transition-colors ${
                        selectedSessions.has(session.id)
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-accent border border-transparent'
                      }`}
                      onClick={handleSelectSession}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSessions.has(session.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(session.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded"
                      />
                      <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      {editingId === session.id ? (
                        <input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-sm"
                        />
                      ) : (
                        <span className="flex-1 min-w-0 truncate">{session.title || 'Untitled'}</span>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{session.message_count} messages</span>
                        {session.model && (
                          <span className="bg-secondary px-1.5 py-0.5 rounded">
                            {session.model.slice(0, 20)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(session);
                          }}
                          className="p-1 hover:bg-muted rounded"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(session.id);
                          }}
                          className="p-1 hover:bg-muted rounded text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {filteredSessions.length > 0 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
            <button
              onClick={toggleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {selectedSessions.size === filteredSessions.length
                ? 'Deselect All'
                : 'Select All'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
