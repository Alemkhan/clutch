import type { SkillResult } from '@clutch/shared';

/** Одна строка solo_run_rounds. settled_at === null: ответ верен, ждём удар. */
export interface SoloRoundRow {
  run_id: string;
  round_index: number;
  question_id: string;
  selected_answer: string;
  response_time_ms: number;
  correct: number;
  /** Присланный момент удара. null — круг закрыт без удара. Сырой ввод, из него выведено расстояние. */
  active_elapsed_ms: number | null;
  /** Окно ответа по часам сервера. null — круги до миграции 0017. */
  answer_window_ms: number | null;
  skill_distance: number | null;
  skill_result: SkillResult | null;
  progress_awarded: number | null;
  progress_after: number | null;
  created_at: number;
  settled_at: number | null;
}

export async function listSoloRounds(db: D1Database, runId: string): Promise<SoloRoundRow[]> {
  const result = await db.prepare(`
    SELECT run_id, round_index, question_id, selected_answer, response_time_ms, correct,
           active_elapsed_ms, answer_window_ms, skill_distance, skill_result,
           progress_awarded, progress_after, created_at, settled_at
    FROM solo_run_rounds WHERE run_id = ?1 ORDER BY round_index ASC
  `).bind(runId).all<SoloRoundRow>();
  return result.results;
}

/**
 * Записывает ответ на круг. Дубликат отсекает PRIMARY KEY (run_id, round_index): false — круг уже есть,
 * и вызывающий обязан отдать то, что записано, а не пересчитывать. Неверный ответ закрывается сразу.
 */
export async function insertSoloAnswer(db: D1Database, input: {
  runId: string;
  roundIndex: number;
  questionId: string;
  selectedAnswer: string;
  responseTimeMs: number;
  correct: boolean;
  /** Только для неверного ответа: круг закрыт без удара. */
  settledProgressAfter: number | null;
  /** Окно, измеренное сервером: от закрытия предыдущего круга до прихода ответа. */
  answerWindowMs: number;
  now: number;
}): Promise<boolean> {
  const settled = input.settledProgressAfter !== null;
  const result = await db.prepare(`
    INSERT INTO solo_run_rounds (
      run_id, round_index, question_id, selected_answer, response_time_ms, correct,
      progress_awarded, progress_after, created_at, settled_at, answer_window_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT (run_id, round_index) DO NOTHING
  `).bind(
    input.runId,
    input.roundIndex,
    input.questionId,
    input.selectedAnswer,
    Math.round(input.responseTimeMs),
    input.correct ? 1 : 0,
    settled ? 0 : null,
    input.settledProgressAfter,
    input.now,
    settled ? input.now : null,
    input.answerWindowMs,
  ).run();
  return result.meta.changes > 0;
}

/** Закрывает круг ударом. false — круг уже закрыт (повтор или параллельный запрос): награда не удваивается. */
export async function settleSoloHammer(db: D1Database, input: {
  runId: string;
  roundIndex: number;
  /** Момент удара, как его сообщил клиент. null — круг закрыт без удара. */
  activeElapsedMs: number | null;
  /** Выведено сервером из момента удара, не присылается клиентом. */
  skillDistance: number;
  skillResult: SkillResult;
  progressAwarded: number;
  progressAfter: number;
  now: number;
}): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE solo_run_rounds
    SET active_elapsed_ms = ?3, skill_distance = ?4, skill_result = ?5,
        progress_awarded = ?6, progress_after = ?7, settled_at = ?8
    WHERE run_id = ?1 AND round_index = ?2 AND correct = 1 AND settled_at IS NULL
  `).bind(
    input.runId,
    input.roundIndex,
    input.activeElapsedMs,
    input.skillDistance,
    input.skillResult,
    input.progressAwarded,
    input.progressAfter,
    input.now,
  ).run();
  return result.meta.changes > 0;
}
