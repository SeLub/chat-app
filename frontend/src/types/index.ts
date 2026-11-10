export type ProviderName = 'ollama' | 'llama_cpp';

export interface ProviderInfo {
  name: ProviderName;
  status: 'connected' | 'disconnected' | 'checking';
  latencyMs?: number;
  error?: string;
  url?: string;
  enabled?: boolean;
}

export interface ProviderStatusResponse {
  providers: Array<{ name: string; status: string; latencyMs?: number; error?: string }>;
}

export interface ModelListResponse {
  connected: boolean;
  models: Array<{ name: string; size: number; contextLength?: number; type?: string }>;
}

export interface ModelShowResponse {
  model_info?: Record<string, unknown>;
  details?: { size?: number; parent_model?: string; format?: string; family?: string; families?: string[] };
  parameters?: { context_length?: number };
}

export interface ChatRequestData {
  sessionId: string;
  message: string;
  model: string;
  questionId: string;
  contextLength?: number;
  retainPercent: number;
  includeQuestionIds: string[];
}

export interface ChatResponse {
  response: string;
  metrics?: { tps?: number; promptTps?: number; ttft?: number; loadTime?: number; totalTime?: number; inputTokens?: number; outputTokens?: number };
  imageData?: { thumbnailUrl: string; fullUrl: string; filename: string };
  contextInfo?: { contextSize: number; totalChars: number; includedQAPairs: number; totalQAPairs: number };
  excludedIndices?: number[];
  error?: string;
}

export interface ModelInfo {
  name: string;
  size: number;
  contextLength: number;
  type: 'chat' | 'embedding' | 'vision';
  provider: ProviderName;
}

export interface ModelDetail {
  name: string;
  details: {
    size: number;
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
  };
  parameters: {
    context_length?: number;
  };
}

// Финальное ТЗ: meta приходит из реестра attachments (бэкенд); optimistic-мета
// (до ответа сервера) содержит только name/size/type — остальные поля опциональны.
export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
  fileId?: string;
  kind?: 'document' | 'code' | 'image' | 'reference';
  fullUrl?: string;
  thumbnailUrl?: string;
}

export interface ImageData {
  thumbnailUrl: string;
  fullUrl: string;
  filename: string;
}

export interface ResponseMetrics {
  inputTokens: number;
  outputTokens: number;
  tps?: number;
  promptTps?: number;
  ttft?: number;
  loadTime?: number;
  totalTime?: number;
}

export interface Session {
  id: string;
  title: string;
  category: string;
  model?: string;
  provider?: string;
  sysprompt: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  mode?: SessionMode;
  project_id?: string;
}

// ============================================================
// ТЗ Project mode A (вариант A: plain fs.readFile + [Материалы])
// ============================================================

/** Режим сессии: legacy 'chat' трактуется бэком как 'research' */
export type SessionMode = 'research' | 'project';

/** GET /api/config → contextBaseDir (§3.1) */
export interface ContextBaseDirStatus {
  ok: boolean;
  path: string | null;
  error: string | null;
}

/** Проект: projects.path относительно CONTEXT_BASE_DIR (§1.3) */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

/** GET /api/projects/:id/files (§3.4) */
export interface ProjectFile {
  path: string;
  size: number;
  language: string;
}

export interface ProjectFilesResponse {
  files: ProjectFile[];
  total: number;
  truncated?: boolean;
}

/** POST /api/projects/:id/attach (§3.5) */
export interface AttachedFile {
  fileId: string;
  name: string;
  size: number;
  kind: 'reference';
  language: string;
  /** идемпотентный повторный attach: существующая строка реестра */
  skipped?: boolean;
}

export interface AttachError {
  path?: string;
  error: string;
}

export interface AttachResponse {
  attached: AttachedFile[];
  errors: AttachError[];
}

/** GET /api/sessions/:id/attachments (§3.7) */
export interface SessionReferenceAttachment extends AttachedFile {
  filePath: string;
  missing?: boolean;
  /** файл разросся сверх MAX_REFERENCE_FILE_SIZE после attach — в [Материалы] не попадёт (TOO LARGE) */
  tooLarge?: boolean;
  /** true = кэш был прочитан и устарел; false при extracted_mtime=NULL (свежий attach — ещё не читался) */
  mtimeStale?: boolean;
}

export interface SessionAttachmentsResponse {
  attachments: SessionReferenceAttachment[];
}



export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  questionId: string;
  model: string;
  metrics?: ResponseMetrics;
  attachmentsMeta?: AttachmentMeta[];
  imageData?: ImageData;
  excludedIndices?: number[];
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface AITranscript {
  role: 'user' | 'interlocutor';
  text: string;
  timestamp: number;
}
