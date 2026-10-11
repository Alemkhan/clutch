import type { Env } from '../env';
import {
  insertInviteOnce,
  isOutbidEnabled,
  markInviteNotified,
  setOutbidEnabled,
} from './repository';
import { sendTelegramMessage } from './telegram';

/**
 * Consent model: opt-out. A Telegram player is notified unless they have unsubscribed. Telegram
 * itself delivers only to users who opened the bot, and every message carries an unsubscribe
 * button. Flip the default in isOutbidEnabled() (and the SQL column default) to make it opt-in.
 */

export const STOP_PAYLOAD = 'unsub';
const MAX_NAME = 40;

/** TELEGRAM_MINI_APP_LINK is "https://t.me/<bot>?startapp"; the payload replaces the empty value. */
export function miniAppLink(base: string | undefined, payload: string): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set('startapp', payload);
    return url.toString();
  } catch {
    return null;
  }
}

export function telegramChatId(playerId: string): string | null {
  const match = /^telegram:(\d{1,20})$/u.exec(playerId);
  return match ? match[1] : null;
}

function cleanName(name: string): string {
  const collapsed = name.replace(/\s+/gu, ' ').trim();
  if (!collapsed) return 'Соперник';
  return collapsed.length > MAX_NAME ? `${collapsed.slice(0, MAX_NAME - 1)}…` : collapsed;
}

export function outbidText(challengerName: string, challengerProgress: number, recipientProgress: number): string {
  return `${cleanName(challengerName)} обошёл вашу запись: ${challengerProgress}% против ${recipientProgress}%. `
    + 'Можно сыграть реванш: вопросы будут новые.';
}

export function newInviteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `rm_${btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')}`;
}

export interface OutbidEvent {
  recipientRun: { id: string; playerId: string; category: string };
  challengerRunId: string;
  challengerName: string;
  recipientProgress: number;
  challengerProgress: number;
}

/**
 * Records the invite once per (recipient run, challenger run), sends `text` with the rematch and
 * unsubscribe buttons, and marks the delivery. Never throws: it runs inside waitUntil, after the
 * challenger already has their answer. The UNIQUE pair makes a repeat a silent no-op.
 */
async function deliverInvite(env: Env, event: OutbidEvent, text: (name: string) => string): Promise<void> {
  try {
    const chatId = telegramChatId(event.recipientRun.playerId);
    if (!chatId || !env.TELEGRAM_BOT_TOKEN) return;
    if (!(await isOutbidEnabled(env.DB, event.recipientRun.playerId))) return;

    const inviteId = newInviteId();
    const isNew = await insertInviteOnce(env.DB, {
      id: inviteId,
      recipientPlayerId: event.recipientRun.playerId,
      recipientRunId: event.recipientRun.id,
      challengerRunId: event.challengerRunId,
      category: event.recipientRun.category,
      recipientProgress: event.recipientProgress,
      challengerProgress: event.challengerProgress,
    });
    if (!isNew) return;

    const rematchUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, inviteId);
    const stopUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, STOP_PAYLOAD);
    if (!rematchUrl || !stopUrl) {
      await markInviteNotified(env.DB, inviteId, false);
      return;
    }
    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      text(cleanName(event.challengerName)),
      [
        [{ text: 'Сыграть реванш', url: rematchUrl }],
        [{ text: 'Не присылать такие сообщения', url: stopUrl }],
      ],
    ).catch(() => 'failed' as const);
    await markInviteNotified(env.DB, inviteId, result === 'sent');
    // The user blocked the bot: stop trying instead of failing on every later outbid.
    if (result === 'blocked') await setOutbidEnabled(env.DB, event.recipientRun.playerId, false);
  } catch (error) {
    console.error('Outbid notification failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

/** Гонка: сообщение только владельцу записи, которую обыграли. */
export async function notifyOutbid(env: Env, event: OutbidEvent): Promise<void> {
  await deliverInvite(env, event, () =>
    outbidText(event.challengerName, event.challengerProgress, event.recipientProgress));
}

/** Исход соло-забега глазами владельца записи: его запись победила, проиграла или сравнялась. */
export type SoloRecipientOutcome = 'record_won' | 'record_lost' | 'tie';

export function soloResultText(challengerName: string, outcome: SoloRecipientOutcome): string {
  const name = cleanName(challengerName);
  const rematch = 'Можно сыграть реванш: вопросы будут новые.';
  if (outcome === 'record_won') return `Ваша запись устояла: ${name} не смог её обойти. ${rematch}`;
  if (outcome === 'record_lost') return `${name} обошёл вашу запись. ${rematch}`;
  return `Ничья с ${name}: результаты сравнялись. ${rematch}`;
}

/** Соло: владелец записи узнаёт исход в любом случае, не только когда его обыграли. */
export async function notifySoloResult(
  env: Env,
  event: OutbidEvent & { outcome: SoloRecipientOutcome },
): Promise<void> {
  await deliverInvite(env, event, (name) => soloResultText(name, event.outcome));
}

export function duelResultText(friendName: string, outcome: SoloRecipientOutcome): string {
  const name = cleanName(friendName);
  if (outcome === 'record_won') return `${name} сыграл вашу запись по ссылке и не смог её обойти. Дружеская игра, не в зачёт.`;
  if (outcome === 'record_lost') return `${name} обошёл вашу запись по ссылке. Дружеская игра, не в зачёт.`;
  return `Ничья с ${name} на вашей записи. Дружеская игра, не в зачёт.`;
}

/**
 * Итог дружеской дуэли для автора записи. Это только известие: приглашения на реванш (строка в
 * rematch_invites и кнопка) не создаётся, потому что забег друга вне соревнования. Не бросает:
 * вызывается из waitUntil после ответа игроку. Повтор невозможен, completion срабатывает один раз.
 */
export async function notifyDuelResult(
  env: Env,
  event: OutbidEvent & { outcome: SoloRecipientOutcome },
): Promise<void> {
  try {
    const chatId = telegramChatId(event.recipientRun.playerId);
    if (!chatId || !env.TELEGRAM_BOT_TOKEN) return;
    if (!(await isOutbidEnabled(env.DB, event.recipientRun.playerId))) return;
    const stopUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, STOP_PAYLOAD);
    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      duelResultText(event.challengerName, event.outcome),
      stopUrl ? [[{ text: 'Не присылать такие сообщения', url: stopUrl }]] : [],
    ).catch(() => 'failed' as const);
    if (result === 'blocked') await setOutbidEnabled(env.DB, event.recipientRun.playerId, false);
  } catch (error) {
    console.error('Duel notification failed:', error instanceof Error ? error.message : 'unknown error');
  }
}
