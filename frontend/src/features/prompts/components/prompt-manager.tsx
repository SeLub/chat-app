import {
  Search,
  Plus,
  Trash2,
  Edit3,
  FolderOpen,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Settings2,
  ListChecks,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { apiGateway } from '@/lib/apiGateway';
import { isGroupOpen } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import type { Prompt } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PromptFormModal } from './prompt-form-modal';

export function PromptManager() {
  const navigate = useNavigate();
  const addToast = useUIStore((s) => s.addToast);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);

  const systemPrompts = prompts.filter((p) => p.type === 'system');
  const userTemplates = prompts.filter((p) => p.type === 'user_template');

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGateway.prompts.list();
      if (data) setPrompts(data);
    } catch (e) {
      console.error('Failed to load prompts', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleDelete = async (id: string) => {
    try {
      await apiGateway.prompts.delete(id);
      addToast('Prompt deleted', 'success');
      loadPrompts();
    } catch (e: any) {
      addToast(e.message || 'Failed to delete prompt', 'error');
    }
  };

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setFormOpen(true);
  };

  const filteredPrompts = prompts.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const renderRow = (prompt: Prompt) => (
    <div
      key={prompt.id}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/50 transition-colors group"
    >
      {prompt.type === 'system' ? (
        <Settings2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      ) : (
        <ListChecks className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      )}
      <span className="flex-1 text-sm truncate">{prompt.name}</span>
      {prompt.is_default === 1 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
          default
        </span>
      )}
      <span className="text-xs text-muted-foreground font-mono">
        {prompt.content.length}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => handleEdit(prompt)}
        >
          <Edit3 className="w-3.5 h-3.5" />
        </Button>
        {prompt.is_default === 1 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cannot delete default prompt</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive"
            onClick={() => handleDelete(prompt.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  const renderGroup = (label: string, items: Prompt[], key: string) => (
    <div className="glass rounded-xl border border-border overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors"
        onClick={() =>
          setGroupOpen((prev) => ({ ...prev, [key]: !isGroupOpen(prev, key) }))
        }
      >
        {isGroupOpen(groupOpen, key) ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground font-mono">
          {items.length}
        </span>
      </button>
      {isGroupOpen(groupOpen, key) && (
        <div className="border-t border-border divide-y divide-border">
          {items.map(renderRow)}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-black tracking-tighter italic">
            Prompt Manager
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/')} className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Chat
            </Button>
            <Button
              onClick={() => {
                setEditingPrompt(null);
                setFormOpen(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New Prompt
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="glass rounded-xl border border-border p-4">
            <div className="text-xs text-muted-foreground">System Prompts</div>
            <div className="font-mono text-2xl">{systemPrompts.length}</div>
          </div>
          <div className="glass rounded-xl border border-border p-4">
            <div className="text-xs text-muted-foreground">User Templates</div>
            <div className="font-mono text-2xl">{userTemplates.length}</div>
          </div>
          <div className="glass rounded-xl border border-border p-4">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-mono text-2xl">{prompts.length}</div>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredPrompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderOpen className="w-8 h-8 mb-2" />
            <span className="text-sm">No prompts found</span>
          </div>
        ) : (
          <div className="space-y-4">
            {searchQuery ? (
              <div className="glass rounded-xl border border-border divide-y divide-border">
                {filteredPrompts.map(renderRow)}
              </div>
            ) : (
              <>
                {renderGroup('System Prompts', systemPrompts, 'system')}
                {renderGroup('User Templates', userTemplates, 'user_template')}
              </>
            )}
          </div>
        )}
      </div>

      {/* Form modal */}
      <PromptFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingPrompt(null);
        }}
        editingPrompt={editingPrompt}
        onSaved={loadPrompts}
      />
    </div>
  );
}
