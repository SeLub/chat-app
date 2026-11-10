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

// ============================================================
// ТЗ Project mode A (§4): configApi / projectsApi / attachmentsApi
// ============================================================
describe('configApi.get — GET /api/config (ТЗ Project mode A §3.1)', () => {
  it('возвращает contextBaseDir-статус', async () => {
    mockFetchResponse({ contextBaseDir: { ok: true, path: '/base', error: null } });
    const res = await apiGateway.config.get();
    expect(mockFetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({ method: 'GET' }));
    expect(res!.contextBaseDir.ok).toBe(true);
  });
});

describe('projectsApi (ТЗ Project mode A §3.3-3.5)', () => {
  it('create → POST /api/projects { sessionId, relativePath }', async () => {
    mockFetchResponse({ id: 'p1', name: 'repo', path: 'repo', totalFiles: 42, created: true });
    const res = await apiGateway.projects.create('sess-1', 'repo');
    expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ sessionId: 'sess-1', relativePath: 'repo' });
    expect(res!.created).toBe(true);
    expect(res!.totalFiles).toBe(42);
  });

  it('get → GET /api/projects/:id', async () => {
    mockFetchResponse({ id: 'p1', name: 'repo', path: 'repo' });
    await apiGateway.projects.get('p1');
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/p1', expect.objectContaining({ method: 'GET' }));
  });

  it('listFiles → GET /api/projects/:id/files с filter (encodeURIComponent)', async () => {
    mockFetchResponse({ files: [], total: 0, truncated: false });
    await apiGateway.projects.listFiles('p1', 'src/ch.ts');
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/projects/p1/files?filter=${encodeURIComponent('src/ch.ts')}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('listFiles без filter → путь без ?filter', async () => {
    mockFetchResponse({ files: [], total: 0 });
    await apiGateway.projects.listFiles('p1');
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/p1/files', expect.anything());
  });

  it('attach → POST /api/projects/:id/attach { sessionId, relativePaths }', async () => {
    mockFetchResponse({ attached: [], errors: [] });
    await apiGateway.projects.attach('p1', 'sess-1', ['a.ts', 'b.md']);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('/api/projects/p1/attach');
    expect(JSON.parse(call[1].body)).toEqual({ sessionId: 'sess-1', relativePaths: ['a.ts', 'b.md'] });
  });

  it('unlink → DELETE /api/sessions/:id/project', async () => {
    mockFetchResponse({ ok: true });
    await apiGateway.projects.unlink('sess-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-1/project', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('attachmentsApi (ТЗ Project mode A §3.6-3.7)', () => {
  it('listBySession → GET /api/sessions/:id/attachments?kind=reference', async () => {
    mockFetchResponse({ attachments: [] });
    await apiGateway.attachments.listBySession('sess-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sessions/sess-1/attachments?kind=reference',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('detach → DELETE /api/attachments/:fileId', async () => {
    mockFetchResponse({ ok: true, deletedId: 'f1' });
    await apiGateway.attachments.detach('f1');
    expect(mockFetch).toHaveBeenCalledWith('/api/attachments/f1', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('sessionsApi.update с mode (ТЗ Project mode A §3.2)', () => {
  it('PATCH /api/sessions/:id с { mode } в body', async () => {
    mockFetchResponse({ id: 'sess-1' });
    await apiGateway.sessions.update('sess-1', { mode: 'project' });
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('/api/sessions/sess-1');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ mode: 'project' });
  });
});
