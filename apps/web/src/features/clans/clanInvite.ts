import { useEffect, useState } from 'react';
import type { ClanMeResponse, Locale } from '@clutch/shared';
import { currentLocale } from '../../i18n/locale';
import { messagesFor } from '../../i18n/messages';
import { logAnalyticsEvent } from '../../platform/api';
import { chooseShareStrategy, executeShare, previewBase } from '../../platform/share';
import { preparedMessageShare } from '../../platform/shareMessage';
import { canShareViaTelegram, shareViaTelegram } from '../../platform/telegram';
import { m } from './messages';

type MyClan = NonNullable<ClanMeResponse['clan']>;

/**
 * Ссылка-превью «заражения»: страница с карточкой клана, которая уводит в Mini App по коду.
 * v — число участников: только ключ кеша, чтобы карточка обновлялась, когда клан растёт.
 */
export function clanInvitePreviewUrl(base: string, clan: Pick<MyClan, 'inviteCode' | 'members'>, locale: Locale = currentLocale()): string {
  const params = new URLSearchParams({ c: clan.inviteCode, v: String(clan.members), l: locale });
  return `${base}/api/share/clan?${params.toString()}`;
}

export type InviteStatus = 'idle' | 'copied' | 'failed' | 'unavailable';

/** «Заразить друга»: карточка сообщением в Telegram → ссылка на превью → системное «Поделиться» → буфер. */
export function useClanInvite(source: 'clan' | 'result') {
  const [status, setStatus] = useState<InviteStatus>('idle');
  useEffect(() => {
    if (status === 'idle') return undefined;
    const id = window.setTimeout(() => setStatus('idle'), 3000);
    return () => window.clearTimeout(id);
  }, [status]);

  const share = (clan: MyClan) => {
    if (!clan.inviteLink) { setStatus('unavailable'); return; }
    const previewUrl = clanInvitePreviewUrl(previewBase(import.meta.env.VITE_API_URL as string | undefined, window.location.origin), clan);
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    void executeShare(
      chooseShareStrategy({ telegramShare: canShareViaTelegram(), nativeShare: hasNative }),
      { text: messagesFor(m).inviteText(clan.emoji), url: previewUrl },
      {
        telegramMessage: preparedMessageShare(previewUrl),
        telegramShare: shareViaTelegram,
        nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
        copy: (value) => navigator.clipboard.writeText(value),
      },
    ).then((result) => {
      if (result === 'shared' || result === 'copied') logAnalyticsEvent('clan_invite_shared', { source });
      setStatus(result === 'copied' ? 'copied' : result === 'failed' ? 'failed' : 'idle');
    });
  };

  return { status, share };
}
