import { X, Save } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useState } from 'react';

export function SaveModal() {
  const saveModalOpen = useUIStore((s: { saveModalOpen: boolean }) => s.saveModalOpen);
  const closeSaveModal = useUIStore((s: { closeSaveModal: () => void }) => s.closeSaveModal);
  const saveConversation = useSessionStore((s: { saveConversation: (t: string, c: string) => Promise<void> }) => s.saveConversation);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [saving, setSaving] = useState(false);

  if (!saveModalOpen) return null;

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await saveConversation(title.trim(), category);
    setSaving(false);
    closeSaveModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={closeSaveModal}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Save Conversation</h2>
          <button
            onClick={closeSaveModal}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Conversation title..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Category..."
            />
          </div>

          <div className="flex justify-end gap-2">
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
          </div>
        </div>
      </div>
    </div>
  );
}
