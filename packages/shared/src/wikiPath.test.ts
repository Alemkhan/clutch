import { describe, expect, it } from 'vitest';
import { rankWikiPathEntries, type WikiPathClickRequest, type WikiPathTodayResponse } from './wikiPath';

describe('wiki path shared contracts', () => {
  it('exposes typed today and click payloads for the daily challenge', () => {
    const today: WikiPathTodayResponse = {
      challenge: { id: 'daily-2026-10-21', date: '2026-10-21', startTitle: 'Абай', targetTitle: 'Алматы' },
      run: {
        runId: 'run-1', challengeId: 'daily-2026-10-21', status: 'in_progress', clicks: 0,
        path: ['page-1'], startedAt: 1_792_558_800_000, completedAt: null,
      },
    };
    const click: WikiPathClickRequest = { title: 'Казахская литература' };
    expect(today.challenge?.startTitle).toBe('Абай');
    expect(click.title).toBe('Казахская литература');
  });

  it('sorts board entries by click count and gives ties the same rank', () => {
    const ranked = rankWikiPathEntries([
      { playerId: 'c', displayName: 'C', clicks: 5, completedAt: 300 },
      { playerId: 'a', displayName: 'A', clicks: 2, completedAt: 100 },
      { playerId: 'b', displayName: 'B', clicks: 2, completedAt: 200 },
      { playerId: 'd', displayName: 'D', clicks: 7, completedAt: 400 },
    ]);
    expect(ranked.map(({ playerId, rank }) => [playerId, rank])).toEqual([
      ['a', 1], ['b', 1], ['c', 3], ['d', 4],
    ]);
  });

  it('keeps input order for tied entries and does not mutate the input', () => {
    const entries = [
      { playerId: 'second', displayName: 'Second', clicks: 3, completedAt: 20 },
      { playerId: 'first', displayName: 'First', clicks: 3, completedAt: 10 },
    ];
    const ranked = rankWikiPathEntries(entries);
    expect(ranked.map(({ playerId, rank }) => [playerId, rank])).toEqual([
      ['second', 1], ['first', 1],
    ]);
    expect(entries[0].playerId).toBe('second');
  });
});
