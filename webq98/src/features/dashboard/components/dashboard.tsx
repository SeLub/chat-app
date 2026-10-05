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
  ArrowLeft,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGateway } from '@/lib/apiGateway';
import { downloadJson } from '@/lib/export';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import type { Session } from '@/types';
import { Button } from '@/components/ui/button';

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

  const totalMessages = sessions.reduce((sum, s) => sum + s.message_count, 0);
  const uniqueCategories = new Set(sessions.map((s) => s.category).filter(Boolean)).size;

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
    await useSessionStore.getState().deleteSession(id);
    loadSessions();
  };

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) return;
    const idsToDelete = Array.from(selectedSessions);
    for (const id of idsToDelete) {
      await useSessionStore.getState().deleteSession(id);
    }
    setSelectedSessions(new Set());
    loadSessions();
  };

  const handleExportSingle = async (sessionId: string) => {
    try {
      const messages = await apiGateway.sessions.getMessages(sessionId);
      downloadJson(messages, `conversation-${sessionId.slice(0, 8)}-${Date.now()}.json`);
      useUIStore.getState().addToast('Conversation exported', 'success');
    } catch (e) {
      console.error('Failed to export conversation', e);
      useUIStore.getState().addToast('Failed to export', 'error');
    }
  };

  const handleExportSelected = async () => {
    if (selectedSessions.size === 0) return;
    try {
      const allMessages: Array<{ sessionId: string; messages: unknown }> = [];
      for (const sessionId of selectedSessions) {
        const messages = await apiGateway.sessions.getMessages(sessionId);
        allMessages.push({ sessionId, messages });
      }
      downloadJson(allMessages, `conversations-bulk-${Date.now()}.json`);
      useUIStore.getState().addToast(`${selectedSessions.size} conversation(s) exported`, 'success');
    } catch (e) {
      console.error('Failed to export selected', e);
      useUIStore.getState().addToast('Failed to export', 'error');
    }
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

  const handleSelectSession = async (sessionId: string) => {
    try {
      await useSessionStore.getState().switchToViewing(sessionId);
      navigate('/');
    } catch {
      useUIStore.getState().addToast('Failed to open conversation', 'error');
    }
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
    if (selectedSessions.size === sessions.length) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(sessions.map((s) => s.id)));
    }
  };

  const grouped = sessions.reduce<Record<string, Session[]>>((acc, s) => {
    const cat = s.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header with back link */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Conversation Dashboard</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/')} className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Chat
            </Button>
            <Button onClick={handleCreateSession} className="flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Chat
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground">Total Conversations</div>
            <div className="text-2xl font-bold">{sessions.length}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground">Total Messages</div>
            <div className="text-2xl font-bold">{totalMessages}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground">Categories</div>
            <div className="text-2xl font-bold">{uniqueCategories}</div>
          </div>
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
            <>
              <button
                onClick={handleExportSelected}
                className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-md text-sm hover:opacity-90 transition-opacity"
              >
                <Upload className="w-4 h-4" />
                Export Selected ({selectedSessions.size})
              </button>
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-2 px-4 py-2.5 bg-destructive text-destructive-foreground rounded-md text-sm hover:opacity-90 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
                Delete ({selectedSessions.size})
              </button>
            </>
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
                      onClick={() => handleSelectSession(session.id)}
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
                            handleExportSingle(session.id);
                          }}
                          className="p-1 hover:bg-muted rounded"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
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

        {sessions.length > 0 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
            <button
              onClick={toggleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {selectedSessions.size === sessions.length
                ? 'Deselect All'
                : 'Select All'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
