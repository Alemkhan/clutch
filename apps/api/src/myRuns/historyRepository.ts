import { DUEL_RULES_VERSION, FRIEND_RULES_VERSION, invertOutcome, type AsyncMatchRound, type MyRunOutcome, type MyRunSummary } from '@clutch/shared';

export interface HistoryRow {
  id: string;
  /** Владелец забега; у чужой дружеской дуэли отличается от смотрящего. */
  player_id?: string;
  display_name?: string;
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
  /** Кто сыграл мою запись: у ждавшего забега соперника в своей строке нет. */
  played_by?: string | null;
  /** 1 — с этого забега уже звали на реванш: кнопку показывать больше не нужно. */
  rematch_offered?: number | null;
  /** Круги записи, против которой шёл этот забег (по её собственной строке); у бота строки нет. */
  opponent_rounds?: number | null;
  /** Круги того, кто сыграл мою запись. */
  played_by_rounds?: number | null;
}

/** Курсор — completedAt_id последней отданной партии; в id нет символа "_". */
export function encodeHistoryCursor(row: { completedAt: number; id: string }): string {
  return `${row.completedAt}_${row.id}`;
}

export function parseHistoryCursor(value: string): { completedAt: number; id: string } | null {
  const match = /^(\d{1,16})_([A-Za-z0-9-]{1,64})$/.exec(value);
  return match ? { completedAt: Number(match[1]), id: match[2] } : null;
}

/**
 * Завершённые партии игрока, новые сверху; строк на одну больше limit — признак следующей страницы.
 * Партии — это дуэли (свои и дружеские): победы и поражения есть только у них. Забег дня живёт в
 * таблице дня, свободная игра нигде не учитывается (решение владельца 2026-10-19).
 */
export async function listCompletedRuns(
  db: D1Database,
  playerId: string,
  limit: number,
  cursor: { completedAt: number; id: string } | null,
): Promise<HistoryRow[]> {
  // played_by: имя того, кто сыграл эту запись. Своя строка этого не знает — связь живёт
  // на строке претендента (opponent_run_id), поэтому владелец записи иначе видит «Победа» без имени.
  const columns = `id, player_id, display_name, category, questions_json, rounds_json, progress, correct_count, rules_version,
    opponent_json, opponent_run_id, reached_target, set_par, solo_score, solo_outcome, created_at, completed_at,
    (SELECT challenger.display_name FROM match_runs challenger
      WHERE challenger.opponent_run_id = match_runs.id AND challenger.status = 'completed'
      ORDER BY challenger.completed_at LIMIT 1) AS played_by,
    (SELECT json_array_length(rival.rounds_json) FROM match_runs rival
      WHERE rival.id = match_runs.opponent_run_id AND rival.status = 'completed') AS opponent_rounds,
    (SELECT json_array_length(challenger.rounds_json) FROM match_runs challenger
      WHERE challenger.opponent_run_id = match_runs.id AND challenger.status = 'completed'
      ORDER BY challenger.completed_at LIMIT 1) AS played_by_rounds,
    EXISTS (SELECT 1 FROM rematch_invites offered
      WHERE offered.challenger_run_id = match_runs.id AND offered.recipient_run_id IS NOT NULL) AS rematch_offered`;
  const statement = cursor
    ? db.prepare(`
        SELECT ${columns} FROM match_runs
        WHERE status = 'completed' AND completed_at IS NOT NULL
          AND (
            (player_id = ?1 AND rules_version IN ('${DUEL_RULES_VERSION}', '${FRIEND_RULES_VERSION}'))
            OR (rules_version = '${FRIEND_RULES_VERSION}' AND opponent_run_id IN (
              SELECT id FROM match_runs WHERE player_id = ?1
            ))
          )
          AND (completed_at < ?2 OR (completed_at = ?2 AND id < ?3))
        ORDER BY completed_at DESC, id DESC LIMIT ?4
      `).bind(playerId, cursor.completedAt, cursor.id, limit + 1)
    : db.prepare(`
        SELECT ${columns} FROM match_runs
        WHERE status = 'completed' AND completed_at IS NOT NULL
          AND (
            (player_id = ?1 AND rules_version IN ('${DUEL_RULES_VERSION}', '${FRIEND_RULES_VERSION}'))
            OR (rules_version = '${FRIEND_RULES_VERSION}' AND opponent_run_id IN (
              SELECT id FROM match_runs WHERE player_id = ?1
            ))
          )
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

/** viewerId нужен, чтобы отличить дуэль друга по моей записи от моей собственной игры. */
export function toRunSummary(row: HistoryRow, viewerId?: string): MyRunSummary {
  const friendDuel = row.rules_version === FRIEND_RULES_VERSION
    ? (viewerId !== undefined && row.player_id !== undefined && row.player_id !== viewerId ? 'hosted' : 'played')
    : null;
  const rounds = (parseJson(row.rounds_json) as AsyncMatchRound[] | null) ?? [];
  const opponent = parseJson(row.opponent_json) as { displayName?: unknown; rounds?: unknown } | null;
  const named = opponent !== null && typeof opponent.displayName === 'string';
  return {
    runId: row.id,
    category: row.category,
    roundsPlayed: rounds.length,
    progress: row.progress,
    correctCount: row.correct_count,
    reachedTarget: row.reached_target === 1,
    setPar: row.set_par,
    soloScore: row.solo_score,
    startedAt: row.created_at,
    completedAt: row.completed_at,
    opponent: friendDuel === 'hosted'
      ? { kind: 'player', displayName: row.display_name ?? 'Друг' }
      : named
        ? { kind: row.opponent_run_id ? 'player' : 'bot', displayName: opponent.displayName as string }
        // Моя запись дождалась соперника: он виден только со своей стороны связи.
        : row.played_by
          ? { kind: 'player', displayName: row.played_by }
          : null,
    // Соло: сохранённый исход; null — соперника не было (opponent === null) или забег старше миграции.
    // Круги соперника: его собственная запись либо тот, кто сыграл мою. У бота и у чужой
    // дружеской дуэли (там «свои» цифры уже друга) — null.
    opponentRoundsPlayed: friendDuel === 'hosted'
      ? null
      : named
        ? (row.opponent_run_id ? row.opponent_rounds ?? null : null)
        : row.played_by ? row.played_by_rounds ?? null : null,
    outcome: friendDuel === 'hosted' && row.solo_outcome ? invertOutcome(row.solo_outcome) : row.solo_outcome ?? null,
    friendDuel,
    rematchOffer: rematchOffer(row, friendDuel),
  };
}

/**
 * Можно ли с этого забега позвать на реванш. Звать вправе сыгравший против записи человека, при
 * любом исходе, и только со своего зачётного соло-забега: дружеская дуэль вне соревнования.
 * Условия те же, что проверяет `POST /api/solo-runs/:id/rematch`.
 */
function rematchOffer(
  row: HistoryRow,
  friendDuel: MyRunSummary['friendDuel'],
): MyRunSummary['rematchOffer'] {
  if (friendDuel || row.rules_version !== DUEL_RULES_VERSION) return null;
  if (!row.opponent_run_id || !['player', 'opponent', 'tie'].includes(row.solo_outcome ?? '')) return null;
  return row.rematch_offered ? 'sent' : 'available';
}
