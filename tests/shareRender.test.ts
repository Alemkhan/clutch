/// <reference types="node" />

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildShareCardSvg, displayName } from '../apps/api/src/share/cardLayout';
import { createCardRenderer } from '../apps/api/src/share/renderCard';

const require = createRequire(import.meta.url);
const render = createCardRenderer(async () => readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

function size(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('share card renderer (real resvg)', () => {
  it.each(['win', 'loss', 'tie'] as const)('draws a 1200x630 PNG for %s', async (outcome) => {
    const started = performance.now();
    const png = await render({ outcome, p: 100, q: 73, name: 'Алексей Қазақ' });
    console.info(`share card ${outcome}: ${Math.round(performance.now() - started)} ms, ${png.length} bytes`);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(size(png)).toEqual({ width: 1200, height: 630 });
    if (process.env.SHARE_CARD_DUMP) writeFileSync(`${process.env.SHARE_CARD_DUMP}/${outcome}.png`, png);
  });

  it('renders long and unusual names without failing', async () => {
    const names = ['W'.repeat(32), 'Очень-длинное-имя-соперника-123', null, '😀 emoji'];
    for (const name of names) {
      const png = await render({ outcome: 'win', p: 0, q: 100, name });
      expect(size(png)).toEqual({ width: 1200, height: 630 });
      if (process.env.SHARE_CARD_DUMP) writeFileSync(`${process.env.SHARE_CARD_DUMP}/name-${String(name).length}.png`, png);
    }
  });

  it('escapes the name in the SVG', () => {
    const svg = buildShareCardSvg({ outcome: 'win', p: 1, q: 2, name: '<b>"&' });
    expect(svg).toContain('&lt;b&gt;&quot;&amp;');
    expect(svg).not.toContain('<b>');
  });

  it('truncates the drawn name and falls back to a default', () => {
    expect(displayName('Alex')).toBe('Alex');
    expect(displayName('x'.repeat(32))).toBe(`${'x'.repeat(13)}…`);
    expect(displayName(null)).toBe('Соперник');
    expect(displayName('   ')).toBe('Соперник');
    expect(displayName('😀 Jörg 日本')).toBe('Jörg');
    expect(displayName('😀')).toBe('Соперник');
  });
});
