import type { ReactNode } from 'react';
import type { WikiPathBoardResponse, WikiPathBoardRouteResponse } from '@clutch/shared';
import { useEffect, useState } from 'react';
import { fetchWikiPathBoardRoute } from '../../platform/api';
import { initials } from '../myRuns/myRunsView';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
export type WikiPathBoardState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; board: WikiPathBoardResponse };
type WikiPathRouteState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; route: WikiPathBoardRouteResponse };
export function wikiPathClicksText(clicks: number): string {
  const mod100 = clicks % 100;
  const mod10 = clicks % 10;
  const word = mod100 >= 11 && mod100 <= 14
    ? 'переходов'
    : mod10 === 1 ? 'переход' : mod10 >= 2 && mod10 <= 4 ? 'перехода' : 'переходов';
  return `${clicks} ${word}`;
}

export function WikiPathBoardView({ state, msLeft, onBack, onRetry, onPlay, kindSwitch }: {
  state: WikiPathBoardState;
  msLeft: number;
  onBack: () => void;
  onRetry: () => void;
  onPlay: () => void;
  kindSwitch?: ReactNode;
}) {
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
      <ScreenHeader onBack={onBack} title="Таблица дня" />
      <p className="solo-board-reset">{resetLabel(msLeft)}</p>
      {kindSwitch}

      {state.status === 'loading' && (
        <div className="matchmaking-loading" role="status"><span /> Загружаем таблицу</div>
      )}
      {state.status === 'error' && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">Не удалось загрузить таблицу. Проверь соединение и попробуй ещё раз.</p>
          <button type="button" className="cta-btn" onClick={onRetry}>Повторить</button>
        </div>
      )}
      {state.status === 'ready' && <>
        <div className="solo-board-you">
          <p className="solo-board-you-text">{state.board.ownRank === null
            ? 'Ты ещё не завершил сегодняшний Вики-путь.'
            : `Твоё место сегодня: ${state.board.ownRank}`}</p>
          {state.board.ownRank === null && (
            <button type="button" className="cta-btn solo-board-play" onClick={onPlay}>Вики-путь</button>
          )}
          {state.board.ownRank === null && state.board.entries.length > 0 && (
            <p className="solo-board-you-text">Заверши маршрут, чтобы посмотреть пути других игроков.</p>
          )}
        </div>

        {state.board.entries.length === 0 ? (
          <div className="my-runs-message">
            <p className="matchmaking-error">Сегодня маршрут ещё никто не завершил.</p>
          </div>
        ) : <>
          <ol className="solo-board-list">
            {state.board.entries.map((entry) => (
              <li key={entry.runId} className="wiki-path-board-item">
                {state.board.ownRank === null ? (
                  <div className="solo-board-row">
                    <span className="solo-board-place">{entry.rank}</span>
                    <span className="solo-board-avatar" aria-hidden="true">{initials(entry.displayName)}</span>
                    <span className="solo-board-name" title={entry.displayName}>{entry.displayName}</span>
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
                    <span className="solo-board-avatar" aria-hidden="true">{initials(entry.displayName)}</span>
                    <span className="solo-board-name" title={entry.displayName}>{entry.displayName}</span>
                    <span className="solo-board-score">{wikiPathClicksText(entry.clicks)}</span>
                    <span className="wiki-path-board-chevron" aria-hidden="true">⌄</span>
                  </button>
                )}
                {selectedRunId === entry.runId && (
                  <div className="wiki-path-board-route" aria-live="polite">
                    {routeState.status === 'loading' && <p>Загружаем путь…</p>}
                    {routeState.status === 'error' && <>
                      <p role="alert">Не удалось загрузить путь.</p>
                      <button type="button" className="ghost-btn" onClick={() => setRouteAttempt((value) => value + 1)}>Повторить</button>
                    </>}
                    {routeState.status === 'ready' && (
                      <ol aria-label={`Путь игрока ${routeState.route.displayName}`}>
                        {routeState.route.titles.map((title, index) => <li key={`${index}-${title}`}>{title}</li>)}
                      </ol>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="solo-board-note">Меньше переходов — выше. При равенстве место общее</p>
        </>}
      </>}
    </section>
  );
}
