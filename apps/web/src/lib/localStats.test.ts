import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStats, recordConfirmedMatch } from './localStats';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('confirmed local stats', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));

  it('deduplicates a confirmed result by match id', () => {
    recordConfirmedMatch('match-1', 50, 25);
    recordConfirmedMatch('match-1', 50, 25);
    expect(getStats()).toMatchObject({ wins: 1, matchesPlayed: 1, currentStreak: 1 });
  });

  it('derives the outcome from the server player progress and queued opponent snapshot', () => {
    recordConfirmedMatch('win', 100, 90);
    recordConfirmedMatch('tie', 40, 40);
    recordConfirmedMatch('loss', 20, 30);
    expect(getStats()).toMatchObject({
      wins: 1, ties: 1, losses: 1, matchesPlayed: 3, currentStreak: 0,
    });
  });

  it('does not mix legacy practice stats into confirmed online stats', () => {
    localStorage.setItem('clutch_stats_v1', JSON.stringify({ wins: 2, matchesPlayed: 3 }));
    expect(getStats()).toMatchObject({ wins: 0, matchesPlayed: 0, confirmedMatchIds: [] });
  });
});
