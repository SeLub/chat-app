import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { LastPromptModal } from './last-prompt-modal';
import { apiGateway } from '../../../lib/apiGateway';
import type { LastPrompt } from '../../../types';

// Mock the API gateway (preserve real ApiError export)
vi.mock('../../../lib/apiGateway', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/apiGateway')>('../../../lib/apiGateway');
  return {
    ...actual,
    apiGateway: {
      sessions: {
        getLastPrompt: vi.fn(),
      },
    },
  };
});

// Mock sonner (toast)
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Minimal ReactMarkdown mock — renders the content string in a div with data-testid
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

const mockGetLastPrompt = vi.mocked(apiGateway.sessions.getLastPrompt);

function makeLastPrompt(overrides: Partial<LastPrompt> = {}): LastPrompt {
  return {
    prompt: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, world!' },
    ],
    meta: {
      model: 'test-model',
      generationParams: { maxTokens: 4096, temperature: 0.7 },
      timestamp: 1736956800000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('LastPromptModal', () => {
  it('shows loading state while fetching', async () => {
    let resolvePromise: (value: LastPrompt) => void;
    mockGetLastPrompt.mockReturnValue(
      new Promise<LastPrompt>((r) => {
        resolvePromise = r;
      })
    );

    render(
      <LastPromptModal open={true} onOpenChange={() => {}} sessionId="s1" />
    );

    // Loading state shows a spinner (Loader2)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();

    resolvePromise!(makeLastPrompt());
    await waitFor(() => expect(document.querySelector('.animate-spin')).not.toBeInTheDocument());
  });

  it('renders meta section and prompt messages on success', async () => {
    mockGetLastPrompt.mockResolvedValue(makeLastPrompt());

    render(
      <LastPromptModal open={true} onOpenChange={() => {}} sessionId="s1" />
    );

    await waitFor(() => expect(screen.getByText('Model')).toBeInTheDocument());

    // Meta fields
    expect(screen.getByText('test-model')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();

    // Prompt messages rendered via ReactMarkdown mock
    const markdowns = screen.getAllByTestId('markdown');
    expect(markdowns.length).toBe(2);
    expect(markdowns[0]).toHaveTextContent('You are a helpful assistant.');
    expect(markdowns[1]).toHaveTextContent('Hello, world!');

    // Copy button
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('renders image placeholder for messages with images', async () => {
    const lp = makeLastPrompt({
      prompt: [
        { role: 'user', content: 'Look at this', images: [{ size: 1234, type: 'base64' }] },
      ],
    });
    mockGetLastPrompt.mockResolvedValue(lp);

    render(
      <LastPromptModal open={true} onOpenChange={() => {}} sessionId="s1" />
    );

    await waitFor(() => expect(screen.getByText('Model')).toBeInTheDocument());

    // Image placeholder rendered as plain text (not markdown)
    expect(screen.getByText(/\[images: 1 × base64\]/)).toBeInTheDocument();
  });

  it('shows "no prompt yet" state on 404', async () => {
    const { ApiError } = await import('../../../lib/apiGateway');
    mockGetLastPrompt.mockRejectedValue(new ApiError(404, 'Not found'));

    render(
      <LastPromptModal open={true} onOpenChange={() => {}} sessionId="s1" />
    );

    await waitFor(() => expect(screen.getByText(/Промпта ещё нет/)).toBeInTheDocument());
    expect(screen.queryByText('Copy')).not.toBeInTheDocument();
  });

  it('shows error state on non-404 errors', async () => {
    const { ApiError } = await import('../../../lib/apiGateway');
    mockGetLastPrompt.mockRejectedValue(new ApiError(500, 'Server error'));

    render(
      <LastPromptModal open={true} onOpenChange={() => {}} sessionId="s1" />
    );

    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());
  });

  it('Copy button copies Markdown to clipboard', async () => {
    mockGetLastPrompt.mockResolvedValue(makeLastPrompt());

    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: copyToClipboard },
      configurable: true,
    });

    render(
      <LastPromptModal open={true} onOpenChange={() => {}} sessionId="s1" />
    );

    await waitFor(() => expect(screen.getByText('Copy')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Copy'));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1));

    const copied = copyToClipboard.mock.calls[0][0] as string;
    expect(copied).toContain('## System');
    expect(copied).toContain('You are a helpful assistant.');
    expect(copied).toContain('## User:');
    expect(copied).toContain('Hello, world!');
  });

  it('does not render content when closed', () => {
    mockGetLastPrompt.mockResolvedValue(makeLastPrompt());

    render(
      <LastPromptModal open={false} onOpenChange={() => {}} sessionId="s1" />
    );

    expect(screen.queryByText('Метаданные')).not.toBeInTheDocument();
    expect(mockGetLastPrompt).not.toHaveBeenCalled();
  });
});
