import { messagesFor, useMessages } from '../../i18n/messages';
import { m } from './messages';
import type { ReactNode } from 'react';
import { betterThanPercent, isPublicPlace, type WikiPathBoardResponse, type WikiPathBoardRouteResponse } from '@clutch/shared';
import { useEffect, useState } from 'react';
import { fetchWikiPathBoardRoute } from '../../platform/api';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
import { Creature } from '../../ui/Creature';
import { displayPlayerName } from '../../i18n/playerName';
export type WikiPathBoardState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; board: WikiPathBoardResponse };
type WikiPathRouteState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; route: WikiPathBoardRouteResponse };
export function wikiPathClicksText(clicks: number): string {
  return messagesFor(m).clicks(clicks);
}

function hiddenCount(board: WikiPathBoardResponse): number {
  return board.total === undefined ? 0 : Math.max(0, board.total - board.entries.length);
}

/**
 * Своя строка над таблицей. Место ниже общей половины видит только сам игрок, поэтому ему
 * показываем долю обойдённых, а не номер «последнего».
 */
function WikiPathYou({ board, onPlay }: { board: WikiPathBoardResponse; onPlay: () => void }) {
  const t = useMessages(m);
  if (board.ownGaveUp) {
    if (board.entries.length === 0) return null;
    return <div className="solo-board-you"><p className="solo-board-you-text">{t.wikiGaveUpRoutes}</p></div>;
  }
  if (board.ownRank === null) {
    return <div className="solo-board-you">
      <p className="solo-board-you-text">{t.wikiNotDone}</p>
      <button type="button" className="cta-btn solo-board-play" onClick={onPlay}>{t.wikiPath}</button>
      {board.entries.length > 0 && <p className="solo-board-you-text">{t.wikiFinishToSee}</p>}
    </div>;
  }
  const total = board.total ?? board.entries.length;
  if (isPublicPlace(board.ownRank, total)) {
    return <div className="solo-board-you"><p className="solo-board-you-text">{t.wikiYourPlace(board.ownRank)}</p></div>;
  }
  const percent = betterThanPercent(board.ownRank, total);
  return <div className="solo-board-you">
    <p className="solo-board-you-text">
      {board.ownClicks != null ? t.wikiYourResult(wikiPathClicksText(board.ownClicks)) : t.finishCounted}
      {' · '}{percent ? t.betterThan(percent) : t.finishCounted}
    </p>
    <p className="solo-board-you-text">{t.privatePlace}</p>
  </div>;
}

export function WikiPathBoardView({ state, msLeft, onBack, onRetry, onPlay, kindSwitch }: {
  state: WikiPathBoardState;
  msLeft: number;
  onBack: () => void;
  onRetry: () => void;
  onPlay: () => void;
  kindSwitch?: ReactNode;
}) {
  const t = useMessages(m);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [routeState, setRouteState] = useState<WikiPathRouteState>({ status: 'idle' });
  const [routeAttempt, setRouteAttempt] = useState(0);

  useEffect(() => {
    if (!selectedRunId) {
      setRouteState({ status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setRouteState({ status: 'loading' });
    fetchWikiPathBoardRoute(selectedRunId, controller.signal)
      .then((route) => { if (!controller.signal.aborted) setRouteState({ status: 'ready', route }); })
      .catch(() => { if (!controller.signal.aborted) setRouteState({ status: 'error' }); });
    return () => controller.abort();
  }, [selectedRunId, routeAttempt]);

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
      {state.status === 'ready' && <WikiPathYou board={state.board} onPlay={onPlay} />}
      {state.status === 'ready' && <>

        {state.board.entries.length === 0 ? (
          <div className="my-runs-message">
            <p className="matchmaking-error">{t.wikiEmpty}</p>
          </div>
        ) : <>
          <ol className="solo-board-list">
            {state.board.entries.map((entry) => (
              <li key={entry.runId} className="wiki-path-board-item">
                {state.board.ownRank === null && !state.board.ownGaveUp ? (
                  <div className="solo-board-row">
                    <span className="solo-board-place">{entry.rank}</span>
                    <span className="solo-board-avatar" aria-hidden="true"><Creature seed={entry.displayName} /></span>
                    <span className="solo-board-name" title={displayPlayerName(entry.displayName)}>{displayPlayerName(entry.displayName)}</span>
                    <span className="solo-board-score">{wikiPathClicksText(entry.clicks)}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="solo-board-row wiki-path-board-row"
                    aria-expanded={selectedRunId === entry.runId}
                    onClick={() => setSelectedRunId((current) => current === entry.runId ? null : entry.runId)}
                  >
                    <span className="solo-board-place">{entry.rank}</span>
                    <span className="solo-board-avatar" aria-hidden="true"><Creature seed={entry.displayName} /></span>
                    <span className="solo-board-name" title={displayPlayerName(entry.displayName)}>{displayPlayerName(entry.displayName)}</span>
                    <span className="solo-board-score">{wikiPathClicksText(entry.clicks)}</span>
                    <span className="wiki-path-board-chevron" aria-hidden="true">⌄</span>
                  </button>
                )}
                {selectedRunId === entry.runId && (
                  <div className="wiki-path-board-route" aria-live="polite">
                    {routeState.status === 'loading' && <p>{t.routeLoading}</p>}
                    {routeState.status === 'error' && <>
                      <p role="alert">{t.routeError}</p>
                      <button type="button" className="ghost-btn" onClick={() => setRouteAttempt((value) => value + 1)}>{t.retry}</button>
                    </>}
                    {routeState.status === 'ready' && (
                      <ol aria-label={t.routeLabel(routeState.route.displayName)}>
                        {routeState.route.titles.map((title, index) => <li key={`${index}-${title}`}>{title}</li>)}
                      </ol>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {hiddenCount(state.board) > 0 && <p className="solo-board-note">{t.hiddenRest(hiddenCount(state.board))}</p>}
          <p className="solo-board-note">{t.wikiNote}</p>
        </>}
      </>}
    </section>
  );
}
