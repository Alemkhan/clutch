/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it, vi } from 'vitest';
import app from '../apps/api/src/index';

const renderMock = vi.hoisted(() => vi.fn());
vi.mock('../apps/api/src/share/workerRenderer', () => ({ renderShareCardPng: renderMock }));

const LINK = 'https://t.me/playclutchbot?startapp';

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

async function get(query: string, extra?: Record<string, string>) {
  const response = await app.request(`https://web.example/api/share${query}`, {}, env(extra));
  return { response, body: await response.text() };
}

describe('GET /api/share', () => {
  it.each([
    ['win', 'Обыграл Rakhat: 100% против 73%'],
    ['loss', 'Уступил Rakhat: 100% против 73%'],
    ['tie', 'Ничья с Rakhat: 100:73'],
  ])('renders the %s card with all tags', async (outcome, title) => {
    const { response, body } = await get(`?o=${outcome}&p=100&q=73&n=Rakhat`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<html lang="ru">');
    expect(body).toContain(`<title>${title}</title>`);
    expect(body).toContain(`<meta property="og:title" content="${title}">`);
    expect(body).toContain('<meta property="og:type" content="website">');
    expect(body).toContain('<meta property="og:site_name" content="Clutch">');
    expect(body).toContain(
      '<meta property="og:description" content="Ответь верно — получи попытку. Забей точнее — выиграй матч. Сегодня у всех один набор вопросов.">',
    );
    expect(body).toContain(`<meta property="og:image" content="https://web.example/api/share/card.png?o=${outcome}&amp;p=100&amp;q=73&amp;n=Rakhat">`);
    expect(body).toContain('<meta property="og:image:width" content="1200">');
    expect(body).toContain('<meta property="og:image:height" content="630">');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain('<meta name="description"');
    expect(body).toContain('Открыть в Telegram');
    expect(body).toContain(`window.location.replace("${LINK}")`);
    expect(body).not.toContain('http-equiv="refresh"');
  });

  it('uses nameless titles when n is absent', async () => {
    expect((await get('?o=win&p=60&q=40')).body).toContain('<title>Мой результат: 60% против 40%</title>');
    expect((await get('?o=loss&p=40&q=60')).body).toContain('<title>Мой результат: 40% против 60%</title>');
    expect((await get('?o=tie&p=50&q=50')).body).toContain('<title>Ничья: 50:50</title>');
  });

  it('escapes HTML in the name', async () => {
    const name = encodeURIComponent(`<b>"&'`);
    const { response, body } = await get(`?o=win&p=1&q=0&n=${name}`);
    expect(response.status).toBe(200);
    expect(body).toContain('Обыграл &lt;b&gt;&quot;&amp;&#39;: 1% против 0%');
    expect(body).not.toContain('<b>');
  });

  it('uses PUBLIC_WEB_ORIGIN for the image when configured', async () => {
    const { body } = await get('?o=win&p=1&q=0', { PUBLIC_WEB_ORIGIN: 'https://cdn.example/' });
    expect(body).toContain('content="https://cdn.example/api/share/card.png?o=win&amp;p=1&amp;q=0"');
  });

  it('redirects only to the configured link, never to a query value', async () => {
    const { body } = await get(`?o=win&p=1&q=0&to=${encodeURIComponent('https://evil.example')}&url=https://evil.example`);
    expect(body).not.toContain('evil.example');
    expect(body).toContain(LINK);
  });

  it.each([
    '',
    '?o=win&p=1',
    '?o=draw&p=1&q=1',
    '?o=win&p=101&q=1',
    '?o=win&p=-1&q=1',
    '?o=win&p=1.5&q=1',
    '?o=win&p=abc&q=1',
    '?o=win&p=1&q=',
    `?o=win&p=1&q=1&n=${'x'.repeat(33)}`,
  ])('returns 400 without HTML for %s', async (query) => {
    const { response, body } = await get(query);
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).not.toContain('<');
  });

  it('accepts a 32 character name', async () => {
    expect((await get(`?o=win&p=1&q=1&n=${'x'.repeat(32)}`)).response.status).toBe(200);
  });
});

describe('GET /api/share/card.png', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  async function card(query: string, extra?: Record<string, string>) {
    return app.request(`https://web.example/api/share/card.png${query}`, {}, env(extra));
  }

  it.each(['win', 'loss', 'tie'])('renders a cacheable PNG for %s', async (outcome) => {
    renderMock.mockReset();
    renderMock.mockResolvedValue(PNG);
    const response = await card(`?o=${outcome}&p=100&q=73&n=Alex`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(renderMock).toHaveBeenCalledWith({ outcome, p: 100, q: 73, name: 'Alex' });
  });

  it('passes a null name when n is absent or blank', async () => {
    renderMock.mockReset();
    renderMock.mockResolvedValue(PNG);
    await card('?o=win&p=1&q=0');
    await card('?o=win&p=1&q=0&n=%20');
    expect(renderMock.mock.calls.map((call) => call[0].name)).toEqual([null, null]);
  });

  it.each([
    '',
    '?o=win&p=1',
    '?o=draw&p=1&q=1',
    '?o=win&p=101&q=1',
    '?o=win&p=1.5&q=1',
    '?o=win&p=1&q=',
    `?o=win&p=1&q=1&n=${'x'.repeat(33)}`,
  ])('returns 400 without rendering for %s', async (query) => {
    renderMock.mockReset();
    const response = await card(query);
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('falls back to the static image when rendering fails', async () => {
    renderMock.mockReset();
    renderMock.mockRejectedValue(new Error('font failed'));
    const response = await card('?o=loss&p=40&q=60&n=Alex');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://web.example/share/loss.png');
    expect(response.headers.get('cache-control')).not.toContain('immutable');
  });

  it('falls back using PUBLIC_WEB_ORIGIN when configured', async () => {
    renderMock.mockReset();
    renderMock.mockRejectedValue(new Error('wasm failed'));
    const response = await card('?o=tie&p=5&q=5', { PUBLIC_WEB_ORIGIN: 'https://cdn.example/' });
    expect(response.headers.get('location')).toBe('https://cdn.example/share/tie.png');
  });
});
