import { DEFAULT_LOCALE, type Locale } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type { ShareCardData, ShareOutcome } from './cardLayout';
import { escapeHtml, renderSharePage } from './sharePage';
import { localizedAsset, shareLocale, shareText } from './shareText';

export { escapeHtml };

type Outcome = ShareOutcome;

const OUTCOMES: readonly Outcome[] = ['win', 'loss', 'tie'];
const MAX_NAME_LENGTH = 32;

function parseProgress(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= 100 ? value : null;
}

/** Заголовок превью матча на языке отправителя (l); без языка - русский. */
export function shareTitle(outcome: Outcome, p: number, q: number, name: string | null, locale: Locale = DEFAULT_LOCALE): string {
  return shareText(locale).outcome.title(outcome, p, q, name);
}

function resolveOrigin(configured: string | undefined, requestUrl: string): string {
  const value = configured?.trim();
  if (value) return value.replace(/\/+$/, '');
  return new URL(requestUrl).origin;
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

type ParsedShare = { ok: true; data: ShareCardData } | { ok: false; response: Response };

/** Общий разбор и проверка параметров для страницы шаринга и картинки; l - язык (ru|en|kk). */
function parseShareQuery(query: Record<string, string>): ParsedShare {
  const outcome = OUTCOMES.find((item) => item === query.o);
  const p = parseProgress(query.p);
  const q = parseProgress(query.q);
  if (!outcome) return { ok: false, response: text('Некорректный параметр o', 400) };
  if (p === null) return { ok: false, response: text('Некорректный параметр p', 400) };
  if (q === null) return { ok: false, response: text('Некорректный параметр q', 400) };

  let name: string | null = null;
  if (query.n !== undefined) {
    const trimmed = query.n.trim();
    if (Array.from(trimmed).length > MAX_NAME_LENGTH) {
      return { ok: false, response: text('Некорректный параметр n', 400) };
    }
    name = trimmed || null;
  }
  return { ok: true, data: { outcome, p, q, name, locale: shareLocale(query.l) } };
}

const CARD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function registerShareRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/share/card.png', handleShareCard);
  app.get('/api/share', handleSharePage);
}

type AppContext = Context<{ Bindings: Env }>;

function defaultCache(): Cache | undefined {
  return typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
}

/** Кладёт отрисованную картинку в кеш после ответа; без кеша или executionCtx ответ всё равно отдаётся. */
function storeInCache(c: AppContext, cache: Cache | undefined, response: Response): void {
  try {
    const store = cache?.put(c.req.url, response.clone());
    if (store) c.executionCtx.waitUntil(store.catch(() => undefined));
  } catch {
    // нет executionCtx или кеша - ответ всё равно отдаём
  }
}

async function handleShareCard(c: AppContext): Promise<Response> {
  const parsed = parseShareQuery(c.req.query());
  if (!parsed.ok) return parsed.response;
  const { data } = parsed;

  // Cache API: повторные обращения Телеграма не перерисовывают картинку.
  const cache = defaultCache();
  try {
    const hit = await cache?.match(c.req.url);
    if (hit) return hit;
  } catch {
    // кеш недоступен - рисуем заново
  }

  try {
    const { renderShareCardPng } = await import('./workerRenderer');
    const png = await renderShareCardPng(data);
    const response = new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': CARD_CACHE_CONTROL },
    });
    storeInCache(c, cache, response);
    return response;
  } catch (error) {
    console.error('share card render failed', error);
    // Сбой шрифта или рендера: откат на статичную картинку, превью не ломается.
    const origin = resolveOrigin(c.env.PUBLIC_WEB_ORIGIN, c.req.url);
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}${localizedAsset(`/share/${data.outcome}.png`, data.locale ?? DEFAULT_LOCALE)}`, 'Cache-Control': 'public, max-age=300' },
    });
  }
}

function renderSharePageHtml(data: ShareCardData, target: string, origin: string): string {
  const { outcome, p, q, name } = data;
  const locale = data.locale ?? DEFAULT_LOCALE;
  const cardParams = new URLSearchParams({ o: outcome, p: String(p), q: String(q) });
  if (name) cardParams.set('n', name);
  // Язык всегда в адресе картинки: у каждого языка своя карточка в кеше.
  cardParams.set('l', locale);
  return renderSharePage({
    locale,
    title: shareTitle(outcome, p, q, name, locale),
    description: shareText(locale).outcome.description,
    image: `${origin}/api/share/card.png?${cardParams.toString()}`,
    target,
  });
}

function handleSharePage(c: AppContext): Response {
  const parsed = parseShareQuery(c.req.query());
  if (!parsed.ok) return parsed.response;

  // Адрес назначения берётся только из конфигурации, не из запроса.
  const target = c.env.TELEGRAM_MINI_APP_LINK?.trim();
  if (!target) return text('Ссылка на приложение не настроена', 503);

  const origin = resolveOrigin(c.env.PUBLIC_WEB_ORIGIN, c.req.url);
  return new Response(renderSharePageHtml(parsed.data, target, origin), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
