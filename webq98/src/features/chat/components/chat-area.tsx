import {
  Send,
  Paperclip,
  Loader2,
  X,
  Copy,
  Check,
} from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@/types';

interface AttachmentFile {
  file: File;
  preview?: string;
}

export function ChatArea() {
  const messages = useSessionStore((s: { messages: ChatMessage[] }) => s.messages);
  const addBotMessage = useSessionStore((s: { addBotMessage: (content: string, model: string, metrics?: unknown, excludedIndices?: number[]) => void }) => s.addBotMessage);
  const addMessage = useSessionStore((s: { addMessage: (msg: ChatMessage) => void }) => s.addMessage);
  const viewingSessionId = useSessionStore((s: { viewingSessionId: string | null }) => s.viewingSessionId);
  const currentModel = useProviderStore((s: { currentModel: string | null }) => s.currentModel);
  const currentProvider = useProviderStore((s: { currentProvider: string }) => s.currentProvider);
  const refreshStatus = useProviderStore((s: { refreshStatus: () => Promise<void> }) => s.refreshStatus);

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreamActive, setIsStreamActive] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputValue]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isSending || !viewingSessionId || !currentModel) return;

    const questionId = `q_${Date.now()}`;
    const userMessage: ChatMessage = {
      role: 'user',
      content: inputValue.trim(),
      questionId,
      model: currentModel,
    };

    addMessage(userMessage);
    setStreamingContent('');
    setIsStreamActive(true);
    setIsSending(true);
    setInputValue('');

    const formData = new FormData();
    formData.append('question', inputValue.trim());
    formData.append('model', currentModel);
    formData.append('questionId', questionId);
    formData.append('provider', currentProvider);

    for (const att of attachments) {
      if (att.file) {
        formData.append('file', att.file);
      }
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'X-Provider': currentProvider },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json();
        addBotMessage(data.response, data.model, data.metrics, data.excludedIndices);
        setIsStreamActive(false);
        refreshStatus();
        return;
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        setStreamingContent(fullResponse);
      }

      addBotMessage(fullResponse, currentModel, undefined, undefined);
      refreshStatus();
    } catch (error) {
      console.error('Failed to send message:', error);
      addBotMessage(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        currentModel,
      );
    } finally {
      setIsSending(false);
      setIsStreamActive(false);
      setAttachments([]);
    }
  }, [inputValue, isSending, viewingSessionId, currentModel, currentProvider, attachments, addMessage, addBotMessage, refreshStatus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: AttachmentFile[] = Array.from(files).map((file) => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sortedMessages = [...messages].sort((a, b) => {
    const aIdx = parseInt(a.questionId.replace('q_', '')) || 0;
    const bIdx = parseInt(b.questionId.replace('q_', '')) || 0;
    return aIdx - bIdx;
  });

  const groupedByQuestion: Array<{
    questionId: string;
    question: string;
    answers: string[];
    model?: string;
  }> = [];

  let currentGroup: typeof groupedByQuestion[number] | null = null;
  for (const msg of sortedMessages) {
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

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {groupedByQuestion.length === 0 && !isStreamActive ? (
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

            {isStreamActive && streamingContent && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium text-primary">AI</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-muted-foreground">AI</span>
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  </div>
                  <div className="prose prose-sm max-w-none text-sm text-foreground bg-card border border-border rounded-lg p-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingContent}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-card flex gap-2 overflow-x-auto">
          {attachments.map((att, idx) => (
            <div key={idx} className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border">
              {att.preview ? (
                <img src={att.preview} alt={att.file.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <FileCode className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <button
                onClick={() => removeAttachment(idx)}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-destructive text-white rounded-full flex items-center justify-center"
              >
                <X className="w-2.5 h-2.5" />
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
            accept="image/*,.txt,.log,.py,.js,.ts,.jsx,.tsx,.json,.xml,.html,.css,.md,.sql"
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
            <span>Context: available</span>
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

function FileCode(props: { className?: string }) {
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
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m9 15-2-2 2-2" />
      <path d="m12 17 2-2-2-2" />
    </svg>
  );
}
