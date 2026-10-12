import { describe, expect, it } from 'vitest';
import {
  generalPackSets,
  isPackRecordLive,
  LAST_STAND_TABLE_SIZE,
  packSetScale,
  planLastStandRounds,
  type LastStandRound,
} from '@clutch/shared';
import { createLastStandBot, FAST_BOT, SLOW_BOT } from '../apps/api/src/lastStand/bots';
import { recogniseAnswer } from '../apps/api/src/lastStand/normalize';
import { memberNameRu, packPools, packSetForRound, planForDate, roundTitleRu } from '../apps/api/src/lastStand/plan';

const dates = Array.from({ length: 60 }, (_, i) => `2026-11-${String((i % 28) + 1).padStart(2, '0')}-${i}`);
const packRounds = (rounds: LastStandRound[]) => rounds.filter((r) => r.categoryId.startsWith('gp:'));
const roundOf = (title: string): LastStandRound => {
  for (const date of dates) {
    const found = planForDate(date).find((r) => roundTitleRu(r) === title);
    if (found) return found;
  }
  // Not planned on the sampled days: build the round directly from the live set.
  const set = generalPackSets.find((s) => s.titleRu === title)!;
  return { index: 0, scale: packSetScale(set), categoryId: `gp:${set.id}`, members: set.members.map((m) => m.id), baseTimeMs: 7000, collisionBonusMs: 3000 };
};

describe('last stand: pack categories', () => {
  it('plans country and pack categories together', () => {
    const all = dates.flatMap((d) => planForDate(d));
    expect(packRounds(all).length).toBeGreaterThan(0);
    expect(all.some((r) => !r.categoryId.startsWith('gp:'))).toBe(true);
    expect(packRounds(all).some((r) => r.scale === 'regional')).toBe(true);
    expect(packRounds(all).some((r) => r.scale === 'narrow')).toBe(true);
  });

  it('never plans non-live sets or sets smaller than the table, and keeps neighbours distinct', () => {
    const live = new Set(generalPackSets.filter(isPackRecordLive).map((s) => `gp:${s.id}`));
    for (const date of dates) {
      const rounds = planForDate(date);
      rounds.forEach((r, i) => {
        if (r.categoryId.startsWith('gp:')) {
          expect(live.has(r.categoryId), r.categoryId).toBe(true);
          expect(r.members.length).toBeGreaterThanOrEqual(LAST_STAND_TABLE_SIZE);
        }
        if (i > 0) expect(r.categoryId).not.toBe(rounds[i - 1].categoryId);
      });
      expect(planForDate(date)).toEqual(rounds);
    }
  });

  it('filters pack sets by status and size on its own data', () => {
    const base = generalPackSets.find((s) => packSetScale(s) === 'narrow' && s.members.length >= 3)!;
    const member = (n: number) => ({ id: `m${n}`, answerRu: `М${n}`, acceptedRu: [`М${n}`] });
    const make = (id: string, count: number, editorialStatus: 'approved' | 'pending') =>
      ({ ...base, id, editorialStatus, members: Array.from({ length: count }, (_, i) => member(i)) });
    const pools = packPools([
      make('ok-narrow', 4, 'approved'),
      make('pending-narrow', 4, 'pending'),
      make('tiny', 2, 'approved'),
      make('ok-regional', 10, 'approved'),
      make('pending-regional', 10, 'pending'),
    ]);
    expect(pools.narrow.map((c) => c.id)).toEqual(['gp:ok-narrow']);
    expect(pools.regional.map((c) => c.id)).toEqual(['gp:ok-regional']);
  });

  it('keeps the plan unchanged when no extra regional pool is given', () => {
    expect(planLastStandRounds('2026-10-08', [])).toEqual(planLastStandRounds('2026-10-08', [], 12, []));
  });

  it('titles a pack round with the set title', () => {
    const round = roundOf('Назови планету земной группы');
    expect(roundTitleRu(round)).toBe('Назови планету земной группы');
  });

  it('recognises members and rejects non-members', () => {
    const planets = roundOf('Назови планету земной группы');
    const set = packSetForRound(planets)!;
    expect(recogniseAnswer('Меркурий', planets, set)).toBe('mercury');
    expect(recogniseAnswer('Юпитер', planets, set)).toBeNull();
    const suits = roundOf('Назови масть игральных карт');
    expect(recogniseAnswer('черви', suits, packSetForRound(suits))).toBe('hearts');
    expect(memberNameRu(planets, 'mercury')).toBe('Меркурий');
    expect(recogniseAnswer('x'.repeat(200), planets, set)).toBeNull();
  });

  it('bots answer with a member of the pack category', () => {
    const rounds = [roundOf('Назови планету земной группы'), roundOf('Назови масть игральных карт')];
    for (const profile of [FAST_BOT, SLOW_BOT]) {
      const bot = createLastStandBot(profile, '2026-10-08', 'guest:x', rounds);
      bot.answers.forEach((a, i) => expect(rounds[i].members).toContain(a!.answer));
      expect(createLastStandBot(profile, '2026-10-08', 'guest:x', rounds)).toEqual(bot);
    }
    const fast = createLastStandBot(FAST_BOT, '2026-10-08', 'guest:x', rounds);
    expect(fast.answers[0]!.answer).toBe(rounds[0].members[0]);
  });
});
