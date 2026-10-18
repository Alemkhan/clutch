import {
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_TARGET_PROGRESS,
  evaluateSoloRun,
  toPublicQuestion,
  type CompleteSoloRunResponse,
  type MiniGameId,
  type SoloPlayedRound,
  type SoloRunSnapshot,
} from '@clutch/shared';
import { finalizeSoloRun } from './finalizeSoloRun';
import { findRunOwner } from './repository';
import { listSoloRounds } from './soloRoundsRepository';
import { settleHammerRow } from './soloRounds';
import { parsePace, questionIds, settledRounds, type AppContext, type LoadedSoloRun } from './soloShared';

/**
 * Снимок забега для продолжения: вопросы без ответов и уже сыгранные круги.
 * Верный ответ без удара засчитывается промахом: повторного удара по тому же вопросу не будет.
 * Один путь и для `GET /api/solo-runs/:id`, и для продолжения при повторном старте.
 */
export async function buildSoloSnapshot(c: AppContext, loaded: LoadedSoloRun): Promise<SoloRunSnapshot | Response> {
  const { run, questions } = loaded;
  let rows = await listSoloRounds(c.env.DB, run.id);

  const pendingIndex = rows.findIndex((row) => row.settled_at === null);
  if (pendingIndex >= 0 && run.status === 'in_progress') {
    const settled = await settleHammerRow(c, loaded, rows, pendingIndex, { kind: 'forfeit' });
    if (settled instanceof Response) return settled;
    rows = settled;
  }
  const state = evaluateSoloRun(questionIds(questions), settledRounds(rows), loaded.roundCap);
  let result: CompleteSoloRunResponse | null = null;
  if (state.status === 'completed') {
    const finished = await finalizeSoloRun(c, loaded, rows);
    if (finished instanceof Response) return finished;
    result = finished;
  }
  const owner = await findRunOwner(c.env.DB, run.id);
  return {
    runId: run.id,
    category: (owner?.category ?? 'general') as SoloRunSnapshot['category'],
    questions: questions.map(toPublicQuestion),
    pace: parsePace(run.opponent_json),
    // Соперника отпустили, пока игрока не было: экран должен сказать об этом прямо.
    ...(run.pace_released === 1 ? { paceReleased: true } : {}),
    target: SOLO_TARGET_PROGRESS,
    // У дуэли — круг, на котором соперник дошёл до цели: клиент кончает партию там же, где сервер.
    roundCap: loaded.roundCap,
    rulesVersion: run.rules_version ?? CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
    miniGameId: run.mini_game_id as MiniGameId,
    bankExhausted: false,
    rounds: rows.filter((row) => row.settled_at !== null).map((row): SoloPlayedRound => ({
      questionId: row.question_id,
      correct: row.correct === 1,
      skillResult: row.skill_result,
      progressAwarded: row.progress_awarded ?? 0,
      responseTimeMs: row.response_time_ms,
    })),
    status: state.status,
    result,
  };
}
