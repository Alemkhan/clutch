import { useMessages } from '../../i18n/messages';
import { m } from './messages';
import type { ReactNode } from 'react';
import type { DuelBoardResponse } from '@clutch/shared';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
import { Creature } from '../../ui/Creature';
import { displayPlayerName } from '../../i18n/playerName';
export type DuelBoardState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; board: DuelBoardResponse };
/** Счёт как в UFC: победы–ничьи–поражения. */
export function duelRecord(entry: { wins: number; draws: number; losses: number }): string {
  return `${entry.wins}–${entry.draws}–${entry.losses}`;
}

export function DuelBoardView({ state, msLeft, onBack, onRetry, onDuel, kindSwitch }: {
  state: DuelBoardState;
  msLeft: number;
  onBack: () => void;
  onRetry: () => void;
  onDuel: () => void;
  kindSwitch?: ReactNode;
}) {
  const t = useMessages(m);
  return (
    <section className="solo-board">
      <ScreenHeader onBack={onBack} title={t.title} />
      <p className="solo-board-reset">{resetLabel(msLeft)}</p>
      {kindSwitch}

      {state.status === 'loading' && (
        <div className="matchmaking-loading" role="status"><span /> {t.loading}</div>
      )}

      {state.status === 'error' && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">{t.loadError}</p>
          <button type="button" className="cta-btn" onClick={onRetry}>{t.retry}</button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="solo-board-you">
            <p className="solo-board-you-text">
              {state.board.you
                ? t.duelYou(duelRecord(state.board.you), state.board.you.rank)
                : t.duelNoneYou}
            </p>
            <button type="button" className="cta-btn solo-board-play" onClick={onDuel}>{t.duel}</button>
          </div>

          {state.board.entries.length === 0 ? (
            <div className="my-runs-message">
              <p className="matchmaking-error">{t.duelEmpty}</p>
            </div>
          ) : (
            <>
              <ol className="solo-board-list">
                {state.board.entries.map((entry, index) => (
                  <li key={`${entry.rank}-${entry.displayName}-${index}`} className="solo-board-row">
                    <span className="solo-board-place">{entry.rank}</span>
                    <span className="solo-board-avatar" aria-hidden="true"><Creature seed={entry.displayName} /></span>
                    <span className="solo-board-name" title={displayPlayerName(entry.displayName)}>{displayPlayerName(entry.displayName)}</span>
                    <span className="solo-board-score" aria-label={t.duelScoreLabel(entry.wins, entry.draws, entry.losses)}>
                      {duelRecord(entry)}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="solo-board-note">{t.duelNote}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
