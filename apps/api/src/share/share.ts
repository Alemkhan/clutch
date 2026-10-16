import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type { ShareCardData, ShareOutcome } from './cardLayout';

type Outcome = ShareOutcome;

const OUTCOMES: readonly Outcome[] = ['win', 'loss', 'tie'];
const MAX_NAME_LENGTH = 32;
const DESCRIPTION =
  'Ответь верно — получи попытку. Забей точнее — выиграй матч. Сегодня у всех один набор вопросов.';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseProgress(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= 100 ? value : null;
}

export function shareTitle(outcome: Outcome, p: number, q: number, name: string | null): string {
  if (name) {
    if (outcome === 'win') return `Обыграл ${name}: ${p}% против ${q}%`;
    if (outcome === 'loss') return `Уступил ${name}: ${p}% против ${q}%`;
    return `Ничья с ${name}: ${p}:${q}`;
  }
  if (outcome === 'tie') return `Ничья: ${p}:${q}`;
  return `Мой результат: ${p}% против ${q}%`;
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

/** Общий разбор и проверка параметров для страницы шаринга и картинки. */
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
  return { ok: true, data: { outcome, p, q, name } };
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
    // нет executionCtx или кеша — ответ всё равно отдаём
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
    // кеш недоступен — рисуем заново
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
      headers: { Location: `${origin}/share/${data.outcome}.png`, 'Cache-Control': 'public, max-age=300' },
    });
  }
}

function renderSharePageHtml(
  { outcome, p, q, name }: ShareCardData,
  target: string,
  origin: string,
): string {
  const title = escapeHtml(shareTitle(outcome, p, q, name));
  const description = escapeHtml(DESCRIPTION);
  const cardParams = new URLSearchParams({ o: outcome, p: String(p), q: String(q) });
  if (name) cardParams.set('n', name);
  const image = escapeHtml(`${origin}/api/share/card.png?${cardParams.toString()}`);
  const href = escapeHtml(target);
  const scriptTarget = JSON.stringify(target).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Clutch">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
</head>
<body style="margin:0;padding:32px 16px;font-family:system-ui,sans-serif;text-align:center;background:#111;color:#fff">
<h1 style="font-size:24px">${title}</h1>
<p style="font-size:48px;margin:16px 0">${p}% : ${q}%</p>
<p><a href="${href}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#f5c518;color:#111;font-weight:700;text-decoration:none">Открыть в Telegram</a></p>
<script>window.location.replace(${scriptTarget});</script>
</body>
</html>`;
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
