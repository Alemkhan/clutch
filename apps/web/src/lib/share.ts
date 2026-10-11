import type { MatchSource } from './matchmaking';

export type ShareOutcome = 'win' | 'loss' | 'tie';
export type ShareStrategy = 'telegram' | 'native' | 'copy';
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareInput {
  playerProgress: number;
  opponentProgress: number;
  opponentName: string;
  matchSource: MatchSource;
}

export interface SharePayload {
  text: string;
  url: string;
}

export interface ShareCapabilities {
  telegramShare: boolean;
  nativeShare: boolean;
}

export interface ShareEffects {
  telegramShare: (url: string, text: string) => boolean;
  nativeShare?: (data: { text: string; url: string }) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}

export function shareOutcome(playerProgress: number, opponentProgress: number): ShareOutcome {
  if (playerProgress > opponentProgress) return 'win';
  if (playerProgress < opponentProgress) return 'loss';
  return 'tie';
}

const MAX_SHARE_NAME_LENGTH = 32;

/**
 * Ссылка на страницу-превью `/api/share` (OG-карточка). Имя соперника передаётся
 * только для соперника-игрока, чтобы не выдавать бота или практику за человека.
 */
export function buildShareUrl(input: ShareInput, apiBase: string | undefined, origin: string): string {
  const base = (apiBase?.trim() || origin).replace(/\/+$/, '');
  const params = new URLSearchParams({
    o: shareOutcome(input.playerProgress, input.opponentProgress),
    p: String(Math.round(input.playerProgress)),
    q: String(Math.round(input.opponentProgress)),
  });
  if (input.matchSource === 'player') {
    const name = Array.from(input.opponentName.trim()).slice(0, MAX_SHARE_NAME_LENGTH).join('').trim();
    if (name) params.set('n', name);
  }
  return `${base}/api/share?${params.toString()}`;
}

export function shareHeadline({ playerProgress, opponentProgress, matchSource }: ShareInput): string {
  if (matchSource === 'local') return 'Потренировался в Clutch';
  const outcome = shareOutcome(playerProgress, opponentProgress);
  if (outcome === 'win') return 'Я вытащил клатч!';
  if (outcome === 'tie') return 'Ничья в Clutch';
  return 'Почти получилось!';
}

export function buildShareText(input: ShareInput): string {
  const { playerProgress: p, opponentProgress: o, matchSource } = input;
  const name = input.opponentName.trim();

  // Локальная практика не сохраняется: не подаём её как матч с соперником.
  if (matchSource === 'local') {
    return `Потренировался в Clutch: ${p}% против ${o}%. Это тренировка, результат не сохранён. Сыграем?`;
  }

  const rival = name ? `«${name}»` : 'соперником';
  const outcome = shareOutcome(p, o);
  if (outcome === 'win') return `Клатч! Обыграл ${rival} в Clutch: ${p}% против ${o}%. Попробуешь лучше?`;
  if (outcome === 'tie') return `Ничья с ${rival} в Clutch: ${p}% на ${o}%. Кто возьмёт перевес?`;
  return `Почти! Уступил ${rival} в Clutch: ${p}% против ${o}%. Попробуешь лучше?`;
}

export function buildSharePayload(input: ShareInput, url: string): SharePayload {
  return { text: buildShareText(input), url };
}

/** «Позвать друга»: ссылка ведёт прямо в приглашение, поэтому свой счёт в текст не входит. */
export function buildFriendInvitePayload(url: string): SharePayload {
  return { text: 'Обгони мой результат в Clutch', url };
}

export function chooseShareStrategy({ telegramShare, nativeShare }: ShareCapabilities): ShareStrategy {
  if (telegramShare) return 'telegram';
  if (nativeShare) return 'native';
  return 'copy';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function executeShare(
  strategy: ShareStrategy,
  payload: SharePayload,
  effects: ShareEffects,
): Promise<ShareResult> {
  try {
    if (strategy === 'telegram') {
      return effects.telegramShare(payload.url, payload.text) ? 'shared' : 'failed';
    }
    if (strategy === 'native') {
      if (!effects.nativeShare) return 'failed';
      await effects.nativeShare({ text: payload.text, url: payload.url });
      return 'shared';
    }
    if (!effects.copy) return 'failed';
    await effects.copy(`${payload.text}
${payload.url}`);
    return 'copied';
  } catch (error) {
    return isAbort(error) ? 'cancelled' : 'failed';
  }
}
