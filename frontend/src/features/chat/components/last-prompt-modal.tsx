import { useEffect, useMemo, useState } from 'react';
import { Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '@/lib/chatRender';
import { apiGateway, ApiError } from '@/lib/apiGateway';
import type { LastPrompt, PromptMessage } from '@/types';

/**
 * ТЗ Last Prompt: модалка с финальным промптом последней отправки.
 * 200 → meta-секция + Markdown-рендер промпта; 404 → «промпта ещё нет»;
 * одна кнопка Copy копирует Markdown (не JSON, не meta).
 */
export function LastPromptModal({
  open,
  onOpenChange,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}) {
  const [data, setData] = useState<LastPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    setNotFound(false);
    setError(null);
    apiGateway.sessions
      .getLastPrompt(sessionId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load prompt');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  // Markdown-представление промпта — то, что копирует кнопка Copy.
  const markdown = useMemo(() => {
    if (!data) return '';
    const parts: string[] = [];
    for (const m of data.prompt) {
      const header =
        m.role === 'system' ? '## System' : `## ${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 60)}`;
      parts.push(`---\n${header}\n\n${m.content}`);
      if (m.images && m.images.length > 0) {
        parts.push(`**[images: ${m.images.length} × base64]**`);
      }
    }
    return parts.join('\n\n');
  }, [data]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const copyButton = (
    <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data || loading}>
      {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Sticky header — always visible, Copy accessible at any scroll position */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-3 shrink-0">
          <DialogHeader className="min-w-0">
            <DialogTitle>👁 Last Prompt</DialogTitle>
            <DialogDescription>
              Финальный контекст последней отправки в модель
            </DialogDescription>
          </DialogHeader>
          {copyButton}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {error && !loading && (
            <div className="py-8 text-center text-sm text-destructive">{error}</div>
          )}

          {notFound && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Промпта ещё нет — отправьте сообщение, чтобы увидеть, что ушло в модель.
            </div>
          )}

          {data && !loading && (
            <>
              <MetaSection meta={data.meta} />
              <div className="border-t border-border my-3" />
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                {data.prompt.map((m, i) => (
                  <PromptBlock key={i} message={m} />
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaSection({ meta }: { meta: LastPrompt['meta'] }) {
  const rows: Array<[string, string]> = [];
  if (meta.mode) rows.push(['Mode', meta.mode]);
  if (meta.model) rows.push(['Model', meta.model]);
  if (meta.provider) rows.push(['Provider', meta.provider]);
  if (meta.questionId) rows.push(['Question ID', meta.questionId]);
  if (meta.timestamp) {
    rows.push(['Sent', new Date(meta.timestamp).toLocaleString()]);
  }
  if (meta.finishReason) rows.push(['Finish reason', meta.finishReason]);
  if (meta.usage) {
    rows.push([
      'Tokens',
      `in ${meta.usage.inputTokens ?? '–'} / out ${meta.usage.outputTokens ?? '–'}`,
    ]);
  }
  rows.push([
    'Context',
    `fixed ${meta.fixedChars ?? 0} + history ${meta.actualHistoryChars ?? 0} chars (target ${meta.targetChars ?? '–'})`,
  ]);
  if (meta.totalQAPairs != null) {
    rows.push(['QA pairs', `${meta.includedQAPairs ?? 0}/${meta.totalQAPairs}`]);
  }
  if (meta.currentAttachments && meta.currentAttachments.length > 0) {
    rows.push([
      'Attachments',
      meta.currentAttachments.map((a) => a.name).join(', '),
    ]);
  }
  const genParams = Object.entries(meta.generationParams ?? {});
  if (genParams.length > 0) {
    rows.push(['Generation params', genParams.map(([k, v]) => `${k}=${v}`).join(', ')]);
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <div className="text-muted-foreground">{label}</div>
          <div className="font-mono break-words">{value}</div>
        </div>
      ))}
    </div>
  );
}

function PromptBlock({ message }: { message: PromptMessage }) {
  const isSystem = message.role === 'system';
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
        {isSystem ? 'System' : message.role}
      </div>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {message.content}
      </ReactMarkdown>
      {message.images && message.images.length > 0 && (
        <div className="text-xs text-muted-foreground mt-1">
          **[images: {message.images.length} × base64]**
        </div>
      )}
    </div>
  );
}
