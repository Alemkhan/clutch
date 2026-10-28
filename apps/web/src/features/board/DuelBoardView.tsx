import type { ReactNode } from 'react';
import type { DuelBoardResponse } from '@clutch/shared';
import { initials } from '../myRuns/myRunsView';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
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

      {state.status === 'ready' && (
        <>
          <div className="solo-board-you">
            <p className="solo-board-you-text">
              {state.board.you
                ? `Ты сегодня: ${duelRecord(state.board.you)} · ${state.board.you.rank}-е место`
                : 'Сегодня у тебя ещё нет законченных дуэлей.'}
            </p>
            <button type="button" className="cta-btn solo-board-play" onClick={onDuel}>Дуэль</button>
          </div>

          {state.board.entries.length === 0 ? (
            <div className="my-runs-message">
              <p className="matchmaking-error">Сегодня ещё никто не довёл дуэль до конца.</p>
            </div>
          ) : (
            <>
              <ol className="solo-board-list">
                {state.board.entries.map((entry, index) => (
                  <li key={`${entry.rank}-${entry.displayName}-${index}`} className="solo-board-row">
                    <span className="solo-board-place">{entry.rank}</span>
                    <span className="solo-board-avatar" aria-hidden="true">{initials(entry.displayName)}</span>
                    <span className="solo-board-name" title={entry.displayName}>{entry.displayName}</span>
                    <span className="solo-board-score" aria-label={`Победы ${entry.wins}, ничьи ${entry.draws}, поражения ${entry.losses}`}>
                      {duelRecord(entry)}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="solo-board-note">Победы – ничьи – поражения за сегодня во всех категориях. Выше тот, у кого больше побед, при равных — меньше поражений</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
