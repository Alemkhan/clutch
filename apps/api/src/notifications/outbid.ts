import type { Env } from '../env';
import {
  insertInviteOnce,
  isOutbidEnabled,
  markInviteNotified,
  setOutbidEnabled,
} from './repository';
import { sendTelegramMessage, type SendResult } from './telegram';

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

/** Приглашение зовёт играть: его текст появляется только когда соперник сам нажал «Позвать на реванш». */
export function rematchOfferText(challengerName: string): string {
  return `${cleanName(challengerName)} зовёт на реванш: вопросы будут новые.`;
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

type NotificationKind = 'solo_result' | 'duel_result' | 'rematch_offer';

function logDeliveryFailure(
  kind: NotificationKind,
  result: Exclude<SendResult, { status: 'sent' }>,
  correlation: { recipientRunId?: string; challengerRunId?: string; inviteId?: string },
): void {
  console.error({
    event: 'telegram_notification_delivery',
    kind,
    deliveryStatus: result.status,
    reasonCode: result.reasonCode,
    ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
    ...correlation,
  });
}

function logHandlerFailure(
  kind: NotificationKind,
  correlation: { recipientRunId?: string; challengerRunId?: string; inviteId?: string },
): void {
  console.error({
    event: 'telegram_notification_handler',
    kind,
    reasonCode: 'unexpected_error',
    ...correlation,
  });
}

/**
 * Известие владельцу записи без приглашения. Строки в `rematch_invites` оно не создаёт: приглашение
 * рождается только от нажатия соперника, иначе у получателя оно выглядит как вызов, которого никто
 * не посылал. Не бросает: вызывается из waitUntil, когда у игрока ответ уже есть.
 */
async function sendNews(
  env: Env,
  event: OutbidEvent,
  kind: Exclude<NotificationKind, 'rematch_offer'>,
  text: string,
): Promise<void> {
  try {
    const chatId = telegramChatId(event.recipientRun.playerId);
    if (!chatId || !env.TELEGRAM_BOT_TOKEN) return;
    if (!(await isOutbidEnabled(env.DB, event.recipientRun.playerId))) return;
    const stopUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, STOP_PAYLOAD);
    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      text,
      stopUrl ? [[{ text: 'Не присылать такие сообщения', url: stopUrl }]] : [],
    );
    if (result.status !== 'sent') {
      logDeliveryFailure(kind, result, {
        recipientRunId: event.recipientRun.id,
        challengerRunId: event.challengerRunId,
      });
    }
    if (result.status === 'blocked') await setOutbidEnabled(env.DB, event.recipientRun.playerId, false);
  } catch {
    logHandlerFailure(kind, {
      recipientRunId: event.recipientRun.id,
      challengerRunId: event.challengerRunId,
    });
  }
}

/**
 * Сообщение с кнопкой реванша по **уже созданному** приглашению: его создаёт маршрут в тот момент,
 * когда соперник нажал «Позвать на реванш». Возвращает true, если Telegram принял сообщение;
 * сам отказ доставки приглашение не отменяет — оно видно в «Моих партиях» у обеих сторон.
 */
export async function sendRematchOffer(env: Env, offer: {
  recipientPlayerId: string;
  recipientRunId: string;
  challengerRunId: string;
  inviteId: string;
  challengerName: string;
}): Promise<boolean> {
  try {
    const chatId = telegramChatId(offer.recipientPlayerId);
    if (!chatId || !env.TELEGRAM_BOT_TOKEN) return false;
    if (!(await isOutbidEnabled(env.DB, offer.recipientPlayerId))) return false;
    const rematchUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, offer.inviteId);
    const stopUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, STOP_PAYLOAD);
    if (!rematchUrl || !stopUrl) {
      await markInviteNotified(env.DB, offer.inviteId, false);
      logDeliveryFailure(
        'rematch_offer',
        { status: 'failed', reasonCode: 'configuration_error' },
        {
          inviteId: offer.inviteId,
          recipientRunId: offer.recipientRunId,
          challengerRunId: offer.challengerRunId,
        },
      );
      return false;
    }
    const result = await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      rematchOfferText(offer.challengerName),
      [
        [{ text: 'Сыграть реванш', url: rematchUrl }],
        [{ text: 'Не присылать такие сообщения', url: stopUrl }],
      ],
    );
    await markInviteNotified(env.DB, offer.inviteId, result.status === 'sent');
    if (result.status !== 'sent') {
      logDeliveryFailure('rematch_offer', result, {
        inviteId: offer.inviteId,
        recipientRunId: offer.recipientRunId,
        challengerRunId: offer.challengerRunId,
      });
    }
    // The user blocked the bot: stop trying instead of failing on every later message.
    if (result.status === 'blocked') await setOutbidEnabled(env.DB, offer.recipientPlayerId, false);
    return result.status === 'sent';
  } catch {
    logHandlerFailure('rematch_offer', {
      inviteId: offer.inviteId,
      recipientRunId: offer.recipientRunId,
      challengerRunId: offer.challengerRunId,
    });
    return false;
  }
}

/** Исход соло-забега глазами владельца записи: его запись победила, проиграла или сравнялась. */
export type SoloRecipientOutcome = 'record_won' | 'record_lost' | 'tie';

/**
 * Только известие об исходе. Реванш здесь не обещается: позвать на него может лишь сам соперник
 * нажатием, и до этого нажатия обещать игроку нечего.
 */
export function soloResultText(challengerName: string, outcome: SoloRecipientOutcome): string {
  const name = cleanName(challengerName);
  if (outcome === 'record_won') return `Ваша запись устояла: ${name} не смог её обойти.`;
  if (outcome === 'record_lost') return `${name} обошёл вашу запись.`;
  return `Ничья с ${name}: результаты сравнялись.`;
}

/**
 * Соло: владелец записи узнаёт исход в любом случае, не только когда его обыграли. Приглашения на
 * реванш это сообщение не создаёт ни при каком исходе — его создаёт нажатие соперника
 * (`POST /api/solo-runs/:id/rematch`), и тогда приходит отдельное сообщение с кнопкой.
 */
export async function notifySoloResult(
  env: Env,
  event: OutbidEvent & { outcome: SoloRecipientOutcome },
): Promise<void> {
  await sendNews(env, event, 'solo_result', soloResultText(event.challengerName, event.outcome));
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
  await sendNews(env, event, 'duel_result', duelResultText(event.challengerName, event.outcome));
}
