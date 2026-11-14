import { usePromptStore } from '@/stores/promptStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SelectedPromptsModalProps {
  open: boolean;
  onClose: () => void;
  questionPreview?: string;
}

export function SelectedPromptsModal({ open, onClose, questionPreview }: SelectedPromptsModalProps) {
  const prompts = usePromptStore((s) => s.prompts);
  const syspromptId = usePromptStore((s) => s.syspromptId);
  const selectedTemplateIds = usePromptStore((s) => s.selectedTemplateIds);

  const systemPrompt = prompts.find((p) => p.id === syspromptId);
  const templates = selectedTemplateIds
    .map((id) => prompts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  let content = '';
  if (systemPrompt) {
    content += systemPrompt.content;
  }
  for (const t of templates) {
    content += `\n\n--- TEMPLATE: ${t.name} ---\n${t.content}`;
  }
  content += '\n\n[Вопрос]';
  if (questionPreview?.trim()) {
    content += `\n${questionPreview.trim()}`;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Selected Prompts Preview</DialogTitle>
        </DialogHeader>
        <pre className="whitespace-pre-wrap font-mono text-xs bg-secondary rounded-lg p-4 border border-border">
          {content || '(no prompts selected)'}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
