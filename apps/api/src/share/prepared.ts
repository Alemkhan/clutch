import type { PreparedShareResponse } from '@clutch/shared';
import type { Hono } from 'hono';
import { resolveRequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { telegramChatId } from '../notifications/outbid';
import { guessShareTitle, isReachableOrigin, parseGuessShare, parseRunShare, publicOrigin, runShareTitle, shareTarget } from './previews';
import { runCallLine } from './runCard';

/**
 * Подготовленное сообщение для Telegram shareMessage (Bot API 8.0, нужен inline-режим бота):
 * в выбранный чат уходит сообщение с крупным превью карточки результата и кнопкой «Играть».
 * Клиент присылает свою ссылку-превью; из неё берутся только путь и проверенные параметры,
 * сама страница строится на origin этого Worker, кнопка ведёт только на ссылку из конфигурации.
 */

const KINDS = {
  '/api/share/run': ['t', 'p', 'c', 'd', 'i', 'n'],
  '/api/share/guess': ['k', 'm', 'pc'],
} as const;
type PreviewPath = keyof typeof KINDS;

export interface PreparedMessage {
  previewUrl: string;
  title: string;
  text: string;
  target: string;
}

/** Ссылка клиента → сообщение; null — путь не наш, параметры не прошли проверку или нет ссылки на бота. */
export function preparedMessageFor(rawUrl: unknown, origin: string, env: Env): PreparedMessage | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!(url.pathname in KINDS)) return null;
  const path = url.pathname as PreviewPath;
  const query: Record<string, string> = {};
  for (const key of KINDS[path]) {
    const value = url.searchParams.get(key);
    if (value !== null) query[key] = value;
  }
  const preview = `${origin}${path}?${new URLSearchParams(query).toString()}`;

  if (path === '/api/share/run') {
    const parsed = parseRunShare(query);
    const target = parsed.ok ? shareTarget(env, parsed.data.inviteId) : null;
    if (!parsed.ok || !target) return null;
    const title = runShareTitle(parsed.data);
    return { previewUrl: preview, title, text: `${title}\n${runCallLine(parsed.data.card)}`, target };
  }
  const parsed = parseGuessShare(query);
  const target = shareTarget(env, null);
  if (!parsed.ok || !target) return null;
  const title = guessShareTitle(parsed.data);
  return { previewUrl: preview, title, text: `${title}\nУгадаешь точнее?`, target };
}

/** Тело savePreparedInlineMessage: статья с текстом (без разметки: имя чужое), большим превью сверху и кнопкой. */
export function preparedInlineMessageBody(userId: string, message: PreparedMessage): Record<string, unknown> {
  return {
    user_id: Number(userId),
    result: {
      type: 'article',
      id: crypto.randomUUID(),
      title: message.title,
      input_message_content: {
        message_text: message.text,
        link_preview_options: { url: message.previewUrl, prefer_large_media: true, show_above_text: true },
      },
      reply_markup: { inline_keyboard: [[{ text: 'Играть в Clutch', url: message.target }]] },
    },
    allow_user_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true,
    allow_bot_chats: false,
  };
}

export function registerPreparedShareRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/share/prepared', async (c) => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `share-prepared:${identity.playerId}`);
    if (rateLimit === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);

    // Подготовить сообщение можно только для пользователя Telegram: его id — адресат в Bot API.
    const userId = telegramChatId(identity.playerId);
    if (!userId) return c.json({ error: 'Only Telegram players can share a message.', reason: 'telegram_only' }, 409);

    // Превью, которое Telegram не скачает, роняет отправку («!» в чате): тогда клиент шлёт обычную ссылку.
    const origin = publicOrigin(c);
    if (!isReachableOrigin(origin)) {
      return c.json({ error: 'The preview is not reachable from Telegram.', reason: 'preview_unreachable' }, 409);
    }
    const body = await c.req.json<{ url?: unknown }>().catch(() => null);
    const message = preparedMessageFor(body?.url, origin, c.env);
    if (!message) return c.json({ error: 'Invalid share link.' }, 400);

    try {
      const response = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preparedInlineMessageBody(userId, message)),
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; result?: { id?: unknown } } | null;
      if (!response.ok || !data?.ok || typeof data.result?.id !== 'string') {
        // Тело Telegram в лог не идёт: только статус. Клиент откатится на обычную ссылку.
        console.error('savePreparedInlineMessage failed', response.status);
        return c.json({ error: 'Telegram did not prepare the message.' }, 502);
      }
      const result: PreparedShareResponse = { id: data.result.id };
      return c.json(result, 201);
    } catch {
      return c.json({ error: 'Telegram is unavailable.' }, 502);
    }
  });
}
