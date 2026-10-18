import { DUEL_RULES_VERSION, dailyKey, dayStartMs, type DuelBoardEntry, type DuelBoardResponse } from '@clutch/shared';
import { authenticate, type AppContext } from './soloShared';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
export const DUEL_BOARD_LIMIT = 50;

/**
 * Дуэли суток (по всем категориям) глазами каждого участника: претендент видит свой исход, владелец
 * записи — обратный. Дуэль относится к суткам, в которые её доиграл претендент. Дружеские дуэли вне
 * зачёта и сюда не идут. Порядок: больше побед, меньше поражений, больше ничьих (W–D–L).
 */
const DUELS_CTE = `
  WITH finished AS (
    SELECT c.player_id, c.display_name, c.solo_outcome, c.opponent_run_id, c.completed_at
    FROM match_runs c
    WHERE c.rules_version = ?1 AND c.status = 'completed' AND c.opponent_run_id IS NOT NULL
      AND c.solo_outcome IS NOT NULL AND c.completed_at >= ?2 AND c.completed_at < ?3
  ),
  sides AS (
    SELECT player_id, display_name, solo_outcome AS outcome, completed_at FROM finished
    UNION ALL
    SELECT r.player_id, r.display_name,
           CASE f.solo_outcome WHEN 'player' THEN 'opponent' WHEN 'opponent' THEN 'player' ELSE 'tie' END,
           f.completed_at
    FROM finished f JOIN match_runs r ON r.id = f.opponent_run_id
  ),
  totals AS (
    SELECT player_id,
           (SELECT s2.display_name FROM sides s2 WHERE s2.player_id = sides.player_id
             ORDER BY s2.completed_at DESC LIMIT 1) AS display_name,
           SUM(CASE WHEN outcome = 'player' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN outcome = 'tie' THEN 1 ELSE 0 END) AS draws,
           SUM(CASE WHEN outcome = 'opponent' THEN 1 ELSE 0 END) AS losses
    FROM sides GROUP BY player_id
  ),
  placed AS (
    SELECT *, RANK() OVER (ORDER BY wins DESC, losses ASC, draws DESC) AS place FROM totals
  )`;

interface PlacedRow {
  player_id: string;
  display_name: string;
  wins: number;
  draws: number;
  losses: number;
  place: number;
}

const toEntry = (row: PlacedRow): DuelBoardEntry => ({
  rank: row.place,
  displayName: row.display_name,
  wins: row.wins,
  draws: row.draws,
  losses: row.losses,
});

export async function duelBoard(db: D1Database, from: number, playerId: string): Promise<{ entries: DuelBoardEntry[]; you: DuelBoardEntry | null }> {
  const [list, own] = await Promise.all([
    db.prepare(`${DUELS_CTE} SELECT * FROM placed ORDER BY place ASC, display_name ASC LIMIT ?4`)
      .bind(DUEL_RULES_VERSION, from, from + DAY_MS, DUEL_BOARD_LIMIT).all<PlacedRow>(),
    db.prepare(`${DUELS_CTE} SELECT * FROM placed WHERE player_id = ?4`)
      .bind(DUEL_RULES_VERSION, from, from + DAY_MS, playerId).first<PlacedRow>(),
  ]);
  return { entries: list.results.map(toEntry), you: own ? toEntry(own) : null };
}

export async function handleDuelBoard(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'duel-board');
  if (identity instanceof Response) return identity;
  const dateKey = c.req.query('date') ?? dailyKey(Date.now());
  const from = DATE_KEY.test(dateKey) ? dayStartMs(dateKey) : Number.NaN;
  if (!Number.isFinite(from) || dailyKey(from) !== dateKey) return c.json({ error: 'Invalid date.' }, 400);
  const response: DuelBoardResponse = { dateKey, ...await duelBoard(c.env.DB, from, identity.playerId) };
  return c.json(response);
}
