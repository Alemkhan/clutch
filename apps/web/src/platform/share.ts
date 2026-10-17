import type { CategoryId, SkillResult } from '@clutch/shared';
import type { MatchSource } from '../features/solo/matchmaking';

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
  /** Сначала карточка сообщением (shareMessage); 'failed' — откат на telegramShare со ссылкой. */
  telegramMessage?: () => Promise<'shared' | 'cancelled' | 'failed'>;
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

/** Куда смотрят ссылки-превью: API (VITE_API_URL), а без него — тот же origin (dev-прокси /api). */
export function previewBase(apiBase: string | undefined, origin: string): string {
  return (apiBase?.trim() || origin).replace(/\/+$/, '');
}

const TILE_BY_SKILL: Partial<Record<SkillResult, string>> = { perfect: 'P', great: 'G', good: 'O', weak: 'W' };

/**
 * Круги забега буквами для карточки: точность удара, а «X» — круг без прогресса (неверный ответ
 * или «мимо»; на карточке они одинаковы). Удар круга с прогрессом — следующий не-«мимо» в списке.
 */
export function roundTiles(awards: readonly number[], skills: readonly SkillResult[]): string {
  let next = 0;
  return awards.map((award) => {
    if (award <= 0) return 'X';
    while (skills[next] === 'miss') next += 1;
    const tile = TILE_BY_SKILL[skills[next]] ?? 'W';
    next += 1;
    return tile;
  }).join('').slice(0, 20);
}

export interface RunPreview {
  tiles: string;
  progress: number;
  category: CategoryId;
  day: string;
  /** Приглашение на дуэль с этой записью и имя того, кто зовёт. */
  inviteId?: string;
  name?: string;
}

/** Страница-превью результата забега (/api/share/run): своя картинка, затем Mini App. */
export function buildRunPreviewUrl(base: string, preview: RunPreview): string {
  const params = new URLSearchParams({
    t: preview.tiles,
    p: String(Math.round(Math.min(100, Math.max(0, preview.progress)))),
    c: preview.category,
    d: preview.day,
  });
  if (preview.inviteId) {
    params.set('i', preview.inviteId);
    const name = Array.from(preview.name?.trim() ?? '').slice(0, MAX_SHARE_NAME_LENGTH).join('').trim();
    if (name) params.set('n', name);
  }
  return `${base}/api/share/run?${params.toString()}`;
}

/** Страница-превью «На глазок» (/api/share/guess). Своей догадки и ответа в ссылке нет. */
export function buildGuessPreviewUrl(
  base: string,
  number: number,
  multiplier: number,
  percentile: number | null,
  best: boolean,
): string {
  const miss = Math.min(999_999_999, Math.max(1, Math.round(multiplier * 10) / 10));
  const params = new URLSearchParams({ k: String(number), m: Number.isInteger(miss) ? String(miss) : miss.toFixed(1) });
  if (best) params.set('pc', 'best');
  else if (percentile !== null) params.set('pc', String(Math.round(percentile)));
  return `${base}/api/share/guess?${params.toString()}`;
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
      const message = effects.telegramMessage ? await effects.telegramMessage() : 'failed';
      if (message !== 'failed') return message;
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
