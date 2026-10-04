import { useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { Sidebar } from '@/shared/components/sidebar';
import { ChatArea } from '@/features/chat/components/chat-area';
import { SettingsPanel } from '@/features/models/components/settings-panel';
import { TopBar } from '@/shared/components/top-bar';
import { AiHelperOverlay } from '@/features/ai-helper/components/ai-helper-overlay';
import { CommandPalette } from '@/shared/components/command-palette';
import { SaveModal } from '@/features/sessions/components/save-modal';
import { Dashboard } from '@/features/dashboard/components/dashboard';

export default function App() {
  const initSession = useSessionStore((s: { init: () => Promise<void> }) => s.init);
  const refreshStatus = useProviderStore((s: { refreshStatus: () => Promise<void> }) => s.refreshStatus);

  useMemo(() => {
    initSession();
    refreshStatus();
  }, [initSession, refreshStatus]);

  return (
    <>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Routes>
          <Route
            path="/"
            element={
              <>
                <Sidebar />
                <ChatArea />
                <SettingsPanel />
              </>
            }
          />
          <Route
            path="/dashboard"
            element={
              <>
                <Sidebar />
                <Dashboard />
                <SettingsPanel />
              </>
            }
          />
        </Routes>
      </div>
      <AiHelperOverlay />
      <CommandPalette />
      <SaveModal />
    </>
  );
}
