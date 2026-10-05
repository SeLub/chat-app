import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { scrollToQuestion } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { QuestionRef } from '@/types';

function shortModel(model: string): string {
  return model.split('/').pop()?.replace('.gguf', '') ?? model;
}

function deriveQuestions(messages: Array<{ role: string; questionId: string; content: string; model: string }>): QuestionRef[] {
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
  const messages = useSessionStore((s) => s.messages);

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
            <Button
              size="sm"
              variant={contextMode === 'standard' ? 'default' : 'secondary'}
              onClick={() => toggleContextMode()}
              className="text-xs"
            >
              {contextMode === 'standard' ? 'Standard (All)' : 'Manual'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Context: {selected}/{total}
            </span>
          </div>
          {contextMode === 'manual' && (
            <div className="flex gap-1 mt-1.5">
              <Button size="sm" variant="ghost" onClick={selectAllQuestions} className="text-xs h-6 px-2">
                All
              </Button>
              <Button size="sm" variant="ghost" onClick={deselectAllQuestions} className="text-xs h-6 px-2">
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
            <div className="text-xs font-semibold text-primary mb-1">
              Q{q.number} • {shortModel(q.model)}
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
              {q.text}
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
