import { useCallback, useEffect, useState } from 'react';
import { chooseShareStrategy, executeShare } from '../../platform/share';
import { canShareViaTelegram, shareViaTelegram } from '../../platform/telegram';
import { resolveGameLink } from '../tiebreaker/tiebreakerShare';
import { circles } from './soloResultModel';

export interface SoloShareInput {
  reachedTarget: boolean;
  progress: number;
  roundsPlayed: number;
  perfectHits: number;
  categoryLabel: string;
}

/**
 * Wordle-style line for any finished run, including one that stopped short of 100%: that is the
 * screen most first-time players see, and it had nothing to share. No questions or answers in it —
 * the set is the same for everyone today.
 */
export function buildSoloShareText(input: SoloShareInput): string {
  const head = `Clutch · ${input.categoryLabel}`;
  if (input.reachedTarget) {
    const perfect = input.perfectHits > 0 ? ` · идеально: ${input.perfectHits}` : '';
    return `${head} · 100% за ${circles(input.roundsPlayed)}${perfect}. Сможешь быстрее?`;
  }
  return `${head} · ${Math.round(input.progress)}% за ${circles(input.roundsPlayed)}. Дойдёшь до 100%?`;
}

export type SoloShareStatus = 'idle' | 'copied' | 'failed';

/** Telegram → системное «Поделиться» → буфер обмена, как у «На глазок». Статус гаснет через 3 с. */
export function useSoloShare(): { status: SoloShareStatus; share: (text: string) => void } {
  const [status, setStatus] = useState<SoloShareStatus>('idle');

  useEffect(() => {
    if (status === 'idle') return undefined;
    const id = window.setTimeout(() => setStatus('idle'), 3000);
    return () => window.clearTimeout(id);
  }, [status]);

  const share = useCallback((text: string) => {
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const url = resolveGameLink(import.meta.env.VITE_TELEGRAM_BOT_LINK as string | undefined, window.location.origin);
    void executeShare(
      chooseShareStrategy({ telegramShare: canShareViaTelegram(), nativeShare: hasNative }),
      { text, url },
      {
        telegramShare: shareViaTelegram,
        nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
        copy: (value) => navigator.clipboard.writeText(value),
      },
    ).then((result) => {
      setStatus(result === 'copied' ? 'copied' : result === 'failed' ? 'failed' : 'idle');
    });
  }, []);

  return { status, share };
}
