import {
  Send,
  Paperclip,
  Loader2,
  X,
  Copy,
  Check,
  FileCode,
  File,
  Image as ImageIcon,
  MessageSquare,
  BarChart3,
  Save,
  FolderOpen,
  ArrowLeft,
  Trash2,
  Archive,
  Upload,
  Palette,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ClipboardCopy,
  ArrowUp,
  AlertTriangle,
} from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { useUIStore } from '@/stores/uiStore';
import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { remarkPlugins, rehypePlugins } from '@/lib/chatRender';
import { cn, scrollToQuestion, formatSize, shortModel } from '@/lib/utils';
import { computeContextLoadPct, formatSizeGb } from '@/lib/stats';
import { formatTokensCompact } from '@/lib/sendError';
// ТЗ adaptive-context-budget (№4): кап длины message — мягкий кап в UI:
// композер блокирует отправку раньше сервера (messageCap — дубликат
// серверной константы, менять ОБА места)
import { MAX_MESSAGE_CHARS, isMessageOverCap, isMessageNearCap, formatChars } from '@/lib/messageCap';
import { CodeBlock } from '@/components/chat/CodeBlock';
import { useTheme } from '@/app/ThemeProvider';
import type { Theme, Mode } from '@/app/ThemeProvider';
import type { ResponseMetrics, AttachmentMeta, ImageData } from '@/types';
import { Button } from '@/components/ui/button';
import { STTInput } from '@/features/stt/components/stt-input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const FILE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
]);

function isFileSlot(name: string, type: string): boolean {
  if (type.startsWith('image/')) return true;
  const ext = name.substring(name.lastIndexOf('.'));
  return FILE_EXTENSIONS.has(ext.toLowerCase());
}

interface FilePreview {
  file: File;
  preview?: string;
}

const themes: { value: Theme; label: string }[] = [
  { value: 'leteem', label: 'Leteem' },
  { value: 'besafe', label: 'Besafe' },
  { value: 'minimal', label: 'Minimal' },
];

const modes: { value: Mode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// ── Derive last assistant metrics from messages ──
function deriveLastMetrics(messages: Array<{ role: string; metrics?: ResponseMetrics }>): ResponseMetrics | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].metrics) {
      return messages[i].metrics;
    }
  }
  return undefined;
}

// ── TPS Statistics Dialog ──
function StatFooter({
  currentModel,
  modelDetail,
  currentContextLength,
  lastMetrics,
  totalInputTokens,
  totalOutputTokens,
  userMsgCount,
}: {
  currentModel: string | null;
  modelDetail: { size?: number; details?: { size?: number } } | null;
  currentContextLength: number | null;
  lastMetrics: ResponseMetrics | undefined;
  totalInputTokens: number;
  totalOutputTokens: number;
  userMsgCount: number;
}) {
  const [open, setOpen] = useState(false);
  const models = useProviderStore((s) => s.models);

  // ТЗ stats-size: цепочка источников размера модели — см. formatSizeGb.
  // modelDetail.details.size не существует ни у одного провайдера (llama.cpp
  // отдаёт size верхним уровнем, Ollama /api/show размера не отдаёт), поэтому
  // последним источником идёт список моделей — фолбэк оригинального script.js.
  const modelSizeBytes =
    (modelDetail?.size || 0) ||
    (modelDetail?.details?.size || 0) ||
    (models.find((m) => m.name === currentModel)?.size || 0);
  const sizeGb = formatSizeGb(modelSizeBytes);

  const ctx = currentContextLength ?? '–';

  const totalTime = lastMetrics?.totalTime != null ? `${lastMetrics.totalTime}s` : '–';

  const modelLabel = currentModel ? shortModel(currentModel) : 'No model selected';

  const contextLoad = computeContextLoadPct(totalInputTokens + totalOutputTokens, currentContextLength);

  return (
    <div className="h-8 flex items-center gap-2 px-4 border-t border-border glass text-xs text-muted-foreground whitespace-nowrap overflow-x-auto">
      <span className="flex items-center gap-1 font-mono text-[11px]">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/></svg>
        {modelLabel}
      </span>
      <span>•</span>
      <span className="font-mono text-[11px]">Size: {sizeGb} GB</span>
      <span>•</span>
      <span className="font-mono text-[11px]">Ctx: {ctx}</span>
      <span>•</span>
      <span className="font-mono text-[11px]">Total Time: {totalTime}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs font-mono" onClick={() => setOpen(true)}>
            TPS
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>📊 Detailed Statistics</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="text-muted-foreground">TPS</div>
            <div className="font-mono">{lastMetrics?.tps != null ? `${lastMetrics.tps} tok/s` : '–'}</div>
            <div className="text-muted-foreground">Prompt Speed</div>
            <div className="font-mono">{lastMetrics?.promptTps != null ? `${lastMetrics.promptTps} tok/s` : '–'}</div>
            <div className="text-muted-foreground">TTFT</div>
            <div className="font-mono">{lastMetrics?.ttft != null ? `${lastMetrics.ttft}s` : '–'}</div>
            <div className="text-muted-foreground">Load Time</div>
            <div className="font-mono">{lastMetrics?.loadTime != null ? `${lastMetrics.loadTime}s` : '–'}</div>
            <div className="text-muted-foreground">Total Time</div>
            <div className="font-mono">{lastMetrics?.totalTime != null ? `${lastMetrics.totalTime}s` : '–'}</div>
            <div className="col-span-2 h-px bg-border my-1" />
            <div className="text-muted-foreground">Input Tokens</div>
            <div className="font-mono">~{totalInputTokens}</div>
            <div className="text-muted-foreground">Output Tokens</div>
            <div className="font-mono">~{totalOutputTokens}</div>
            <div className="text-muted-foreground">Context Load</div>
            <div className="font-mono">{contextLoad != null ? `${contextLoad}%` : '–'}</div>
            <div className="text-muted-foreground">Questions</div>
            <div className="font-mono">{userMsgCount}</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ChatArea({ className }: { className?: string }) {
  const messages = useSessionStore((s) => s.messages);
  const contextInfo = useSessionStore((s) => s.contextInfo);
  const totalInputTokens = useSessionStore((s) => s.totalInputTokens);
  const totalOutputTokens = useSessionStore((s) => s.totalOutputTokens);
  const currentModel = useProviderStore((s) => s.currentModel);
  const modelDetail = useProviderStore((s) => s.modelDetail);
  const currentContextLength = useProviderStore((s) => s.currentContextLength);
  const refreshStatus = useProviderStore((s) => s.refreshStatus);
  const providers = useProviderStore((s) => s.providers);
  const currentProvider = useProviderStore((s) => s.currentProvider);
  const setCurrentProvider = useProviderStore((s) => s.setCurrentProvider);
  const models = useProviderStore((s) => s.models);
  const selectModel = useProviderStore((s) => s.selectModel);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const currentSessionTitle = useSessionStore((s) => s.currentSessionTitle);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const returnToCurrent = useSessionStore((s) => s.returnToCurrent);
  const clearChat = useSessionStore((s) => s.clearChat);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const exportConversation = useSessionStore((s) => s.exportConversation);
  const deleteMessage = useSessionStore((s) => s.deleteMessage);
  const sendError = useSessionStore((s) => s.sendError);
  const dismissSendError = useSessionStore((s) => s.dismissSendError);

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [fileSlot, setFileSlot] = useState<FilePreview | null>(null);
  const [codeFiles, setCodeFiles] = useState<FilePreview[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { theme, mode, setTheme, setMode } = useTheme();

  const lastMetrics = deriveLastMetrics(messages);

  // ТЗ context-overflow-ux (№2): баннер показывается только в той сессии,
  // где произошла провальная отправка (не «переезжает» при переключении).
  const activeSendError =
    sendError && sendError.sessionId === viewingSessionId ? sendError : null;

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ТЗ context-overflow-ux (№2): при провале отправки вопрос не теряется —
  // текст возвращается в поле ввода (если пользователь не начал печатать
  // новый) и вложения возвращаются в композер (если он пуст).
  useEffect(() => {
    if (!activeSendError) return;
    const err = activeSendError;
    setInputValue((prev) => (prev.trim() === '' ? err.failedText : prev));
    const f = err.failedFiles?.file;
    if (f) {
      setFileSlot((prev) =>
        prev ?? {
          file: f,
          preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
        },
      );
    }
    const code = err.failedFiles?.codeFiles;
    if (code && code.length > 0) {
      setCodeFiles((prev) => (prev.length === 0 ? code.map((file) => ({ file })) : prev));
    }
  }, [activeSendError]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputValue]);

  const clearAttachments = useCallback(() => {
    if (fileSlot?.preview) URL.revokeObjectURL(fileSlot.preview);
    for (const cf of codeFiles) {
      if (cf.preview) URL.revokeObjectURL(cf.preview);
    }
    setFileSlot(null);
    setCodeFiles([]);
  }, [fileSlot, codeFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFileSlot: FilePreview[] = [];
    const newCodeFiles: FilePreview[] = [];

    for (const file of Array.from(files)) {
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const item = { file, preview };

      if (isFileSlot(file.name, file.type)) {
        newFileSlot.push(item);
      } else {
        newCodeFiles.push(item);
      }
    }

    if (newFileSlot.length > 0) {
      setFileSlot(newFileSlot[0]);
    }
    if (newFileSlot.length > 1) {
      useUIStore.getState().addToast(
        'Документ/изображение можно приложить только один — взят первый',
        'warning',
      );
    }
    if (newCodeFiles.length > 0) {
      setCodeFiles((prev) => [...prev, ...newCodeFiles]);
    }

    e.target.value = '';
  }, []);

  const removeFileSlot = useCallback(() => {
    if (fileSlot?.preview) URL.revokeObjectURL(fileSlot.preview);
    setFileSlot(null);
  }, [fileSlot]);

  const removeCodeFile = useCallback((index: number) => {
    const removed = codeFiles[index];
    if (removed?.preview) URL.revokeObjectURL(removed.preview);
    setCodeFiles((prev) => prev.filter((_, i) => i !== index));
  }, [codeFiles]);

  const collectFiles = useCallback((): { file?: File; codeFiles?: File[] } | undefined => {
    if (!fileSlot && codeFiles.length === 0) return undefined;
    return {
      file: fileSlot?.file,
      codeFiles: codeFiles.length > 0 ? codeFiles.map((f) => f.file) : undefined,
    };
  }, [fileSlot, codeFiles]);

  // ТЗ adaptive-context-budget (№4): длина отправляемого текста (trim — как
  // в handleSend) против капа. overCap — Send заблокирован + разрушающая
  // подсказка; nearCap (>90%) — нейтральный счётчик («пометка в UI»).
  const trimmedInput = inputValue.trim();
  const messageOverCap = isMessageOverCap(trimmedInput.length);
  const messageNearCap = isMessageNearCap(trimmedInput.length);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isSending) return;
    // №4: кап длины message — не отправляем, подсказка уже видна в футере
    if (isMessageOverCap(inputValue.trim().length)) return;
    const text = inputValue.trim();
    const files = collectFiles();
    setInputValue('');
    clearAttachments();
    setIsSending(true);
    try {
      await sendMessage(text, files);
      await refreshStatus();
    } catch (e) {
      // Guards (нет сессии/модели) — исключение доходит сюда. ТЗ
      // context-overflow-ux: вопрос не теряется — возвращаем в композер.
      useUIStore.getState().addToast(
        e instanceof Error ? e.message : 'Failed to send',
        'error',
      );
      setInputValue(text);
      const f = files?.file;
      if (f) {
        setFileSlot({
          file: f,
          preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
        });
      }
      const code = files?.codeFiles;
      if (code && code.length > 0) {
        setCodeFiles(code.map((file) => ({ file })));
      }
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [inputValue, isSending, sendMessage, collectFiles, clearAttachments, refreshStatus]);

  // ТЗ context-overflow-ux (№2): «Повторить» на баннере — повторная отправка
  // ИСХОДНОГО вопроса с исходными вложениями; композер на время попытки
  // очищается (при новом провале баннер вернёт текст/файлы обратно).
  const handleRetry = useCallback(async () => {
    const err = useSessionStore.getState().sendError;
    if (!err || isSending) return;
    useSessionStore.getState().dismissSendError();
    setInputValue('');
    clearAttachments();
    setIsSending(true);
    try {
      await sendMessage(err.failedText, err.failedFiles);
      await refreshStatus();
    } catch (e) {
      useUIStore.getState().addToast(
        e instanceof Error ? e.message : 'Failed to send',
        'error',
      );
      setInputValue(err.failedText);
      const f = err.failedFiles?.file;
      if (f) {
        setFileSlot({
          file: f,
          preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
        });
      }
      const code = err.failedFiles?.codeFiles;
      if (code && code.length > 0) {
        setCodeFiles(code.map((file) => ({ file })));
      }
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [isSending, sendMessage, refreshStatus, clearAttachments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const groupedByQuestion: Array<{
    questionId: string;
    question: string;
    answers: string[];
    model?: string;
    excludedIndices?: number[];
    attachmentsMeta?: AttachmentMeta[];
    imageData?: ImageData;
  }> = [];

  let currentGroup: typeof groupedByQuestion[number] | null = null;
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentGroup) groupedByQuestion.push(currentGroup);
      currentGroup = {
        questionId: msg.questionId,
        question: msg.content,
        answers: [],
        model: msg.model,
        excludedIndices: undefined,
        attachmentsMeta: msg.attachmentsMeta,
      };
    } else if (currentGroup) {
      currentGroup.answers.push(msg.content);
      if (msg.excludedIndices && msg.excludedIndices.length > 0) {
        currentGroup.excludedIndices = msg.excludedIndices;
      }
      if (msg.imageData) {
        currentGroup.imageData = msg.imageData;
      }
    }
  }
  if (currentGroup) groupedByQuestion.push(currentGroup);

  // Context bar pct — та же токеновая формула, что в Detailed Statistics
  // (computeContextLoadPct). Прежняя char-эвристика totalChars/(ctx*4)
  // занижала на кириллице/коде в 1.5–3 раза (12% вместо реальных 38%).
  const pct = computeContextLoadPct(totalInputTokens + totalOutputTokens, currentContextLength) ?? 0;

  const pctColor = contextInfo
    ? pct <= 50
      ? 'text-success'
      : pct <= 75
        ? 'text-warning'
        : 'text-destructive'
    : '';

  const userMsgCount = messages.filter((m) => m.role === 'user').length;

  const connectedProviders = providers.filter((p) => p.status === 'connected');
  const currentProviderConnected = providers.find((p) => p.name === currentProvider)?.status === 'connected';
  const providerLabel = currentProviderConnected ? currentProvider : 'n/a';
  const modelAvailable = currentProviderConnected && models.length > 0;

  return (
    <main className={cn('flex-1 flex flex-col overflow-hidden bg-transparent', className)}>
      {/* ── Chat Header ── */}
      <div className="h-[44px] flex items-center justify-between px-4 border-b border-border glass-strong flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
          <h1 className="text-sm font-black tracking-tighter italic text-foreground truncate">
            {currentSessionTitle || 'New Chat'}
          </h1>

          {/* Provider / Model selectors */}
          <div className="flex items-center gap-1 ml-2 min-w-0">
            {connectedProviders.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-xs px-2 py-1 rounded-md hover:bg-accent transition-colors flex items-center gap-1">
                    Provider: {providerLabel}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => refreshStatus()}>
                    🔄 Refresh status
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {connectedProviders.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      className="justify-between"
                      onClick={() => setCurrentProvider(p.name)}
                    >
                      {p.name}
                      {currentProvider === p.name && (
                        <span className="text-primary">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-xs px-2 py-1 text-muted-foreground" title="No provider connected">
                Provider: n/a
              </span>
            )}

            {modelAvailable ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-xs px-2 py-1 rounded-md hover:bg-accent transition-colors flex items-center gap-1 max-w-[180px]">
                    Model: {currentModel ? shortModel(currentModel) : '—'}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                  {models.map((m) => (
                    <DropdownMenuItem
                      key={m.name}
                      className="justify-between max-w-[280px]"
                      onClick={() => selectModel(m.name)}
                    >
                      <span className="truncate">
                        {shortModel(m.name)} ({(m.size / 1024 / 1024 / 1024).toFixed(1)}GB){m.type === 'vision' ? ' (vision)' : ''}
                      </span>
                      {currentModel === m.name && (
                        <span className="text-primary flex-shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-xs px-2 py-1 text-muted-foreground">
                Model: —
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => navigate('/dashboard')} aria-label="Dashboard">
                <BarChart3 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Dashboard</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => useUIStore.getState().openSaveModal()} aria-label="Save Conversation">
                <Save className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Save Conversation</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => useUIStore.getState().openLoadModal()} aria-label="Load Conversation">
                <FolderOpen className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Load Conversation</TooltipContent>
          </Tooltip>

          {viewingSessionId !== activeSessionId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => returnToCurrent()} aria-label="Return to Current">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Return to Current</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => {
                const isViewingActive = viewingSessionId === activeSessionId;
                if (confirm(isViewingActive
                  ? 'Clear current chat and start new?'
                  : 'Clear archived viewed session and start new?'
                )) {
                  clearChat();
                }
              }} aria-label="Clear Chat">
                <Archive className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Clear chat (archive + new)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => {
                if (confirm('Delete this conversation permanently?\nThis cannot be undone.')) {
                  deleteSession(viewingSessionId!);
                }
              }} aria-label="Delete Conversation">
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Delete conversation (permanent)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => exportConversation()} aria-label="Export to File">
                <Upload className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Export to File</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Theme">
                    <Palette className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Theme</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                {themes.map((t) => (
                  <DropdownMenuItem
                    key={t.value}
                    className="justify-between"
                    onClick={() => setTheme(t.value)}
                  >
                    {t.label}
                    {theme === t.value && (
                      <span className="text-primary">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Mode</DropdownMenuLabel>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {modes.map((m) => (
                        <DropdownMenuItem
                          key={m.value}
                          className="justify-between"
                          onClick={() => setMode(m.value)}
                        >
                          {m.label}
                          {mode === m.value && (
                            <span className="text-primary">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Context Bar ── */}
      <div
        className={cn('h-7 flex items-center px-4 border-b border-border glass flex-shrink-0', !contextInfo && 'opacity-40')}
        title="Questions • Input/Output tokens • Context load"
      >
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              contextInfo
                ? pct <= 50
                  ? 'bg-success'
                  : pct <= 75
                    ? 'bg-warning'
                    : 'bg-destructive'
                : 'bg-muted-foreground',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="ml-2 text-xs whitespace-nowrap text-muted-foreground">
          {userMsgCount} • {totalInputTokens}/{totalOutputTokens} •{' '}
          <span className={pctColor}>{pct}%</span>
        </span>
      </div>

      {/* ── Messages ── */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {groupedByQuestion.length === 0 && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <div className="w-16 h-16 rounded-[2rem] bg-primary/10 flex items-center justify-center mb-4 animate-pulse">
              <MessageSquare className="w-8 h-8" />
            </div>
            <p className="text-xl font-black tracking-tighter italic text-foreground">Start a conversation</p>
            <p className="text-sm mt-1 italic">
              {currentModel ? `Using ${currentModel}` : 'Select a model to start'}
            </p>
          </div>
        ) : (
          <>
            {groupedByQuestion.map((group, groupIdx) => {
              const hasExcluded = group.excludedIndices && group.excludedIndices.length > 0;
              return (
                <div key={group.questionId} data-chat-question-id={group.questionId} className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {/* Question card */}
                    <div className="rounded-xl bg-primary/10 border border-primary/20 p-4">
                      <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="text-xs font-semibold text-primary">Вы • Q{groupIdx + 1}</span>
                      {group.model && (
                        <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                          {shortModel(group.model)}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-6 px-1.5"
                                disabled={groupIdx === 0}
                                onClick={() => {
                                  if (groupIdx === 0) {
                                    useUIStore.getState().addToast('No more questions', 'info');
                                    return;
                                  }
                                  const prevGroup = groupedByQuestion[groupIdx - 1];
                                  scrollToQuestion(prevGroup.questionId);
                                }}
                                aria-label="Previous question"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">↑ Prev</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-6 px-1.5"
                                disabled={groupIdx === groupedByQuestion.length - 1}
                                onClick={() => {
                                  if (groupIdx === groupedByQuestion.length - 1) {
                                    useUIStore.getState().addToast('No more questions', 'info');
                                    return;
                                  }
                                  const nextGroup = groupedByQuestion[groupIdx + 1];
                                  scrollToQuestion(nextGroup.questionId);
                                }}
                                aria-label="Next question"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Next ↓</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                      <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-content-text">
                        {group.question}
                      </div>
                      {group.attachmentsMeta && group.attachmentsMeta.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {group.attachmentsMeta.map((att, i) => (
                            <span
                              key={i}
                              className="text-xs bg-secondary border border-border rounded-md px-2 py-0.5 text-muted-foreground"
                            >
                              📎 {att.name} ({formatSize(att.size)})
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Question actions */}
                      <div className="flex items-center gap-1 mt-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs gap-1"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(group.question);
                                  useUIStore.getState().addToast('Question copied!', 'success');
                                } catch {
                                  useUIStore.getState().addToast('Failed to copy', 'error');
                                }
                              }}
                              aria-label="Copy question"
                            >
                              <ClipboardCopy className="w-3 h-3" />
                              Copy Question
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Copy Question</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-destructive gap-1"
                              onClick={() => {
                                if (confirm('Delete this question and answer?')) {
                                  deleteMessage(group.questionId);
                                }
                              }}
                              aria-label="Delete question"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Delete this question and answer</TooltipContent>
                        </Tooltip>
                      </div>
                  </div>

                  {/* Context notice */}
                    {hasExcluded && (
                      <div className="text-warning italic text-xs bg-warning/10 border-l-[3px] border-warning rounded-md px-3 py-2 mt-2">
                        ⚠️ {group.excludedIndices!.map(n => `Q${n}`).join(', ')} исключены из контекста.
                      </div>
                    )}

                    {/* Answers */}
                    {group.answers.map((answer, idx) => (
                      <div key={`ans-${idx}`} className="rounded-xl bg-card border border-border p-4">
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <span className="text-xs font-semibold text-success">AI</span>
                          <button
                            onClick={() => handleCopy(answer, `copy-${idx}`)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                          >
                            {copiedId === `copy-${idx}` ? (
                              <Check className="w-3 h-3 text-success" />
                            ) : (
                              <Copy className="w-3 h-3 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                        {group.imageData?.thumbnailUrl && (
                          <div className="mt-1.5">
                            <img
                              src={group.imageData.thumbnailUrl}
                              className="max-w-[200px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => window.open(group.imageData!.fullUrl, '_blank')}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                            <div className="text-xs text-muted-foreground mt-1">{group.imageData.filename}</div>
                          </div>
                        )}
                        <div className="chat-markdown">
                          <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{ pre: CodeBlock }}>
                            {answer}
                          </ReactMarkdown>
                        </div>
                        {/* Answer actions */}
                        <div className="flex items-center gap-1 mt-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs gap-1"
                                onClick={() => scrollToQuestion(group.questionId)}
                                aria-label="Go to question"
                              >
                                <ArrowUp className="w-3 h-3" />
                                Question
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Go to question</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs gap-1"
                                onClick={async () => {
                                  const qaText = `## Question\n\n${group.question}\n\n## Answer\n\n${answer}`;
                                  try {
                                    await navigator.clipboard.writeText(qaText);
                                    useUIStore.getState().addToast('Q&A copied as Markdown!', 'success');
                                  } catch {
                                    useUIStore.getState().addToast('Failed to copy', 'error');
                                  }
                                }}
                                aria-label="Copy Q&A as Markdown"
                              >
                                <ClipboardCopy className="w-3 h-3" />
                                Copy Q&A
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Copy Q&A as Markdown</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

            {isSending && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium text-primary">AI</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-muted-foreground">AI</span>
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  </div>
                  <div className="text-sm text-muted-foreground italic">
                    модель думает...
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Send Error Banner (ТЗ context-overflow-ux №2) ── */}
      {activeSendError && (
        <div
          className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 flex items-start gap-2 flex-shrink-0"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-destructive">{activeSendError.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{activeSendError.detail}</div>
            {activeSendError.estimatedTokens != null && activeSendError.contextLength != null && (
              <div className="font-mono text-[11px] mt-1 text-foreground">
                ≈{formatTokensCompact(activeSendError.estimatedTokens)} / {formatTokensCompact(activeSendError.contextLength)} tok
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={isSending}
              onClick={handleRetry}
            >
              Повторить
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => dismissSendError()}
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── File Previews ── */}
      {(fileSlot || codeFiles.length > 0) && (
        <div className="px-4 py-2 border-t border-border bg-card flex gap-2 overflow-x-auto items-center">
          {fileSlot && (
            <div className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border">
              {fileSlot.preview ? (
                <img
                  src={fileSlot.preview}
                  alt={fileSlot.file.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  {fileSlot.file.type.startsWith('image/') ? (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <File className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              )}
              <button
                onClick={removeFileSlot}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-destructive text-white rounded-full flex items-center justify-center"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
          {codeFiles.map((cf, idx) => (
            <div key={`code-${idx}`} className="relative flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-secondary border border-border rounded-md text-xs text-foreground">
              <FileCode className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="max-w-[100px] truncate">{cf.file.name}</span>
              <button
                onClick={() => removeCodeFile(idx)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Input Zone ── */}
      <div className="p-4 border-t border-border glass-strong">
        <div className="flex items-end gap-2 bg-primary/10 rounded-[2rem] border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all px-4 py-2.5">
          <STTInput onTranscribe={(t) => setInputValue((prev) => (prev ? prev + (prev.endsWith(' ') ? '' : ' ') + t : t))} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => useUIStore.getState().toggleAiHelper()}
                aria-label="AI Helper"
                className="flex-shrink-0"
              >
                <Sparkles className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">AI Helper (звонки)</TooltipContent>
          </Tooltip>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.log,.py,.js,.ts,.jsx,.tsx,.json,.xml,.html,.css,.md,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.swift,.kt,.sh,.yaml,.yml,.toml,.ini,.cfg,.conf,.env"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-lg border border-border hover:bg-accent transition-colors flex-shrink-0"
            aria-label="Attach files"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 min-h-[44px] max-h-[200px] py-2.5 px-3 bg-secondary border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !inputValue.trim() || !currentModel || messageOverCap}
            className={cn(
              'p-2.5 rounded-[1.5rem] bg-primary text-primary-foreground hover:opacity-90 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0',
              inputValue.trim() && currentModel ? 'scale-100' : 'scale-90',
            )}
            aria-label="Send message"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          {messageOverCap ? (
            // №4: мягкий кап — разрушающая пометка вместо отправки
            <span className="text-destructive">
              Слишком длинный ввод: {formatChars(trimmedInput.length)} / {formatChars(MAX_MESSAGE_CHARS)} символов — сократи вопрос или вынеси часть в файл
            </span>
          ) : messageNearCap ? (
            // №4: предупреждение до капа — нейтральный счётчик
            <span>
              {formatChars(trimmedInput.length)} / {formatChars(MAX_MESSAGE_CHARS)} символов
            </span>
          ) : (
            <span>Press Enter to send, Shift+Enter for newline</span>
          )}
        </div>
      </div>

      {/* ── Stat Footer ── */}
      <StatFooter
        currentModel={currentModel}
        modelDetail={modelDetail}
        currentContextLength={currentContextLength}
        lastMetrics={lastMetrics}
        totalInputTokens={totalInputTokens}
        totalOutputTokens={totalOutputTokens}
        userMsgCount={userMsgCount}
      />
    </main>
  );
}
