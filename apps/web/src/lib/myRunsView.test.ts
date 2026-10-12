import { describe, expect, it } from 'vitest';
import type { MyRunSummary } from '@clutch/shared';
import { categoryName, formatRunTime, inviteDeadline, roundsText, runStatus, runSummary } from './myRunsView';

function run(overrides: Partial<MyRunSummary> = {}): MyRunSummary {
  return {
    runId: 'r1', category: 'geography', mode: 'solo', roundsPlayed: 7, progress: 100, correctCount: 6,
    reachedTarget: true, setPar: 8, soloScore: 0.9, startedAt: 0, completedAt: 0, opponent: null, outcome: null,
    ...overrides,
  };
}

describe('run status', () => {
  it('waits for a rival only when a run reached the target and nobody has played it', () => {
    expect(runStatus(run())).toEqual({ kind: 'waiting', text: 'Ждём соперника' });
  });

  it('never says waiting for a run that missed the target', () => {
    expect(runStatus(run({ reachedTarget: false, progress: 60 })).kind).toBe('missed');
    expect(runStatus(run({ reachedTarget: false, outcome: 'player', opponent: { kind: 'player', displayName: 'Ann' } })).kind).toBe('missed');
  });

  it('names win, loss and tie, and keeps a tie apart from waiting', () => {
    const rival = { kind: 'player', displayName: 'Ann' } as const;
    expect(runStatus(run({ outcome: 'player', opponent: rival })).text).toBe('Победа');
    expect(runStatus(run({ outcome: 'opponent', opponent: rival })).text).toBe('Поражение');
    expect(runStatus(run({ outcome: 'tie', opponent: rival })).text).toBe('Ничья');
  });

  it('does not invent an outcome for a race it cannot judge', () => {
    expect(runStatus(run({ mode: 'race', reachedTarget: null, opponent: { kind: 'bot', displayName: 'Alex' } })).kind).toBe('unknown');
  });
});

describe('run text', () => {
  it('declines rounds and circles', () => {
    expect(roundsText(run({ roundsPlayed: 1 }))).toBe('1 круг');
    expect(roundsText(run({ roundsPlayed: 4 }))).toBe('4 круга');
    expect(roundsText(run({ roundsPlayed: 12 }))).toBe('12 кругов');
    expect(roundsText(run({ mode: 'race', roundsPlayed: 6 }))).toBe('6 раундов');
  });

  it('summarises reached and missed runs without par or score', () => {
    expect(runSummary(run())).toBe('Дошёл до 100% за 7 кругов');
    expect(runSummary(run({ reachedTarget: false, progress: 64, roundsPlayed: 20 }))).toBe('64% за 20 кругов');
    expect(runSummary(run())).not.toMatch(/эталон|par|score/i);
  });
});

describe('time text', () => {
  const now = new Date(2026, 9, 11, 15, 0).getTime();

  it('says today, yesterday, then the date', () => {
    expect(formatRunTime(new Date(2026, 9, 11, 9, 5).getTime(), now)).toMatch(/^Сегодня, 09:05$/);
    expect(formatRunTime(new Date(2026, 9, 10, 23, 50).getTime(), now)).toMatch(/^Вчера, 23:50$/);
    expect(formatRunTime(new Date(2026, 9, 3, 18, 20).getTime(), now)).toMatch(/^3 октября, 18:20$/);
  });

  it('shows the invite deadline in the coarsest useful unit and drops expired ones', () => {
    expect(inviteDeadline(now + 2 * 24 * 3600_000 + 5, now)).toBe('Ещё 2 дн.');
    expect(inviteDeadline(now + 5 * 3600_000, now)).toBe('Ещё 5 ч');
    expect(inviteDeadline(now + 90_000, now)).toBe('Ещё 1 мин');
    expect(inviteDeadline(now - 1, now)).toBeNull();
  });
});

describe('category names', () => {
  it('names the general category', () => {
    expect(categoryName('general')).toBe('Общие знания');
  });
});
