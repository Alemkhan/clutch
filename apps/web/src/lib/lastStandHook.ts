import { parseLeaderboardResponse } from './lastStandRun';

/** The server returns at most this many leaderboard rows. */
export const LAST_STAND_BOARD_LIMIT = 50;

export interface LastStandHook {
  kind: 'empty' | 'played';
  headline: string;
  detail: string;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Turns the raw leaderboard response into the daily hook of the home card.
 * Returns null when there is no trustworthy data (not loaded, network error,
 * malformed body): the card then shows no hook at all instead of zeros.
 */
export function buildLastStandHook(raw: unknown): LastStandHook | null {
  if (raw === null || raw === undefined) return null;
  let entries;
  try {
    entries = parseLeaderboardResponse(raw).entries;
  } catch {
    return null;
  }
  if (entries.length === 0) {
    return {
      kind: 'empty',
      headline: 'Сегодня ещё никто не играл',
      detail: 'Будь первым и задай планку дня',
    };
  }
  const best = Math.max(...entries.map((entry) => Math.max(0, Math.floor(entry.survived))));
  const count = entries.length;
  const capped = count >= LAST_STAND_BOARD_LIMIT;
  const countText = capped ? `${LAST_STAND_BOARD_LIMIT}+` : String(count);
  const verb = count === 1 ? 'играл' : 'играли';
  const noun = capped ? 'человек' : plural(count, 'человек', 'человека', 'человек');
  return {
    kind: 'played',
    headline: `Сегодня ${verb} ${countText} ${noun}`,
    detail: `Лучший результат: ${best} ${plural(best, 'круг', 'круга', 'кругов')}`,
  };
}
