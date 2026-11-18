import { useEffect, useState } from 'react';
import type { ClanJoinResponse } from '@clutch/shared';
import { ApiError, joinClan } from '../../platform/api';
import { displayPlayerName } from '../../i18n/playerName';
import { useMessages } from '../../i18n/messages';
import { setMyClan } from './clanStore';
import { m } from './messages';

type JoinState =
  | { status: 'joining' }
  | { status: 'done'; result: ClanJoinResponse }
  | { status: 'gone' }
  | { status: 'error' };

/** Ссылка «заразить друга»: вступление сразу при входе, без лишнего шага. */
export function ClanInviteEntry({ code, onClan, onPlay }: { code: string; onClan: () => void; onPlay: () => void }) {
  const [state, setState] = useState<JoinState>({ status: 'joining' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'joining' });
    joinClan(code, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setMyClan(result.me);
        setState({ status: 'done', result });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState(error instanceof ApiError && (error.status === 404 || error.status === 400) ? { status: 'gone' } : { status: 'error' });
      },
    );
    return () => controller.abort();
  }, [code, attempt]);
  return <ClanInviteEntryView state={state} onClan={onClan} onPlay={onPlay} onRetry={() => setAttempt((n) => n + 1)} />;
}

export function ClanInviteEntryView({ state, onClan, onPlay, onRetry }: {
  state: JoinState; onClan: () => void; onPlay: () => void; onRetry: () => void;
}) {
  const t = useMessages(m);
  const clan = state.status === 'done' ? state.result.me.clan : null;
  return (
    <section className="matchmaking clan-invite-entry">
      <div className="matchmaking-body">
        {state.status === 'joining' && <div className="matchmaking-loading" role="status"><span /> {t.joining}</div>}
        {state.status === 'gone' && <p className="matchmaking-error" role="alert">{t.inviteGone}</p>}
        {state.status === 'error' && (
          <>
            <p className="matchmaking-error" role="alert">{t.loadError}</p>
            <button type="button" className="cta-btn" onClick={onRetry}>{t.retry}</button>
          </>
        )}
        {clan && state.status === 'done' && (
          <>
            <span className="clan-hero-emoji clan-infect" aria-hidden="true">{clan.emoji}</span>
            {state.result.status === 'joined' ? (
              <>
                <h1 className="screen-title">{t.joined(clan.emoji)}</h1>
                <p className="matchmaking-status">
                  {t.joinedText(clan.invitedByName ? displayPlayerName(clan.invitedByName) : null, t.members(clan.members))}
                </p>
              </>
            ) : (
              <>
                <h1 className="screen-title">{t.already(clan.emoji)}</h1>
                <p className="matchmaking-status">{t.alreadyText}</p>
              </>
            )}
            <button type="button" className="cta-btn" onClick={onPlay}>{t.play}</button>
            <button type="button" className="ghost-btn" onClick={onClan}>{t.toClan}</button>
          </>
        )}
        {(state.status === 'gone' || state.status === 'error') && <button type="button" className="ghost-btn" onClick={onPlay}>{t.play}</button>}
      </div>
    </section>
  );
}
