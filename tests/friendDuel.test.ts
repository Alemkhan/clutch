/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  FRIEND_RULES_VERSION,
  PRACTICE_RULES_VERSION,
  dailyQuestionSet,
  invertOutcome,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CompleteSoloRunResponse,
  type MyRunsResponse,
  type Question,
  type DuelBoardResponse,
  type SoloLeaderboardResponse,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { listCompletedRuns, toRunSummary } from '../apps/api/src/myRuns/historyRepository';
import { insertInviteOnce, insertOpenInviteOnce } from '../apps/api/src/notifications/repository';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const SET = dailyQuestionSet('geography', NOW, 0);
const AUTHOR = 'telegram:42';
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

function call(db: TestD1, label: string, path: string, body?: unknown) {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: guest(label).authorization },
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

/** Завершённая соло-запись на наборе 0: четыре точных удара, дошла до цели. */
function insertRecord(db: TestD1, id: string, playerId: string) {
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
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, 'completed', ?, ?, ?, ?, ?, 1, ?, 1, 20, 0.2)
  `).run(
    id, playerId, id, JSON.stringify(SET.questions), JSON.stringify(rounds),
    NOW - 2000, NOW - 1000, SOLO, CURRENT_HAMMER_MINI_GAME.id, configJson, SET.questionSetId,
  );
}

const rowOf = (db: TestD1, id: string) =>
  db.sqlite.prepare('SELECT * FROM match_runs WHERE id = ?').get(id) as Record<string, unknown>;
const inviteCount = (db: TestD1) =>
  (db.sqlite.prepare('SELECT COUNT(*) AS n FROM rematch_invites').get() as { n: number }).n;

const OPEN_INVITE = 'rm_openannrun0000000000AB';

async function openInvite(db: TestD1): Promise<void> {
  await insertOpenInviteOnce(db.binding, {
    id: OPEN_INVITE, challengerRunId: 'ann-run', category: 'geography', challengerProgress: 100, now: NOW,
  });
}

async function playFriend(db: TestD1, label = 'bob') {
  insertRecord(db, 'ann-run', AUTHOR);
  await openInvite(db);
  const started = await call(db, label, '/api/solo-runs', {
    displayName: label, category: 'geography', mode: 'duel', rematchInviteId: OPEN_INVITE,
  });
  expect(started.status).toBe(201);
  const run = await started.json() as StartSoloRunResponse;
  const done = await playRounds((path, body) => call(db, label, path, body), run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
  await Promise.all(pending);
  expect(done.status).toBe(200);
  return { run, result: await done.json() as CompleteSoloRunResponse };
}

describe('friend duel: out of the competition', () => {
  it('is marked with its own rules version, like practice', async () => {
    const db = database();
    const { run } = await playFriend(db);
    expect(run.rulesVersion).toBe(FRIEND_RULES_VERSION);
    expect(rowOf(db, run.runId).rules_version).toBe(FRIEND_RULES_VERSION);
    expect(FRIEND_RULES_VERSION).not.toBe(SOLO);
    expect(FRIEND_RULES_VERSION).not.toBe(PRACTICE_RULES_VERSION);
    expect(rowOf(db, run.runId).ghost_eligible).toBe(0);
  });

  it('1. is not offered to other players in the shared pool', async () => {
    const db = database();
    const { run } = await playFriend(db);
    // Запись автора убрана из пула, чтобы осталась только проверка забега друга.
    db.sqlite.prepare('UPDATE match_runs SET reached_target = 0 WHERE id = ?').run('ann-run');
    db.sqlite.prepare('UPDATE match_runs SET reached_target = 1, set_par = 20, solo_score = 0.2 WHERE id = ?').run(run.runId);
    const other = await call(db, 'carol', '/api/solo-runs', { displayName: 'carol', category: 'geography', mode: 'duel' });
    const started = await other.json() as StartSoloRunResponse;
    expect(started.pace).toBeNull();
    expect(rowOf(db, started.runId).opponent_run_id).toBeNull();
  });

  it('2. does not reach the results table', async () => {
    const db = database();
    const { run } = await playFriend(db);
    db.sqlite.prepare('UPDATE match_runs SET reached_target = 1, set_par = 20, solo_score = 0.01 WHERE id = ?').run(run.runId);
    // Таблица дня — только забеги дня: ни дружеская дуэль, ни запись-дуэль автора туда не попадают.
    const board = await call(db, 'carol', '/api/solo-leaderboard?category=geography');
    const names = (await board.json() as SoloLeaderboardResponse).entries.map((entry) => entry.displayName);
    expect(names).toEqual([]);
    const duels = await call(db, 'carol', '/api/duel-board');
    expect((await duels.json() as DuelBoardResponse).entries).toEqual([]);
  });

  it('3. cannot be turned into a new friend link', async () => {
    const db = database();
    const { run } = await playFriend(db);
    const before = inviteCount(db);
    const response = await call(db, 'bob', `/api/solo-runs/${run.runId}/invite`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'not_solo' });
    expect(inviteCount(db)).toBe(before);
  });

  it('4. creates no rematch invite and no rematch button', async () => {
    const db = database();
    insertRecord(db, 'ann-run', AUTHOR);
    await openInvite(db);
    const before = inviteCount(db);
    const started = await call(db, 'bob', '/api/solo-runs', {
      displayName: 'bob', category: 'geography', mode: 'duel', rematchInviteId: OPEN_INVITE,
    });
    const run = await started.json() as StartSoloRunResponse;
    await playRounds((path, body) => call(db, 'bob', path, body), run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
    await Promise.all(pending);
    expect(inviteCount(db)).toBe(before);
    for (const [, init] of fetchMock.mock.calls as Array<[string, { body: string }]>) {
      expect(init.body).not.toContain('Сыграть реванш');
    }
  });
});

describe('friend duel: the duel itself still counts', () => {
  it('5. gives the friend an outcome against the record of the author', async () => {
    const db = database();
    const { run, result } = await playFriend(db);
    expect(['player', 'opponent', 'tie']).toContain(result.outcome);
    expect(rowOf(db, run.runId).solo_outcome).toBe(result.outcome);
    expect(result.reachedTarget).toBe(true);
    const mine = await call(db, 'bob', '/api/my-runs');
    const runs = (await mine.json() as MyRunsResponse).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: run.runId, friendDuel: 'played', outcome: result.outcome });
    expect(runs[0].opponent).toEqual({ kind: 'player', displayName: 'ann-run' });
  });

  it('shows the author the same duel with the inverted outcome, and tells them about it', async () => {
    const db = database();
    const { run, result } = await playFriend(db);
    const rows = await listCompletedRuns(db.binding, AUTHOR, 20, null);
    const summaries = rows.map((row) => toRunSummary(row, AUTHOR));
    const hosted = summaries.find((summary) => summary.runId === run.runId);
    expect(hosted).toMatchObject({ friendDuel: 'hosted' });
    expect(hosted?.outcome).toBe(invertOutcome(result.outcome!));
    expect(hosted?.opponent?.displayName).toBe('bob');
    // Собственная запись автора остаётся обычной партией.
    expect(summaries.find((summary) => summary.runId === 'ann-run')?.friendDuel).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('/sendMessage');
    const body = JSON.parse(init.body) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('не в зачёт');
    expect(init.body).not.toContain('реванш');
  });

  it('does not show the duel to a third player', async () => {
    const db = database();
    await playFriend(db);
    const mine = await call(db, 'carol', '/api/my-runs');
    expect((await mine.json() as MyRunsResponse).runs).toEqual([]);
  });
});

describe('friend duel: what stays competitive', () => {
  it('6. keeps the record of the inviter in the pool', async () => {
    const db = database();
    await playFriend(db);
    expect(rowOf(db, 'ann-run').rules_version).toBe(SOLO);
    const next = await call(db, 'dave', '/api/solo-runs', { displayName: 'dave', category: 'geography', mode: 'duel' });
    expect((await next.json() as StartSoloRunResponse).pace?.id).toBe('ann-run');
  });

  it('7. keeps a run started from a rematch invite a counted duel', async () => {
    const db = database();
    insertRecord(db, 'ann-run', AUTHOR);
    const bob = guest('bob');
    insertRecord(db, 'bob-first', bob.playerId);
    db.sqlite.prepare('UPDATE match_runs SET solo_score = 99 WHERE id = ?').run('bob-first');
    await insertInviteOnce(db.binding, {
      id: 'rm_rematch0000000000000AB',
      recipientPlayerId: bob.playerId,
      recipientRunId: 'bob-first',
      challengerRunId: 'ann-run',
      category: 'geography',
      recipientProgress: 100,
      challengerProgress: 100,
    });
    const started = await call(db, 'bob', '/api/solo-runs', {
      displayName: 'bob', category: 'geography', mode: 'duel', rematchInviteId: 'rm_rematch0000000000000AB',
    });
    expect(started.status).toBe(201);
    const run = await started.json() as StartSoloRunResponse;
    expect(run.rulesVersion).toBe(SOLO);
    const done = await playRounds((path, body) => call(db, 'bob', path, body), run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
    expect(done.status).toBe(200);
    expect(rowOf(db, run.runId)).toMatchObject({ rules_version: SOLO, reached_target: 1 });
    // Реванш — дуэль, а не забег дня: в таблицу забегов дня он не идёт.
    const board = await call(db, 'carol', '/api/solo-leaderboard?category=geography');
    expect((await board.json() as SoloLeaderboardResponse).entries.map((e) => e.displayName)).not.toContain('bob');
  });

  it('8. keeps practice out of the competition', async () => {
    const db = database();
    const started = await call(db, 'bob', '/api/solo-runs', { displayName: 'bob', category: 'geography', mode: 'duel', botLevel: 'amateur' });
    const run = await started.json() as StartSoloRunResponse;
    expect(run.rulesVersion).toBe(PRACTICE_RULES_VERSION);
    await playRounds((path, body) => call(db, 'bob', path, body), run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
    const board = await call(db, 'carol', '/api/solo-leaderboard?category=geography');
    expect((await board.json() as SoloLeaderboardResponse).entries).toEqual([]);
    const mine = await call(db, 'bob', '/api/my-runs');
    expect((await mine.json() as MyRunsResponse).runs).toEqual([]);
  });
});
