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

// Один рендерер на файл: resvg инициализируется один раз на процесс.
const render = createSvgRenderer(async () => readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));

describe('preview cards (real resvg)', () => {
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

describe('POST /api/share/prepared', () => {
  it('builds the message from the validated preview only, on this worker', async () => {
    const { preparedMessageFor, preparedInlineMessageBody } = await import('../apps/api/src/share/prepared');
    const message = preparedMessageFor(
      `https://evil.example/api/share/run?t=PPOPP&p=100&c=general&i=${INVITE}&n=Alex&to=https://evil.example`,
      'https://api.example',
      env() as never,
    );
    expect(message).toEqual({
      previewUrl: `https://api.example/api/share/run?t=PPOPP&p=100&c=general&i=${INVITE}&n=Alex`,
      title: 'Alex зовёт на дуэль: 100% за 5 кругов',
      text: 'Alex зовёт на дуэль: 100% за 5 кругов\nОбгонишь эту запись?',
      button: 'Играть в Clutch',
      target: `${LINK}=${INVITE}`,
    });
    const body = preparedInlineMessageBody('42', message!) as { user_id: number; result: Record<string, unknown> };
    expect(body.user_id).toBe(42);
    expect(body.result).toMatchObject({
      type: 'article',
      input_message_content: { link_preview_options: { url: message!.previewUrl, prefer_large_media: true, show_above_text: true } },
      reply_markup: { inline_keyboard: [[{ text: 'Играть в Clutch', url: `${LINK}=${INVITE}` }]] },
    });
    expect(JSON.stringify(body)).not.toContain('parse_mode');
  });

  it.each([
    'https://api.example/api/share?o=win&p=1&q=0',
    'https://api.example/api/share/run?t=P&p=500&c=general',
    'not a url',
    42,
  ])('refuses %s', async (url) => {
    const { preparedMessageFor } = await import('../apps/api/src/share/prepared');
    expect(preparedMessageFor(url, 'https://api.example', env() as never)).toBeNull();
  });

  it('requires a signed-in player', async () => {
    const response = await app.request('https://api.example/api/share/prepared', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://api.example/api/share/guess?k=1&m=2' }),
    }, env());
    expect(response.status).toBe(401);
  });
});

describe('public origin behind a tunnel', () => {
  const tunnel = { 'X-Forwarded-Host': 'depose-payday-puppy.ngrok-free.dev', 'X-Forwarded-Proto': 'https' };

  async function page(environment: string) {
    const response = await app.request('http://127.0.0.1:8787/api/share/guess?k=1&m=2', { headers: tunnel }, env({ ENVIRONMENT: environment }));
    return response.text();
  }

  it('points the image at the tunnel in development', async () => {
    expect(await page('development')).toContain('content="https://depose-payday-puppy.ngrok-free.dev/api/share/guess.png?k=1&amp;m=2"');
  });

  it('ignores forwarded headers in production', async () => {
    expect(await page('production')).toContain('content="http://127.0.0.1:8787/api/share/guess.png?k=1&amp;m=2"');
  });

  it('knows which origins Telegram can fetch', async () => {
    const { isReachableOrigin } = await import('../apps/api/src/share/previews');
    expect(isReachableOrigin('https://depose-payday-puppy.ngrok-free.dev')).toBe(true);
    expect(isReachableOrigin('https://clutch-api.example.workers.dev')).toBe(true);
    for (const origin of ['http://127.0.0.1:8787', 'https://localhost:8787', 'http://example.com', 'https://192.168.1.5', 'https://10.0.0.2']) {
      expect(isReachableOrigin(origin)).toBe(false);
    }
  });
});

describe('localized previews (l=ru|en|kk)', () => {
  const plain = (svg: string) => svg.replace(/<[^>]+>/gu, '');

  it.each([
    ['en', '100% in 5 rounds · General knowledge', 'Open in Telegram'],
    ['kk', '5 айналым ішінде 100% · Жалпы білім', 'Telegram-да ашу'],
    ['ru', '100% за 5 кругов · Общие знания', 'Открыть в Telegram'],
  ])('titles the run page in %s', async (locale, title, button) => {
    const { body } = await get(`/api/share/run?t=PPOPP&p=100&c=general&d=2026-11-16&l=${locale}`);
    expect(body).toContain(`<html lang="${locale}">`);
    expect(body).toContain(`<title>${title}</title>`);
    expect(body).toContain(button);
    expect(body).toContain(`run.png?t=PPOPP&amp;p=100&amp;c=general&amp;d=2026-11-16&amp;l=${locale}"`);
  });

  it('falls back to Russian for an unknown language', async () => {
    const { response, body } = await get('/api/share/run?t=P&p=25&c=general&l=de');
    expect(response.status).toBe(200);
    expect(body).toContain('<html lang="ru">');
    expect(body).toContain('25% за 1 круг · Общие знания');
  });

  it('uses the plural forms of each language', async () => {
    const title = async (tiles: string, locale: string) => {
      const { body } = await get(`/api/share/run?t=${tiles}&p=50&c=geography&l=${locale}`);
      return body.slice(body.indexOf('<title>') + 7, body.indexOf('</title>'));
    };
    expect(await title('PP', 'ru')).toBe('50% за 2 круга · География');
    expect(await title('P'.repeat(11), 'ru')).toBe('50% за 11 кругов · География');
    expect(await title('P', 'en')).toBe('50% in 1 round · Geography');
    expect(await title('PP', 'en')).toBe('50% in 2 rounds · Geography');
    expect(await title('PP', 'kk')).toBe('2 айналым ішінде 50% · География');
  });

  it('localizes the duel invite', async () => {
    expect((await get(`/api/share/run?t=PGP&p=100&c=history&i=${INVITE}&n=Alex&l=en`)).body)
      .toContain('<title>Alex challenges you to a duel: 100% in 3 rounds</title>');
    expect((await get(`/api/share/run?t=PGP&p=100&c=history&i=${INVITE}&n=Alex&l=kk`)).body)
      .toContain('<title>Alex дуэльге шақырады: 3 айналым ішінде 100%</title>');
  });

  it.each([
    ['en', '?k=12&m=2.5', 'Guesstimate #12: miss ×2.5'],
    ['en', '?k=12&m=1.3&pc=84', 'Guesstimate #12: closer than 84% of players'],
    ['kk', '?k=12&m=2.5', 'Көзмөлшер #12: қателік ×2,5'],
    ['kk', '?k=12&m=1&pc=best', 'Көзмөлшер #12: күннің ең үздік жауабы'],
  ])('titles the guess page in %s for %s', async (locale, query, title) => {
    expect((await get(`/api/share/guess${query}&l=${locale}`)).body).toContain(`<title>${title}</title>`);
  });

  it('styles the page with the game palette, not the old beige and red', async () => {
    const { body } = await get('/api/share/run?t=P&p=25&c=general&l=en');
    expect(body).toContain('#2b2270');
    expect(body).toContain('background:#ffc94d');
    expect(body).toContain('box-shadow:0 6px 0 #e39a26');
    expect(body).not.toMatch(/#f3f0e8|#f04a3e|#171716/iu);
  });

  it('falls back to the localized site card when rendering fails', async () => {
    renderMock.mockReset();
    renderMock.mockRejectedValue(new Error('wasm failed'));
    const location = async (query: string) => (await get(`/api/share/run.png${query}`, { PUBLIC_WEB_ORIGIN: 'https://clutch.example' })).response.headers.get('location');
    expect(await location('?t=P&p=25&c=general&l=en')).toBe('https://clutch.example/og.en.png');
    expect(await location('?t=P&p=25&c=general&l=kk')).toBe('https://clutch.example/og.kk.png');
    expect(await location('?t=P&p=25&c=general&l=ru')).toBe('https://clutch.example/og.png');
  });

  it('draws the run card text in the requested language with the day number', () => {
    const card = (locale: 'ru' | 'en' | 'kk', progress = 100) => plain(buildRunCardSvg({ tiles: ['P', 'G', 'X'], progress, category: 'kz_history', day: '2026-11-16', invite: null, locale }));
    const ru = card('ru');
    for (const value of ['Мой результат дня', 'за 3 круга', 'Clutch #29 · 16 ноя', 'История Казахстана', 'Сможешь быстрее?', 'Играть в Telegram', 'Круг — верный ответ и удар молотком']) {
      expect(ru).toContain(value);
    }
    expect(card('ru', 60)).toContain('Дойдёшь до 100%?');
    const en = card('en');
    for (const value of ['My result today', 'in 3 rounds', 'Clutch #29 · Nov 16', 'History of Kazakhstan', 'Can you do it faster?', 'Play in Telegram']) {
      expect(en).toContain(value);
    }
    expect(card('en', 60)).toContain('Can you reach 100%?');
    const kk = card('kk');
    for (const value of ['Менің бүгінгі нәтижем', '3 айналым ішінде', 'Clutch #29 · 16 қараша', 'Қазақстан тарихы', 'Жылдамырақ өте аласың ба?', 'Telegram-да ойна']) {
      expect(kk).toContain(value);
    }
    expect(card('kk', 60)).toContain('100%-ға жете аласың ба?');
  });

  it('omits the day number before day 1 and without a day', () => {
    const card = (day: string | null) => plain(buildRunCardSvg({ tiles: ['P'], progress: 25, category: 'general', day, invite: null }));
    expect(card('2026-10-17')).not.toContain('Clutch #');
    expect(card('2026-10-19')).toContain('Clutch #1 · 19 окт');
    expect(card(null)).not.toContain('Clutch #');
  });

  it('paints round tiles in the mini-game zone colours on the dark background', () => {
    const svg = buildRunCardSvg({ tiles: ['P', 'G', 'O', 'W', 'X'], progress: 60, category: 'general', day: null, invite: null });
    expect(svg).toContain('stop-color="#2b2270"');
    expect(svg).toContain('stop-color="#160f3e"');
    for (const colour of ['#ffc94d', '#3ccf8e', '#7a5cf0', '#43378f', '#2a1b5c', '#e39a26', '#5f33dd']) expect(svg).toContain(colour);
    expect(svg).toContain('stroke-opacity="0.18"');
    expect(svg).not.toMatch(/#f3f0e8|#f04a3e|#171716/iu);
  });

  it('keeps Kazakh letters in the Cyrillic family', () => {
    const svg = buildRunCardSvg({ tiles: ['P'], progress: 25, category: 'general', day: null, invite: null, locale: 'kk' });
    expect(svg).toContain(`<tspan font-family="${CYRILLIC_FAMILY} Black">Менің</tspan>`);
    expect(svg).toContain(`<tspan font-family="${CYRILLIC_FAMILY} Black">бүгінгі</tspan>`);
  });

  it('localizes the guess and brand cards', () => {
    expect(plain(buildGuessCardSvg({ number: 12, multiplier: 2.5, percentile: null, locale: 'en' }))).toContain('miss ×2.5');
    expect(plain(buildGuessCardSvg({ number: 12, multiplier: 2.5, percentile: 84, locale: 'kk' }))).toContain('Көзмөлшер #12');
    expect(plain(buildBrandCardSvg('en'))).toContain('Hit the center.');
    expect(plain(buildBrandCardSvg('kk'))).toContain('Ортаға дәл тигіз.');
  });

  it('writes the prepared Telegram message in the language of the link', async () => {
    const { preparedMessageFor, preparedInlineMessageBody } = await import('../apps/api/src/share/prepared');
    const en = preparedMessageFor('https://x.example/api/share/run?t=PP&p=40&c=general&l=en', 'https://api.example', env() as never);
    expect(en).toMatchObject({
      previewUrl: 'https://api.example/api/share/run?t=PP&p=40&c=general&l=en',
      text: ['40% in 2 rounds · General knowledge', 'Can you reach 100%?'].join('\n'),
      button: 'Play Clutch',
    });
    const kk = preparedMessageFor('https://x.example/api/share/guess?k=3&m=2&l=kk', 'https://api.example', env() as never);
    expect(kk).toMatchObject({ text: ['Көзмөлшер #3: қателік ×2,0', 'Дәлірек табасың ба?'].join('\n'), button: 'Clutch ойнау' });
    const body = preparedInlineMessageBody('7', kk!) as { result: { reply_markup: unknown } };
    expect(body.result.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Clutch ойнау', url: LINK }]] });
  });

  it.each(['ru', 'en', 'kk'] as const)('renders the %s run card with real resvg', async (locale) => {
    const png = await render(buildRunCardSvg({ tiles: ['P', 'G', 'O', 'W', 'X'], progress: 100, category: 'kz_history', day: '2026-11-16', invite: { name: 'Әйгерім' }, locale }));
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
  });
});
