export interface StoredStats {
  wins: number;
  losses: number;
  ties: number;
  currentStreak: number;
  bestStreak: number;
  matchesPlayed: number;
  confirmedMatchIds: string[];
}

// Confirmed online matches intentionally do not migrate or merge legacy practice stats.
const KEY = 'clutch_confirmed_stats_v1';

const emptyStats: StoredStats = {
  wins: 0,
  losses: 0,
  ties: 0,
  currentStreak: 0,
  bestStreak: 0,
  matchesPlayed: 0,
  confirmedMatchIds: [],
};

export function getStats(): StoredStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredStats>;
      return {
        ...emptyStats,
        ...parsed,
        confirmedMatchIds: Array.isArray(parsed.confirmedMatchIds)
          ? parsed.confirmedMatchIds.filter((id): id is string => typeof id === 'string')
          : [],
      };
    }
  } catch {
    // localStorage unavailable
  }
  return { ...emptyStats };
}

function applyOutcome(stats: StoredStats, outcome: 'win' | 'loss' | 'tie'): void {
  stats.matchesPlayed += 1;
  if (outcome === 'win') {
    stats.wins += 1;
    stats.currentStreak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
  } else if (outcome === 'tie') {
    stats.ties += 1;
  } else {
    stats.losses += 1;
    stats.currentStreak = 0;
  }
}

function persistStats(stats: StoredStats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // localStorage unavailable
  }
}

export function recordConfirmedMatch(
  matchId: string,
  playerProgress: number,
  opponentProgress: number,
): StoredStats {
  const stats = getStats();
  if (stats.confirmedMatchIds.includes(matchId)) return stats;
  stats.confirmedMatchIds = [...stats.confirmedMatchIds, matchId].slice(-100);
  applyOutcome(stats, playerProgress > opponentProgress ? 'win' : playerProgress < opponentProgress ? 'loss' : 'tie');
  persistStats(stats);
  return stats;
}

export function winRatePercent(stats: StoredStats): number {
  if (stats.matchesPlayed === 0) return 0;
  return Math.round((stats.wins / stats.matchesPlayed) * 100);
}
