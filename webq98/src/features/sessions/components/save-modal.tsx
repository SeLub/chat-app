import { Save } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function SaveModal() {
  const saveModalOpen = useUIStore((s: { saveModalOpen: boolean }) => s.saveModalOpen);
  const closeSaveModal = useUIStore((s: { closeSaveModal: () => void }) => s.closeSaveModal);
  const saveConversation = useSessionStore((s: { saveConversation: (t: string, c: string) => Promise<void> }) => s.saveConversation);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await saveConversation(title.trim(), category);
    setSaving(false);
    closeSaveModal();
  };

  return (
    <Dialog open={saveModalOpen} onOpenChange={(open) => !open && closeSaveModal()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save Conversation</DialogTitle>
          <DialogDescription>Give the conversation a title and category.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="save-title">Title</label>
            <input
              id="save-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Conversation title..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="save-category">Category</label>
            <input
              id="save-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Category..."
            />
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={closeSaveModal}
            className="px-4 py-2 text-sm bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
