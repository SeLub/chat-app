import { useState, useEffect, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';
import { getLanguageFromClassName, isMermaid } from '@/lib/utils';
import { useTheme } from '@/app/ThemeProvider';

function extractCodeText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractCodeText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractCodeText((children.props as { children?: ReactNode }).children);
  }
  return '';
}

// mermaid.initialize — один раз на приложение (модульный флаг).
let mermaidInitialized = false;

async function initMermaid(isDark: boolean) {
  const { default: mermaid } = await import('mermaid');
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'strict' });
    mermaidInitialized = true;
  } else {
    // смена темы — перенастройка без повторной инициализации
    mermaid.initialize({ theme: isDark ? 'dark' : 'default' });
  }
  return mermaid;
}

let mermaidSeq = 0;

function MermaidBlock({ code }: { code: string }) {
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  // смена темы → перерендер активной диаграммы
  useEffect(() => {
    if (!open || error) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await initMermaid(isDark);
        const id = `mermaid-${++mermaidSeq}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, isDark, error, code]);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      setSvg(null);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      const mermaid = await initMermaid(isDark);
      const id = `mermaid-${++mermaidSeq}`;
      const { svg: rendered } = await mermaid.render(id, code);
      setSvg(rendered);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3">
      <button
        onClick={toggle}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80 transition-opacity disabled:opacity-50"
      >
        📊 {open ? 'Hide diagram' : 'Show diagram'}
      </button>
      {open && loading && !svg && (
        <div className="text-xs text-muted-foreground mt-2">Rendering…</div>
      )}
      {open && error && (
        <div className="text-xs text-destructive mt-2">Diagram error — showing source</div>
      )}
      {open && svg && !error && (
        <div
          className="mt-3 flex justify-center overflow-x-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}

export function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const lang = getLanguageFromClassName(
    child && typeof child === 'object' && 'props' in child
      ? (child.props as { className?: string }).className
      : undefined,
  );

  const codeText = extractCodeText(children);
  const mermaid = isMermaid(lang);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
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
      {mermaid ? <MermaidBlock code={codeText} /> : children}
    </div>
  );
}
