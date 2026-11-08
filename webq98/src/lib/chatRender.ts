import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';

// Единственное место конфигурации markdown-пайплайна чата.
// remark-breaks: LLM пишут одиночные \n, CommonMark их не ломает (решение 73).
export const remarkPlugins = [remarkGfm, remarkBreaks];

// rehype-highlight без ignoreMissing: незнакомые языки не бросают исключение —
// плагин пишет vfile-сообщение 'missing-language' и оставляет код как есть.
export const rehypePlugins = [rehypeHighlight];
