import { useMemo } from 'react';
import { ListChecks, MessageSquare } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { scrollToQuestion } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function shortModel(model: string): string {
  return model.split('/').pop()?.replace('.gguf', '') ?? model;
}

function deriveQuestions(messages: Array<{ role: string; questionId: string; content: string; model: string }>): Array<{ id: string; text: string; model: string; number: number }> {
  return messages
    .filter((m) => m.role === 'user')
    .map((m, i) => ({
      id: m.questionId,
      text: m.content,
      model: m.model,
      number: i + 1,
    }));
}

export function QuestionsPanel({ className }: { className?: string }) {
  const contextMode = useSessionStore((s) => s.contextMode);
  const selectedQuestionIds = useSessionStore((s) => s.selectedQuestionIds);
  const toggleContextMode = useSessionStore((s) => s.toggleContextMode);
  const selectAllQuestions = useSessionStore((s) => s.selectAllQuestions);
  const deselectAllQuestions = useSessionStore((s) => s.deselectAllQuestions);
  const toggleQuestionSelection = useSessionStore((s) => s.toggleQuestionSelection);
  const messages = useSessionStore((s) => s.messages);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isViewing = viewingSessionId !== activeSessionId;

  const questions = useMemo(() => deriveQuestions(messages), [messages]);

  const total = questions.length;
  const selected = contextMode === 'standard' ? total : selectedQuestionIds.length;

  return (
    <aside className={`${className} flex flex-col h-full border-r border-border bg-card`}>
      {/* Header */}
      <div className="h-[44px] flex items-center px-3 border-b border-border flex-shrink-0">
        <ListChecks className="w-4 h-4 text-muted-foreground mr-2" />
        <span className="text-sm font-semibold text-foreground">Questions</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Mode block */}
        <div className="bg-muted/50 rounded-lg p-2.5">
          <div className="flex items-center justify-between">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={contextMode === 'standard' ? 'default' : 'secondary'}
                    onClick={() => toggleContextMode()}
                    disabled={isViewing}
                    className="text-xs"
                  >
                    {contextMode === 'standard' ? 'Standard (All)' : 'Manual'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="flex items-center gap-1.5">
                    <MessageSquare className="w-3 h-3" />
                    Контекст управляется в текущем чате
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-xs text-muted-foreground">
              Context: {selected}/{total}
            </span>
          </div>
          {contextMode === 'manual' && (
            <div className="flex gap-1 mt-1.5">
              <Button size="sm" variant="ghost" onClick={selectAllQuestions} disabled={isViewing} className="text-xs h-6 px-2">
                All
              </Button>
              <Button size="sm" variant="ghost" onClick={deselectAllQuestions} disabled={isViewing} className="text-xs h-6 px-2">
                None
              </Button>
            </div>
          )}
        </div>

        {/* Questions list */}
        {questions.map((q) => (
          <div
            key={q.id}
            data-question-id={q.id}
            className="rounded-lg p-2.5 bg-card border border-border cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => scrollToQuestion(q.id)}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={contextMode === 'standard' || selectedQuestionIds.includes(q.id)}
                disabled={contextMode === 'standard'}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleQuestionSelection(q.id)}
                className="mt-0.5 cursor-pointer accent-[hsl(var(--primary))] flex-shrink-0
                  disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-primary mb-1">
                  Q{q.number} • {shortModel(q.model)}
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                  {q.text}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="h-8 flex items-center px-3 border-t border-border flex-shrink-0">
        <span className="text-xs text-muted-foreground">{questions.length} questions</span>
      </div>
    </aside>
  );
}
