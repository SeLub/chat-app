import { logger } from './logger';
import type {
  ChatRequestData,
  ChatResponse,
  ModelListResponse,
  ModelShowResponse,
  ProviderName,
  ProviderStatusResponse,
  ContextBaseDirStatus,
  ProjectInfo,
  ProjectFilesResponse,
  AttachResponse,
  SessionAttachmentsResponse,
  SessionMode,
} from '@/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; provider?: ProviderName; headers?: Record<string, string> } = {},
): Promise<T | null> {
  const { body, headers = {}, provider } = options;

  const fetchHeaders: Record<string, string> = { ...headers };

  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    fetchHeaders['Content-Type'] = 'application/json';
  }

  if (provider) {
    fetchHeaders['X-Provider'] = provider;
  }

  let requestBody: BodyInit | undefined;
  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestBody = JSON.stringify(body);
  }

  try {
    const response = await fetch(path, {
      method,
      headers: fetchHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
      logger.error(`API ${method} ${path} failed`, { status: response.status, error: errorMessage });
      throw new ApiError(response.status, errorMessage, errorData);
    }

    if (response.status === 204) return null;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error(`Network error: ${method} ${path}`, error);
    throw new ApiError(0, `Network error: ${error instanceof Error ? error.message : String(error)}`, error);
  }
}

// === Sessions API ===
export const sessionsApi = {
  list(options?: { mode?: string; limit?: number; offset?: number; search?: string }) {
    const params = new URLSearchParams();
    if (options?.mode) params.append('mode', options.mode);
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    if (options?.search) params.append('search', options.search);
    const qs = params.toString();
    return request<Array<{ id: string; title: string; category: string; message_count: number; model?: string; provider?: string; sysprompt: string; created_at: string; updated_at: string; mode?: SessionMode; project_id?: string; last_send_error?: string | null }>>(
      'GET',
      `/api/sessions${qs ? '?' + qs : ''}`,
    );
  },
  get(id: string) {
    // ТЗ send-error-persist (№3): last_send_error — сырой JSON-столбец sessions
    // (персистентная плашка последней провальной отправки, переживает F5).
    return request<{ id: string; title: string; category: string; model?: string; provider?: string; sysprompt: string; message_count: number; created_at: string; updated_at: string; mode?: SessionMode; project_id?: string; last_send_error?: string | null }>(
      'GET',
      `/api/sessions/${id}`,
    );
  },
  getMessages(id: string) {
    return request<Array<{
      questionId: string;
      questionText: string;
      answerText?: string;
      model?: string;
      attachmentsMeta?: unknown;
      metrics?: unknown;
      imageData?: unknown;
    }>>(
      'GET',
      `/api/sessions/${id}/messages`,
    );
  },
  create(title?: string, mode?: SessionMode, projectId?: string) {
    const body: Record<string, string | undefined> = {};
    if (title) body.title = title;
    if (mode) body.mode = mode;
    if (projectId) body.project_id = projectId;
    return request<{ id: string; title: string }>('POST', '/api/sessions', { body });
  },
  update(id: string, updates: Record<string, string>) {
    return request<{ id: string }>('PATCH', `/api/sessions/${id}`, { body: updates });
  },
  delete(id: string) {
    return request<{ ok: boolean }>('DELETE', `/api/sessions/${id}`);
  },
  deleteQAPair(sessionId: string, questionId: string) {
    return request<{ ok: boolean; deletedMessages: number; deletedAttachments: number }>(
      'DELETE',
      `/api/sessions/${sessionId}/messages/${questionId}`,
    );
  },
  // ТЗ send-error-persist (№3): явный dismiss персистентной плашки (крестик).
  clearSendError(id: string) {
    return request<{ ok: boolean }>('DELETE', `/api/sessions/${id}/send-error`);
  },
};

// === Chat API ===
export const chatApi = {
  send(
    data: ChatRequestData,
    provider: ProviderName,
    files?: { file?: File; codeFiles?: File[] },
  ): Promise<ChatResponse | null> {
    const formData = new FormData();
    formData.append('message', data.message);
    formData.append('model', data.model);
    formData.append('sessionId', data.sessionId);
    formData.append('questionId', data.questionId);
    formData.append('retainPercent', String(data.retainPercent));

    if (data.contextLength !== undefined) {
      formData.append('contextLength', String(data.contextLength));
    }

    formData.append('includeQuestionIds', JSON.stringify(data.includeQuestionIds));

    if (data.generationParams) {
      for (const [key, value] of Object.entries(data.generationParams)) {
        if (value === undefined || value === null) continue;
        formData.append(key, String(value));
      }
    }

    if (files?.file) {
      formData.append('file', files.file);
    }

    if (files?.codeFiles) {
      for (const codeFile of files.codeFiles) {
        formData.append('codeFiles', codeFile);
      }
    }

    return request<ChatResponse>(
      'POST',
      '/api/chat',
      { body: formData, provider },
    );
  },
};

// === Models API ===
export const modelsApi = {
  list(provider: ProviderName): Promise<ModelListResponse | null> {
    logger.debug('API GET /api/models', { provider });
    return request<ModelListResponse>(
      'GET',
      '/api/models',
      { provider },
    );
  },
  show(name: string, provider: ProviderName): Promise<ModelShowResponse | null> {
    return request<ModelShowResponse>(
      'POST',
      '/api/show',
      { body: { name }, provider },
    );
  },
};

// === Providers API ===
export const providersApi = {
  status(): Promise<ProviderStatusResponse | null> {
    return request<ProviderStatusResponse>(
      'GET',
      '/api/providers/status',
    );
  },
};

// === STT API ===
export const sttApi = {
  transcribe(audioBlob: Blob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    return request<{ text: string }>(
      'POST',
      '/api/stt/transcribe',
      { body: formData },
    );
  },
};

// === Config API (ТЗ Project mode A §3.1) ===
export const configApi = {
  get() {
    return request<{ contextBaseDir: ContextBaseDirStatus }>('GET', '/api/config');
  },
};

// === Projects API (ТЗ Project mode A §3.3–3.5) ===
export const projectsApi = {
  /** Регистрация/поиск проекта + привязка к сессии (идемпотентно по path) */
  create(sessionId: string, relativePath: string) {
    return request<ProjectInfo & { totalFiles: number; created: boolean }>('POST', '/api/projects', {
      body: { sessionId, relativePath },
    });
  },
  /** Информация о проекте (восстановление CurrentProject после перезагрузки) */
  get(projectId: string) {
    return request<ProjectInfo>('GET', `/api/projects/${projectId}`);
  },
  /** Browse-список файлов проекта (filter — подстрока, лимит 500) */
  listFiles(projectId: string, filter = '') {
    const qs = filter ? `?filter=${encodeURIComponent(filter)}` : '';
    return request<ProjectFilesResponse>('GET', `/api/projects/${projectId}/files${qs}`);
  },
  /** Attach reference-файлов (идемпотентно по session_id + file_path) */
  attach(projectId: string, sessionId: string, relativePaths: string[]) {
    return request<AttachResponse>('POST', `/api/projects/${projectId}/attach`, {
      body: { sessionId, relativePaths },
    });
  },
  /** Remove project (§10.8: project_id=NULL, mode=research, авто-detach reference) */
  unlink(sessionId: string) {
    return request<{ ok: boolean }>('DELETE', `/api/sessions/${sessionId}/project`);
  },
};

// === Attachments API (ТЗ Project mode A §3.6–3.7) ===
export const attachmentsApi = {
  /** Список reference-файлов сессии с бейджами missing/mtimeStale */
  listBySession(sessionId: string) {
    return request<SessionAttachmentsResponse>(
      'GET',
      `/api/sessions/${sessionId}/attachments?kind=reference`,
    );
  },
  /** Detach: удаляется ТОЛЬКО строка реестра, файл на диске не трогается */
  detach(fileId: string) {
    return request<{ ok: boolean; deletedId: string }>('DELETE', `/api/attachments/${fileId}`);
  },
};

export const apiGateway = {
  sessions: sessionsApi,
  chat: chatApi,
  models: modelsApi,
  providers: providersApi,
  stt: sttApi,
  config: configApi,
  projects: projectsApi,
  attachments: attachmentsApi,
  ApiError,
};
