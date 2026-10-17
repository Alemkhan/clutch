/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import app from '../apps/api/src/index';
import { CYRILLIC_FAMILY, createSvgRenderer, renameFamily } from '../apps/api/src/share/renderCard';
import { buildBrandCardSvg, buildGuessCardSvg, buildRunCardSvg } from '../apps/api/src/share/runCard';
import { INTER_FONTS } from '../apps/api/src/share/interFonts';

const renderMock = vi.hoisted(() => vi.fn());
vi.mock('../apps/api/src/share/workerRenderer', () => ({ renderSvgPng: renderMock, renderShareCardPng: vi.fn() }));

const LINK = 'https://t.me/playclutchbot?startapp';
const INVITE = 'rm_AbCdEfGhIjKlMnOpQrStUv';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function env(extra: Record<string, string> = {}) {
  return {
    DB: {} as D1Database,
    API_RATE_LIMITER: {} as RateLimit,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: 'test-session-signing-secret-at-least-32-characters',
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: LINK,
    ...extra,
  };
}

async function get(path: string, extra?: Record<string, string>) {
  const response = await app.request(`https://api.example${path}`, {}, env(extra));
  return { response, body: response.headers.get('content-type')?.includes('png') ? '' : await response.text() };
}

describe('GET /api/share/run', () => {
  it('describes the run and points the image at the same worker', async () => {
    const { response, body } = await get('/api/share/run?t=PPOPP&p=100&c=general&d=2026-10-17');
    expect(response.status).toBe(200);
    expect(body).toContain('<meta property="og:title" content="100% за 5 кругов · Общие знания">');
    expect(body).toContain('<meta property="og:image" content="https://api.example/api/share/run.png?t=PPOPP&amp;p=100&amp;c=general&amp;d=2026-10-17">');
    expect(body).toContain(`window.location.replace("${LINK}")`);
  });

  it('turns an invite into a duel card that opens that invite', async () => {
    const { body } = await get(`/api/share/run?t=PGP&p=100&c=history&i=${INVITE}&n=${encodeURIComponent('Қайрат')}`);
    expect(body).toContain('<title>Қайрат зовёт на дуэль: 100% за 3 круга</title>');
    expect(body).toContain(`window.location.replace("${LINK}=${INVITE}")`);
  });

  it('escapes the name', async () => {
    const { body } = await get(`/api/share/run?t=P&p=25&c=general&i=${INVITE}&n=${encodeURIComponent('<b>"&')}`);
    expect(body).toContain('&lt;b&gt;&quot;&amp; зовёт на дуэль');
    expect(body).not.toContain('<b>');
  });

  it.each([
    '?p=100&c=general',
    '?t=PPZ&p=100&c=general',
    `?t=${'P'.repeat(21)}&p=100&c=general`,
    '?t=P&p=101&c=general',
    '?t=P&p=1.5&c=general',
    '?t=P&p=25&c=music',
    '?t=P&p=25&c=general&d=2026-02-30',
    '?t=P&p=25&c=general&i=https://evil.example',
    `?t=P&p=25&c=general&i=${INVITE}&n=${'x'.repeat(33)}`,
  ])('rejects %s', async (query) => {
    const { response, body } = await get(`/api/share/run${query}`);
    expect(response.status).toBe(400);
    expect(body).not.toContain('<');
  });

  it('needs the configured mini app link', async () => {
    const { response } = await get('/api/share/run?t=P&p=25&c=general', { TELEGRAM_MINI_APP_LINK: '' });
    expect(response.status).toBe(503);
  });
});

describe('GET /api/share/guess', () => {
  it.each([
    ['?k=12&m=1.3&pc=84', 'На глазок #12: точнее 84% игроков'],
    ['?k=12&m=1&pc=best', 'На глазок #12: лучший ответ дня'],
    ['?k=12&m=2.5', 'На глазок #12: промах ×2,5'],
  ])('titles %s', async (query, title) => {
    const { body } = await get(`/api/share/guess${query}`);
    expect(body).toContain(`<title>${title}</title>`);
    expect(body).toContain(`content="https://api.example/api/share/guess.png${query.replace(/&/g, '&amp;')}"`);
  });

  it.each(['?m=1.3', '?k=0&m=1.3', '?k=12&m=0.5', '?k=12&m=1.25', '?k=12&m=2&pc=101', '?k=12&m=2&pc=top'])('rejects %s', async (query) => {
    expect((await get(`/api/share/guess${query}`)).response.status).toBe(400);
  });
});

describe('preview images', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  it('renders a cacheable PNG of the run card', async () => {
    renderMock.mockReset();
    renderMock.mockResolvedValue(PNG);
    const { response } = await get('/api/share/run.png?t=PX&p=25&c=general');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(renderMock.mock.calls[0][0]).toContain('<svg');
  });

  it('falls back to the site card when rendering fails', async () => {
    renderMock.mockReset();
    renderMock.mockRejectedValue(new Error('wasm failed'));
    const { response } = await get('/api/share/guess.png?k=3&m=4', { PUBLIC_WEB_ORIGIN: 'https://clutch.example/' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://clutch.example/og.png');
  });

  it('does not render invalid parameters', async () => {
    renderMock.mockReset();
    expect((await get('/api/share/run.png?t=P&p=200&c=general')).response.status).toBe(400);
    expect(renderMock).not.toHaveBeenCalled();
  });
});

describe('preview cards (real resvg)', () => {
  const require = createRequire(import.meta.url);
  const render = createSvgRenderer(async () => readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const size = (png: Uint8Array) => {
    const view = new DataView(png.buffer, png.byteOffset);
    return [view.getUint32(16), view.getUint32(20)];
  };

  it('draws every card at 1200x630', async () => {
    const cards = [
      buildRunCardSvg({ tiles: ['P', 'P', 'O', 'P', 'P'], progress: 100, category: 'general', day: '2026-10-17', invite: null }),
      buildRunCardSvg({ tiles: Array(20).fill('X'), progress: 0, category: 'languages', day: null, invite: { name: '😀 Очень-длинное-имя-соперника' } }),
      buildGuessCardSvg({ number: 12, multiplier: 1.3, percentile: 84 }),
      buildGuessCardSvg({ number: 9999, multiplier: 1e9, percentile: null }),
      buildBrandCardSvg(),
    ];
    for (const svg of cards) expect(size(await render(svg))).toEqual([1200, 630]);
  });

  it('gives Cyrillic its own family so bold headlines keep one weight', () => {
    const svg = buildRunCardSvg({ tiles: ['P'], progress: 25, category: 'general', day: null, invite: null });
    expect(svg).toContain(`<tspan font-family="${CYRILLIC_FAMILY} Black">Мой</tspan>`);
    expect(svg).toContain('<tspan font-family="Inter Black">25%</tspan>');
    const font = Uint8Array.from(atob(INTER_FONTS[1]), (char) => char.charCodeAt(0));
    const renamed = new TextDecoder('utf-16be').decode(renameFamily(font));
    expect(renamed).toContain(CYRILLIC_FAMILY);
  });
});
