export interface StoredStats {
  wins: number;
  losses: number;
  ties: number;
  currentStreak: number;
  bestStreak: number;
  matchesPlayed: number;
}

const KEY = 'clutch_stats_v1';

const emptyStats: StoredStats = {
  wins: 0,
  losses: 0,
  ties: 0,
  currentStreak: 0,
  bestStreak: 0,
  matchesPlayed: 0,
};

export function getStats(): StoredStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyStats, ...JSON.parse(raw) };
  } catch {
    // localStorage unavailable
  }
  return { ...emptyStats };
}

export function recordMatch(outcome: 'win' | 'loss' | 'tie'): StoredStats {
  const stats = getStats();
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
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // localStorage unavailable
  }
  return stats;
}

export function winRatePercent(stats: StoredStats): number {
  if (stats.matchesPlayed === 0) return 0;
  return Math.round((stats.wins / stats.matchesPlayed) * 100);
}
