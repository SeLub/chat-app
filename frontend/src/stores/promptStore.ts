import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiGateway } from '@/lib/apiGateway';
import type { Prompt } from '@/types';

interface PromptState {
  prompts: Prompt[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  // P0.2: selected template IDs (persisted in localStorage)
  selectedTemplateIds: string[];
  // Selected system prompt ID (persisted in localStorage)
  syspromptId: string | null;

  loadPrompts: () => Promise<void>;
  createPrompt: (data: { name: string; type: 'system' | 'user_template'; content: string; is_default?: number }) => Promise<Prompt | null>;
  updatePrompt: (id: string, data: { name?: string; type?: 'system' | 'user_template'; content?: string; is_default?: number }) => Promise<Prompt | null>;
  deletePrompt: (id: string) => Promise<void>;
  toggleTemplate: (id: string) => void;
  setSyspromptId: (id: string | null) => void;
}

export const usePromptStore = create<PromptState>()(
  persist(
    (set, get) => ({
      prompts: [],
      loading: false,
      loaded: false,
      error: null,
      selectedTemplateIds: [],
      syspromptId: null,

      loadPrompts: async () => {
        set({ loading: true, error: null });
        try {
          const prompts = await apiGateway.prompts.list();
          set({ prompts: prompts || [], loading: false, loaded: true });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Failed to load prompts', loading: false, loaded: true });
        }
      },

      createPrompt: async (data) => {
        try {
          const prompt = await apiGateway.prompts.create(data);
          if (prompt) {
            set((s) => ({ prompts: [...s.prompts, prompt] }));
          }
          return prompt;
        } catch (e) {
          throw e;
        }
      },

      updatePrompt: async (id, data) => {
        try {
          const prompt = await apiGateway.prompts.update(id, data);
          if (prompt) {
            set((s) => ({
              prompts: s.prompts.map((p) => (p.id === id ? prompt : p)),
            }));
          }
          return prompt;
        } catch (e) {
          throw e;
        }
      },

      deletePrompt: async (id) => {
        try {
          await apiGateway.prompts.delete(id);
          set((s) => ({
            prompts: s.prompts.filter((p) => p.id !== id),
            selectedTemplateIds: s.selectedTemplateIds.filter((tid) => tid !== id),
            syspromptId: s.syspromptId === id ? null : s.syspromptId,
          }));
        } catch (e) {
          throw e;
        }
      },

      toggleTemplate: (id) => {
        set((s) => ({
          selectedTemplateIds: s.selectedTemplateIds.includes(id)
            ? s.selectedTemplateIds.filter((tid) => tid !== id)
            : [...s.selectedTemplateIds, id],
        }));
      },

      setSyspromptId: (id) => {
        set({ syspromptId: id });
      },
    }),
    {
      name: 'prompt-store',
      partialize: (s) => ({
        selectedTemplateIds: s.selectedTemplateIds,
        syspromptId: s.syspromptId,
      }),
    },
  ),
);
