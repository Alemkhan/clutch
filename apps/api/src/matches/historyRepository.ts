import { evaluateMatch, type AsyncMatchRound, type MyRunOutcome, type MyRunSummary } from '@clutch/shared';
import { parseQuestions } from './validation';

export interface HistoryRow {
  id: string;
  category: MyRunSummary['category'];
  questions_json: string;
  rounds_json: string | null;
  progress: number;
  correct_count: number;
  rules_version: string | null;
  opponent_json: string | null;
  opponent_run_id: string | null;
  reached_target: number | null;
  set_par: number | null;
  solo_score: number | null;
  solo_outcome: MyRunOutcome | null;
  created_at: number;
  completed_at: number;
}

/** Курсор — completedAt_id последней отданной партии; в id нет символа "_". */
export function encodeHistoryCursor(row: { completedAt: number; id: string }): string {
  return `${row.completedAt}_${row.id}`;
}

export function parseHistoryCursor(value: string): { completedAt: number; id: string } | null {
  const match = /^(\d{1,16})_([A-Za-z0-9-]{1,64})$/.exec(value);
  return match ? { completedAt: Number(match[1]), id: match[2] } : null;
}

/** Завершённые партии игрока, новые сверху; строк на одну больше limit — признак следующей страницы. */
export async function listCompletedRuns(
  db: D1Database,
  playerId: string,
  limit: number,
  cursor: { completedAt: number; id: string } | null,
): Promise<HistoryRow[]> {
  const columns = `id, category, questions_json, rounds_json, progress, correct_count, rules_version,
    opponent_json, opponent_run_id, reached_target, set_par, solo_score, solo_outcome, created_at, completed_at`;
  const statement = cursor
    ? db.prepare(`
        SELECT ${columns} FROM match_runs
        WHERE player_id = ?1 AND status = 'completed' AND completed_at IS NOT NULL
          AND (completed_at < ?2 OR (completed_at = ?2 AND id < ?3))
        ORDER BY completed_at DESC, id DESC LIMIT ?4
      `).bind(playerId, cursor.completedAt, cursor.id, limit + 1)
    : db.prepare(`
        SELECT ${columns} FROM match_runs
        WHERE player_id = ?1 AND status = 'completed' AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, id DESC LIMIT ?2
      `).bind(playerId, limit + 1);
  return (await statement.all<HistoryRow>()).results;
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Исход гонки восстанавливается правилами shared; не вышло — null, а не догадка. */
function raceOutcome(
  row: HistoryRow,
  rounds: AsyncMatchRound[],
  opponent: { rounds?: unknown } | null,
): MyRunOutcome | null {
  const questions = parseQuestions(row.questions_json);
  if (!questions || !opponent || !Array.isArray(opponent.rounds)) return null;
  try {
    const state = evaluateMatch(
      questions.map((question) => question.id),
      rounds,
      opponent.rounds as AsyncMatchRound[],
      { frozenOpponent: true },
    );
    return state.status === 'completed' ? state.outcome ?? null : null;
  } catch {
    return null;
  }
}

export function toRunSummary(row: HistoryRow): MyRunSummary {
  const solo = row.rules_version?.startsWith('solo-') ?? false;
  const rounds = (parseJson(row.rounds_json) as AsyncMatchRound[] | null) ?? [];
  const opponent = parseJson(row.opponent_json) as { displayName?: unknown; rounds?: unknown } | null;
  const named = opponent !== null && typeof opponent.displayName === 'string';
  return {
    runId: row.id,
    category: row.category,
    mode: solo ? 'solo' : 'race',
    roundsPlayed: rounds.length,
    progress: row.progress,
    correctCount: row.correct_count,
    reachedTarget: solo ? row.reached_target === 1 : null,
    setPar: solo ? row.set_par : null,
    soloScore: solo ? row.solo_score : null,
    startedAt: row.created_at,
    completedAt: row.completed_at,
    opponent: named
      ? { kind: row.opponent_run_id ? 'player' : 'bot', displayName: opponent.displayName as string }
      : null,
    // Соло: сохранённый исход; null — соперника не было (opponent === null) или забег старше миграции.
    outcome: solo ? row.solo_outcome ?? null : raceOutcome(row, rounds, opponent),
  };
}
