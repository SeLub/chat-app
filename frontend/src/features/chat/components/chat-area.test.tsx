import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatArea } from './chat-area';

// --- Mocks ---

const mockSessionStore: any = {
  messages: [],
  contextInfo: null,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  activeSessionId: 'sess-1',
  sessionMode: 'research',
  viewingSessionId: null,
  currentSessionTitle: 'Test Session',
  mode: 'research',
  streaming: { active: false, content: '', reasoning: '', questionId: null },
  sendMessage: vi.fn(),
  sendMessageStream: vi.fn(),
  returnToCurrent: vi.fn(),
  clearChat: vi.fn(),
  deleteSession: vi.fn(),
  exportConversation: vi.fn(),
  deleteMessage: vi.fn(),
  setInputValue: vi.fn(),
};

const mockProviderStore: any = {
  models: [{ name: 'test-model', size: 100 }],
  currentModel: 'test-model',
  selectModel: vi.fn(),
  currentProviderConnected: true,
  modelDetail: null,
  currentContextLength: 4096,
  refreshStatus: 'idle',
  providers: [{ name: 'llama', status: 'connected' }],
  currentProvider: 'llama',
  setCurrentProvider: vi.fn(),
};

const mockUIStore: any = {
  sidebarOpen: false,
};

const mockGenParamsStore: any = {
  params: {},
  activePreset: null,
  open: false,
};

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: any) =>
      typeof selector === 'function' ? selector(mockSessionStore) : mockSessionStore[selector],
    { getState: () => mockSessionStore },
  ),
}));

vi.mock('@/stores/providerStore', () => ({
  useProviderStore: (selector: any) =>
    typeof selector === 'function' ? selector(mockProviderStore) : mockProviderStore[selector],
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: any) =>
    typeof selector === 'function' ? selector(mockUIStore) : mockUIStore[selector],
}));

vi.mock('@/stores/generationParamsStore', () => ({
  useGenerationParamsStore: (selector: any) =>
    typeof selector === 'function' ? selector(mockGenParamsStore) : mockGenParamsStore[selector],
}));

vi.mock('@/app/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'dark',
    mode: 'dark',
    setTheme: vi.fn(),
    setMode: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/features/chat/components/generation-params-modal', () => ({
  GenerationParamsModal: () => null,
}));

vi.mock('@/features/chat/components/last-prompt-modal', () => ({
  LastPromptModal: () => null,
}));

vi.mock('@/features/stt/components/stt-input', () => ({
  STTInput: () => null,
}));

vi.mock('@/components/chat/CodeBlock', () => ({
  CodeBlock: () => null,
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/lib/chatRender', () => ({
  remarkPlugins: [],
  rehypePlugins: [],
}));

vi.mock('@/lib/apiGateway', () => ({
  apiGateway: {
    sessions: { getLastPrompt: vi.fn() },
  },
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
}));

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionStore.messages = [];
  mockSessionStore.streaming.active = false;
  mockSessionStore.mode = 'research';
});

describe('ChatArea — paperclip visibility', () => {
  it('shows paperclip button in research mode', () => {
    mockSessionStore.mode = 'research';
    render(<ChatArea />);
    expect(screen.getByLabelText('Attach files')).toBeInTheDocument();
  });

  it('hides paperclip button in project mode', () => {
    mockSessionStore.mode = 'project';
    render(<ChatArea />);
    expect(screen.queryByLabelText('Attach files')).not.toBeInTheDocument();
  });
});
