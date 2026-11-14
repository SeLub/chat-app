import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings2, ListChecks, Eye } from 'lucide-react';
import { usePromptStore } from '@/stores/promptStore';
import { Button } from '@/components/ui/button';
import { SelectedPromptsModal } from './selected-prompts-modal';

interface PromptsTabProps {
  questionPreview?: string;
}

export function PromptsTab({ questionPreview }: PromptsTabProps) {
  const navigate = useNavigate();
  const prompts = usePromptStore((s) => s.prompts);
  const syspromptId = usePromptStore((s) => s.syspromptId);
  const selectedTemplateIds = usePromptStore((s) => s.selectedTemplateIds);
  const setSyspromptId = usePromptStore((s) => s.setSyspromptId);
  const toggleTemplate = usePromptStore((s) => s.toggleTemplate);
  const [previewOpen, setPreviewOpen] = useState(false);

  const systemPrompts = prompts.filter((p) => p.type === 'system');
  const userTemplates = prompts.filter((p) => p.type === 'user_template');

  return (
    <div className="flex flex-col h-full">
      {/* Header buttons */}
      <div className="p-3 flex gap-2 border-b border-border">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          onClick={() => navigate('/templatemanager')}
        >
          Prompt Manager
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          onClick={() => setPreviewOpen(true)}
        >
          <Eye className="w-3 h-3 mr-1" />
          Selected
        </Button>
      </div>

      {/* System Prompts */}
      <div className="flex-1 min-h-0 overflow-y-auto border-b border-border">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground sticky top-0 bg-background">
          System Prompts
        </div>
        <div className="px-3 space-y-1">
          {systemPrompts.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="sysprompt"
                checked={syspromptId === p.id}
                onChange={() => setSyspromptId(p.id)}
                className="cursor-pointer accent-[hsl(var(--primary))] flex-shrink-0"
              />
              <Settings2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs truncate flex-1">{p.name}</span>
              {p.is_default === 1 && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">
                  def
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* User Templates */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground sticky top-0 bg-background">
          User Templates
        </div>
        <div className="px-3 space-y-1">
          {userTemplates.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedTemplateIds.includes(p.id)}
                onChange={() => toggleTemplate(p.id)}
                className="cursor-pointer accent-[hsl(var(--primary))] flex-shrink-0"
              />
              <ListChecks className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs truncate flex-1">{p.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Selected Prompts Modal */}
      <SelectedPromptsModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        questionPreview={questionPreview}
      />
    </div>
  );
}
