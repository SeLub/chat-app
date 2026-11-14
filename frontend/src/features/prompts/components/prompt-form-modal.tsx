import { useState, useEffect } from 'react';
import { apiGateway } from '@/lib/apiGateway';
import { useUIStore } from '@/stores/uiStore';
import type { Prompt } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PromptFormModalProps {
  open: boolean;
  onClose: () => void;
  editingPrompt: Prompt | null;
  onSaved: () => void;
}

export function PromptFormModal({ open, onClose, editingPrompt, onSaved }: PromptFormModalProps) {
  const addToast = useUIStore((s) => s.addToast);
  const [name, setName] = useState('');
  const [type, setType] = useState<'system' | 'user_template'>('user_template');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingPrompt) {
      setName(editingPrompt.name);
      setType(editingPrompt.type);
      setContent(editingPrompt.content);
    } else {
      setName('');
      setType('user_template');
      setContent('');
    }
    setError(null);
  }, [editingPrompt, open]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingPrompt) {
        await apiGateway.prompts.update(editingPrompt.id, {
          name: name.trim(),
          content: content.trim(),
        });
        addToast('Prompt updated', 'success');
      } else {
        await apiGateway.prompts.create({
          name: name.trim(),
          type,
          content: content.trim(),
        });
        addToast('Prompt created', 'success');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to save prompt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingPrompt ? 'Edit Prompt' : 'New Prompt'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Prompt name..."
              className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Type</label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as 'system' | 'user_template')}
              disabled={!!editingPrompt}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System Prompt</SelectItem>
                <SelectItem value="user_template">User Template</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Content */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="Prompt content..."
              className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
