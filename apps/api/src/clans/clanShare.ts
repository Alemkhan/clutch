import { CLAN_INVITE_CODE, CLAN_INVITE_PREFIX, DEFAULT_LOCALE, type Locale } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { miniAppLink } from '../notifications/outbid';
import { PALETTE, fitSize, footer, header, open, surface, text } from '../share/cardKit';
import { cardResponse, pageResponse } from '../share/previews';
import { shareLocale } from '../share/shareText';
import { clansOpen, clanStanding } from './clans';

/**
 * Карточка-приглашение в клан: `/api/share/clan?c=<код>&v=<число участников>&l=<язык>` — страница
 * с превью, которая уводит в Mini App по ссылке «заражения»; `.png` — сама картинка. Данные клана
 * берутся с сервера по коду, `v` нужен только как ключ кеша (клан растёт — картинка новая).
 *
 * Эмодзи в шрифте карточки нет, поэтому оно рисуется картинкой Twemoji (графика © Twitter/X и
 * участники проекта, CC-BY 4.0: https://github.com/jdecked/twemoji).
 */

type AppContext = Context<{ Bindings: Env }>;

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/';
const CLAN_CARD_CACHE = 'public, max-age=3600';

function ruPlural(count: number, forms: readonly [string, string, string]): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

export const CLAN_SHARE_TEXT = {
  ru: {
    caption: 'Кланы-эмодзи',
    title: 'Тебя заражают!',
    inviter: (name: string) => `${name} зовёт в свой клан`,
    members: (count: number) => `${count} ${ruPlural(count, ['участник', 'участника', 'участников'])}`,
    rank: (rank: number) => `#${rank} в войне кланов`,
    forever: 'Один клан навсегда',
    call: 'Вступай в клан',
    action: 'Вступить',
    messageTitle: (emoji: string) => `Тебя заражают ${emoji}!`,
    messageText: (emoji: string, members: string) => `Вступай в клан ${emoji} в Clutch — в нём уже ${members}. Один клан навсегда.`,
    description: 'Каждое эмодзи — один клан. Вступай и сражайся в недельной войне кланов.',
  },
  en: {
    caption: 'Emoji clans',
    title: "You're being infected!",
    inviter: (name: string) => `${name} invites you to their clan`,
    members: (count: number) => `${count} ${count === 1 ? 'member' : 'members'}`,
    rank: (rank: number) => `#${rank} in the clan war`,
    forever: 'One clan forever',
    call: 'Join the clan',
    action: 'Join',
    messageTitle: (emoji: string) => `You're being infected with ${emoji}!`,
    messageText: (emoji: string, members: string) => `Join the ${emoji} clan in Clutch — it already has ${members}. One clan forever.`,
    description: 'Every emoji is one clan. Join and fight in the weekly clan war.',
  },
  kk: {
    caption: 'Эмодзи-кландар',
    title: 'Сені кланға шақырады!',
    inviter: (name: string) => `${name} сені өз кланына шақырады`,
    members: (count: number) => `${count} мүше`,
    rank: (rank: number) => `Кландар соғысында #${rank}`,
    forever: 'Бір клан мәңгілікке',
    call: 'Кланға қосыл',
    action: 'Қосылу',
    messageTitle: (emoji: string) => `Сені ${emoji} кланына шақырады!`,
    messageText: (emoji: string, members: string) => `Clutch-тағы ${emoji} кланына қосыл — онда ${members} бар. Бір клан мәңгілікке.`,
    description: 'Әр эмодзи — бір клан. Қосыл да, апталық кландар соғысында шайқас.',
  },
} satisfies Record<Locale, unknown>;

/** Имя файла Twemoji: коды символов через «-», FE0F убирается, кроме последовательностей с ZWJ. */
export function twemojiName(emoji: string): string {
  const raw = emoji.includes('‍') ? emoji : emoji.replace(/️/gu, '');
  return Array.from(raw, (char) => char.codePointAt(0)!.toString(16)).join('-');
}

function base64(textValue: string): string {
  const bytes = new TextEncoder().encode(textValue);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** SVG эмодзи как data URI; null — CDN недоступен, тогда карточка рисуется без картинки. */
export async function emojiDataUri(emoji: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(`${TWEMOJI_BASE}${twemojiName(emoji)}.svg`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const svg = await response.text();
    if (!svg.trimStart().startsWith('<svg') || svg.length > 100_000) return null;
    return `data:image/svg+xml;base64,${base64(svg)}`;
  } catch {
    return null;
  }
}

export interface ClanCardData {
  emojiImage: string | null;
  inviterName: string;
  members: number;
  rank: number | null;
  locale: Locale;
}

export function buildClanCardSvg(data: ClanCardData): string {
  const t = CLAN_SHARE_TEXT[data.locale];
  const stats = data.rank ? `${t.members(data.members)} · ${t.rank(data.rank)}` : t.members(data.members);
  const left = 72;
  const box = 300;
  const top = 168;
  const column = left + box + 56;
  const width = 1128 - column;
  const inviter = t.inviter(data.inviterName);
  return [
    open(),
    header(t.caption),
    surface(left, top, box, box, 56),
    data.emojiImage
      ? `<image x="${left + 40}" y="${top + 40}" width="${box - 80}" height="${box - 80}" href="${data.emojiImage}"/>`
      : text(`x="${left + box / 2}" y="${top + box / 2 + 60}" font-size="170" fill="${PALETTE.dim}" text-anchor="middle"`, '?', 'black'),
    text(`x="${column}" y="${top + 78}" font-size="${fitSize(t.title, width, 64, 'black', 40)}" fill="${PALETTE.text}"`, t.title, 'black'),
    text(`x="${column}" y="${top + 148}" font-size="${fitSize(inviter, width, 34, 'bold', 24)}" fill="${PALETTE.dim}"`, inviter, 'bold'),
    text(`x="${column}" y="${top + 214}" font-size="${fitSize(stats, width, 38, 'black', 26)}" fill="${PALETTE.gold}"`, stats, 'black'),
    text(`x="${column}" y="${top + 272}" font-size="${fitSize(t.forever, width, 28, 'bold', 20)}" fill="${PALETTE.dim}"`, t.forever, 'bold'),
    footer(t.call, t.action),
    '</svg>',
  ].join('');
}

export interface ClanShareInfo {
  code: string;
  emoji: string;
  inviterName: string;
  members: number;
  rank: number | null;
  locale: Locale;
}

/** Код из ссылки → данные клана; null — код кривой или такого участника нет. */
export async function clanShareInfo(db: D1Database, query: Record<string, string>): Promise<ClanShareInfo | null> {
  const code = (query.c ?? '').replace(CLAN_INVITE_PREFIX, '');
  if (!CLAN_INVITE_CODE.test(code)) return null;
  const standing = await clanStanding(db, code);
  if (!standing) return null;
  return { code, ...standing, locale: shareLocale(query.l) };
}

export function clanInviteTarget(env: Pick<Env, 'TELEGRAM_MINI_APP_LINK'>, code: string): string | null {
  return miniAppLink(env.TELEGRAM_MINI_APP_LINK?.trim(), `${CLAN_INVITE_PREFIX}${code}`);
}

/** Сообщение для Telegram shareMessage: заголовок и текст с эмодзи, кнопка «Вступить». */
export function clanPreparedMessage(info: ClanShareInfo, previewUrl: string, env: Pick<Env, 'TELEGRAM_MINI_APP_LINK'>) {
  const target = clanInviteTarget(env, info.code);
  if (!target) return null;
  const t = CLAN_SHARE_TEXT[info.locale];
  const title = t.messageTitle(info.emoji);
  return { previewUrl, title, text: `${title}\n${t.messageText(info.emoji, t.members(info.members))}`, button: t.action, target };
}

export function registerClanShareRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/share/clan', async (c: AppContext) => {
    if (!clansOpen(c.env)) return new Response('Not found', { status: 404 });
    const info = await clanShareInfo(c.env.DB, c.req.query());
    if (!info) return new Response('Приглашение не найдено', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const t = CLAN_SHARE_TEXT[info.locale];
    return pageResponse(c, info.locale, t.messageTitle(info.emoji), t.description, clanInviteTarget(c.env, info.code));
  });

  app.get('/api/share/clan.png', async (c: AppContext) => {
    if (!clansOpen(c.env)) return new Response('Not found', { status: 404 });
    const info = await clanShareInfo(c.env.DB, c.req.query());
    if (!info) return new Response('Приглашение не найдено', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return cardResponse(c, info.locale ?? DEFAULT_LOCALE, async () => buildClanCardSvg({
      emojiImage: await emojiDataUri(info.emoji),
      inviterName: info.inviterName,
      members: info.members,
      rank: info.rank,
      locale: info.locale,
    }), CLAN_CARD_CACHE);
  });
}
