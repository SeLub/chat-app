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
  const [showDiagram, setShowDiagram] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [diagError, setDiagError] = useState(false);
  const [loading, setLoading] = useState(false);

  // автогидрат: контент стабилен ≥600 мс → рендер; смена темы — перерендер.
  useEffect(() => {
    if (!showDiagram) return;
    setDiagError(false);
    setLoading(true);
    const generation = ++mermaidSeq;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await initMermaid(isDark);
        const id = `mmd-${generation}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (generation === mermaidSeq) setSvg(rendered);
      } catch {
        if (generation === mermaidSeq) setDiagError(true);
      } finally {
        if (generation === mermaidSeq) setLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [code, isDark, showDiagram]);

  const toggle = () => {
    setShowDiagram((v) => !v);
  };

  return (
    <div className="p-3">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
      >
        📊 {showDiagram ? 'Hide diagram' : 'Show diagram'}
      </button>
      {showDiagram && loading && !svg && !diagError && (
        <div className="text-xs text-muted-foreground mt-2">Rendering…</div>
      )}
      {showDiagram && diagError && (
        <>
          <div className="text-xs text-destructive mt-2">Diagram error — showing source</div>
          <pre className="overflow-x-auto mt-2 text-xs">{code}</pre>
        </>
      )}
      {showDiagram && svg && !diagError && (
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
      {mermaid ? (
        <MermaidBlock code={codeText} />
      ) : (
        <pre className="overflow-x-auto">
          {children}
        </pre>
      )}
    </div>
  );
}
