import { useEffect, useMemo, useState } from 'react';
import { ListChecks, MessageSquare } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { scrollToQuestion, shortModel } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PromptsTab } from '@/features/prompts/components/prompts-tab';

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

type PanelTab = 'questions' | 'prompts';

export function QuestionsPanel({ className }: { className?: string }) {
  const [tab, setTab] = useState<PanelTab>('questions');

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

  const retainPercent = useSessionStore((s) => s.retainPercent);
  const setRetainPercent = useSessionStore((s) => s.setRetainPercent);

  const [retainInput, setRetainInput] = useState(retainPercent);

  useEffect(() => {
    setRetainInput(retainPercent);
  }, [retainPercent]);

  const questions = useMemo(() => deriveQuestions(messages), [messages]);

  const total = questions.length;
  const selected = contextMode === 'standard' ? total : selectedQuestionIds.length;

  const handleRetainChange = (val: number) => {
    setRetainInput(val);
    setRetainPercent(val);
  };

  return (
    <aside className={`${className} flex flex-col h-full glass border-r border-border`}>
      {/* Header */}
      <div className="h-[44px] flex items-center px-4 border-b border-border flex-shrink-0">
        <ListChecks className="w-4 h-4 text-muted-foreground mr-2" />
        <span className="text-sm font-semibold text-foreground">Context</span>
      </div>

      {/* Tab bar */}
      <div className="flex flex-shrink-0 border-b border-border">
        {(['questions', 'prompts'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-xs py-2 transition-colors ${
              tab === t
                ? 'bg-primary/10 text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'questions' ? 'Questions' : 'Prompts'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'questions' ? (
          <div className="p-4 space-y-2">
            {/* Sticky mode block */}
            <div className="sticky top-0 z-10 bg-background rounded-lg p-3 border border-border">
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
                className="rounded-lg p-4 bg-card border border-border cursor-pointer hover:border-primary/50 transition-colors"
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
                    <div className="text-[13px] leading-snug text-muted-foreground whitespace-pre-wrap line-clamp-3">
                      {q.text}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <PromptsTab />
        )}
      </div>

      {/* Footer */}
      <div className="h-8 flex items-center px-4 border-t border-border flex-shrink-0">
        <span className="text-xs text-muted-foreground">{questions.length} questions</span>
      </div>
    </aside>
  );
}
