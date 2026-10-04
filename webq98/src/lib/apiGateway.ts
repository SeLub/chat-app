import { logger } from './logger';

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
  options: { body?: unknown; provider?: string; headers?: Record<string, string> } = {},
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
    return request<{ id: string; title: string; category: string; message_count: number; model?: string; provider?: string; sysprompt: string; created_at: string; updated_at: string }[]>(
      'GET',
      `/api/sessions${qs ? '?' + qs : ''}`,
    );
  },
  get(id: string) {
    return request<{ id: string; title: string; category: string; model?: string; provider?: string; sysprompt: string; message_count: number; created_at: string; updated_at: string }>(
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
  getQAPairs(id: string) {
    return request<Array<{ questionId: string; questionText: string; answerText?: string; model?: string }>>(
      'GET',
      `/api/sessions/${id}/qa-pairs`,
    );
  },
  getContextConfig(id: string) {
    return request<{ mode: string; trimPercent: number; manualInclude: string[] }>(
      'GET',
      `/api/sessions/${id}/context-config`,
    );
  },
  updateContextConfig(id: string, config: { mode?: string; trimPercent?: number; manualInclude?: string[] }) {
    return request<{ ok: boolean; config: unknown }>(
      'PATCH',
      `/api/sessions/${id}/context-config`,
      { body: config },
    );
  },
  create(title?: string, mode?: 'chat' | 'project', projectId?: string) {
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
};

// === Attachments API ===
export const attachmentsApi = {
  extract(paths: string[], sessionId: string) {
    return request<{ results: unknown[]; errors: string[] }>(
      'POST',
      '/api/attachments/extract',
      { body: { paths, sessionId } },
    );
  },
  get(fileId: string) {
    return request<{ id: string; text: string }>('GET', `/api/attachments/${fileId}`);
  },
};

// === Chat API ===
export const chatApi = {
  send(
    data: FormData,
    provider: string,
  ) {
    return request<{
      response: string;
      model: string;
      imageData?: unknown;
      metrics?: unknown;
      excludedIndices?: number[];
      contextInfo?: unknown;
    }>(
      'POST',
      '/api/chat',
      { body: data, provider },
    );
  },
};

// === Models API ===
export const modelsApi = {
  list(provider: string) {
    return request<{ connected: boolean; models: Array<{ name: string; size: number; contextLength?: number; type?: string }> }>(
      'GET',
      '/api/models',
      { provider },
    );
  },
  show(name: string, provider: string) {
    return request<{ details?: { size: number }; parameters?: { context_length?: number } }>(
      'POST',
      '/api/show',
      { body: { name }, provider },
    );
  },
};

// === Providers API ===
export const providersApi = {
  list() {
    return request<Array<{ name: string; url: string; enabled: boolean }>>('GET', '/api/providers');
  },
  status() {
    return request<Array<{ name: string; status: string; latencyMs?: number; error?: string }>>(
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

export const apiGateway = {
  sessions: sessionsApi,
  attachments: attachmentsApi,
  chat: chatApi,
  models: modelsApi,
  providers: providersApi,
  stt: sttApi,
  ApiError,
};
