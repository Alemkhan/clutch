import { useRef, useState } from 'react';
import { createGroupChallenge } from '../../platform/api';
import { chooseShareStrategy, executeShare } from '../../platform/share';
import { canShareViaTelegram, shareViaTelegram } from '../../platform/telegram';

export function useGroupChallenge(runId?: string) {
  const [status, setStatus] = useState('idle');
  const url = useRef<string>();
  const busy = useRef(false);
  async function send() {
    if (!runId || busy.current) return;
    busy.current = true; setStatus('working');
    try {
      url.current ??= (await createGroupChallenge(runId)).url;
      const native = typeof navigator.share === 'function';
      const result = await executeShare(chooseShareStrategy({ telegramShare: canShareViaTelegram(), nativeShare: native }),
        { url: url.current, text: 'Мой вызов друзьям: один набор для всех! Присоединяйся в течение 24 часов.' },
        { telegramShare: shareViaTelegram, nativeShare: native ? data => navigator.share(data) : undefined, copy: text => navigator.clipboard.writeText(text) });
      setStatus(result === 'failed' ? 'error' : result);
    } catch { setStatus('error'); }
    finally { busy.current = false; }
  }
  return { status, send };
}
