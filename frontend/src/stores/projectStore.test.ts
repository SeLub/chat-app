import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectStore, extractRelativePath } from './projectStore';

// vi.mock is hoisted — see sessionStore.test.ts pattern
const mocked = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
    }
  },
  apiGateway: {
    config: { get: vi.fn() },
    projects: { create: vi.fn(), get: vi.fn(), listFiles: vi.fn(), attach: vi.fn(), unlink: vi.fn() },
    attachments: { listBySession: vi.fn(), detach: vi.fn() },
    sessions: { get: vi.fn(), update: vi.fn() },
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/apiGateway', () => mocked);
vi.mock('sonner', () => ({ toast: mocked.toast }));

// projectStore читает активную сессию из sessionStore — мокаем (ТЗ: mode не дублируется)
vi.mock('./sessionStore', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({ activeSessionId: 'sess-1' })),
  },
}));


beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    config: null,
    currentProject: null,
    attachments: [],
    filter: '',
    browseFiles: [],
    browseTotal: 0,
    browseTruncated: false,
    isLoading: false,
  });
});

describe('projectStore (ТЗ Project mode A §4)', () => {
  it('init(): fetch /api/config + восстановление currentProject по session.project_id + attachments', async () => {
    mocked.apiGateway.config.get.mockResolvedValue({
      contextBaseDir: { ok: true, path: '/base', error: null },
    });
    mocked.apiGateway.sessions.get.mockResolvedValue({
      id: 'sess-1',
      title: 't',
      category: 'General',
      sysprompt: '',
      message_count: 0,
      created_at: '',
      updated_at: '',
      mode: 'project',
      project_id: 'proj-9',
    });
    mocked.apiGateway.projects.get.mockResolvedValue({ id: 'proj-9', name: 'my-repo', path: 'my-repo' });
    mocked.apiGateway.attachments.listBySession.mockResolvedValue({
      attachments: [{ fileId: 'f1', name: 'chat.ts', size: 10, kind: 'reference', language: 'typescript', filePath: 'my-repo/src/chat.ts' }],
    });

    await useProjectStore.getState().init();

    expect(mocked.apiGateway.config.get).toHaveBeenCalledOnce();
    expect(mocked.apiGateway.projects.get).toHaveBeenCalledWith('proj-9');
    expect(useProjectStore.getState().currentProject).toEqual({ id: 'proj-9', name: 'my-repo', path: 'my-repo' });
    expect(useProjectStore.getState().attachments).toHaveLength(1);
  });

  it('createProject(): POST /api/projects → currentProject set + тост успеха', async () => {
    mocked.apiGateway.projects.create.mockResolvedValue({ id: 'p1', name: 'repo', path: 'repo', totalFiles: 42, created: true });
    mocked.apiGateway.attachments.listBySession.mockResolvedValue({ attachments: [] });

    await useProjectStore.getState().createProject('repo');

    expect(mocked.apiGateway.projects.create).toHaveBeenCalledWith('sess-1', 'repo');
    expect(useProjectStore.getState().currentProject?.id).toBe('p1');
    expect(mocked.toast.success).toHaveBeenCalled();
  });

  it('createProject(): ошибка API → тост, currentProject не установлен', async () => {
    mocked.apiGateway.projects.create.mockRejectedValue(new mocked.ApiError(400, 'Project directory not found'));

    await useProjectStore.getState().createProject('nope');

    expect(mocked.toast.error).toHaveBeenCalledWith('Project directory not found');
    expect(useProjectStore.getState().currentProject).toBeNull();
  });

  it('attach(): POST attach → success-тост по фактически добавленным, errors — по одному тосту', async () => {
    useProjectStore.setState({ currentProject: { id: 'p1', name: 'r', path: 'r' } });
    mocked.apiGateway.projects.attach.mockResolvedValue({
      attached: [
        { fileId: 'f1', name: 'a.ts', size: 1, kind: 'reference', language: 'typescript' },
        { fileId: 'f2', name: 'b.md', size: 1, kind: 'reference', language: 'markdown', skipped: true },
      ],
      errors: [{ path: 'src/gone.ts', error: 'File not found' }],
    });
    mocked.apiGateway.attachments.listBySession.mockResolvedValue({ attachments: [] });

    await useProjectStore.getState().attach(['a.ts', 'b.md', 'src/gone.ts']);

    expect(mocked.apiGateway.projects.attach).toHaveBeenCalledWith('p1', 'sess-1', ['a.ts', 'b.md', 'src/gone.ts']);
    expect(mocked.toast.error).toHaveBeenCalledWith('src/gone.ts: File not found');
    expect(mocked.toast.success).toHaveBeenCalledWith('Приложено файлов: 1'); // skipped не считается
  });

  it('detach(): DELETE /api/attachments/:fileId → файл убран из списка', async () => {
    useProjectStore.setState({
      attachments: [
        { fileId: 'f1', name: 'a.ts', size: 1, kind: 'reference', language: 'typescript', filePath: 'r/a.ts' },
        { fileId: 'f2', name: 'b.ts', size: 1, kind: 'reference', language: 'typescript', filePath: 'r/b.ts' },
      ],
    });
    mocked.apiGateway.attachments.detach.mockResolvedValue({ ok: true, deletedId: 'f1' });

    await useProjectStore.getState().detach('f1');

    expect(mocked.apiGateway.attachments.detach).toHaveBeenCalledWith('f1');
    expect(useProjectStore.getState().attachments.map((a) => a.fileId)).toEqual(['f2']);
  });

  it('unlinkProject(): DELETE /api/sessions/:id/project → currentProject null, attachments очищены', async () => {
    useProjectStore.setState({ currentProject: { id: 'p1', name: 'r', path: 'r' }, attachments: [{ fileId: 'f1', name: 'a', size: 1, kind: 'reference', language: 'text', filePath: 'r/a' }] });
    mocked.apiGateway.projects.unlink.mockResolvedValue({ ok: true });

    await useProjectStore.getState().unlinkProject();

    expect(mocked.apiGateway.projects.unlink).toHaveBeenCalledWith('sess-1');
    expect(useProjectStore.getState().currentProject).toBeNull();
    expect(useProjectStore.getState().attachments).toEqual([]);
  });

  it('loadBrowseFiles(): GET files → browseFiles/total/truncated', async () => {
    useProjectStore.setState({ currentProject: { id: 'p1', name: 'r', path: 'r' } });
    mocked.apiGateway.projects.listFiles.mockResolvedValue({
      files: [{ path: 'src/a.ts', size: 5, language: 'typescript' }],
      total: 700,
      truncated: true,
    });

    await useProjectStore.getState().loadBrowseFiles('a.ts');

    expect(mocked.apiGateway.projects.listFiles).toHaveBeenCalledWith('p1', 'a.ts');
    expect(useProjectStore.getState().browseFiles).toHaveLength(1);
    expect(useProjectStore.getState().browseTotal).toBe(700);
    expect(useProjectStore.getState().browseTruncated).toBe(true);
  });

  it('extractRelativePath: первый сегмент webkitRelativePath; без него (корень) → null', () => {
    const mk = (name: string, rel?: string) =>
      ({ name, webkitRelativePath: rel } as unknown as File);
    expect(extractRelativePath([mk('chat.ts', 'my-repo/src/chat.ts')] as unknown as FileList)).toBe('my-repo');
    expect(extractRelativePath([mk('chat.ts')] as unknown as FileList)).toBeNull();
    expect(extractRelativePath([] as unknown as FileList)).toBeNull();
  });
});
