import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectPanel } from './project-panel';

// Mock projectStore
const mockAttachments: any[] = [];
const mockProjectStore = {
  config: { contextBaseDir: { ok: true, error: null } },
  currentProject: { id: 'p1', name: 'test-project', path: '/base/test-project' },
  attachments: mockAttachments,
  filter: '',
  browseFiles: [],
  browseTotal: 0,
  browseTruncated: false,
  isLoading: false,
  init: vi.fn(),
  loadConfig: vi.fn(),
  createProject: vi.fn(),
  unlinkProject: vi.fn(),
  loadAttachments: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  setFilter: vi.fn(),
  loadBrowseFiles: vi.fn(),
};

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: (selector: any) => selector(mockProjectStore),
}));

// Mock sessionStore
const mockSessionStore: any = {
  activeSessionId: 'sess-1',
  mode: 'project',
  streaming: { active: false, content: '', reasoning: '', questionId: null },
  messages: [],
};

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (selector: any) => selector(mockSessionStore),
}));

// Mock apiGateway
const mockGetLastPrompt = vi.fn();
vi.mock('@/lib/apiGateway', async () => {
  const actual = await vi.importActual<any>('@/lib/apiGateway');
  return {
    ...actual,
    apiGateway: {
      sessions: {
        getLastPrompt: (...args: any[]) => mockGetLastPrompt(...args),
      },
    },
  };
});

// Mock BrowseDialog
vi.mock('./browse-dialog', () => ({
  BrowseDialog: () => <div data-testid="browse-dialog" />,
}));

// Mock sonner — use vi.hoisted to avoid hoisting issues
const mocked = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: mocked.toast }));

function makeAttachment(fileId: string, name: string) {
  return {
    fileId,
    name,
    size: 100,
    kind: 'reference' as const,
    language: 'js',
    filePath: `/base/test-project/${name}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAttachments.length = 0;
  mockSessionStore.streaming.active = false;
  mockGetLastPrompt.mockRejectedValue(new Error('404'));
});

describe('ProjectPanel — attached files split', () => {
  it('shows "New for this question" when last_prompt has no matching files', async () => {
    mockAttachments.push(makeAttachment('A', 'a.js'), makeAttachment('B', 'b.js'));
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [] },
    });

    render(<ProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText('New for this question (2)')).toBeInTheDocument();
    });
    expect(screen.queryByText(/From previous answer/)).not.toBeInTheDocument();
  });

  it('splits files into New and Previous based on last_prompt.currentAttachments', async () => {
    mockAttachments.push(
      makeAttachment('A', 'a.js'),
      makeAttachment('B', 'b.js'),
      makeAttachment('C', 'c.js'),
    );
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [{ fileId: 'A' }, { fileId: 'B' }] },
    });

    render(<ProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText('New for this question (1)')).toBeInTheDocument();
    });
    expect(screen.getByText('From previous answer (2)')).toBeInTheDocument();
    // New file C is shown
    expect(screen.getByTitle('/base/test-project/c.js')).toBeInTheDocument();
  });

  it('shows all files as "From previous answer" after a response (no new files)', async () => {
    mockAttachments.push(
      makeAttachment('A', 'a.js'),
      makeAttachment('B', 'b.js'),
    );
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [{ fileId: 'A' }, { fileId: 'B' }] },
    });

    render(<ProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText('From previous answer (2)')).toBeInTheDocument();
    });
    expect(screen.queryByText(/New for this question/)).not.toBeInTheDocument();
  });

  it('shows "No files attached" when attachments is empty', async () => {
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [] },
    });

    render(<ProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText('No files attached')).toBeInTheDocument();
    });
  });

  it('re-requests last_prompt when streamingActive transitions to false', async () => {
    mockAttachments.push(makeAttachment('A', 'a.js'));
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [{ fileId: 'A' }] },
    });

    // Start with streaming active — should NOT fetch
    mockSessionStore.streaming.active = true;
    const { rerender } = render(<ProjectPanel />);
    expect(mockGetLastPrompt).not.toHaveBeenCalled();

    // Simulate streaming ending
    mockSessionStore.streaming.active = false;
    rerender(<ProjectPanel />);

    await waitFor(() => {
      expect(mockGetLastPrompt).toHaveBeenCalledWith('sess-1');
    });
  });

  it('caches 404 and does not re-request getLastPrompt on re-render', async () => {
    mockAttachments.push(makeAttachment('A', 'a.js'));
    mockSessionStore.messages = [{ id: 'm1' } as any];
    // Simulate 404 response
    mockGetLastPrompt.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

    const { rerender } = render(<ProjectPanel />);

    // First request happens
    await waitFor(() => {
      expect(mockGetLastPrompt).toHaveBeenCalledTimes(1);
    });

    // Re-render (e.g., attachments changed) — should NOT re-request due to 404 cache
    mockAttachments.push(makeAttachment('B', 'b.js'));
    rerender(<ProjectPanel />);

    // Wait a tick to ensure no additional call was made
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetLastPrompt).toHaveBeenCalledTimes(1);
  });

  it('resets 404 cache when streaming starts (streamingActive becomes true)', async () => {
    mockAttachments.push(makeAttachment('A', 'a.js'));
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

    const { rerender } = render(<ProjectPanel />);

    // First request → 404 → cached
    await waitFor(() => {
      expect(mockGetLastPrompt).toHaveBeenCalledTimes(1);
    });

    // Streaming starts → resets 404 cache
    mockSessionStore.streaming.active = true;
    rerender(<ProjectPanel />);

    // Streaming ends → should re-request (cache was reset)
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [{ fileId: 'A' }] },
    });
    mockSessionStore.streaming.active = false;
    rerender(<ProjectPanel />);

    await waitFor(() => {
      expect(mockGetLastPrompt).toHaveBeenCalledTimes(2);
    });
  });

  it('does NOT request last_prompt when messagesCount === 0 (новый чат)', async () => {
    mockAttachments.push(makeAttachment('A', 'a.js'));
    mockSessionStore.messages = []; // ← пустой чат
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [] },
    });

    render(<ProjectPanel />);

    // Даем время на рендер и useEffect
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetLastPrompt).not.toHaveBeenCalled();
  });

  it('requests last_prompt when messagesCount > 0', async () => {
    mockAttachments.push(makeAttachment('A', 'a.js'));
    mockSessionStore.messages = [{ id: 'm1' } as any];
    mockGetLastPrompt.mockResolvedValue({
      prompt: [],
      meta: { currentAttachments: [] },
    });

    render(<ProjectPanel />);

    await waitFor(() => {
      expect(mockGetLastPrompt).toHaveBeenCalledWith('sess-1');
    });
  });
});

describe('ProjectPanel — onDirectoryPicked', () => {
  beforeEach(() => {
    mocked.toast.error.mockReset();
    mocked.toast.success.mockReset();
  });

  it('400 from createProject → toast с подсказкой «выберите корень проекта»', async () => {
    mockProjectStore.createProject.mockRejectedValue(
      Object.assign(new Error('Project directory not found'), { status: 400 }),
    );

    render(<ProjectPanel />);

    const input = document.querySelector('input[type="file"][hidden]') as HTMLInputElement;
    expect(input).toBeInTheDocument();

    // Симулируем выбор папки packages/ (подпапка внутри проекта)
    const file = Object.assign(new File(['x'], 'foo.js'), { webkitRelativePath: 'packages/foo.js' });
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(mocked.toast.error).toHaveBeenCalledWith(
        expect.stringContaining('packages'),
      );
      expect(mocked.toast.error).toHaveBeenCalledWith(
        expect.stringContaining('КОРЕНЬ проекта'),
      );
    });
  });

  it('успешный createProject → вызов createProject с правильным путём', async () => {
    mockProjectStore.createProject.mockResolvedValue(undefined);

    render(<ProjectPanel />);

    const input = document.querySelector('input[type="file"][hidden]') as HTMLInputElement;

    const file = Object.assign(new File(['x'], 'foo.js'), { webkitRelativePath: 'my-project/foo.js' });
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(mockProjectStore.createProject).toHaveBeenCalledWith('my-project');
    });
    // Успешный вызов — нет toast.error
    expect(mocked.toast.error).not.toHaveBeenCalled();
  });
});
