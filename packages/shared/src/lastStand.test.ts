import { describe, expect, it } from 'vitest';
import {
  LAST_STAND_MAX_ROUNDS,
  LAST_STAND_TABLE_SIZE,
  applyLastStandResolution,
  countFreeOptions,
  createLastStandGame,
  currentLastStandRound,
  isExhausted,
  narrowShareAt,
  planLastStandRounds,
  regionalCategories,
  resolveLastStandAnswer,
  roundDeadlineMs,
  submitLastStandAnswer,
  validateNarrowCategories,
  wideCategory,
  type LastStandCategory,
  type LastStandRound,
} from './lastStand';
import { countries } from './countries';

// Fixtures: the module must not depend on any real narrow list.
const narrow = (id: string, members: string[]): LastStandCategory => ({ id, scale: 'narrow', members });
const POOL: LastStandCategory[] = [
  narrow('t-pair', ['aa', 'bb']),
  narrow('t-trio', ['cc', 'dd', 'ee']),
  narrow('t-six', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']),
  narrow('t-four', ['f1', 'f2', 'f3', 'f4']),
  narrow('t-five', ['g1', 'g2', 'g3', 'g4', 'g5']),
];

const roundOf = (scale: 'wide' | 'regional' | 'narrow', members: string[]): LastStandRound => ({
  index: 0,
  scale,
  categoryId: 'x',
  members,
  baseTimeMs: scale === 'wide' ? 15000 : scale === 'regional' ? 10000 : 7000,
  collisionBonusMs: scale === 'wide' ? 7000 : scale === 'regional' ? 5000 : 3000,
});

describe('plan', () => {
  it('is deterministic per date and differs between dates', () => {
    expect(planLastStandRounds('2026-10-08', POOL)).toEqual(planLastStandRounds('2026-10-08', POOL));
    expect(planLastStandRounds('2026-10-08', POOL)).not.toEqual(planLastStandRounds('2026-10-09', POOL));
  });

  it('does not depend on input order of the pool', () => {
    expect(planLastStandRounds('2026-10-08', [...POOL].reverse())).toEqual(planLastStandRounds('2026-10-08', POOL));
  });

  it('has 12 rounds with scale-bound timers and real memberships', () => {
    const rounds = planLastStandRounds('2026-10-08', POOL);
    expect(rounds).toHaveLength(LAST_STAND_MAX_ROUNDS);
    for (const round of rounds) {
      if (round.scale === 'wide') {
        expect(round.members).toHaveLength(countries.length);
        expect([round.baseTimeMs, round.collisionBonusMs]).toEqual([15000, 7000]);
      } else if (round.scale === 'regional') {
        expect([round.baseTimeMs, round.collisionBonusMs]).toEqual([10000, 5000]);
        expect(round.members.length).toBeGreaterThanOrEqual(14);
      } else {
        expect([round.baseTimeMs, round.collisionBonusMs]).toEqual([7000, 3000]);
        expect(round.members.length).toBeGreaterThanOrEqual(2);
        expect(round.members.length).toBeLessThanOrEqual(6);
      }
    }
  });

  it('region sizes match countries.ts', () => {
    const sizes = Object.fromEntries(regionalCategories().map((c) => [c.id, c.members.length]));
    expect(sizes).toMatchObject({
      'region:Africa': 54,
      'region:Asia': 48,
      'region:Europe': 46,
      'region:Americas': 35,
      'region:Oceania': 14,
    });
    expect(wideCategory().members).toHaveLength(countries.length);
  });

  it('shifts toward narrow rounds late in the party (many days)', () => {
    let early = 0;
    let late = 0;
    const scales = new Set<string>();
    const days = 400;
    for (let d = 0; d < days; d++) {
      const rounds = planLastStandRounds(`2027-01-01#${d}`, POOL);
      rounds.slice(0, 4).forEach((r) => {
        if (r.scale === 'narrow') early++;
      });
      rounds.slice(-4).forEach((r) => {
        if (r.scale === 'narrow') late++;
      });
      rounds.forEach((r) => scales.add(r.scale));
    }
    const earlyShare = early / (days * 4);
    const lateShare = late / (days * 4);
    expect(lateShare).toBeGreaterThan(earlyShare + 0.3);
    expect(earlyShare).toBeLessThan(0.35);
    expect(lateShare).toBeGreaterThan(0.5);
    expect(lateShare).toBeLessThan(0.95); // not a strict ladder
    expect(scales.size).toBe(3);
  });

  it('narrowShareAt grows monotonically', () => {
    for (let i = 1; i < 12; i++) expect(narrowShareAt(i)).toBeGreaterThan(narrowShareAt(i - 1));
  });

  it('works with an empty narrow pool (regional replaces narrow)', () => {
    const rounds = planLastStandRounds('2026-10-08', []);
    expect(rounds.every((r) => r.scale !== 'narrow')).toBe(true);
  });

  it('never puts the same category in two neighbouring rounds (many days, with and without narrow pool)', () => {
    for (const pool of [POOL, [], [POOL[0]]]) {
      for (let d = 0; d < 500; d++) {
        const rounds = planLastStandRounds(`adj${d}`, pool);
        for (let i = 1; i < rounds.length; i++) expect(rounds[i].categoryId).not.toBe(rounds[i - 1].categoryId);
        expect(planLastStandRounds(`adj${d}`, pool)).toEqual(rounds);
      }
    }
  });

  it('avoids repeating a narrow category while unused ones remain', () => {
    // Only categories that can seat the whole table are schedulable, so the pair never counts.
    const schedulable = POOL.filter((c) => c.members.length >= LAST_STAND_TABLE_SIZE).length;
    for (let d = 0; d < 100; d++) {
      const ids = planLastStandRounds(`d${d}`, POOL)
        .filter((r) => r.scale === 'narrow')
        .map((r) => r.categoryId);
      if (ids.length <= schedulable) expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('rejects invalid narrow categories', () => {
    expect(() => validateNarrowCategories([narrow('one', ['a'])])).toThrow(RangeError);
    expect(() => validateNarrowCategories([narrow('seven', ['1', '2', '3', '4', '5', '6', '7'])])).toThrow(RangeError);
    expect(() => validateNarrowCategories([narrow('d', ['a', 'a'])])).toThrow(RangeError);
    expect(() => validateNarrowCategories([narrow('x', ['a', 'b']), narrow('x', ['c', 'd'])])).toThrow(RangeError);
    expect(() => validateNarrowCategories([{ id: 'r', scale: 'regional', members: ['a', 'b'] }])).toThrow(RangeError);
  });
});

describe('timers', () => {
  it('adds the bonus per collision by scale', () => {
    expect(roundDeadlineMs(roundOf('wide', []), 0)).toBe(15000);
    expect(roundDeadlineMs(roundOf('wide', []), 1)).toBe(22000);
    expect(roundDeadlineMs(roundOf('regional', []), 2)).toBe(20000);
    expect(roundDeadlineMs(roundOf('narrow', []), 3)).toBe(16000);
  });
});

describe('resolve', () => {
  const round = roundOf('regional', ['a', 'b', 'c', 'd']);
  const base = { round, collisions: 0 };

  it('accepts a free answer', () => {
    expect(resolveLastStandAnswer({ ...base, answer: 'a', atMs: 2000, records: [null, null] })).toEqual({
      kind: 'accepted',
      answer: 'a',
    });
  });

  it('marks an answer named by a faster record as occupied, with the bonus', () => {
    const r = resolveLastStandAnswer({ ...base, answer: 'a', atMs: 3000, records: [{ answer: 'a', atMs: 2000 }, null] });
    expect(r).toEqual({ kind: 'occupied', answer: 'a', collisions: 1, deadlineMs: 15000, freeLeft: 3 });
  });

  it('a slower record blocks too (time is irrelevant), records untouched', () => {
    const records = [{ answer: 'a', atMs: 8107 }, { answer: 'b', atMs: 8992 }] as const;
    const snapshot = JSON.stringify(records);
    expect(resolveLastStandAnswer({ ...base, answer: 'a', atMs: 600, records })).toEqual({
      kind: 'occupied',
      answer: 'a',
      collisions: 1,
      deadlineMs: 15000,
      freeLeft: 2,
    });
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  it('equal time collides as well', () => {
    expect(
      resolveLastStandAnswer({ ...base, answer: 'a', atMs: 3000, records: [{ answer: 'a', atMs: 3000 }, null] }).kind,
    ).toBe('occupied');
  });

  it('an answer no opponent named is accepted whenever it is given', () => {
    const records = [{ answer: 'a', atMs: 100 }, { answer: 'b', atMs: 9000 }] as const;
    expect(resolveLastStandAnswer({ ...base, answer: 'c', atMs: 50, records }).kind).toBe('accepted');
    expect(resolveLastStandAnswer({ ...base, answer: 'c', atMs: 9500, records: [...records], collisions: 1 }).kind).toBe('accepted');
  });

  it('unrecognised or out-of-category input is not an elimination', () => {
    expect(resolveLastStandAnswer({ ...base, answer: null, atMs: 1000, records: [null, null] })).toEqual({ kind: 'invalid' });
    expect(resolveLastStandAnswer({ ...base, answer: 'zz', atMs: 1000, records: [null, null] })).toEqual({ kind: 'invalid' });
  });

  it('times out after the deadline, extended by collisions', () => {
    expect(resolveLastStandAnswer({ ...base, answer: 'a', atMs: 10001, records: [null, null] })).toEqual({
      kind: 'eliminated',
      reason: 'timeout',
    });
    expect(resolveLastStandAnswer({ ...base, answer: 'a', atMs: 10000, records: [null, null] }).kind).toBe('accepted');
    expect(resolveLastStandAnswer({ ...base, collisions: 1, answer: 'a', atMs: 14000, records: [null, null] }).kind).toBe(
      'accepted',
    );
    expect(resolveLastStandAnswer({ ...base, answer: null, atMs: 12000, records: [null, null] })).toEqual({
      kind: 'eliminated',
      reason: 'timeout',
    });
  });

  it('counts free options against all opponent answers, regardless of time', () => {
    const records = [
      { answer: 'a', atMs: 1000 },
      { answer: 'b', atMs: 20000 },
    ] as const;
    expect(countFreeOptions(round.members, records)).toBe(2);
    expect(countFreeOptions(round.members, [null, null])).toBe(4);
  });

  it('exhaustion: pair category, two opponents cover both members', () => {
    const pair = roundOf('narrow', ['aa', 'bb']);
    const records = [
      { answer: 'aa', atMs: 8000 },
      { answer: 'bb', atMs: 9000 },
    ] as const;
    expect(isExhausted(pair.members, records)).toBe(true);
    for (const answer of ['aa', 'bb', null]) {
      expect(resolveLastStandAnswer({ round: pair, collisions: 0, answer, atMs: 300, records })).toEqual({
        kind: 'eliminated',
        reason: 'exhausted',
      });
    }
  });

  it('pair category with one opponent answer or duplicate answers is not exhausted', () => {
    const pair = roundOf('narrow', ['aa', 'bb']);
    expect(isExhausted(pair.members, [{ answer: 'aa', atMs: 1 }, null])).toBe(false);
    expect(
      isExhausted(pair.members, [
        { answer: 'aa', atMs: 1 },
        { answer: 'aa', atMs: 2 },
      ]),
    ).toBe(false);
    expect(resolveLastStandAnswer({ round: pair, collisions: 0, answer: 'bb', atMs: 300, records: [{ answer: 'aa', atMs: 1 }, null] }).kind).toBe('accepted');
  });

  it('exhaustion never happens if records do not cover everyone', () => {
    const trio = roundOf('narrow', ['x', 'y', 'z']);
    expect(isExhausted(trio.members, [{ answer: 'x', atMs: 1 }, { answer: 'y', atMs: 2 }])).toBe(false);
    expect(isExhausted(trio.members, [{ answer: 'x', atMs: 1 }, null])).toBe(false);
    expect(isExhausted([], [])).toBe(false);
  });

  it('timeout still depends on atMs when not exhausted', () => {
    const pair = roundOf('narrow', ['aa', 'bb']);
    expect(resolveLastStandAnswer({ round: pair, collisions: 0, answer: 'bb', atMs: 7001, records: [{ answer: 'aa', atMs: 1 }, null] })).toEqual({
      kind: 'eliminated',
      reason: 'timeout',
    });
  });
});

describe('state', () => {
  const noRecords = [null, null] as const;
  const accept = (state: ReturnType<typeof createLastStandGame>) => {
    const round = currentLastStandRound(state)!;
    return submitLastStandAnswer(state, { answer: round.members[0], atMs: 1000, records: noRecords }).state;
  };

  it('starts at round 0 and advances on acceptance', () => {
    const start = createLastStandGame('2026-10-08', POOL);
    expect(start).toMatchObject({ roundIndex: 0, survived: 0, status: 'playing' });
    const next = accept(start);
    expect(next).toMatchObject({ roundIndex: 1, survived: 1, collisions: 0, status: 'playing' });
    expect(start.survived).toBe(0); // immutable
  });

  it('collision keeps the round, bumps collisions, and resets on advance', () => {
    const state = createLastStandGame('2026-10-08', POOL);
    const round = currentLastStandRound(state)!;
    const first = round.members[0];
    const records = [{ answer: first, atMs: 1000 }, null] as const;
    const r1 = submitLastStandAnswer(state, { answer: first, atMs: 2000, records });
    expect(r1.resolution?.kind).toBe('occupied');
    expect(r1.state).toMatchObject({ roundIndex: 0, collisions: 1 });
    const r2 = submitLastStandAnswer(r1.state, { answer: round.members[1], atMs: 3000, records });
    expect(r2.state).toMatchObject({ roundIndex: 1, collisions: 0, survived: 1 });
  });

  it('the bonus exists only after a collision', () => {
    const state = createLastStandGame('2026-10-08', POOL);
    const round = currentLastStandRound(state)!;
    const late = round.baseTimeMs + 1;
    const plain = submitLastStandAnswer(state, { answer: round.members[0], atMs: late, records: noRecords });
    expect(plain.state.eliminatedBy).toBe('timeout');
    const records = [{ answer: round.members[0], atMs: 100 }, null] as const;
    const collided = submitLastStandAnswer(state, { answer: round.members[0], atMs: 200, records });
    const second = submitLastStandAnswer(collided.state, { answer: round.members[1], atMs: late, records });
    expect(second.state.status).toBe('playing');
  });

  it('invalid input leaves state untouched', () => {
    const state = createLastStandGame('2026-10-08', POOL);
    const out = submitLastStandAnswer(state, { answer: null, atMs: 500, records: noRecords });
    expect(out.state).toBe(state);
    expect(out.resolution).toEqual({ kind: 'invalid' });
  });

  it('elimination is terminal and keeps the score', () => {
    let state = accept(accept(createLastStandGame('2026-10-08', POOL)));
    state = submitLastStandAnswer(state, { answer: null, atMs: 99999, records: noRecords }).state;
    expect(state).toMatchObject({ status: 'eliminated', eliminatedBy: 'timeout', survived: 2 });
    expect(currentLastStandRound(state)).toBeNull();
    const after = submitLastStandAnswer(state, { answer: 'x', atMs: 1, records: noRecords });
    expect(after.state).toBe(state);
    expect(after.resolution).toBeNull();
    expect(applyLastStandResolution(state, { kind: 'accepted', answer: 'x' })).toBe(state);
  });

  it('exhaustion eliminates with the exhausted reason', () => {
    const planned = createLastStandGame('2026-10-08', POOL);
    const state = { ...planned, rounds: [roundOf('narrow', ['aa', 'bb']), ...planned.rounds.slice(1)] };
    const out = submitLastStandAnswer(state, {
      answer: 'aa',
      atMs: 3000,
      records: [
        { answer: 'aa', atMs: 1000 },
        { answer: 'bb', atMs: 2000 },
      ],
    });
    expect(out.state).toMatchObject({ status: 'eliminated', eliminatedBy: 'exhausted', survived: 0 });
  });

  it('never schedules a category smaller than the table, so exhaustion cannot decide a round', () => {
    for (let day = 1; day <= 120; day++) {
      const dateKey = `2026-10-${String((day % 28) + 1).padStart(2, '0')}`;
      for (const round of planLastStandRounds(`${dateKey}-${day}`, POOL)) {
        expect(round.members.length).toBeGreaterThanOrEqual(LAST_STAND_TABLE_SIZE);
        expect(round.categoryId).not.toBe('t-pair');
      }
    }
  });

  it('still plans narrow rounds when only the pair is filtered out', () => {
    const scales = new Set(
      planLastStandRounds('2026-10-08', [narrow('t-pair', ['aa', 'bb']), narrow('t-trio', ['cc', 'dd', 'ee'])])
        .map((round) => round.scale),
    );
    expect(scales.has('narrow')).toBe(true);
  });

  it('falls back to wider scales when every narrow category is below the table size', () => {
    const rounds = planLastStandRounds('2026-10-08', [narrow('t-pair', ['aa', 'bb'])]);
    expect(rounds).toHaveLength(LAST_STAND_MAX_ROUNDS);
    expect(rounds.every((round) => round.scale !== 'narrow')).toBe(true);
  });

  it('uses every distinct category before repeating any, across scales', () => {
    // 6 narrow fixtures + 5 regions + 1 wide = 12 distinct categories for 12 rounds.
    const pool = [
      narrow('n1', ['a1', 'a2', 'a3']), narrow('n2', ['b1', 'b2', 'b3']),
      narrow('n3', ['c1', 'c2', 'c3']), narrow('n4', ['d1', 'd2', 'd3']),
      narrow('n5', ['e1', 'e2', 'e3']), narrow('n6', ['f1', 'f2', 'f3']),
    ];
    for (let day = 0; day < 80; day++) {
      const ids = planLastStandRounds(`repeat-${day}`, pool).map((r) => r.categoryId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('cap of 12 rounds ends the party as cleared', () => {
    let state = createLastStandGame('2026-10-08', POOL);
    for (let i = 0; i < LAST_STAND_MAX_ROUNDS; i++) {
      expect(state.status).toBe('playing');
      state = accept(state);
    }
    expect(state).toMatchObject({ status: 'cleared', survived: 12, eliminatedBy: null });
    expect(currentLastStandRound(state)).toBeNull();
  });
});
