import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('preloadImages', () => {
  const created: { src: string; onerror: (() => void) | null }[] = [];
  beforeEach(() => {
    vi.resetModules();
    created.length = 0;
    vi.stubGlobal('Image', class { src = ''; decoding = ''; onerror: (() => void) | null = null; constructor() { created.push(this); } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests each url once', async () => {
    const { preloadImages } = await import('./preloadImages');
    preloadImages(['/a.png', '/b.png']);
    preloadImages(['/a.png']);
    expect(created.map((i) => i.src)).toEqual(['/a.png', '/b.png']);
  });

  it('allows a retry after a load error', async () => {
    const { preloadImages } = await import('./preloadImages');
    preloadImages(['/a.png']);
    created[0].onerror?.();
    preloadImages(['/a.png']);
    expect(created).toHaveLength(2);
  });

  it('does nothing without Image support', async () => {
    vi.stubGlobal('Image', undefined);
    const { preloadImages } = await import('./preloadImages');
    expect(() => preloadImages(['/a.png'])).not.toThrow();
  });
});
