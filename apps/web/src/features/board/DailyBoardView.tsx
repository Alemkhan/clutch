import type { ReactNode } from 'react';
import { isCategoryOpen, type CategoryId, type SoloLeaderboardResponse, type SoloLeaderboardStanding, type SoloMode } from '@clutch/shared';
import { categoryName, finishedText, initials, roundsShort, soloRoundsText } from '../myRuns/myRunsView';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
export type SoloBoardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; board: SoloLeaderboardResponse };

const CATEGORIES: ReadonlyArray<CategoryId> = (['general', 'geography', 'history', 'languages', 'kz_history'] as const)
  .filter((category) => isCategoryOpen(category));
interface SoloBoardViewProps {
  state: SoloBoardState;
  msLeft: number;
  category: CategoryId;
  onCategory: (category: CategoryId) => void;
  onBack: () => void;
  onRetry: () => void;
  onPlay: (category: CategoryId, mode: SoloMode) => void;
  kindSwitch?: ReactNode;
}
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
export function SoloBoardView({ state, msLeft, category, onCategory, onBack, onRetry, onPlay, kindSwitch }: SoloBoardViewProps) {
  // Попытка забега дня одна: сыгравшего таблица зовёт в дуэль, а не во второй забег дня.
  const played = state.status === 'ready' && (state.board.you !== null || state.board.dailyAttempt === 'completed');
  const playButton = played
    ? { label: 'Дуэль', mode: 'duel' as const }
    : { label: 'Забег дня', mode: 'daily' as const };
  return (
    <section className="solo-board">
      <ScreenHeader onBack={onBack} title="Таблица дня" />
      <p className="solo-board-reset">{resetLabel(msLeft)}</p>
      {kindSwitch}

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
              <button type="button" className="cta-btn solo-board-play" onClick={() => onPlay(category, playButton.mode)}>{playButton.label}</button>
            </div>
          )}

          {!state.board.you && state.board.entries.length > 0 && (
            <div className="solo-board-you">
              <p className="solo-board-you-text">
                Твоего забега дня здесь нет: в таблицу идёт первая попытка, если она дошла до 100%.
              </p>
              <button type="button" className="cta-btn solo-board-play" onClick={() => onPlay(category, playButton.mode)}>{playButton.label}</button>
            </div>
          )}

          {state.board.entries.length === 0 && (
            <div className="my-runs-message">
              <p className="matchmaking-error">Сегодня в этой категории ещё никто не дошёл до цели.</p>
              <button type="button" className="cta-btn" onClick={() => onPlay(category, playButton.mode)}>{playButton.label}</button>
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
