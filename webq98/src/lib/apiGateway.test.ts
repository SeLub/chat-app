import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiGateway } from './apiGateway';

// Global mock for fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

function mockFetchResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValue(mockResponse(data, status));
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('chatApi.send — FormData contract (§3.1)', () => {
  it('1. builds FormData with all required fields, includeQuestionIds, and optional file/codeFiles', async () => {
    let formDataCaptured: FormData | undefined;
    mockFetch.mockImplementation(async (url: string, opts: RequestInit) => {
      formDataCaptured = opts.body as FormData;
      return mockResponse({ response: 'ok' }, 200);
    });

    const file = new File(['x'], 'f.pdf', { type: 'application/pdf' });
    const codeFile = new File(['c'], 'a.ts', { type: 'text/typescript' });

    await apiGateway.chat.send(
      {
        sessionId: 's1',
        message: 'hello',
        model: 'llama3',
        questionId: 'q_1_100',
        retainPercent: 80,
        includeQuestionIds: ['q_1_100'],
      },
      'llama_cpp',
      { file, codeFiles: [codeFile] },
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const fd = formDataCaptured!;
    expect(fd.get('message')).toBe('hello');
    expect(fd.get('model')).toBe('llama3');
    expect(fd.get('sessionId')).toBe('s1');
    expect(fd.get('questionId')).toBe('q_1_100');
    expect(fd.get('retainPercent')).toBe('80');
    expect(fd.get('includeQuestionIds')).toBe(JSON.stringify(['q_1_100']));
    // contextLength NOT present when undefined
    expect(fd.has('contextLength')).toBe(false);
    // file present
    expect(fd.get('file')).toBe(file);
    // codeFiles appended once per file
    const codeFilesValues = fd.getAll('codeFiles');
    expect(codeFilesValues).toHaveLength(1);
    expect(codeFilesValues[0]).toBe(codeFile);
  });

  it('2. X-Provider header is set to provider value', async () => {
    mockFetchResponse({ response: 'ok' });
    await apiGateway.chat.send(
      {
        sessionId: 's1',
        message: 'hi',
        model: 'm',
        questionId: 'q_1_1',
        retainPercent: 80,
        includeQuestionIds: [],
      },
      'llama_cpp',
    );
    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['X-Provider']).toBe('llama_cpp');
  });

  it('3. 200 → parsed ChatResponse', async () => {
    const resp = { response: 'Hello!', metrics: { tps: 5 } };
    mockFetchResponse(resp);
    const result = await apiGateway.chat.send(
      {
        sessionId: 's1',
        message: 'hi',
        model: 'm',
        questionId: 'q_1_1',
        retainPercent: 80,
        includeQuestionIds: [],
      },
      'llama_cpp',
    );
    expect(result).toEqual(resp);
  });

  it('4. 204 → null', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiGateway.chat.send(
      {
        sessionId: 's1',
        message: 'hi',
        model: 'm',
        questionId: 'q_1_1',
        retainPercent: 80,
        includeQuestionIds: [],
      },
      'llama_cpp',
    );
    expect(result).toBeNull();
  });

  it('5. 503 + body {error} → ApiError with status and message', async () => {
    mockFetch.mockResolvedValue(mockResponse({ error: 'provider unavailable' }, 503));
    await expect(
      apiGateway.chat.send(
        {
          sessionId: 's1',
          message: 'hi',
          model: 'm',
          questionId: 'q_1_1',
          retainPercent: 80,
          includeQuestionIds: [],
        },
        'llama_cpp',
      ),
    ).rejects.toMatchObject({ status: 503, message: 'provider unavailable', name: 'ApiError' });
  });

  it('6. Network failure (TypeError) → ApiError with status=0', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network error'));
    await expect(
      apiGateway.chat.send(
        {
          sessionId: 's1',
          message: 'hi',
          model: 'm',
          questionId: 'q_1_1',
          retainPercent: 80,
          includeQuestionIds: [],
        },
        'llama_cpp',
      ),
    ).rejects.toMatchObject({ status: 0 });
  });

  it('7. sessionsApi.list builds query-string with search and limit', async () => {
    mockFetchResponse([{ id: 's1', title: 'T', category: '', message_count: 0, sysprompt: '' }]);
    await apiGateway.sessions.list({ search: 'foo', limit: 5 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toMatch(/search=foo.*limit=5|limit=5.*search=foo/);
  });
});
