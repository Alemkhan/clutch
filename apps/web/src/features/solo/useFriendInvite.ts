import { useCallback, useRef, useState } from 'react';
import { createFriendInvite } from '../../platform/api';
import { buildFriendInvitePayload, chooseShareStrategy, executeShare } from '../../platform/share';
import { canShareViaTelegram, shareViaTelegram } from '../../platform/telegram';

export type FriendInviteStatus = 'idle' | 'working' | 'shared' | 'copied' | 'error';

/**
 * «Позвать друга» с экрана результата: ссылка создаётся по нажатию (запись резервируется только
 * тогда) и уходит через общий механизм share. Созданная ссылка запоминается: повторное нажатие
 * после сбоя отправки не ходит в сеть и успевает до потери пользовательского жеста.
 */
export function useFriendInvite(runId: string | undefined) {
  const [status, setStatus] = useState<FriendInviteStatus>('idle');
  const urlRef = useRef<string>();
  const busyRef = useRef(false);

  const send = useCallback(async () => {
    if (!runId || busyRef.current) return;
    busyRef.current = true;
    setStatus('working');
    try {
      if (!urlRef.current) urlRef.current = (await createFriendInvite(runId)).url;
      const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
      const result = await executeShare(
        chooseShareStrategy({ telegramShare: canShareViaTelegram(), nativeShare: hasNative }),
        buildFriendInvitePayload(urlRef.current),
        {
          telegramShare: shareViaTelegram,
          nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
          copy: (text) => navigator.clipboard.writeText(text),
        },
      );
      setStatus(result === 'cancelled' ? 'idle' : result === 'failed' ? 'error' : result);
    } catch {
      setStatus('error');
    } finally {
      busyRef.current = false;
    }
  }, [runId]);

  return { status, send };
}
