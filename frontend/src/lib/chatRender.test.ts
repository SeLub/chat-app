import { describe, it, expect } from 'vitest';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { remarkPlugins, rehypePlugins } from './chatRender';

describe('chatRender pipeline', () => {
  it('remarkPlugins contains remarkGfm and remarkBreaks', () => {
    expect(remarkPlugins).toContain(remarkGfm);
    expect(remarkPlugins).toContain(remarkBreaks);
  });

  it('rehypePlugins is non-empty (rehype-highlight)', () => {
    expect(rehypePlugins.length).toBeGreaterThan(0);
  });
});
