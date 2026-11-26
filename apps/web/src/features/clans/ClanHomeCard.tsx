import { useEffect } from 'react';
import type { ClanMeResponse } from '@clutch/shared';
import { useMessages } from '../../i18n/messages';
import { loadMyClan, useMyClan } from './clanStore';
import { clansEnabled } from './clansEnabled';
import { m } from './messages';

/**
 * Клан на главной: свой клан с местом в войне или, после первого забега, приглашение занять
 * эмодзи. Пока забегов нет - ничего: новичку сначала игра.
 */
export function ClanHomeCard({ onOpen }: { onOpen: () => void }) {
  const clan = useMyClan();
  // Без клана: после первого забега «можно занять» меняется - перечитываем при каждом заходе на главную.
  useEffect(() => {
    if (clan.status === 'ready' && !clan.me.clan) void loadMyClan(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (clan.status !== 'ready' || !clansEnabled()) return null;
  return <ClanHomeCardView me={clan.me} onOpen={onOpen} />;
}

export function ClanHomeCardView({ me, onOpen }: { me: ClanMeResponse; onOpen: () => void }) {
  const t = useMessages(m);
  if (me.clan) {
    const rank = me.clan.week.rank ? t.weekRank(me.clan.week.rank) : t.weekNoRank;
    return (
      <button type="button" className="clan-home-card" onClick={onOpen}>
        <span className="clan-home-emoji" aria-hidden="true">{me.clan.emoji}</span>
        <span className="clan-home-text">
          <strong>{t.title} {me.clan.emoji}</strong>
          <span>{t.homeClanMeta(t.members(me.clan.members), rank)}</span>
        </span>
        <span className="clan-home-arrow" aria-hidden="true">›</span>
      </button>
    );
  }
  if (!me.canFound) return null;
  return (
    <button type="button" className="clan-home-card claim" onClick={onOpen}>
      <span className="clan-home-emoji" aria-hidden="true">❔</span>
      <span className="clan-home-text">
        <strong>{t.homeClaim}</strong>
        <span>{t.homeClaimText}</span>
      </span>
      <span className="clan-home-arrow" aria-hidden="true">›</span>
    </button>
  );
}
