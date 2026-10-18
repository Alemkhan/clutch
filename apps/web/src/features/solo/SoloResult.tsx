import { useEffect, useRef } from 'react';
import { SOLO_ROUND_CAP, SOLO_TARGET_PROGRESS, dailyKey } from '@clutch/shared';
import type { CategoryId, CompleteSoloRunResponse, MiniGameId, Opponent, SkillResult, SoloMode } from '@clutch/shared';
import { playSound } from '../../platform/sounds';
import { buildReceiptStats, buildSoloResult, circles, countPerfectStrikes, type RunStandingState, type SoloSaveStatus } from './soloResultModel';
import { buildSoloShareText, useSoloShare } from './soloShare';
import { categoryName } from '../myRuns/myRunsView';
import { useRunStanding } from './useRunStanding';
import type { SoloRunView } from './soloRunSession';
import type { PracticeSummary } from './practiceResult';
import { FRIEND_DUEL_CHIP, type FriendDuelSummary } from './friendDuelResult';
import { useFriendInvite } from './useFriendInvite';
import { getTelegramIdentity } from '../../platform/telegram';
import { buildRunPreviewUrl, previewBase, roundTiles } from '../../platform/share';

interface SoloResultProps {
  view: SoloRunView;
  saveStatus: SoloSaveStatus;
  response: CompleteSoloRunResponse | null;
  saveError?: string;
  canRetrySave: boolean;
  onRetrySave: () => void;
  onReplay: () => void;
  onMyRuns: () => void;
  /** Тренировка против бота: короткий итог без сохранения; «Мои партии» заменяет выбор уровня. */
  practice?: PracticeSummary | null;
  onExitPractice?: () => void;
  /** Дружеская дуэль: вне соревнования, но исход против записи автора показывается. */
  friendDuel?: FriendDuelSummary | null;
  /** Категория забега: подпись под заголовком и таблица дня, в которой ищем место. */
  category?: CategoryId;
  /** Верные ответы и удары забега; верные из ответа сервера главнее. */
  correctCount?: number;
  skillResults?: readonly SkillResult[];
  /** Прогресс каждого сыгранного круга по порядку: квадраты на карточке превью. */
  roundAwards?: readonly number[];
  /** Подмена места (тесты); без неё место берётся из таблицы дня. */
  standing?: RunStandingState;
  /** Режим забега: от него зависят главная кнопка, место в таблице и «ждёт соперника». */
  mode?: SoloMode | null;
  /** Потолок кругов забега: у дуэли — круг, на котором финишировал соперник. */
  roundCap?: number;
  /** Запись соперника (дуэль): по ней видно, что партию кончил его финиш. */
  pace?: Opponent | null;
  miniGameId?: MiniGameId;
  /** Сыграть в другом режиме: дуэль, свободная игра. */
  onPlayMode?: (mode: SoloMode) => void;
}

/** Партию кончил финиш соперника: заголовок говорит это словами мини-игры. */
export function opponentFinishedHeadline(miniGameId: MiniGameId | undefined): string {
  return miniGameId === 'tower_stack' ? 'Соперник достроил башню первым' : 'Соперник забил гвоздь первым';
}

/** Заголовок итога дуэли: победа, поражение (словами мини-игры, если партию кончил финиш соперника) или ничья. */
export function duelHeadline(
  outcome: CompleteSoloRunResponse['outcome'],
  rival: string,
  opponentFinished: boolean,
  miniGameId: MiniGameId | undefined,
): { text: string; tone: 'win' | 'loss' | 'tie' } | null {
  // Имя не склоняем («над Дамир»): оно стоит в именительном падеже.
  if (outcome === 'player') return { text: `Победа: ${rival} позади`, tone: 'win' };
  if (outcome === 'opponent') {
    return { text: opponentFinished ? opponentFinishedHeadline(miniGameId) : `${rival} оказался быстрее`, tone: 'loss' };
  }
  if (outcome === 'tie') return { text: 'Ничья', tone: 'tie' };
  return null;
}

/** Главная кнопка итога по режиму: после забега дня — дуэль, после свободной игры и дуэли — ещё одна. */
const NEXT_ACTION: Readonly<Record<SoloMode, { mode: SoloMode; label: string }>> = {
  daily: { mode: 'duel', label: 'Дуэль' },
  free: { mode: 'free', label: 'Ещё набор' },
  duel: { mode: 'duel', label: 'Ещё дуэль' },
};

/**
 * Два разных итога: дошёл до 100% либо упёрся в потолок. Второй не выдаётся за победу.
 * Исхода против соперника здесь нет: результат зафиксирован, а исход живёт в «Моих партиях».
 */
export function SoloResult({
  view,
  saveStatus,
  response,
  saveError,
  canRetrySave,
  onRetrySave,
  onReplay,
  onMyRuns,
  practice,
  onExitPractice,
  friendDuel,
  category = 'general',
  correctCount = 0,
  skillResults = [],
  roundAwards = [],
  standing,
  mode = null,
  roundCap = SOLO_ROUND_CAP,
  pace = null,
  miniGameId,
  onPlayMode,
}: SoloResultProps) {
  const result = buildSoloResult({ view, save: saveStatus, response });
  // Дуэль кончилась на круге финиша соперника, а игрок до 100% не дошёл: он проиграл раньше конца набора.
  const opponentFinished = pace !== null && !practice && !result.reachedTarget
    && roundCap < SOLO_ROUND_CAP && result.roundsPlayed >= roundCap;
  const preview = roundAwards.length > 0
    ? { tiles: roundTiles(roundAwards, skillResults), progress: result.progress, category, day: dailyKey(Date.now()) }
    : undefined;
  const playedRef = useRef(false);
  const practiceWon = practice ? practice.outcome === 'player' : null;
  const invite = useFriendInvite(response?.runId, preview);
  const resultShare = useSoloShare();
  // Место есть только у сохранённого забега дня, дошедшего до 100%.
  const ranked = saveStatus === 'saved' && response?.reachedTarget === true && mode === 'daily';
  const fetched = useRunStanding(category, ranked && !standing);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    playSound((practiceWon ?? result.reachedTarget) ? 'matchWin' : 'matchLose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (practice) {
    const practiceTone = practice.outcome === 'player' ? 'win' : practice.outcome === 'tie' ? 'tie' : 'loss';
    return (
      <div className="result-screen solo-result practice">
        <span className="chip">Тренировка · не засчитывается</span>
        <h1 className={`result-headline ${practiceTone}`}>{practice.headline}</h1>
        <p className="solo-result-summary">{practice.line}</p>
        <div className="result-actions solo-result-actions">
          <button type="button" className="cta-btn" onClick={() => { onReplay(); }}>Ещё раз</button>
          <button type="button" className="ghost-btn" onClick={() => { onExitPractice?.(); }}>Другой уровень</button>
        </div>
      </div>
    );
  }

  // Уход с экрана оборвал бы отправку результата, поэтому до ответа сервера кнопки выключены.
  const saving = saveStatus === 'saving';
  const tone = result.reachedTarget ? 'win' : 'tie';
  // Звать есть кого, только когда результат дошёл до цели и сохранён на сервере.
  // Забег по ссылке вне соревнования: звать с него друзей нельзя.
  // Забег дня не зовёт друга: тот узнал бы вопросы дня до своей попытки.
  const canInvite = saveStatus === 'saved' && response?.reachedTarget === true && !friendDuel
    && (mode === 'duel' || mode === 'free');
  const receipt = result.reachedTarget && !friendDuel;
  // «Ждёт соперника»: только дуэль, сыгранная без записи; её забег сам стал вызовом.
  const waitingDuel = receipt && mode === 'duel' && pace === null;
  const stats = buildReceiptStats({
    correctCount: response?.correctCount ?? correctCount,
    roundsPlayed: result.roundsPlayed,
    skillResults,
    standing: ranked ? (standing ?? fetched) : null,
  });
  const finishLine = opponentFinished
    ? `Он дошёл до ${SOLO_TARGET_PROGRESS}% за ${circles(roundCap)}. У тебя ${result.progress}%.`
    : '';
  const summaryText = friendDuel
    ? [finishLine, friendDuel.line].filter(Boolean).join(' ') || result.summary
    : finishLine || result.summary;
  // Дуэль: исход известен сразу (сервер вернул его вместе с последним кругом), и он главный на экране.
  const duel = mode === 'duel' && pace !== null && !friendDuel ? duelHeadline(response?.outcome ?? null, pace.displayName, opponentFinished, miniGameId) : null;
  const headline = duel?.text ?? (opponentFinished && !friendDuel ? opponentFinishedHeadline(miniGameId) : result.headline);
  const headTone = duel?.tone ?? (opponentFinished ? 'loss' : tone);
  const next = mode ? NEXT_ACTION[mode] : null;
  const viaTelegram = getTelegramIdentity() !== null;
  const duelTone = friendDuel?.outcome === 'player' ? 'win' : friendDuel?.outcome === 'opponent' ? 'loss' : 'tie';

  return (
    <div className={`result-screen solo-result ${result.reachedTarget ? 'reached' : 'not-reached'}`}>
      <div className="solo-result-head">
        {friendDuel && <span className="chip">{FRIEND_DUEL_CHIP}</span>}
        {!friendDuel && (
          <div className={`solo-result-icon ${tone}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={result.reachedTarget ? 'M5 12l5 5 9-10' : 'M7 17L17 7M9 7h8v8'} />
            </svg>
          </div>
        )}
        <div className="solo-result-title">
          <h1 className={`result-headline ${friendDuel ? duelTone : headTone}`}>{friendDuel ? friendDuel.headline : headline}</h1>
          <p className="solo-result-meta">за {circles(result.roundsPlayed)} · {categoryName(category)}</p>
        </div>
      </div>
      <div className="solo-result-stats" data-cols={stats.length} aria-label="Итоги забега">
        {stats.map((stat) => (
          <div key={stat.key} className="solo-result-stat" data-stat={stat.key}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      {summaryText && <p className="solo-result-summary">{summaryText}</p>}
      {friendDuel?.tiebreakLine && <p className="solo-result-summary tb-duel-line">{friendDuel.tiebreakLine}</p>}

      {(saveStatus === 'saving' || saveStatus === 'error') && (
        <div
          className={`result-save-status ${saveStatus === 'error' ? 'error' : 'pending'}`}
          role={saveStatus === 'error' ? 'alert' : 'status'}
        >
          {saveStatus === 'saving' && 'Сохраняем результат…'}
          {saveStatus === 'error' && (
            <>
              <span>{saveError || 'Не удалось сохранить результат.'}</span>
              {canRetrySave && (
                <>
                  {' '}
                  <button type="button" className="result-save-retry" onClick={onRetrySave}>Повторить</button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {invite.status === 'copied' && <p className="result-insight" role="status">Ссылка скопирована.</p>}
      {invite.status === 'error' && <p className="result-insight" role="alert">Не удалось отправить. Нажми ещё раз.</p>}
      {resultShare.status === 'copied' && <p className="result-insight" role="status">Результат скопирован.</p>}
      {resultShare.status === 'failed' && <p className="result-insight" role="alert">Не удалось поделиться. Нажми ещё раз.</p>}

      {waitingDuel && saveStatus === 'saved' && (
        <section className="solo-result-receipt" aria-label="Твоя запись">
          <div className="solo-result-receipt-row">
            <h2>Твоя запись</h2>
            <span className="solo-result-pill">ждёт соперника</span>
          </div>
          <p className="solo-result-receipt-line">{SOLO_TARGET_PROGRESS}% за {circles(result.roundsPlayed)}</p>
          <p>
            Против неё сыграет следующий, кто выйдет на дуэль. Исход придёт в «Партии»
            {viaTelegram ? ' и в Telegram.' : '.'}
          </p>
        </section>
      )}

      <div className="result-actions solo-result-actions">
        {next && onPlayMode ? (
          <button type="button" className="cta-btn" disabled={saving} onClick={() => { onPlayMode(next.mode); }}>{next.label}</button>
        ) : (
          <button type="button" className="cta-btn" disabled={saving} onClick={() => { onReplay(); }}>Сыграть ещё</button>
        )}
        {mode === 'daily' && onPlayMode && (
          <button type="button" className="ghost-btn" disabled={saving} onClick={() => { onPlayMode('free'); }}>Свободная игра</button>
        )}
        {/* A run that reached 100% is shared as a duel link; any other run as a result line. */}
        <div className="solo-result-secondary">
        {canInvite ? (
          <button
            type="button"
            className="ghost-btn"
            disabled={invite.status === 'working'}
            onClick={() => { void invite.send(); }}
          >
            Позвать друга
          </button>
        ) : (
          <button
            type="button"
            className="ghost-btn"
            disabled={saving}
            onClick={() => {
              resultShare.share(buildSoloShareText({
                reachedTarget: result.reachedTarget,
                progress: result.progress,
                roundsPlayed: result.roundsPlayed,
                perfectHits: countPerfectStrikes(skillResults),
                categoryLabel: categoryName(category),
              }), result.reachedTarget, preview
                ? buildRunPreviewUrl(previewBase(import.meta.env.VITE_API_URL as string | undefined, window.location.origin), preview)
                : undefined);
            }}
          >
            Поделиться
          </button>
        )}
        <button type="button" className="ghost-btn" disabled={saving} onClick={() => { onMyRuns(); }}>Мои партии</button>
        </div>
      </div>
    </div>
  );
}
