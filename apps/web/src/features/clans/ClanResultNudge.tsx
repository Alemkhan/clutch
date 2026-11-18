import { useEffect } from 'react';
import { CLAN_TOP_MEMBERS, type ClanMeResponse } from '@clutch/shared';
import { useMessages } from '../../i18n/messages';
import { useClanInvite, type InviteStatus } from './clanInvite';
import { loadMyClan, useMyClan } from './clanStore';
import { clansEnabled } from './clansEnabled';
import { m } from './messages';

/**
 * Клан на экране итога забега дня — в момент, когда очки только что заработаны. Пока в клане
 * меньше десяти человек, зовём заразить друга: пустые места в зачёте недели — нули. Без клана
 * (после первого забега это уже можно) — занять своё эмодзи.
 */
export function ClanResultNudge({ onClan }: { onClan?: () => void }) {
  const clan = useMyClan();
  const invite = useClanInvite('result');
  // Забег только что сохранился: вклад и «можно занять» изменились.
  useEffect(() => { void loadMyClan(true); }, []);
  if (clan.status !== 'ready' || !clansEnabled()) return null;
  return <ClanResultNudgeView me={clan.me} onClan={onClan} onInvite={() => clan.me.clan && invite.share(clan.me.clan)} inviteStatus={invite.status} />;
}

export function ClanResultNudgeView({ me, onClan, onInvite, inviteStatus = 'idle' }: {
  me: ClanMeResponse;
  onClan?: () => void;
  onInvite: () => void;
  inviteStatus?: InviteStatus;
}) {
  const t = useMessages(m);
  const clan = me.clan;
  if (!clan) {
    if (!me.canFound || !onClan) return null;
    return (
      <section className="clan-nudge">
        <span className="clan-nudge-emoji" aria-hidden="true">❔</span>
        <div className="clan-nudge-body">
          <strong>{t.homeClaim}</strong>
          <span>{t.homeClaimText}</span>
        </div>
        <button type="button" className="clan-nudge-btn" onClick={onClan}>{t.nudgeClaim}</button>
      </section>
    );
  }
  const short = clan.members < CLAN_TOP_MEMBERS;
  return (
    <section className="clan-nudge">
      <span className="clan-nudge-emoji" aria-hidden="true">{clan.emoji}</span>
      <div className="clan-nudge-body">
        <strong>{short ? t.nudgeNeed(clan.emoji, CLAN_TOP_MEMBERS, clan.members) : t.nudgeContribution(clan.emoji)}</strong>
        <span>{t.nudgePoints(t.points(clan.youWeekPoints))}</span>
        {inviteStatus === 'copied' && <span role="status">{t.inviteCopied}</span>}
        {inviteStatus === 'failed' && <span role="status">{t.inviteFailed}</span>}
        {inviteStatus === 'unavailable' && <span role="status">{t.inviteUnavailable}</span>}
      </div>
      {short
        ? <button type="button" className="clan-nudge-btn" onClick={onInvite}>{t.nudgeInvite}</button>
        : onClan && <button type="button" className="clan-nudge-btn" onClick={onClan}>{t.toClan}</button>}
    </section>
  );
}
