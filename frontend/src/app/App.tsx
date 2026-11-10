import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
import { ChatArea } from '@/features/chat/components/chat-area';
import { SettingsPanel } from '@/features/models/components/settings-panel';
import { QuestionsPanel } from '@/features/questions/components/questions-panel';
import { AiHelperOverlay } from '@/features/ai-helper/components/ai-helper-overlay';
import { CommandPalette } from '@/shared/components/command-palette';
import { SaveModal } from '@/features/sessions/components/save-modal';
import { LoadModal } from '@/features/sessions/components/load-modal';
import { Dashboard } from '@/features/dashboard/components/dashboard';

export default function App() {
  const initSession = useSessionStore((s: { init: () => Promise<void> }) => s.init);

  useEffect(() => {
    useProviderStore.getState().init();
    // polling removed from UI (TZ-4.5), keep for now
    // ТЗ Project mode A: projectStore.init после восстановления активной сессии
    initSession().finally(() => {
      useProjectStore.getState().init();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <div className="flex flex-1 overflow-hidden gap-2 p-2">
              <QuestionsPanel className="w-1/5 min-w-[240px]" />
              <ChatArea className="w-3/5" />
              <SettingsPanel className="w-1/5 min-w-[280px]" />
            </div>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Dashboard />
          }
        />
      </Routes>
      <AiHelperOverlay />
      <CommandPalette />
      <SaveModal />
      <LoadModal />
    </>
  );
}
