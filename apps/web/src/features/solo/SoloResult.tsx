import { messagesFor, useMessages } from '../../i18n/messages';
import { m } from './messages';
import { useGroupChallenge } from './useGroupChallenge';
import { useEffect, useRef } from 'react';
import { SOLO_ROUND_CAP, SOLO_TARGET_PROGRESS, clanRunPoints, dailyKey, gameDayNumber } from '@clutch/shared';
import { DailyReminderOffer } from '../progress/Progress';
import { ClanResultNudge } from '../clans/ClanResultNudge';
import type { CategoryId, CompleteSoloRunResponse, MiniGameId, Opponent, SkillResult, SoloMode } from '@clutch/shared';
import { playSound } from '../../platform/sounds';
import { buildReceiptStats, buildSoloResult, circles, countPerfectStrikes, type RunStandingState, type SoloSaveStatus } from './soloResultModel';
import { buildSoloShareText, useSoloShare } from './soloShare';
import { categoryName } from '../myRuns/myRunsView';
import { useRunStanding } from './useRunStanding';
import type { SoloRunView } from './soloRunSession';
import type { PracticeSummary } from './practiceResult';
import { friendDuelChip, type FriendDuelSummary } from './friendDuelResult';
import { useFriendInvite } from './useFriendInvite';
import { getTelegramIdentity } from '../../platform/telegram';
import { buildRunPreviewUrl, previewBase, roundTiles } from '../../platform/share';

interface SoloResultProps {
  view: SoloRunView;
  groupChallenge?: boolean;
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
  /** Потолок кругов забега: у дуэли - круг, на котором финишировал соперник. */
  roundCap?: number;
  /** Запись соперника (дуэль): по ней видно, что партию кончил его финиш. */
  pace?: Opponent | null;
  miniGameId?: MiniGameId;
  /** Сыграть в другом режиме: дуэль, свободная игра. */
  onPlayMode?: (mode: SoloMode) => void;
  /** Разобрать ошибки забега: неверные ответы сервер уже записал в журнал тренировки. */
  onPracticeMistakes?: () => void;
  /** Открыть клан (или выбор эмодзи) из подсказки клана под забегом дня. */
  onClan?: () => void;
}

/** Партию кончил финиш соперника: заголовок говорит это словами мини-игры. */
export function opponentFinishedHeadline(miniGameId: MiniGameId | undefined): string {
  const t = messagesFor(m);
  return miniGameId === 'tower_stack' ? t.towerFirst : t.hammerFirst;
}

/** Заголовок итога дуэли: победа, поражение (словами мини-игры, если партию кончил финиш соперника) или ничья. */
export function duelHeadline(
  outcome: CompleteSoloRunResponse['outcome'],
  rival: string,
  opponentFinished: boolean,
  miniGameId: MiniGameId | undefined,
): { text: string; tone: 'win' | 'loss' | 'tie' } | null {
  const t = messagesFor(m);
  // Имя не склоняем («над Дамир»): оно стоит в именительном падеже.
  if (outcome === 'player') return { text: t.victory(rival), tone: 'win' };
  if (outcome === 'opponent') {
    return { text: opponentFinished ? opponentFinishedHeadline(miniGameId) : t.rivalFaster(rival), tone: 'loss' };
  }
  if (outcome === 'tie') return { text: t.tie, tone: 'tie' };
  return null;
}

/** Главная кнопка итога по режиму: после забега дня - дуэль, после свободной игры и дуэли - ещё одна. */
const nextAction = (t: (typeof m)['ru']): Readonly<Record<SoloMode, { mode: SoloMode; label: string }>> => ({
  daily: { mode: 'duel', label: t.nextDuel },
  free: { mode: 'free', label: t.nextFree },
  duel: { mode: 'duel', label: t.nextAnotherDuel },
});

/**
 * Два разных итога: дошёл до 100% либо упёрся в потолок. Второй не выдаётся за победу.
 * Исхода против соперника здесь нет: результат зафиксирован, а исход живёт в «Моих партиях».
 */
export function SoloResult({
  view,
  groupChallenge,
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
  onPracticeMistakes,
  onClan,
}: SoloResultProps) {
  const t = useMessages(m);
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
  const groupInvite = useGroupChallenge(response?.runId);
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
        <span className="chip">{t.practiceChip}</span>
        <h1 className={`result-headline ${practiceTone}`}>{practice.headline}</h1>
        <p className="solo-result-summary">{practice.line}</p>
        <div className="result-actions solo-result-actions">
          <button type="button" className="cta-btn" onClick={() => { onReplay(); }}>{t.again}</button>
          <button type="button" className="ghost-btn" onClick={() => { onExitPractice?.(); }}>{t.otherLevel}</button>
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
  const canInvite = saveStatus === 'saved' && response?.reachedTarget === true && !friendDuel && !groupChallenge
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
    ? t.opponentReached(SOLO_TARGET_PROGRESS, circles(roundCap), result.progress)
    : '';
  const summaryText = friendDuel
    ? [finishLine, friendDuel.line].filter(Boolean).join(' ') || result.summary
    : finishLine || result.summary;
  // Дуэль: исход известен сразу (сервер вернул его вместе с последним кругом), и он главный на экране.
  const duel = mode === 'duel' && pace !== null && !friendDuel ? duelHeadline(response?.outcome ?? null, pace.displayName, opponentFinished, miniGameId) : null;
  const headline = duel?.text ?? (opponentFinished && !friendDuel ? opponentFinishedHeadline(miniGameId) : result.headline);
  const headTone = duel?.tone ?? (opponentFinished ? 'loss' : tone);
  const next = mode ? nextAction(t)[mode] : null;
  const mistakes = Math.max(0, result.roundsPlayed - (response?.correctCount ?? correctCount));
  const viaTelegram = getTelegramIdentity() !== null;
  const duelTone = friendDuel?.outcome === 'player' ? 'win' : friendDuel?.outcome === 'opponent' ? 'loss' : 'tie';

  return (
    <div className={`result-screen solo-result ${result.reachedTarget ? 'reached' : 'not-reached'}`}>
      {groupChallenge && <span className="chip">{t.groupChip}</span>}
      <div className="solo-result-head">
        {friendDuel && <span className="chip">{friendDuelChip()}</span>}
        {!friendDuel && (
          <div className={`solo-result-icon ${tone}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={result.reachedTarget ? 'M5 12l5 5 9-10' : 'M7 17L17 7M9 7h8v8'} />
            </svg>
          </div>
        )}
        <div className="solo-result-title">
          <h1 className={`result-headline ${friendDuel ? duelTone : headTone}`}>{friendDuel ? friendDuel.headline : headline}</h1>
          <p className="solo-result-meta">{t.resultMeta(circles(result.roundsPlayed), categoryName(category))}</p>
        </div>
      </div>
      <div className="solo-result-stats" data-cols={stats.length} aria-label={t.runTotals}>
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
          {saveStatus === 'saving' && t.savingResult}
          {saveStatus === 'error' && (
            <>
              <span>{saveError || t.saveResultFailed}</span>
              {canRetrySave && (
                <>
                  {' '}
                  <button type="button" className="result-save-retry" onClick={onRetrySave}>{t.retry}</button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {groupInvite.status === 'copied' && <p role="status">{t.challengeLinkCopied}</p>}
      {groupInvite.status === 'error' && <p role="alert">{t.challengeSendFailed}</p>}
      {invite.status === 'copied' && <p className="result-insight" role="status">{t.linkCopied}</p>}
      {invite.status === 'error' && <p className="result-insight" role="alert">{t.sendFailed}</p>}
      {resultShare.status === 'copied' && <p className="result-insight" role="status">{t.resultCopied}</p>}
      {resultShare.status === 'failed' && <p className="result-insight" role="alert">{t.shareFailed}</p>}

      {waitingDuel && saveStatus === 'saved' && (
        <section className="solo-result-receipt" aria-label={t.yourRecord}>
          <div className="solo-result-receipt-row">
            <h2>{t.yourRecord}</h2>
            <span className="solo-result-pill">{t.waitingRival}</span>
          </div>
          <p className="solo-result-receipt-line">{t.receiptLine(SOLO_TARGET_PROGRESS, circles(result.roundsPlayed))}</p>
          <p>
            {t.receiptNext}
            {viaTelegram ? t.receiptTelegram : t.receiptEnd}
          </p>
        </section>
      )}

      <DailyReminderOffer />
      {/* Очки клана дают только забеги дня. */}
      {mode === 'daily' && <ClanResultNudge
        onClan={onClan}
        runPoints={saveStatus === 'saved' && response
          ? clanRunPoints({ progress: response.progress, reachedTarget: response.reachedTarget, soloScore: response.reachedTarget ? response.score : null })
          : undefined}
      />}

      <div className="result-actions solo-result-actions">
        {next && onPlayMode ? (
          <button type="button" className="cta-btn" disabled={saving} onClick={() => { onPlayMode(next.mode); }}>{next.label}</button>
        ) : (
          <button type="button" className="cta-btn" disabled={saving} onClick={() => { onReplay(); }}>{t.playMore}</button>
        )}
        {mode === 'daily' && onPlayMode && (
          <button type="button" className="ghost-btn" disabled={saving} onClick={() => { onPlayMode('free'); }}>{t.freePlay}</button>
        )}
        {canInvite && <>
          <button type="button" className="ghost-btn" disabled={groupInvite.status === 'working'} onClick={() => void groupInvite.send()}>{t.challengeFriends}</button>
          <p className="solo-result-summary">{t.groupHint}</p>
        </>}
        {/* A run that reached 100% is shared as a duel link; any other run as a result line. */}
        <div className="solo-result-secondary">
        {canInvite ? (
          <button
            type="button"
            className="ghost-btn"
            disabled={invite.status === 'working'}
            onClick={() => { void invite.send(); }}
          >
            {t.inviteFriend}
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
                roundAwards,
                dayNumber: mode === 'daily' ? gameDayNumber(dailyKey(Date.now())) : undefined,
              }), result.reachedTarget, preview
                ? buildRunPreviewUrl(previewBase(import.meta.env.VITE_API_URL as string | undefined, window.location.origin), preview)
                : undefined);
            }}
          >
            {t.share}
          </button>
        )}
        <button type="button" className="ghost-btn" disabled={saving} onClick={() => { onMyRuns(); }}>{t.myRuns}</button>
        </div>
        {/* Ошибки забега уже в журнале тренировки; без ссылки туда почти никто не доходил. */}
        {onPracticeMistakes && mistakes > 0 && (
          <button type="button" className="solo-result-mistakes" disabled={saving} onClick={() => { onPracticeMistakes(); }}>
            {t.reviewMistakes(mistakes)}
          </button>
        )}
      </div>
    </div>
  );
}
