import { parseLeaderboardResponse } from './lastStandRun';

export interface LastStandHook {
  kind: 'best';
  headline: string;
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
 * Turns the raw leaderboard response into the one-line hook of the home card:
 * the best result of the day. Returns null when there is nothing trustworthy to
 * show (not loaded, network error, malformed body, nobody has a result yet):
 * the card then shows no hook at all instead of "nobody played" or zeros.
 */
export function buildLastStandHook(raw: unknown): LastStandHook | null {
  if (raw === null || raw === undefined) return null;
  let entries;
  try {
    entries = parseLeaderboardResponse(raw).entries;
  } catch {
    return null;
  }
  const best = Math.max(0, ...entries.map((entry) => Math.floor(entry.survived)));
  if (best < 1) return null;
  return {
    kind: 'best',
    headline: `Лучший результат дня: ${best} ${plural(best, 'круг', 'круга', 'кругов')}`,
  };
}
