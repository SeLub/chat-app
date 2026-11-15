import { useRef } from 'react';
import { Paperclip, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Research mode: правая панель. Описание режима + кнопка «Attach file(s)»
// (дублирует скрепку в композере — вторая точка входа для file picker).
// Файлы передаются в ChatArea через кастомное DOM-событие 'chat-attach-files'.

export function ResearchPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    window.dispatchEvent(
      new CustomEvent('chat-attach-files', { detail: Array.from(files) }),
    );
    e.target.value = '';
  };

  return (
    <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FlaskConical className="w-4 h-4 text-primary" />
          Research mode
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Диалог с моделью: файлы (PDF/DOC/код) и изображения прикладываются
          через форму чата — они попадают в <span className="font-mono">[Материалы]</span> контекста
          как снапшот на момент отправки.
        </p>
      </div>

      {/* Кнопка attach — на том же уровне, что «Attach file(s)» / «Browse project files» в ProjectPanel */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="w-4 h-4" />
          Attach file(s)
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.log,.py,.js,.ts,.jsx,.tsx,.json,.xml,.html,.css,.md,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.swift,.kt,.sh,.yaml,.yml,.toml,.ini,.cfg,.conf,.env"
        onChange={handleFileSelect}
        className="hidden"
      />

      <p className="text-xs text-muted-foreground italic">
        Переключитесь в Project, чтобы работать с папкой репозитория на диске
        (актуальные версии файлов, mtime-кэш).
      </p>
    </div>
  );
}
