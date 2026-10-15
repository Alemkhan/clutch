/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  CURRENT_SOLO_RUN_CONDITIONS,
  dailyKey,
  dailyQuestionSet,
  setPar,
  type AsyncMatchRound,
  type CompleteSoloRunResponse,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { duelResultText, soloResultText } from '../apps/api/src/notifications/outbid';
import { insertOpenInviteOnce } from '../apps/api/src/notifications/repository';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

// R24c1: исход решает прикидка «На глазок», когда счёт и круги равны.
const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const TODAY = dailyKey(NOW);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const SET = dailyQuestionSet('geography', NOW, 0);
const EQUAL_SCORE = 4 / setPar(SET.questions);
const PACE_OWNER = 'telegram:42';
const databases: TestD1[] = [];
let pending: Promise<unknown>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
const executionCtx = {
  waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  passThroughOnException() {},
} as unknown as ExecutionContext;

beforeEach(() => {
  pending = [];
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function call(db: TestD1, path: string, authorization: string, body?: unknown) {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  }, executionCtx);
}

function telegram(id: number): { authorization: string; playerId: string } {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Игрок' }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test').digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return { authorization: `tma ${params.toString()}`, playerId: `telegram:${id}` };
}

function guest(label: string): { authorization: string; playerId: string } {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(NOW / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return {
    authorization: `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`,
    playerId: `guest:${subject}`,
  };
}

/** Завершённая запись на наборе 0: четыре круга по 25, дошла до цели. */
function insertRecord(db: TestD1, options: { id: string; playerId: string; completedAt?: number }) {
  let progress = 0;
  const rounds: AsyncMatchRound[] = Array.from({ length: 4 }, (_, index) => {
    progress += 25;
    return {
      questionId: SET.questions[index].id,
      correct: true,
      responseTimeMs: 1000,
      progressAwarded: 25,
      playerProgressAfter: progress,
    };
  });
  const completedAt = options.completedAt ?? NOW - 1000;
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, 'completed', ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
  `).run(
    options.id, options.playerId, options.id, JSON.stringify(SET.questions), JSON.stringify(rounds),
    completedAt - 1000, completedAt, SOLO, CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id, configJson,
    SET.questionSetId, setPar(SET.questions), EQUAL_SCORE,
  );
}

/** Ответ игрока на вопрос суток dateKey (вопрос создаётся при первом обращении). */
function answered(db: TestD1, playerId: string, dateKey: string, multiplier: number) {
  db.sqlite.prepare(`
    INSERT OR IGNORE INTO tiebreaker_questions (id, prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at)
    VALUES (?, 'Сколько?', '', 100, 'https://example.com', '2026-01-01', ?, '{"steps":[{"label":"шаг","value":1,"unit":"","sourceUrl":"https://example.org","sourceTitle":"Пример"}],"summary":"итог"}', 1)
  `).run(`q-${dateKey}`, dateKey);
  db.sqlite.prepare(`
    INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at)
    VALUES (?, ?, ?, 100, ?, 1)
  `).run(playerId, `q-${dateKey}`, dateKey, multiplier);
}

async function play(db: TestD1, authorization: string, start: Record<string, unknown> = {}) {
  const started = await call(db, '/api/solo-runs', authorization, { displayName: 'Игрок', category: 'geography', ...start });
  expect(started.status).toBe(201);
  const run = await started.json() as StartSoloRunResponse;
  const done = await playRounds(
    (path, body) => call(db, path, authorization, body),
    run.runId,
    roundInputs(fullQuestions(db, run.runId), 4, true),
  );
  await Promise.all(pending);
  expect(done.status).toBe(200);
  return { run, raw: await done.text() };
}

const parse = (raw: string) => JSON.parse(raw) as CompleteSoloRunResponse;
const sentText = (): string => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).text;
const stored = (db: TestD1, runId: string) =>
  (db.sqlite.prepare('SELECT solo_outcome FROM match_runs WHERE id = ?').get(runId) as { solo_outcome: unknown }).solo_outcome;

describe('solo outcome: the guess resolves an equal run', () => {
  // Лениво: auth_date берётся из подменённых часов, а не из момента сборки файла.
  const bob = () => telegram(7);

  it('both answered: the lower multiplier wins and the record owner is told with the numbers', async () => {
    const db = database();
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    answered(db, PACE_OWNER, TODAY, 2.8);
    answered(db, bob().playerId, TODAY, 1.4);
    const { run, raw } = await play(db, bob().authorization);
    const result = parse(raw);
    expect(result.outcome).toBe('player');
    expect(result.tiebreak).toEqual({ ownMultiplier: 1.4, opponentMultiplier: 2.8 });
    expect(stored(db, run.runId)).toBe('player');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentText()).toBe('Ничья по забегу, но «На глазок» ×2,8 против ×1,4: Игрок оказался ближе.');
  });

  it('both answered: the higher multiplier loses and the record holds', async () => {
    const db = database();
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    answered(db, PACE_OWNER, TODAY, 1.4);
    answered(db, bob().playerId, TODAY, 2.8);
    const { raw } = await play(db, bob().authorization);
    const result = parse(raw);
    expect(result.outcome).toBe('opponent');
    expect(result.tiebreak).toEqual({ ownMultiplier: 2.8, opponentMultiplier: 1.4 });
    expect(sentText()).toBe('Ничья по забегу, но «На глазок» ×1,4 против ×2,8: победа ваша.');
  });

  it('only the challenger answered: he wins, the pace multiplier is null', async () => {
    const db = database();
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    answered(db, bob().playerId, TODAY, 3);
    const { raw } = await play(db, bob().authorization);
    const result = parse(raw);
    expect(result.outcome).toBe('player');
    expect(result.tiebreak).toEqual({ ownMultiplier: 3, opponentMultiplier: null });
    expect(sentText()).toBe('Ничья по забегу, но «На глазок» ответил только Игрок: Игрок оказался ближе.');
  });

  it('only the record owner answered: the challenger loses and is not shown the pace multiplier', async () => {
    const db = database();
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    answered(db, PACE_OWNER, TODAY, 2.8);
    const { run, raw } = await play(db, bob().authorization);
    const result = parse(raw);
    expect(result.outcome).toBe('opponent');
    expect(stored(db, run.runId)).toBe('opponent');
    expect(result.tiebreak).toEqual({ ownMultiplier: null, opponentMultiplier: null });
    expect(raw).not.toContain('2.8');
  });

  it('nobody answered: still a tie, no tiebreak in the response', async () => {
    const db = database();
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    const { run, raw } = await play(db, bob().authorization);
    expect(parse(raw).outcome).toBe('tie');
    expect(parse(raw).tiebreak).toBeUndefined();
    expect(stored(db, run.runId)).toBe('tie');
    expect(sentText()).toBe('Ничья с Игрок: результаты сравнялись.');
  });

  it('equal multipliers stay a tie', async () => {
    const db = database();
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    answered(db, PACE_OWNER, TODAY, 1.4);
    answered(db, bob().playerId, TODAY, 1.4);
    const { raw } = await play(db, bob().authorization);
    expect(parse(raw).outcome).toBe('tie');
    expect(parse(raw).tiebreak).toBeUndefined();
  });

  it('the record was set on another day: different questions, a tie', async () => {
    const db = database();
    const yesterday = dailyKey(NOW - 30 * 3_600_000);
    expect(yesterday).not.toBe(TODAY);
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER, completedAt: NOW - 30 * 3_600_000 });
    answered(db, PACE_OWNER, yesterday, 9);
    answered(db, bob().playerId, TODAY, 1.1);
    const { raw } = await play(db, bob().authorization);
    expect(parse(raw).outcome).toBe('tie');
    expect(parse(raw).tiebreak).toBeUndefined();
  });

  it('a guest answer is stored but does not count: the challenger guest is a nobody', async () => {
    const db = database();
    const guestPlayer = guest('guesty');
    insertRecord(db, { id: 'alem-run', playerId: PACE_OWNER });
    answered(db, guestPlayer.playerId, TODAY, 1.1);
    answered(db, PACE_OWNER, TODAY, 5);
    const { raw } = await play(db, guestPlayer.authorization);
    // Гость «не ответил»: проигрывает ответившему владельцу записи.
    expect(parse(raw).outcome).toBe('opponent');
    expect(parse(raw).tiebreak).toEqual({ ownMultiplier: null, opponentMultiplier: null });
  });

  it('a guest owner of the record does not count either', async () => {
    const db = database();
    const guestOwner = guest('owner');
    insertRecord(db, { id: 'guest-run', playerId: guestOwner.playerId });
    answered(db, guestOwner.playerId, TODAY, 1.1);
    answered(db, bob().playerId, TODAY, 9);
    const { raw } = await play(db, bob().authorization);
    expect(parse(raw).outcome).toBe('player');
    expect(parse(raw).tiebreak).toEqual({ ownMultiplier: 9, opponentMultiplier: null });
  });

  it('a friend duel goes through the same path', async () => {
    const db = database();
    insertRecord(db, { id: 'ann-run', playerId: PACE_OWNER });
    await insertOpenInviteOnce(db.binding, {
      id: 'rm_openannrun0000000000AB', challengerRunId: 'ann-run', category: 'geography', challengerProgress: 100, now: NOW,
    });
    answered(db, PACE_OWNER, TODAY, 2.8);
    answered(db, bob().playerId, TODAY, 1.4);
    const { run, raw } = await play(db, bob().authorization, { rematchInviteId: 'rm_openannrun0000000000AB' });
    const result = parse(raw);
    expect(result.outcome).toBe('player');
    expect(result.tiebreak).toEqual({ ownMultiplier: 1.4, opponentMultiplier: 2.8 });
    expect(stored(db, run.runId)).toBe('player');
    expect(sentText()).toBe('Ничья по забегу, но «На глазок» ×2,8 против ×1,4: Игрок оказался ближе. Дружеская игра, не в зачёт.');
  });
});

describe('notification texts for a tiebreak', () => {
  it('formats multipliers with a comma and one decimal, and never invents numbers', () => {
    expect(soloResultText('Игрок', 'record_won', { recipientMultiplier: 1.44, challengerMultiplier: 12 }))
      .toBe('Ничья по забегу, но «На глазок» ×1,4 против ×12,0: победа ваша.');
    expect(duelResultText('Друг', 'record_lost', { recipientMultiplier: null, challengerMultiplier: 2 }))
      .toBe('Ничья по забегу, но «На глазок» ответил только Друг: Друг оказался ближе. Дружеская игра, не в зачёт.');
  });
});
