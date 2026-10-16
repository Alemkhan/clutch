import { useEffect, useState } from 'react';
import type { CategoryId, SoloLeaderboardResponse, SoloLeaderboardStanding } from '@clutch/shared';
import { fetchSoloLeaderboard } from '../../platform/api';
import { categoryName, finishedText, initials, roundsShort, soloRoundsText } from '../myRuns/myRunsView';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
import { useDayCountdown } from '../tiebreaker/useDayCountdown';
import { ScreenHeader } from '../../ui/ScreenHeader';

/** Категории в том же порядке, что на экране выбора: общие знания первыми. */
const CATEGORIES: ReadonlyArray<CategoryId> = ['general', 'geography', 'history', 'languages'];

export type SoloBoardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; board: SoloLeaderboardResponse };

interface SoloBoardViewProps {
  state: SoloBoardState;
  /** Сколько осталось до конца игровых суток: таблица обнуляется вместе с набором. */
  msLeft: number;
  category: CategoryId;
  onCategory: (category: CategoryId) => void;
  onBack: () => void;
  onRetry: () => void;
  onPlay: (category: CategoryId) => void;
}

/**
 * «До 4-го места — один круг»: цель достижима, в отличие от «попасть в топ-50». Если стоящий выше
 * имеет те же круги, счёт круга ничего не даст — выше поставила прикидка «На глазок».
 */
export function standingHint(standing: SoloLeaderboardStanding): string {
  if (standing.roundsToNext === null) return 'Ты первый сегодня';
  if (standing.outrankedByGuess) {
    if (standing.tiebreak === 'guest') return 'Равных разводит «На глазок» — только с Telegram';
    if (standing.tiebreak === 'answered') return 'Выше с теми же кругами — по «На глазок»';
    return 'Ответь «На глазок» — поднимет над равными';
  }
  const gap = standing.roundsToNext === 1 ? 'один круг' : soloRoundsText(standing.roundsToNext);
  return `До ${standing.placeAbove ?? standing.rank - 1}-го места — ${gap}`;
}

export function SoloBoardView({ state, msLeft, category, onCategory, onBack, onRetry, onPlay }: SoloBoardViewProps) {
  return (
    <section className="solo-board">
      <ScreenHeader onBack={onBack} title="Таблица дня" />
      <p className="solo-board-reset">{resetLabel(msLeft)}</p>

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
              <div className="solo-board-you-row">
                <span className="solo-board-you-rank">{state.board.you.rank}<span className="visually-hidden">-е место</span></span>
                <div className="solo-board-you-info">
                  <span className="solo-board-you-hint">{standingHint(state.board.you)}</span>
                  {/* Пар набора игроку не показывается: он откалиброван на старом молотке и занижен
                      на 12–22% (см. SKILL_SHARE). Круги — честное число, их и показываем. */}
                  <span className="solo-board-you-meta">
                    Ты: {soloRoundsText(state.board.you.entry.roundsPlayed)} · {finishedText(state.board.you.total)}
                  </span>
                </div>
              </div>
              <button type="button" className="cta-btn solo-board-play" onClick={() => onPlay(category)}>Сыграть ещё набор</button>
            </div>
          )}

          {!state.board.you && state.board.entries.length > 0 && (
            <div className="solo-board-you">
              <p className="solo-board-you-text">
                Твоего забега сегодня здесь нет: в таблицу попадают только дошедшие до 100%.
              </p>
              <button type="button" className="cta-btn solo-board-play" onClick={() => onPlay(category)}>Играть</button>
            </div>
          )}

          {state.board.entries.length === 0 && (
            <div className="my-runs-message">
              <p className="matchmaking-error">Сегодня в этой категории ещё никто не дошёл до цели.</p>
              <button type="button" className="cta-btn" onClick={() => onPlay(category)}>Играть</button>
            </div>
          )}

          {state.board.entries.length > 0 && (
            <>
              <ol className="solo-board-list">
                {state.board.entries.map((entry, index) => {
                  // Место общее у ничьих (1, 2, 2, 4), поэтому «своя» строка — по месту и имени-метке.
                  const mine = state.board.you !== null
                    && state.board.you.rank === entry.rank
                    && state.board.you.entry.completedAt === entry.completedAt
                    && state.board.you.entry.displayName === entry.displayName;
                  return (
                    <li
                      key={`${entry.completedAt}-${entry.displayName}-${index}`}
                      className={mine ? 'solo-board-row mine' : 'solo-board-row'}
                    >
                      <span className="solo-board-place">{entry.rank}</span>
                      <span className="solo-board-avatar" aria-hidden="true">{mine ? 'ТЫ' : initials(entry.displayName)}</span>
                      <span className="solo-board-name" title={entry.displayName}>{mine ? 'Ты' : entry.displayName}</span>
                      <span className="solo-board-score">{roundsShort(entry.roundsPlayed)}</span>
                    </li>
                  );
                })}
              </ol>
              {/* Правда для текущей таблицы: равных разводит прикидка дня (R25), длительность не участвует. */}
              <p className="solo-board-note">При равных кругах выше тот, чья прикидка «На глазок» точнее</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

interface SoloBoardProps {
  onBack: () => void;
  onPlay: (category: CategoryId) => void;
}

export function SoloBoard({ onBack, onPlay }: SoloBoardProps) {
  const [category, setCategory] = useState<CategoryId>('general');
  const [state, setState] = useState<SoloBoardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const msLeft = useDayCountdown();

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
      msLeft={msLeft}
      category={category}
      onCategory={setCategory}
      onBack={onBack}
      onRetry={() => setAttempt((value) => value + 1)}
      onPlay={onPlay}
    />
  );
}
