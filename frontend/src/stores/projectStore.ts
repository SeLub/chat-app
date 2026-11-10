import { create } from 'zustand';
import { toast } from 'sonner';
import { apiGateway, ApiError } from '@/lib/apiGateway';
import type {
  ContextBaseDirStatus,
  ProjectInfo,
  ProjectFile,
  SessionReferenceAttachment,
} from '@/types';
import { useSessionStore } from './sessionStore';

// ============================================================
// ТЗ Project mode A (§4): store правой панели (Project mode).
// mode сессии — НЕ здесь (дублирование запрещено ТЗ): он живёт в
// sessionStore и обновляется через PATCH /api/sessions/:id.
// ============================================================

interface ProjectStore {
  config: { contextBaseDir: ContextBaseDirStatus } | null;
  currentProject: (ProjectInfo & { totalFiles?: number }) | null;
  attachments: SessionReferenceAttachment[];
  filter: string;
  /** browse-диалог: файлы проекта под текущим фильтром */
  browseFiles: ProjectFile[];
  browseTotal: number;
  browseTruncated: boolean;
  isLoading: boolean;

  init: () => Promise<void>;
  loadConfig: () => Promise<void>;
  createProject: (relativePath: string) => Promise<void>;
  unlinkProject: () => Promise<void>;
  loadAttachments: (sessionId?: string) => Promise<void>;
  attach: (relativePaths: string[]) => Promise<void>;
  detach: (fileId: string) => Promise<void>;
  setFilter: (filter: string) => void;
  loadBrowseFiles: (filter?: string) => Promise<void>;
}

function getActiveSessionId(): string | null {
  return useSessionStore.getState().activeSessionId;
}

function toastError(error: unknown, fallback: string) {
  const message = error instanceof ApiError ? error.message : fallback;
  toast.error(message);
  if (!(error instanceof ApiError)) console.error(fallback, error);
}

/** relativePath проекта из выбора <input webkitdirectory>: первый сегмент webkitRelativePath */
export function extractRelativePath(files: FileList | null): string | null {
  if (!files || files.length === 0) return null;
  const first = files[0] as File & { webkitRelativePath?: string };
  const rel = first.webkitRelativePath || first.name;
  const segments = rel.split('/');
  return segments.length > 1 ? segments[0] : null;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  config: null,
  currentProject: null,
  attachments: [],
  filter: '',
  browseFiles: [],
  browseTotal: 0,
  browseTruncated: false,
  isLoading: false,

  /** Вызывается из App вместе с init() других сторов */
  init: async () => {
    await get().loadConfig();
    const sessionId = getActiveSessionId();
    if (!sessionId) return;

    // Восстановление CurrentProject после перезагрузки: session.project_id → проекты
    try {
      const session = await apiGateway.sessions.get(sessionId);
      if (session?.project_id) {
        const project = await apiGateway.projects.get(session.project_id);
        if (project) set({ currentProject: project });
      }
    } catch {
      /* проект мог быть удалён — CurrentProject остаётся пустым */
    }
    await get().loadAttachments(sessionId);
  },

  loadConfig: async () => {
    try {
      const config = await apiGateway.config.get();
      set({ config: config ?? null });
    } catch (error) {
      toastError(error, 'Не удалось получить /api/config');
    }
  },

  /** POST /api/projects: регистрация/поиск + привязка сессии (§3.3, §5.2 шаг 6) */
  createProject: async (relativePath) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      toast.error('Нет активной сессии');
      return;
    }
    set({ isLoading: true });
    try {
      const project = await apiGateway.projects.create(sessionId, relativePath);
      if (project) {
        set({ currentProject: project });
        toast.success(`Проект «${project.name}» подключён (${project.totalFiles} файлов)`);
        await get().loadAttachments(sessionId);
      }
    } catch (error) {
      toastError(error, 'Не удалось подключить проект');
    } finally {
      set({ isLoading: false });
    }
  },

  /** Remove project (§10.8): unlink + авто-detach reference */
  unlinkProject: async () => {
    const sessionId = getActiveSessionId();
    if (!sessionId) return;
    set({ isLoading: true });
    try {
      await apiGateway.projects.unlink(sessionId);
      set({ currentProject: null, attachments: [] });
      toast.success('Проект отвязан');
    } catch (error) {
      toastError(error, 'Не удалось отвязать проект');
    } finally {
      set({ isLoading: false });
    }
  },

  /** GET /api/sessions/:id/attachments (§3.7) — бейджи missing/mtimeStale */
  loadAttachments: async (sessionIdArg?: string) => {
    const sessionId = sessionIdArg ?? getActiveSessionId();
    if (!sessionId) return;
    try {
      const res = await apiGateway.attachments.listBySession(sessionId);
      set({ attachments: res?.attachments ?? [] });
    } catch (error) {
      toastError(error, 'Не удалось получить список файлов проекта');
    }
  },

  /** POST /api/projects/:id/attach (§3.5) */
  attach: async (relativePaths) => {
    const sessionId = getActiveSessionId();
    const projectId = get().currentProject?.id;
    if (!sessionId || !projectId) return;
    set({ isLoading: true });
    try {
      const res = await apiGateway.projects.attach(projectId, sessionId, relativePaths);
      for (const err of res?.errors ?? []) {
        toast.error(err.path ? `${err.path}: ${err.error}` : err.error);
      }
      const attachedCount = res?.attached.filter((a) => !a.skipped).length ?? 0;
      if (attachedCount > 0) toast.success(`Приложено файлов: ${attachedCount}`);
      await get().loadAttachments(sessionId);
    } catch (error) {
      toastError(error, 'Не удалось приложить файлы');
    } finally {
      set({ isLoading: false });
    }
  },

  /** DELETE /api/attachments/:fileId (§3.6): строка реестра, файл на диске не трогаем */
  detach: async (fileId) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) return;
    try {
      await apiGateway.attachments.detach(fileId);
      set({ attachments: get().attachments.filter((a) => a.fileId !== fileId) });
    } catch (error) {
      toastError(error, 'Не удалось отвязать файл');
    }
  },

  setFilter: (filter) => set({ filter }),

  /** GET /api/projects/:id/files для BrowseDialog (§3.4) */
  loadBrowseFiles: async (filterArg?: string) => {
    const projectId = get().currentProject?.id;
    if (!projectId) return;
    const filter = filterArg ?? get().filter;
    set({ isLoading: true });
    try {
      const res = await apiGateway.projects.listFiles(projectId, filter);
      set({
        browseFiles: res?.files ?? [],
        browseTotal: res?.total ?? 0,
        browseTruncated: res?.truncated ?? false,
      });
    } catch (error) {
      toastError(error, 'Не удалось получить список файлов проекта');
    } finally {
      set({ isLoading: false });
    }
  },
}));
