import { create } from 'zustand';
import { toast } from 'sonner';
import type { ToastMessage } from '@/types';

interface UIStore {
  toasts: ToastMessage[];
  sidebarOpen: boolean;
  aiHelperOpen: boolean;
  saveModalOpen: boolean;
  loadModalOpen: boolean;
  commandPaletteOpen: boolean;

  addToast: (message: string, type?: ToastMessage['type']) => void;
  removeToast: (id: string) => void;
  toggleSidebar: () => void;
  toggleAiHelper: () => void;
  openSaveModal: () => void;
  closeSaveModal: () => void;
  openLoadModal: () => void;
  closeLoadModal: () => void;
  toggleCommandPalette: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  toasts: [],
  sidebarOpen: true,
  aiHelperOpen: false,
  saveModalOpen: false,
  loadModalOpen: false,
  commandPaletteOpen: false,

  addToast: (message: string, type: ToastMessage['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    toast(message, { duration: 3000, description: type !== 'info' ? type : undefined });
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleAiHelper: () => set((s) => ({ aiHelperOpen: !s.aiHelperOpen })),
  openSaveModal: () => set({ saveModalOpen: true }),
  closeSaveModal: () => set({ saveModalOpen: false }),
  openLoadModal: () => set({ loadModalOpen: true }),
  closeLoadModal: () => set({ loadModalOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
}));
