import { messagesFor } from '../../i18n/messages';
import { m } from './messages';
import { useCallback, useEffect, useState } from 'react';
import { logAnalyticsEvent } from '../../platform/api';
import { chooseShareStrategy, executeShare } from '../../platform/share';
import { preparedMessageShare } from '../../platform/shareMessage';
import { canShareViaTelegram, shareViaTelegram } from '../../platform/telegram';
import { resolveGameLink } from '../tiebreaker/tiebreakerShare';
import { circles } from './soloResultModel';

export interface SoloShareInput {
  reachedTarget: boolean;
  progress: number;
  roundsPlayed: number;
  perfectHits: number;
  categoryLabel: string;
  /** Прогресс каждого круга по порядку: из него сетка 🟩🟥, как у Wordle. */
  roundAwards?: readonly number[];
  /** Номер игрового дня («Clutch #28»): только у забега дня, у которого набор общий на всех. */
  dayNumber?: number;
}

/** Сетка кругов: 🟩 - круг дал прогресс, 🟥 - нет (неверный ответ или промах). По 10 в строке. */
export function roundGrid(awards: readonly number[]): string {
  const cells = awards.map((award) => (award > 0 ? '🟩' : '🟥'));
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 10) rows.push(cells.slice(index, index + 10).join(''));
  return rows.join('\n');
}

/**
 * Wordle-style line for any finished run, including one that stopped short of 100%: that is the
 * screen most first-time players see, and it had nothing to share. No questions or answers in it -
 * the set is the same for everyone today.
 */
export function buildSoloShareText(input: SoloShareInput): string {
  const t = messagesFor(m);
  const perfect = input.reachedTarget && input.perfectHits > 0 ? t.sharePerfect(input.perfectHits) : '';
  const outcome = input.reachedTarget
    ? t.shareReached(circles(input.roundsPlayed), perfect)
    : t.shareNotReached(Math.round(input.progress), circles(input.roundsPlayed));
  if (!input.roundAwards?.length) return `Clutch · ${input.categoryLabel} · ${outcome}`;
  // Карточка в несколько строк: заголовок с номером дня, сетка кругов, итог.
  const head = input.dayNumber ? `Clutch #${input.dayNumber} · ${input.categoryLabel}` : `Clutch · ${input.categoryLabel}`;
  return [head, roundGrid(input.roundAwards), outcome].join('\n');
}

export type SoloShareStatus = 'idle' | 'copied' | 'failed';

/** Telegram → системное «Поделиться» → буфер обмена, как у «На глазок». Статус гаснет через 3 с. */
export function useSoloShare(): { status: SoloShareStatus; share: (text: string, reached?: boolean, previewUrl?: string) => void } {
  const [status, setStatus] = useState<SoloShareStatus>('idle');

  useEffect(() => {
    if (status === 'idle') return undefined;
    const id = window.setTimeout(() => setStatus('idle'), 3000);
    return () => window.clearTimeout(id);
  }, [status]);

  const share = useCallback((text: string, reached = false, previewUrl?: string) => {
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    // Превью со своей карточкой результата; без него - прямо в бота.
    const url = previewUrl ?? resolveGameLink(import.meta.env.VITE_TELEGRAM_BOT_LINK as string | undefined, window.location.origin);
    void executeShare(
      chooseShareStrategy({ telegramShare: canShareViaTelegram(), nativeShare: hasNative }),
      { text, url },
      {
        telegramMessage: previewUrl ? preparedMessageShare(previewUrl) : undefined,
        telegramShare: shareViaTelegram,
        nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
        copy: (value) => navigator.clipboard.writeText(value),
      },
    ).then((result) => {
      if (result === 'shared' || result === 'copied') logAnalyticsEvent('result_shared', { reached });
      setStatus(result === 'copied' ? 'copied' : result === 'failed' ? 'failed' : 'idle');
    });
  }, []);

  return { status, share };
}
