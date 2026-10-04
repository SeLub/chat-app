import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { ChatArea } from '@/features/chat/components/chat-area';
import { SettingsPanel } from '@/features/models/components/settings-panel';
import { AiHelperOverlay } from '@/features/ai-helper/components/ai-helper-overlay';
import { CommandPalette } from '@/shared/components/command-palette';
import { SaveModal } from '@/features/sessions/components/save-modal';
import { Dashboard } from '@/features/dashboard/components/dashboard';

export default function App() {
  const initSession = useSessionStore((s: { init: () => Promise<void> }) => s.init);

  useEffect(() => {
    useProviderStore.getState().init();
    useProviderStore.getState().startPolling();
    initSession();
    return () => useProviderStore.getState().stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <div className="flex flex-1 overflow-hidden">
              <ChatArea />
              <SettingsPanel />
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
    </>
  );
}
