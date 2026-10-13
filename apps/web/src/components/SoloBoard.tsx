import { useEffect, useState } from 'react';
import type { CategoryId, SoloLeaderboardResponse, SoloLeaderboardStanding } from '@clutch/shared';
import { fetchSoloLeaderboard } from '../lib/api';
import { categoryName, soloRoundsText } from '../lib/myRunsView';
import { ScreenHeader } from './ScreenHeader';

/** Категории в том же порядке, что на экране выбора: общие знания первыми. */
const CATEGORIES: ReadonlyArray<CategoryId> = ['general', 'geography', 'history', 'languages'];

export type SoloBoardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; board: SoloLeaderboardResponse };

interface SoloBoardViewProps {
  state: SoloBoardState;
  category: CategoryId;
  onCategory: (category: CategoryId) => void;
  onBack: () => void;
  onRetry: () => void;
  onPlay: () => void;
}

/** «до 36-го один круг»: цель достижима, в отличие от «попасть в топ-50». */
export function standingHint(standing: SoloLeaderboardStanding): string {
  if (standing.roundsToNext === null) return 'Выше никого: это первое место дня.';
  const gap = standing.roundsToNext === 1 ? 'один круг' : soloRoundsText(standing.roundsToNext);
  return `До ${standing.rank - 1}-го места — ${gap}.`;
}

export function SoloBoardView({ state, category, onCategory, onBack, onRetry, onPlay }: SoloBoardViewProps) {
  return (
    <section className="solo-board">
      <ScreenHeader onBack={onBack} title="Таблица дня" />

      <div className="solo-board-tabs" role="tablist" aria-label="Категория">
        {CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === category}
            className={id === category ? 'solo-board-tab active' : 'solo-board-tab'}
            onClick={() => { if (id !== category) onCategory(id); }}
          >
            {categoryName(id)}
          </button>
        ))}
      </div>

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
          {/* Своё место видно всегда, даже когда игрок далеко за топ-50. */}
          {state.board.you && (
            <div className="solo-board-you">
              <span className="solo-board-you-rank">
                {state.board.you.rank}-й из {state.board.you.total}
              </span>
              <span className="solo-board-you-meta">
                {soloRoundsText(state.board.you.entry.roundsPlayed)} · пар {state.board.you.entry.setPar}
              </span>
              <span className="solo-board-you-hint">{standingHint(state.board.you)}</span>
            </div>
          )}

          {state.board.entries.length === 0 && (
            <div className="my-runs-message">
              <p className="matchmaking-error">Сегодня в этой категории ещё никто не дошёл до цели.</p>
              <button type="button" className="cta-btn" onClick={onPlay}>Играть</button>
            </div>
          )}

          {state.board.entries.length > 0 && (
            <ol className="solo-board-list">
              {state.board.entries.map((entry, index) => (
                <li
                  key={`${entry.completedAt}-${entry.displayName}-${index}`}
                  className={state.board.you?.rank === index + 1 ? 'solo-board-row mine' : 'solo-board-row'}
                >
                  <span className="solo-board-place">{index + 1}</span>
                  <span className="solo-board-name">{entry.displayName}</span>
                  <span className="solo-board-score">{soloRoundsText(entry.roundsPlayed)}</span>
                </li>
              ))}
            </ol>
          )}

          {!state.board.you && state.board.entries.length > 0 && (
            <p className="solo-board-note">
              Твоего забега сегодня здесь нет: в таблицу попадают только дошедшие до 100%.
            </p>
          )}
        </>
      )}
    </section>
  );
}

interface SoloBoardProps {
  onBack: () => void;
  onPlay: () => void;
}

export function SoloBoard({ onBack, onPlay }: SoloBoardProps) {
  const [category, setCategory] = useState<CategoryId>('general');
  const [state, setState] = useState<SoloBoardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchSoloLeaderboard(category, controller.signal)
      .then((board) => { if (!controller.signal.aborted) setState({ status: 'ready', board }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => controller.abort();
  }, [category, attempt]);

  return (
    <SoloBoardView
      state={state}
      category={category}
      onCategory={setCategory}
      onBack={onBack}
      onRetry={() => setAttempt((value) => value + 1)}
      onPlay={onPlay}
    />
  );
}
