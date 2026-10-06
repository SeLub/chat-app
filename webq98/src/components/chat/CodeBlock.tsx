import { useState, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';
import { getLanguageFromClassName } from '@/lib/utils';

function extractCodeText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractCodeText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractCodeText((children.props as { children?: ReactNode }).children);
  }
  return '';
}

export function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const lang = getLanguageFromClassName(
    child && typeof child === 'object' && 'props' in child
      ? (child.props as { className?: string }).className
      : undefined,
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extractCodeText(children));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {lang ?? 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-success" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>
      {children}
    </div>
  );
}
