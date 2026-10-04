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
} from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { useUIStore } from '@/stores/uiStore';
import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

export function ChatArea() {
  const messages = useSessionStore((s) => s.messages);
  const contextInfo = useSessionStore((s) => s.contextInfo);
  const currentModel = useProviderStore((s) => s.currentModel);
  const refreshStatus = useProviderStore((s) => s.refreshStatus);
  const sendMessage = useSessionStore((s) => s.sendMessage);

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [fileSlot, setFileSlot] = useState<FilePreview | null>(null);
  const [codeFiles, setCodeFiles] = useState<FilePreview[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputValue]);

  const clearAttachments = useCallback(() => {
    setFileSlot(null);
    setCodeFiles([]);
  }, []);

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
    if (newCodeFiles.length > 0) {
      setCodeFiles((prev) => [...prev, ...newCodeFiles]);
    }

    e.target.value = '';
  }, []);

  const removeFileSlot = useCallback(() => {
    setFileSlot(null);
  }, []);

  const removeCodeFile = useCallback((index: number) => {
    setCodeFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const collectFiles = useCallback((): { file?: File; codeFiles?: File[] } | undefined => {
    if (!fileSlot && codeFiles.length === 0) return undefined;
    return {
      file: fileSlot?.file,
      codeFiles: codeFiles.length > 0 ? codeFiles.map((f) => f.file) : undefined,
    };
  }, [fileSlot, codeFiles]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isSending) return;
    const text = inputValue.trim();
    const files = collectFiles();
    setInputValue('');
    clearAttachments();
    setIsSending(true);
    try {
      await sendMessage(text, files);
      await refreshStatus();
    } catch (e) {
      useUIStore.getState().addToast(
        e instanceof Error ? e.message : 'Failed to send',
        'error',
      );
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [inputValue, isSending, sendMessage, collectFiles, clearAttachments, refreshStatus]);

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

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const groupedByQuestion: Array<{
    questionId: string;
    question: string;
    answers: string[];
    model?: string;
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
      };
    } else if (currentGroup) {
      currentGroup.answers.push(msg.content);
    }
  }
  if (currentGroup) groupedByQuestion.push(currentGroup);

  const pct = contextInfo
    ? Math.round(contextInfo.totalChars / (contextInfo.contextSize * 4) * 100)
    : 0;

  const pctColor = contextInfo
    ? pct <= 50
      ? 'text-success'
      : pct <= 75
        ? 'text-warning'
        : 'text-destructive'
    : '';

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {groupedByQuestion.length === 0 && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">Start a conversation</p>
            <p className="text-sm mt-1">
              {currentModel ? `Using ${currentModel}` : 'Select a model to start'}
            </p>
          </div>
        ) : (
          <>
            {groupedByQuestion.map((group) => (
              <div key={group.questionId} className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-medium text-primary">U</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-muted-foreground">You</span>
                      {group.model && (
                        <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                          {group.model}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-foreground bg-muted/50 rounded-lg p-3">
                      {group.question}
                    </div>
                  </div>
                </div>

                {group.answers.map((answer, idx) => (
                  <div key={`ans-${idx}`} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-medium text-primary">AI</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">AI</span>
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
                      <div className="prose prose-sm max-w-none text-sm text-foreground bg-card border border-border rounded-lg p-4">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {answer}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}

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

      {(fileSlot || codeFiles.length > 0) && (
        <div className="px-4 py-2 border-t border-border bg-card flex gap-2 overflow-x-auto items-center">
          {fileSlot && (
            <div className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border">
              {fileSlot.preview ? (
                <img src={fileSlot.preview} alt={fileSlot.file.name} className="w-full h-full object-cover" />
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

      <div className="p-4 border-t border-border bg-card">
        <div className="flex items-end gap-2">
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
            className="flex-1 min-h-[40px] max-h-[200px] py-2.5 px-3 bg-secondary border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !inputValue.trim() || !currentModel}
            className="p-2.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            aria-label="Send message"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {contextInfo ? (
              <span className={pctColor}>
                {contextInfo.includedQAPairs}/{contextInfo.totalQAPairs} Q&A • {pct}%
              </span>
            ) : (
              <span>–</span>
            )}
          </div>
          <span>Press Enter to send, Shift+Enter for newline</span>
        </div>
      </div>
    </main>
  );
}

function MessageSquare(props: { className?: string }) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
