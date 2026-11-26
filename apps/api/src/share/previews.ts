import { DEFAULT_LOCALE, type CategoryId, type Locale } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { miniAppLink } from '../notifications/outbid';
import { renderSharePage } from './sharePage';
import { localizedAsset, shareLocale, shareText } from './shareText';
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
 *   /api/share/run   - результат соло-забега; с i= - приглашение на дуэль с этой записью
 *   /api/share/guess - «На глазок»
 * l - язык текста (ru|en|kk, по умолчанию ru): его ставит отправитель, получатель видит этот же язык.
 * Картинки: те же пути с .png. При сбое рендера - общая карточка игры с сайта (/og.png, /og.en.png…).
 */

type AppContext = Context<{ Bindings: Env }>;

const CATEGORIES: readonly CategoryId[] = ['general', 'geography', 'history', 'languages', 'kz_history'];
const MAX_NAME_LENGTH = 32;
const INVITE_ID = /^rm_[A-Za-z0-9_-]{22}$/u;
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

/** t - круги буквами PGOWX, p - прогресс, c - категория, d - день, i - приглашение, n - имя, l - язык. */
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
        locale: shareLocale(query.l),
      },
      inviteId,
    },
  };
}

/** k - номер вопроса, m - промах (×, до десятых), pc - перцентиль или best, l - язык. */
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
  return { ok: true, data: { number, multiplier: Number(query.m), percentile, locale: shareLocale(query.l) } };
}

export function runShareTitle({ card }: RunShare): string {
  const locale = card.locale ?? DEFAULT_LOCALE;
  const t = shareText(locale);
  const result = t.result(card.progress, circles(card.tiles.length, locale));
  if (card.invite) return t.inviteTitle(card.invite.name, result);
  return t.runTitle(result, t.categories[card.category]);
}

export function guessShareTitle(data: GuessCardData): string {
  const locale = data.locale ?? DEFAULT_LOCALE;
  const g = shareText(locale).guess;
  if (data.percentile === 'best') return g.titleBest(data.number);
  if (data.percentile === null) return g.titleMiss(data.number, formatMultiplierLabel(data.multiplier, locale));
  return g.titlePercentile(data.number, data.percentile);
}

function requestOrigin(c: AppContext): string {
  return new URL(c.req.url).origin;
}

const FORWARDED_HOST = /^[a-z0-9.-]+(:d{1,5})?$/iu;

/**
 * Адрес, по которому этот Worker видят снаружи: его ссылки уходят в Telegram, и тот их скачивает.
 * В dev запрос приходит через туннель (ngrok) и прокси Vite с changeOrigin, поэтому сам URL запроса -
 * 127.0.0.1:8787; настоящий хост туннеля лежит в X-Forwarded-Host. На проде заголовкам не верим:
 * адрес Worker - это адрес запроса.
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

/** Статичная карточка игры лежит на сайте (Pages); без PUBLIC_WEB_ORIGIN - рядом с API. */
function webOrigin(c: AppContext): string {
  return c.env.PUBLIC_WEB_ORIGIN?.trim().replace(/\/+$/u, '') || requestOrigin(c);
}

/** Тот же запрос, но к картинке: путь + .png, параметры как есть (уже проверены). */
function imageUrl(c: AppContext): string {
  const url = new URL(c.req.url);
  return `${publicOrigin(c)}${url.pathname}.png${url.search}`;
}

export function pageResponse(c: AppContext, locale: Locale, title: string, description: string, target: string | null): Response {
  if (!target) return text('Ссылка на приложение не настроена', 503);
  return new Response(renderSharePage({ locale, title, description, image: imageUrl(c), target }), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

function defaultCache(): Cache | undefined {
  return typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
}

/**
 * PNG из кеша или свежий рендер; при сбое - редирект на общую карточку, превью не ломается.
 * cacheControl - для карточек, чьё содержимое меняется (клан растёт), вместо вечного кеша.
 */
export async function cardResponse(
  c: AppContext,
  locale: Locale,
  svg: () => string | Promise<string>,
  cacheControl: string = CARD_CACHE_CONTROL,
): Promise<Response> {
  const cache = defaultCache();
  try {
    const hit = await cache?.match(c.req.url);
    if (hit) return hit;
  } catch {
    // кеш недоступен - рисуем заново
  }
  try {
    const { renderSvgPng } = await import('./workerRenderer');
    const response = new Response(await renderSvgPng(await svg()), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl },
    });
    try {
      const store = cache?.put(c.req.url, response.clone());
      if (store) c.executionCtx.waitUntil(store.catch(() => undefined));
    } catch {
      // нет executionCtx или кеша - ответ всё равно отдаём
    }
    return response;
  } catch (error) {
    console.error('share preview render failed', error);
    return new Response(null, {
      status: 302,
      headers: { Location: `${webOrigin(c)}${localizedAsset('/og.png', locale)}`, 'Cache-Control': 'public, max-age=300' },
    });
  }
}

/** Куда ведёт ссылка: приглашение открывает дуэль с записью (id проверен по формату), остальное - Mini App. */
export function shareTarget(env: Env, inviteId: string | null): string | null {
  const base = env.TELEGRAM_MINI_APP_LINK?.trim();
  if (!base) return null;
  return inviteId ? miniAppLink(base, inviteId) : base;
}

export function registerPreviewRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/share/run', (c) => {
    const parsed = parseRunShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    const locale = parsed.data.card.locale ?? DEFAULT_LOCALE;
    return pageResponse(c, locale, runShareTitle(parsed.data), shareText(locale).runDescription, shareTarget(c.env, parsed.data.inviteId));
  });
  app.get('/api/share/run.png', (c) => {
    const parsed = parseRunShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    return cardResponse(c, parsed.data.card.locale ?? DEFAULT_LOCALE, () => buildRunCardSvg(parsed.data.card));
  });
  app.get('/api/share/guess', (c) => {
    const parsed = parseGuessShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    const locale = parsed.data.locale ?? DEFAULT_LOCALE;
    return pageResponse(c, locale, guessShareTitle(parsed.data), shareText(locale).guess.description, shareTarget(c.env, null));
  });
  app.get('/api/share/guess.png', (c) => {
    const parsed = parseGuessShare(c.req.query());
    if (!parsed.ok) return parsed.response;
    return cardResponse(c, parsed.data.locale ?? DEFAULT_LOCALE, () => buildGuessCardSvg(parsed.data));
  });
}
