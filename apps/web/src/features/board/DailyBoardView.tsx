import { messagesFor, useMessages } from '../../i18n/messages';
import { m } from './messages';
import type { ReactNode } from 'react';
import { betterThanPercent, isCategoryOpen, isPublicPlace, type CategoryId, type SoloLeaderboardResponse, type SoloLeaderboardStanding, type SoloMode } from '@clutch/shared';
import { categoryName, finishedText, roundsShort, soloRoundsText } from '../myRuns/myRunsView';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
import { PlayerAvatar } from '../../ui/PlayerAvatar';
import { displayPlayerName } from '../../i18n/playerName';
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
  const t = messagesFor(m);
  if (standing.roundsToNext === null) return t.first;
  if (standing.outrankedByGuess) {
    if (standing.tiebreak === 'guest') return t.tieGuest;
    if (standing.tiebreak === 'answered') return t.tieAnswered;
    return t.tieAnswer;
  }
  const gap = standing.roundsToNext === 1 ? t.oneRound : soloRoundsText(standing.roundsToNext);
  return t.toPlace(standing.placeAbove ?? standing.rank - 1, gap);
}
/** Место ниже общей половины таблицы: другие его не видят, и показываем мы его мягче. */
function isPrivateStanding(standing: SoloLeaderboardStanding): boolean {
  return !isPublicPlace(standing.rank, standing.total);
}

function privateStandingHint(standing: SoloLeaderboardStanding): string {
  const t = messagesFor(m);
  const percent = betterThanPercent(standing.rank, standing.total);
  return percent ? t.betterThan(percent) : t.finishCounted;
}

export function SoloBoardView({ state, msLeft, category, onCategory, onBack, onRetry, onPlay, kindSwitch }: SoloBoardViewProps) {
  const t = useMessages(m);
  // Попытка забега дня одна: сыгравшего таблица зовёт в дуэль, а не во второй забег дня.
  const played = state.status === 'ready' && (state.board.you !== null || state.board.dailyAttempt === 'completed');
  const playButton = played
    ? { label: t.duel, mode: 'duel' as const }
    : { label: t.daily, mode: 'daily' as const };
  return (
    <section className="solo-board">
      <ScreenHeader onBack={onBack} title={t.title} />
      <p className="solo-board-reset">{resetLabel(msLeft)}</p>
      {kindSwitch}

      <div className="solo-board-tabs" role="tablist" aria-label={t.categoryLabel}>
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
          {/* Своё место видно всегда, даже когда игрок далеко за топ-50. */}
          {state.board.you && (
            <div className="solo-board-you">
              <div className="solo-board-you-row">
                {isPrivateStanding(state.board.you)
                  ? <span className="solo-board-you-rank" aria-hidden="true">✓</span>
                  : <span className="solo-board-you-rank">{state.board.you.rank}<span className="visually-hidden">{t.placeSuffix}</span></span>}
                <div className="solo-board-you-info">
                  <span className="solo-board-you-hint">{isPrivateStanding(state.board.you) ? privateStandingHint(state.board.you) : standingHint(state.board.you)}</span>
                  {isPrivateStanding(state.board.you) && <span className="solo-board-you-meta">{t.privatePlace}</span>}
                  {/* Пар набора игроку не показывается: он откалиброван на старом молотке и занижен
                      на 12–22% (см. SKILL_SHARE). Круги — честное число, их и показываем. */}
                  <span className="solo-board-you-meta">
                    {t.youMeta(soloRoundsText(state.board.you.entry.roundsPlayed), finishedText(state.board.you.total))}
                  </span>
                </div>
              </div>
              <button type="button" className="cta-btn solo-board-play" onClick={() => onPlay(category, playButton.mode)}>{playButton.label}</button>
            </div>
          )}

          {!state.board.you && state.board.entries.length > 0 && (
            <div className="solo-board-you">
              <p className="solo-board-you-text">
                {t.notOnBoard}
              </p>
              <button type="button" className="cta-btn solo-board-play" onClick={() => onPlay(category, playButton.mode)}>{playButton.label}</button>
            </div>
          )}

          {state.board.entries.length === 0 && (
            <div className="my-runs-message">
              <p className="matchmaking-error">{t.emptyDaily}</p>
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
                      <span className="solo-board-avatar" aria-hidden="true">{mine && !entry.clanEmoji ? t.youAvatar : <PlayerAvatar seed={entry.displayName} emoji={entry.clanEmoji} />}</span>
                      <span className="solo-board-name" title={displayPlayerName(entry.displayName)}>{mine ? t.you : displayPlayerName(entry.displayName)}</span>
                      <span className="solo-board-score">{roundsShort(entry.roundsPlayed)}</span>
                    </li>
                  );
                })}
              </ol>
              {(state.board.total ?? 0) > state.board.entries.length && (
                <p className="solo-board-note">{t.hiddenRest((state.board.total ?? 0) - state.board.entries.length)}</p>
              )}
              {/* Правда для текущей таблицы: равных разводит прикидка дня (R25), длительность не участвует. */}
              <p className="solo-board-note">{t.dailyNote}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
