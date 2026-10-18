import {
  compareSoloRunsDetailed,
  dailyKey,
  evaluateSoloRun,
  invertOutcome,
  setPar,
  soloScore,
  type AsyncMatchRound,
  type CompleteSoloRunResponse,
  type MyRunOutcome,
  type Question,
} from '@clutch/shared';
import { notifyDuelResult, notifySoloResult } from '../notifications/outbid';
import { notifyBumpedFromTopTen, snapshotTopTen, type TopTenSnapshot } from '../notifications/outOfTop';
import { findTiebreakAnswer } from '../tiebreaker/tiebreakerRepository';
import { findRun, findRunOwner } from './repository';
import type { SoloRoundRow } from './soloRoundsRepository';
import { completeSoloRun, findPaceResult, findSoloOutcome, settleRecordOutcome } from './soloRepository';
import { deferred, questionIds, type AppContext, type LoadedSoloRun } from './soloShared';
import type { RunRow } from './types';

type PaceResult = NonNullable<Awaited<ReturnType<typeof findPaceResult>>>;
type OwnTiebreak = Awaited<ReturnType<typeof findTiebreakAnswer>>;

const soloRounds = (rounds: readonly AsyncMatchRound[]) =>
  rounds.map((round) => ({ questionId: round.questionId, progressAwarded: round.progressAwarded }));

const storedRounds = (rows: readonly SoloRoundRow[]): AsyncMatchRound[] => rows.map((row) => ({
  questionId: row.question_id,
  correct: row.correct === 1,
  responseTimeMs: row.response_time_ms,
  skillResult: row.skill_result ?? undefined,
  progressAwarded: row.progress_awarded ?? 0,
  playerProgressAfter: row.progress_after ?? 0,
}));

/** Итог собирается только из кругов и правил shared; повтор completion даёт тот же ответ. */
function summary(
  runId: string,
  questions: readonly Question[],
  rounds: AsyncMatchRound[],
  correctCount: number,
  outcome: MyRunOutcome | null,
  roundCap: number,
): CompleteSoloRunResponse {
  const final = evaluateSoloRun(questionIds(questions), soloRounds(rounds), roundCap);
  const par = setPar(questions);
  return {
    runId,
    rounds,
    progress: final.progress,
    correctCount,
    roundsPlayed: final.roundsPlayed,
    reachedTarget: final.reachedTarget,
    par,
    score: soloScore(final.roundsPlayed, par),
    outcome,
  };
}

/** Итог уже закрытого забега из сохранённых данных; null — сохранённого итога нет. */
async function storedResult(c: AppContext, loaded: LoadedSoloRun): Promise<CompleteSoloRunResponse | null> {
  const runId = loaded.run.id;
  const fresh = await findRun(c.env.DB, runId);
  if (fresh?.status !== 'completed' || !fresh.rounds_json) return null;
  return summary(
    runId,
    loaded.questions,
    JSON.parse(fresh.rounds_json) as AsyncMatchRound[],
    fresh.correct_count,
    await findSoloOutcome(c.env.DB, runId),
    loaded.roundCap,
  );
}

/**
 * Чистое сравнение с записью-темпом: исход и (если решила прикидка) данные о ней.
 * Нет записи: исход null, забег ждёт соперника.
 */
function decideOutcome(
  result: CompleteSoloRunResponse,
  pace: PaceResult | null,
  ownTiebreak: OwnTiebreak,
): { outcome: MyRunOutcome | null; byTiebreak: boolean; tiebreak?: CompleteSoloRunResponse['tiebreak'] } {
  if (!pace) return { outcome: null, byTiebreak: false };
  const comparison = compareSoloRunsDetailed({
    reachedTarget: result.reachedTarget,
    progress: result.progress,
    roundsPlayed: result.roundsPlayed,
    soloScore: result.score,
    tiebreak: ownTiebreak,
  }, pace);
  if (!comparison.byTiebreak) return { outcome: comparison.outcome, byTiebreak: false };
  // Число соперника не отдаём тому, кто сам не отвечал: исход честный и без подсказки.
  return {
    outcome: comparison.outcome,
    byTiebreak: true,
    tiebreak: {
      ownMultiplier: ownTiebreak?.multiplier ?? null,
      opponentMultiplier: ownTiebreak ? pace.tiebreak?.multiplier ?? null : null,
    },
  };
}

/** Владелец записи узнаёт исход в любом случае; повтор сюда не доходит (didComplete только у одного запроса). */
function notifyRecordOwner(
  c: AppContext,
  run: RunRow,
  friend: boolean,
  outcome: MyRunOutcome,
  paceRunId: string,
  progress: { recipient: number; challenger: number },
  tiebreak: { recipientMultiplier: number | null; challengerMultiplier: number | null } | null,
): void {
  deferred(c, (async () => {
    const recipientRun = await findRunOwner(c.env.DB, paceRunId);
    if (!recipientRun) return;
    const recipientView = invertOutcome(outcome);
    // Исход записывается и владельцу записи, иначе его забег навсегда остаётся «Ждём соперника».
    // Дружеская дуэль вне зачёта: там исход владельцу не пишется, у неё своя пометка.
    if (!friend) await settleRecordOutcome(c.env.DB, paceRunId, recipientView);
    // Дружеская дуэль: автор записи узнаёт итог, но реванш-приглашение ему не создаётся.
    const notify = friend ? notifyDuelResult : notifySoloResult;
    await notify(c.env, {
      recipientRun,
      challengerRunId: run.id,
      challengerName: run.display_name,
      recipientProgress: progress.recipient,
      challengerProgress: progress.challenger,
      ...(tiebreak ? { tiebreak } : {}),
      outcome: recipientView === 'player' ? 'record_won' : recipientView === 'opponent' ? 'record_lost' : 'tie',
    });
  })().catch((error) => {
    console.error('Solo result lookup failed:', error instanceof Error ? error.message : 'unknown error');
  }));
}

/**
 * Закрытие забега сервером: цель, потолок кругов или конец набора (правила: evaluateSoloRun).
 * Идемпотентно: условный UPDATE выполняется ровно одним запросом, остальные получают сохранённый итог.
 */
export async function finalizeSoloRun(
  c: AppContext,
  loaded: LoadedSoloRun,
  rows: SoloRoundRow[],
): Promise<CompleteSoloRunResponse | Response> {
  const { run, questions, practice, friend } = loaded;
  const runId = run.id;
  if (run.status === 'completed') {
    return (await storedResult(c, loaded)) ?? c.json({ error: 'Stored run result is missing.' }, 409);
  }

  const rounds = storedRounds(rows);
  const correctCount = rows.filter((row) => row.correct === 1).length;
  const result = summary(runId, questions, rounds, correctCount, null, loaded.roundCap);

  // Сравнение с записью-темпом. Тренировка не сравнивается: бот не запись игрока,
  // а исход тренировки не хранится.
  const completedAt = Date.now();
  const pace = run.opponent_run_id && !practice ? await findPaceResult(c.env.DB, run.opponent_run_id) : null;
  // Прикидка своей стороны: сутки набора этого забега. Читаем только когда есть с кем сравнивать.
  const ownTiebreak = pace ? await findTiebreakAnswer(c.env.DB, run.player_id, dailyKey(run.created_at)) : null;
  const decision = decideOutcome(result, pace, ownTiebreak);
  const { outcome } = decision;
  result.outcome = outcome;
  if (decision.tiebreak) result.tiebreak = decision.tiebreak;

  // R25: снимок верха таблицы до записи забега; сбой снимка не должен ломать завершение.
  const dateKey = dailyKey(completedAt);
  // В таблицу идёт только забег дня; свободная игра и дуэли — вне её.
  const ranked = loaded.mode === 'daily' && result.reachedTarget;
  let topBefore: TopTenSnapshot | null = null;
  let category = '';
  if (ranked) {
    try {
      category = (await findRunOwner(c.env.DB, runId))?.category ?? '';
      if (category) topBefore = await snapshotTopTen(c.env.DB, [category], dateKey);
    } catch {
      topBefore = null;
    }
  }

  const didComplete = await completeSoloRun(c.env.DB, {
    matchId: runId,
    rounds,
    progress: result.progress,
    correctCount,
    reachedTarget: result.reachedTarget,
    setPar: result.par,
    soloScore: result.score,
    outcome,
    practice,
    friend,
    recordable: loaded.mode === 'duel',
    now: completedAt,
  });
  if (!didComplete) {
    return (await storedResult(c, loaded)) ?? c.json({ error: 'Run completion conflicted with another request.' }, 409);
  }
  if (!practice && outcome && run.opponent_run_id) {
    notifyRecordOwner(
      c,
      run,
      friend,
      outcome,
      run.opponent_run_id,
      { recipient: pace?.progress ?? 0, challenger: result.progress },
      decision.byTiebreak && pace
        ? { recipientMultiplier: pace.tiebreak?.multiplier ?? null, challengerMultiplier: ownTiebreak?.multiplier ?? null }
        : null,
    );
  }
  if (topBefore) {
    const before = topBefore;
    deferred(c, (async () => {
      const after = await snapshotTopTen(c.env.DB, [category], dateKey);
      await notifyBumpedFromTopTen(c.env, {
        triggerPlayerId: run.player_id,
        triggerName: run.display_name,
        dateKey,
        before,
        after,
      });
    })().catch(() => {
      console.error({ event: 'telegram_notification_handler', kind: 'top_ten', reasonCode: 'unexpected_error' });
    }));
  }
  return result;
}
