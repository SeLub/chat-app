import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function scrollToQuestion(questionId: string) {
  const el = document.querySelector(`[data-chat-question-id="${CSS.escape(questionId)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const prev = (el as HTMLElement).style.backgroundColor;
  (el as HTMLElement).style.transition = 'background-color 0.3s';
  (el as HTMLElement).style.backgroundColor = 'hsl(var(--primary) / 0.15)';
  setTimeout(() => { (el as HTMLElement).style.backgroundColor = prev; }, 2000);
}
