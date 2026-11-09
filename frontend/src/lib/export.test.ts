import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadJson } from './export';

describe('downloadJson', () => {
  let createdAnchors: HTMLAnchorElement[];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup() {
    createdAnchors = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = originalCreate('a');
        createdAnchors.push(a);
        return a;
      }
      throw new Error(`unexpected tag ${tag}`);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  it('creates a JSON blob and clicks an anchor with the given filename', () => {
    setup();

    downloadJson({ a: 1 }, 'test.json');

    expect(createdAnchors).toHaveLength(1);
    const a = createdAnchors[0];
    expect(a.download).toBe('test.json');
    expect(a.href).toBe('blob:fake-url');
  });

  it('revokes the object URL after clicking', () => {
    setup();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    downloadJson([1, 2, 3], 'bulk.json');

    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-url');
  });

  it('serializes data as pretty JSON in the blob', async () => {
    setup();
    const blobSpy = vi.spyOn(window, 'Blob');

    downloadJson({ x: [1, 2] }, 'data.json');

    expect(blobSpy).toHaveBeenCalledWith(
      [JSON.stringify({ x: [1, 2] }, null, 2)],
      { type: 'application/json' },
    );
  });
});
