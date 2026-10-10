/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseTimeMs, collisionBonusMs, countries, LAST_STAND_MAX_ROUNDS } from '@clutch/shared';
import app from '../apps/api/src/index';
import { createLastStandBot, FAST_BOT, SLOW_BOT, type LastStandOpponent } from '../apps/api/src/lastStand/bots';
import { recogniseCountry } from '../apps/api/src/lastStand/normalize';
import { countryNameRu, planForDate } from '../apps/api/src/lastStand/plan';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const today = '2026-10-08';
const databases: TestD1[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${today}T12:00:00.000Z`) });
});

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function env(db: TestD1, limiter: RateLimit = { limit: async () => ({ success: true }) }) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: limiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
  };
}

function guest(label: string): { authorization: string; playerId: string } {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  const signature = createHmac('sha256', sessionSecret).update(signed).digest('base64url');
  return { authorization: `Bearer ${signed}.${signature}`, playerId: `guest:${subject}` };
}

type Json = Record<string, any>;

async function post(db: TestD1, path: string, authorization: string | undefined, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
}

async function startRun(db: TestD1, label: string, name = label) {
  const identity = guest(label);
  const response = await post(db, '/api/last-stand/start', identity.authorization, { displayName: name });
  expect(response.status).toBe(201);
  return { ...identity, ...(await response.json() as Json) } as Json;
}

function answer(db: TestD1, run: Json, text: string, atMs: number) {
  return post(db, `/api/last-stand/${run.runId}/answer`, run.authorization, { answer: text, atMs });
}

function members(index: number): string[] {
  return [...planForDate(today)[index].members];
}

function setOpponents(db: TestD1, runId: string, opponents: LastStandOpponent[]) {
  db.sqlite.prepare('UPDATE last_stand_runs SET opponents_json = ? WHERE id = ?').run(JSON.stringify(opponents), runId);
}

function emptyOpponent(name: string): LastStandOpponent {
  return { runId: `bot:${name}`, displayName: name, source: 'bot', answers: Array(LAST_STAND_MAX_ROUNDS).fill(null) };
}

function opponentAnswering(name: string, answers: Record<number, { answer: string; atMs: number }>): LastStandOpponent {
  const result = emptyOpponent(name);
  for (const [index, value] of Object.entries(answers)) result.answers[Number(index)] = value;
  return result;
}

describe('last stand: start', () => {
  it('returns the agreed shape with two bots and no roster', async () => {
    const db = database();
    const run = await startRun(db, 'alem', 'Алем');
    expect(Object.keys(run).sort()).toEqual(['authorization', 'dateKey', 'opponents', 'playerId', 'round', 'runId']);
    expect(run.dateKey).toBe(today);
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.opponents.map((o: Json) => o.displayName)).toEqual(['Dana', 'Max']);
    expect(run.opponents.every((o: Json) => o.source === 'bot')).toBe(true);
    const plan = planForDate(today)[0];
    expect(run.round).toEqual({
      index: 0,
      scale: plan.scale,
      titleRu: expect.any(String),
      timeMs: baseTimeMs(plan.scale),
    });
    expect(JSON.stringify(run)).not.toMatch(/members|"answers"/);
  });

  it('requires identity and honours the rate limiter', async () => {
    const db = database();
    expect((await post(db, '/api/last-stand/start', undefined, {})).status).toBe(401);
    const limited = await app.request('/api/last-stand/start', {
      method: 'POST',
      headers: { authorization: guest('x').authorization },
    }, env(db, { limit: async () => ({ success: false }) }));
    expect(limited.status).toBe(429);
  });

  it('accepts an empty body', async () => {
    const db = database();
    const response = await app.request('/api/last-stand/start', {
      method: 'POST',
      headers: { authorization: guest('nobody').authorization },
    }, env(db));
    expect(response.status).toBe(201);
  });
});

describe('last stand: answers', () => {
  it('accepted: next round, reveal of this round only', async () => {
    const db = database();
    const run = await startRun(db, 'p1');
    const [first, second] = members(0);
    setOpponents(db, run.runId, [
      opponentAnswering('Dana', { 0: { answer: second, atMs: 3000 }, 1: { answer: first, atMs: 100 } }),
      emptyOpponent('Max'),
    ]);
    const response = await answer(db, run, countryNameRu(first), 2400);
    expect(response.status).toBe(200);
    const body = await response.json() as Json;
    const next = planForDate(today)[1];
    expect(body).toEqual({
      status: 'accepted',
      reason: null,
      deadlineMs: baseTimeMs(planForDate(today)[0].scale),
      reveal: [{ displayName: 'Dana', answerRu: countryNameRu(second), atMs: 3000 }],
      survived: 1,
      round: { index: 1, scale: next.scale, titleRu: expect.any(String), timeMs: baseTimeMs(next.scale) },
    });
    expect(JSON.stringify(body)).not.toContain('members');
  });

  it('occupied: same round, longer deadline, then a free answer passes', async () => {
    const db = database();
    const run = await startRun(db, 'p2');
    const round = planForDate(today)[0];
    const [taken, free] = members(0);
    setOpponents(db, run.runId, [opponentAnswering('Dana', { 0: { answer: taken, atMs: 1000 } }), emptyOpponent('Max')]);
    const occupied = await (await answer(db, run, countryNameRu(taken), 2000)).json() as Json;
    expect(occupied.status).toBe('occupied');
    expect(occupied.reason).toBeNull();
    expect(occupied.deadlineMs).toBe(baseTimeMs(round.scale) + collisionBonusMs(round.scale));
    expect(occupied.round.index).toBe(0);
    expect(occupied.reveal).toEqual([]);
    expect(occupied.survived).toBe(0);
    const accepted = await (await answer(db, run, countryNameRu(free), 3000)).json() as Json;
    expect(accepted.status).toBe('accepted');
    expect(accepted.round.index).toBe(1);
  });

  it('occupied extends the timer: an answer past base time but within the bonus is not a timeout', async () => {
    const db = database();
    const run = await startRun(db, 'p2b');
    const round = planForDate(today)[0];
    const [taken, free] = members(0);
    setOpponents(db, run.runId, [opponentAnswering('Dana', { 0: { answer: taken, atMs: 1000 } }), emptyOpponent('Max')]);
    await answer(db, run, countryNameRu(taken), 2000);
    const late = baseTimeMs(round.scale) + 1000;
    expect(((await (await answer(db, run, countryNameRu(free), late)).json()) as Json).status).toBe('accepted');
  });

  it('invalid: unknown text and a country outside the category are not elimination', async () => {
    const db = database();
    const run = await startRun(db, 'p3');
    const round = planForDate(today)[0];
    const outside = countries.find((country) => !round.members.includes(country.code))?.nameRu;
    const base = baseTimeMs(round.scale);
    for (const text of ['абракадабра', '', '   ', ...(outside ? [outside] : [])]) {
      const body = await (await answer(db, run, text, 1500)).json() as Json;
      expect(body).toMatchObject({ status: 'invalid', reason: null, deadlineMs: base, survived: 0, reveal: [] });
      expect(body.round.index).toBe(0);
    }
    expect(((await (await answer(db, run, countryNameRu(members(0)[0]), 1600)).json()) as Json).status).toBe('accepted');
  });

  it('eliminated by timeout, with reveal and a null round', async () => {
    const db = database();
    const run = await startRun(db, 'p4');
    const [first] = members(0);
    setOpponents(db, run.runId, [opponentAnswering('Dana', { 0: { answer: first, atMs: 5000 } }), emptyOpponent('Max')]);
    const body = await (await answer(db, run, countryNameRu(first), 10_000_000)).json() as Json;
    expect(body).toMatchObject({ status: 'eliminated', reason: 'timeout', survived: 0, round: null });
    expect(body.deadlineMs).toBe(baseTimeMs(planForDate(today)[0].scale));
    expect(body.reveal).toEqual([{ displayName: 'Dana', answerRu: countryNameRu(first), atMs: 5000 }]);
  });

  it('eliminated by exhaustion when records already named every member', async () => {
    const db = database();
    const run = await startRun(db, 'p5');
    const all = members(0);
    const opponents = all.map((code, index) => opponentAnswering(`R${index}`, { 0: { answer: code, atMs: 100 + index } }));
    setOpponents(db, run.runId, opponents);
    const body = await (await answer(db, run, countryNameRu(all[0]), 9000)).json() as Json;
    expect(body).toMatchObject({ status: 'eliminated', reason: 'exhausted', round: null, survived: 0 });
  });

  it('cleared after twelve rounds; a finished run answers 409', async () => {
    const db = database();
    const run = await startRun(db, 'p6');
    setOpponents(db, run.runId, [emptyOpponent('Dana'), emptyOpponent('Max')]);
    for (let index = 0; index < LAST_STAND_MAX_ROUNDS; index++) {
      const body = await (await answer(db, run, countryNameRu(members(index)[0]), 2000)).json() as Json;
      if (index < LAST_STAND_MAX_ROUNDS - 1) {
        expect(body.status).toBe('accepted');
        expect(body.round.index).toBe(index + 1);
      } else {
        expect(body).toMatchObject({ status: 'cleared', reason: null, round: null, survived: LAST_STAND_MAX_ROUNDS });
      }
    }
    expect((await answer(db, run, 'Франция', 1000)).status).toBe(409);
  });

  it('eliminated run answers 409', async () => {
    const db = database();
    const run = await startRun(db, 'p7');
    await answer(db, run, 'x', 10_000_000);
    expect((await answer(db, run, countryNameRu(members(0)[0]), 1000)).status).toBe(409);
  });

  it('404 for a foreign or unknown run, 400 for garbage, 401 without identity', async () => {
    const db = database();
    const run = await startRun(db, 'owner');
    const other = guest('thief');
    expect((await post(db, `/api/last-stand/${run.runId}/answer`, other.authorization, { answer: 'a', atMs: 1 })).status).toBe(404);
    expect((await post(db, '/api/last-stand/nope/answer', run.authorization, { answer: 'a', atMs: 1 })).status).toBe(404);
    expect((await post(db, `/api/last-stand/${run.runId}/answer`, undefined, { answer: 'a', atMs: 1 })).status).toBe(401);
    for (const bad of [{}, { answer: 5, atMs: 1 }, { answer: 'a', atMs: 'x' }, { answer: 'a' }, null, [], 'text']) {
      expect((await post(db, `/api/last-stand/${run.runId}/answer`, run.authorization, bad)).status).toBe(400);
    }
    const noJson = await app.request(`/api/last-stand/${run.runId}/answer`, {
      method: 'POST', headers: { authorization: run.authorization }, body: '{oops',
    }, env(db));
    expect(noJson.status).toBe(400);
  });

  it('clamps absurd atMs instead of failing', async () => {
    const db = database();
    const run = await startRun(db, 'p8');
    const body = await (await answer(db, run, countryNameRu(members(0)[0]), -50)).json() as Json;
    expect(body.status).toBe('accepted');
    const huge = await startRun(db, 'p9');
    const timeout = await (await answer(db, huge, 'x', 1e308)).json() as Json;
    expect(timeout).toMatchObject({ status: 'eliminated', reason: 'timeout' });
  });
});

describe('last stand: pool, leaderboard, ranking', () => {
  async function finish(db: TestD1, run: Json, rounds: number): Promise<void> {
    setOpponents(db, run.runId, [emptyOpponent('Dana'), emptyOpponent('Max')]);
    for (let index = 0; index < rounds; index++) await answer(db, run, countryNameRu(members(index)[0]), 2000);
    if (rounds < LAST_STAND_MAX_ROUNDS) await answer(db, run, 'x', 10_000_000);
  }

  async function board(db: TestD1, label: string, date?: string) {
    return app.request(`/api/last-stand/leaderboard${date ? `?date=${date}` : ''}`, {
      headers: { authorization: guest(label).authorization },
    }, env(db));
  }

  it('orders by survived, then earliest completion, one entry per player; only the first finished run counts', async () => {
    const db = database();
    const a = await startRun(db, 'a', 'Алем');
    await finish(db, a, 3);
    vi.setSystemTime(new Date(`${today}T12:01:00.000Z`));
    const b = await startRun(db, 'b', 'Борис');
    await finish(db, b, 5);
    vi.setSystemTime(new Date(`${today}T12:02:00.000Z`));
    const c = await startRun(db, 'c', 'Вера');
    await finish(db, c, 5);
    vi.setSystemTime(new Date(`${today}T12:03:00.000Z`));
    const again = await startRun(db, 'a', 'Алем');
    await finish(db, again, 9);

    const response = await board(db, 'a');
    expect(response.status).toBe(200);
    const body = await response.json() as Json;
    expect(body.dateKey).toBe(today);
    expect(body.entries.map((e: Json) => [e.displayName, e.survived])).toEqual([['Борис', 5], ['Вера', 5], ['Алем', 3]]);
    expect(typeof body.entries[0].completedAt).toBe('number');
    const flags = db.sqlite.prepare('SELECT counts_for_board AS f FROM last_stand_runs WHERE id = ?').get(again.runId) as { f: number };
    expect(flags.f).toBe(0);
  });

  it('leaderboard validates the date and defaults to today; other days are empty', async () => {
    const db = database();
    expect((await board(db, 'a', 'garbage')).status).toBe(400);
    expect((await board(db, 'a', '2026-02-31')).status).toBe(400);
    expect(((await (await board(db, 'a')).json()) as Json).dateKey).toBe(today);
    expect(((await (await board(db, 'a', '2026-01-01')).json()) as Json).entries).toEqual([]);
    expect((await app.request('/api/last-stand/leaderboard', {}, env(db))).status).toBe(401);
  });

  it('unfinished runs never reach the board or the pool', async () => {
    const db = database();
    const a = await startRun(db, 'a');
    setOpponents(db, a.runId, [emptyOpponent('Dana'), emptyOpponent('Max')]);
    await answer(db, a, countryNameRu(members(0)[0]), 2000);
    expect(((await (await board(db, 'a')).json()) as Json).entries).toEqual([]);
    const b = await startRun(db, 'b');
    expect(b.opponents.every((o: Json) => o.source === 'bot')).toBe(true);
  });

  it('serves a real record as an opponent, tops up with a bot, and never repeats the same record', async () => {
    const db = database();
    const a = await startRun(db, 'a', 'Алем');
    await finish(db, a, 2);
    vi.setSystemTime(new Date(`${today}T12:05:00.000Z`));
    const b = await startRun(db, 'b', 'Борис');
    expect(b.opponents).toHaveLength(2);
    expect(b.opponents.map((o: Json) => o.source).sort()).toEqual(['bot', 'player']);
    expect(b.opponents.find((o: Json) => o.source === 'player').displayName).toBe('Алем');
    const stored = JSON.parse((db.sqlite.prepare('SELECT opponents_json AS j FROM last_stand_runs WHERE id = ?').get(b.runId) as { j: string }).j) as LastStandOpponent[];
    const record = stored.find((o) => o.source === 'player')!;
    expect(record.runId).toBe(a.runId);
    expect(record.answers[0]).toEqual({ answer: members(0)[0], atMs: 2000 });
    expect(record.answers[5]).toBeNull();
    // Second run of b: the record was already faced; two bots.
    const b2 = await startRun(db, 'b', 'Борис');
    expect(b2.opponents.every((o: Json) => o.source === 'bot')).toBe(true);
    // Own records are never served to the owner.
    const a2 = await startRun(db, 'a', 'Алем');
    expect(a2.opponents.some((o: Json) => o.displayName === 'Алем')).toBe(false);
  });

  it('a record blocks regardless of who was faster', async () => {
    const db = database();
    const [first] = members(0);
    const c = await startRun(db, 'c', 'Вера');
    setOpponents(db, c.runId, [opponentAnswering('Алем', { 0: { answer: first, atMs: 2000 } }), emptyOpponent('Max')]);
    expect(((await (await answer(db, c, countryNameRu(first), 2000)).json()) as Json).status).toBe('occupied');
    expect(((await (await answer(db, c, countryNameRu(first), 600)).json()) as Json).status).toBe('occupied');
    const d = await startRun(db, 'd', 'Дима');
    setOpponents(db, d.runId, [opponentAnswering('Алем', { 0: { answer: first, atMs: 2000 } }), emptyOpponent('Max')]);
    expect(((await (await answer(db, d, countryNameRu(first), 2001)).json()) as Json).status).toBe('occupied');
  });
});

describe('last stand: bots', () => {
  it('answer every round with a member and a time inside the base timer, deterministically', () => {
    for (const dateKey of ['2026-10-08', '2026-10-09', '2027-01-15']) {
      const rounds = planForDate(dateKey);
      for (const profile of [FAST_BOT, SLOW_BOT]) {
        const bot = createLastStandBot(profile, dateKey, 'guest:x', rounds);
        expect(bot.answers).toHaveLength(LAST_STAND_MAX_ROUNDS);
        bot.answers.forEach((entry, index) => {
          expect(entry).not.toBeNull();
          expect(rounds[index].members).toContain(entry!.answer);
          expect(entry!.atMs).toBeGreaterThan(0);
          expect(entry!.atMs).toBeLessThan(rounds[index].baseTimeMs);
        });
        expect(createLastStandBot(profile, dateKey, 'guest:x', rounds)).toEqual(bot);
      }
    }
  });

  it('the fast bot is faster and more obvious than the slow one', () => {
    const rounds = planForDate(today);
    const fast = createLastStandBot(FAST_BOT, today, 'guest:x', rounds);
    const slow = createLastStandBot(SLOW_BOT, today, 'guest:x', rounds);
    const mean = (bot: LastStandOpponent) => bot.answers.reduce((sum, a) => sum + a!.atMs, 0) / bot.answers.length;
    expect(mean(fast)).toBeLessThan(mean(slow));
    expect(Math.max(...fast.answers.map((a) => a!.atMs))).toBeLessThan(3601);
    const differs = fast.answers.some((entry, index) => entry!.answer !== slow.answers[index]!.answer);
    expect(differs).toBe(true);
  });
});

describe('last stand: input recognition', () => {
  const koreas = ['kp', 'kr'];
  it('matches Russian and English names, case, spacing, yo and typos', () => {
    expect(recogniseCountry('Южная Корея', koreas)).toBe('kr');
    expect(recogniseCountry('  северная   КОРЕЯ ', koreas)).toBe('kp');
    expect(recogniseCountry('North Korea', koreas)).toBe('kp');
    expect(recogniseCountry('Южная Карея', koreas)).toBe('kr');
    expect(recogniseCountry('Бельгея', ['be', 'nl', 'lu'])).toBe('be');
    expect(recogniseCountry('Нидерланды', ['be', 'nl', 'lu'])).toBe('nl');
  });
  it('rejects non-members, ambiguity, garbage and non-strings', () => {
    expect(recogniseCountry('Франция', koreas)).toBeNull();
    expect(recogniseCountry('Корея', koreas)).toBeNull();
    expect(recogniseCountry('', koreas)).toBeNull();
    expect(recogniseCountry('x'.repeat(500), koreas)).toBeNull();
    expect(recogniseCountry(42, koreas)).toBeNull();
    expect(recogniseCountry(null, koreas)).toBeNull();
  });
  it('resolves among the whole world for wide rounds', () => {
    const all = countries.map((country) => country.code);
    expect(recogniseCountry('Япония', all)).toBe('jp');
    expect(recogniseCountry('germany', all)).toBe('de');
  });
});
