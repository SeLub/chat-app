export interface ProviderInfo {
  name: 'ollama' | 'llama.cpp';
  status: 'connected' | 'disconnected' | 'checking';
  latencyMs?: number;
  error?: string;
  url: string;
  enabled: boolean;
}

export interface ModelInfo {
  name: string;
  size: number;
  contextLength: number;
  type: 'chat' | 'embedding' | 'vision';
  provider: 'ollama' | 'llama.cpp';
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

export interface QAPair {
  id: string;
  questionId: string;
  questionText: string;
  answerText: string;
  model: string;
  attachmentsMeta: AttachmentMeta[];
  metrics?: ResponseMetrics;
  imageData?: ImageData;
  excludedFromContext: boolean;
}

export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
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
  mode?: 'chat' | 'project';
  project_id?: string;
}

export interface ContextConfig {
  mode: 'standard' | 'manual';
  trimPercent: number;
  manualInclude: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  questionId: string;
  model: string;
  metrics?: ResponseMetrics;
  attachmentsMeta?: AttachmentMeta[];
  imageData?: ImageData;
  excludedFromContext?: boolean;
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
