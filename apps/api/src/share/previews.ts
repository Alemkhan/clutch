import type { CategoryId } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { miniAppLink } from '../notifications/outbid';
import { escapeHtml } from './share';
import {
  MAX_TILES,
  buildGuessCardSvg,
  buildRunCardSvg,
  circles,
  formatMultiplierLabel,
  type GuessCardData,
  type RoundTile,
  type RunCardData,
} from './runCard';

/**
 * Превью ссылок, которыми делятся из игры: страница с og-тегами и картинкой под конкретный
 * результат, которая сразу уводит в Mini App. Все параметры проверяются строго: страница и
 * картинка рисуются только из того, что прошло проверку, а уводят только на ссылку из конфигурации.
 *
 *   /api/share/run   — результат соло-забега; с i= — приглашение на дуэль с этой записью
 *   /api/share/guess — «На глазок»
 * Картинки: те же пути с .png. При сбое рендера — общая карточка игры с сайта (/og.png).
 */

type AppContext = Context<{ Bindings: Env }>;

const CATEGORIES: readonly CategoryId[] = ['general', 'geography', 'history', 'languages', 'kz_history'];
const CATEGORY_LABEL: Record<CategoryId, string> = {
  general: 'Общие знания',
  geography: 'География',
  history: 'История',
  languages: 'Языки',
  kz_history: 'История Казахстана',
};
const MAX_NAME_LENGTH = 32;
const INVITE_ID = /^rm_[A-Za-z0-9_-]{22}$/u;
const RUN_DESCRIPTION = 'Ответь верно — получи удар молотком. Точнее удар — быстрее до 100%. Сегодня у всех один набор вопросов.';
const GUESS_DESCRIPTION = 'Вопрос дня без вариантов: угадай число. Чем меньше промах, тем выше в таблице.';
const CARD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const bad = (name: string): { ok: false; response: Response } => ({ ok: false, response: text(`Некорректный параметр ${name}`, 400) });

function parseInteger(raw: string | undefined, max: number): number | null {
  if (raw === undefined || !/^\d{1,6}$/u.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

function validDay(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return false;
  const time = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw;
}

function parseName(raw: string | undefined): Parsed<string | null> {
  if (raw === undefined) return { ok: true, data: null };
  const trimmed = raw.trim();
  if (Array.from(trimmed).length > MAX_NAME_LENGTH) return bad('n');
  return { ok: true, data: trimmed || null };
}

export interface RunShare {
  card: RunCardData;
  inviteId: string | null;
}

/** t — круги буквами PGOWX, p — прогресс, c — категория, d — день, i — приглашение, n — имя. */
export function parseRunShare(query: Record<string, string>): Parsed<RunShare> {
  const tiles = query.t;
  if (tiles === undefined || !new RegExp(`^[PGOWX]{1,${MAX_TILES}}$`, 'u').test(tiles)) return bad('t');
  const progress = parseInteger(query.p, 100);
  if (progress === null) return bad('p');
  const category = CATEGORIES.find((item) => item === query.c);
  if (!category) return bad('c');
  const day = query.d ?? null;
  if (day !== null && !validDay(day)) return bad('d');
  const inviteId = query.i ?? null;
  if (inviteId !== null && !INVITE_ID.test(inviteId)) return bad('i');
  const name = parseName(query.n);
  if (!name.ok) return name;
  return {
    ok: true,
    data: {
      card: {
        tiles: Array.from(tiles) as RoundTile[],
        progress,
        category,
        day,
        invite: inviteId ? { name: name.data } : null,
      },
      inviteId,
    },
  };
}

/** k — номер вопроса, m — промах (×, до десятых), pc — перцентиль или best. */
export function parseGuessShare(query: Record<string, string>): Parsed<GuessCardData> {
  const number = parseInteger(query.k, 99999);
  if (number === null || number < 1) return bad('k');
  if (query.m === undefined || !/^\d{1,9}(\.\d)?$/u.test(query.m) || Number(query.m) < 1) return bad('m');
  let percentile: GuessCardData['percentile'] = null;
  if (query.pc === 'best') percentile = 'best';
  else if (query.pc !== undefined) {
    percentile = parseInteger(query.pc, 100);
    if (percentile === null) return bad('pc');
  }
  return { ok: true, data: { number, multiplier: Number(query.m), percentile } };
}

export function runShareTitle({ card }: RunShare): string {
  const result = `${card.progress}% за ${circles(card.tiles.length)}`;
  if (card.invite) {
    return card.invite.name ? `${card.invite.name} зовёт на дуэль: ${result}` : `Дуэль в Clutch: обгони ${result}`;
  }
  return `${result} · ${CATEGORY_LABEL[card.category]}`;
}

export function guessShareTitle(data: GuessCardData): string {
  if (data.percentile === 'best') return `На глазок #${data.number}: лучший ответ дня`;
  if (data.percentile === null) return `На глазок #${data.number}: промах ${formatMultiplierLabel(data.multiplier)}`;
  return `На глазок #${data.number}: точнее ${data.percentile}% игроков`;
}

function requestOrigin(c: AppContext): string {
  return new URL(c.req.url).origin;
}

const FORWARDED_HOST = /^[a-z0-9.-]+(:d{1,5})?$/iu;

/**
 * Адрес, по которому этот Worker видят снаружи: его ссылки уходят в Telegram, и тот их скачивает.
 * В dev запрос приходит через туннель (ngrok) и прокси Vite с changeOrigin, поэтому сам URL запроса —
 * 127.0.0.1:8787; настоящий хост туннеля лежит в X-Forwarded-Host. На проде заголовкам не верим:
 * адрес Worker — это адрес запроса.
 */
export function publicOrigin(c: AppContext): string {
  if (c.env.ENVIRONMENT !== 'production') {
    const host = c.req.header('X-Forwarded-Host')?.split(',')[0].trim();
    const proto = c.req.header('X-Forwarded-Proto')?.split(',')[0].trim();
    if (host && FORWARDED_HOST.test(host)) return `${proto === 'http' ? 'http' : 'https'}://${host}`;
  }
  return requestOrigin(c);
}

/** Telegram скачивает превью при отправке: localhost и http он не достанет, и сообщение не уйдёт. */
export function isReachableOrigin(origin: string): boolean {
  const { protocol, hostname } = new URL(origin);
  return protocol === 'https:'
    && hostname !== 'localhost'
    && !hostname.endsWith('.localhost')
    && !/^(127.|10.|192.168.|172.(1[6-9]|2d|3[01]).|0.)/u.test(hostname)
    && hostname !== '[::1]';
}

/** Статичная карточка игры лежит на сайте (Pages); без PUBLIC_WEB_ORIGIN — рядом с API. */
function webOrigin(c: AppContext): string {
  return c.env.PUBLIC_WEB_ORIGIN?.trim().replace(/\/+$/u, '') || requestOrigin(c);
}

/** Тот же запрос, но к картинке: путь + .png, параметры как есть (уже проверены). */
function imageUrl(c: AppContext): string {
  const url = new URL(c.req.url);
  return `${publicOrigin(c)}${url.pathname}.png${url.search}`;
}

function renderPage(title: string, description: string, image: string, target: string): string {
  const safeTitle = escapeHtml(title);
  const href = escapeHtml(target);
  const scriptTarget = JSON.stringify(target).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Clutch">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
</head>
<body style="margin:0;padding:32px 16px;font-family:system-ui,sans-serif;text-align:center;background:#f3f0e8;color:#171716">
<img src="${escapeHtml(image)}" alt="" width="600" height="315" style="max-width:100%;height:auto;border-radius:16px">
<h1 style="font-size:24px">${safeTitle}</h1>
<p><a href="${href}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#f04a3e;color:#fff;font-weight:700;text-decoration:none">Открыть в Telegram</a></p>
<script>window.location.replace(${scriptTarget});</script>
</body>
</html>`;
}

function pageResponse(c: AppContext, title: string, description: string, target: string | null): Response {
  if (!target) return text('Ссылка на приложение не настроена', 503);
  return new Response(renderPage(title, description, imageUrl(c), target), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

function defaultCache(): Cache | undefined {
  return typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
}

/** PNG из кеша или свежий рендер; при сбое — редирект на общую карточку, превью не ломается. */
async function cardResponse(c: AppContext, svg: () => string): Promise<Response> {
  const cache = defaultCache();
  try {
    const hit = await cache?.match(c.req.url);
    if (hit) return hit;
  } catch {
    // кеш недоступен — рисуем заново
  }
  try {
    const { renderSvgPng } = await import('./workerRenderer');
    const response = new Response(await renderSvgPng(svg()), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': CARD_CACHE_CONTROL },
    });
    try {
      const store = cache?.put(c.req.url, response.clone());
      if (store) c.executionCtx.waitUntil(store.catch(() => undefined));
    } catch {
      // нет executionCtx или кеша — ответ всё равно отдаём
    }
    return response;
  } catch (error) {
    console.error('share preview render failed', error);
    return new Response(null, {
      status: 302,
      headers: { Location: `${webOrigin(c)}/og.png`, 'Cache-Control': 'public, max-age=300' },
    });
  }
}

/** Куда ведёт ссылка: приглашение открывает дуэль с записью (id проверен по формату), остальное — Mini App. */
export function shareTarget(env: Env, inviteId: string | null): string | null {
  const base = env.TELEGRAM_MINI_APP_LINK?.trim();
  if (!base) return null;
  return inviteId ? miniAppLink(base, inviteId) : base;
}

export function registerPreviewRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/share/run', (c) => {
    const parsed = parseRunShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    return pageResponse(c, runShareTitle(parsed.data), RUN_DESCRIPTION, shareTarget(c.env, parsed.data.inviteId));
  });
  app.get('/api/share/run.png', (c) => {
    const parsed = parseRunShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    return cardResponse(c, () => buildRunCardSvg(parsed.data.card));
  });
  app.get('/api/share/guess', (c) => {
    const parsed = parseGuessShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    return pageResponse(c, guessShareTitle(parsed.data), GUESS_DESCRIPTION, shareTarget(c.env, null));
  });
  app.get('/api/share/guess.png', (c) => {
    const parsed = parseGuessShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    return cardResponse(c, () => buildGuessCardSvg(parsed.data));
  });
}
