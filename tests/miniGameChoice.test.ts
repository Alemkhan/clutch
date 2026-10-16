/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  PRACTICE_RULES_VERSION,
  dailyQuestionSet,
  type AsyncMatchRound,
  type MiniGameId,
  type SoloRunSnapshot,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { insertInviteOnce, insertOpenInviteOnce } from '../apps/api/src/notifications/repository';
import { pickMiniGameId } from '../apps/api/src/solo/miniGame';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const databases: TestD1[] = [];
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

/** Завершённая соло-запись, дошедшая до цели, в заданной игре и на заданном наборе дня. */
function insertRecord(db: TestD1, id: string, playerId: string, miniGameId: string, setIndex = 0) {
  const set = dailyQuestionSet('geography', NOW, setIndex);
  let progress = 0;
  const rounds: AsyncMatchRound[] = Array.from({ length: 4 }, (_, index) => {
    progress += 25;
    return {
      questionId: set.questions[index].id,
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
    id, playerId, id, JSON.stringify(set.questions), JSON.stringify(rounds),
    NOW - 2000, NOW - 1000, SOLO, miniGameId, configJson, set.questionSetId,
  );
}

const rowOf = (db: TestD1, id: string) =>
  db.sqlite.prepare('SELECT * FROM match_runs WHERE id = ?').get(id) as Record<string, unknown>;

async function start(db: TestD1, label: string, extra: Record<string, unknown> = {}) {
  const response = await call(db, label, '/api/solo-runs', { displayName: label, category: 'geography', ...extra });
  expect(response.status).toBe(201);
  return await response.json() as StartSoloRunResponse;
}

function randomReturns(value: number) {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
    array[0] = value;
    return array;
  }) as typeof crypto.getRandomValues);
}

describe('pickMiniGameId', () => {
  it('inherits the game of a human record, whatever the random source says', () => {
    expect(pickMiniGameId({ row: { mini_game_id: 'tower_stack' } }, () => 0)).toBe('tower_stack');
    expect(pickMiniGameId({ row: { mini_game_id: 'hammer_nail' } }, () => 0.99)).toBe('hammer_nail');
  });

  it('chooses 50/50 without a record, and ignores an unknown stored id', () => {
    expect(pickMiniGameId(null, () => 0)).toBe('hammer_nail');
    expect(pickMiniGameId(null, () => 0.49)).toBe('hammer_nail');
    expect(pickMiniGameId(null, () => 0.5)).toBe('tower_stack');
    expect(pickMiniGameId(null, () => 0.999999)).toBe('tower_stack');
    expect(pickMiniGameId({ row: { mini_game_id: 'darts' } }, () => 0.9)).toBe('tower_stack');
  });
});

describe('mini-game of a new run', () => {
  it('regular start: the pool finds records of both games and the run inherits the record game', async () => {
    for (const game of ['hammer_nail', 'tower_stack'] as MiniGameId[]) {
      const db = database();
      insertRecord(db, 'ann-run', 'telegram:42', game);
      const run = await start(db, 'bob');
      expect(run.pace?.id).toBe('ann-run');
      expect(run.miniGameId).toBe(game);
      expect(rowOf(db, run.runId).mini_game_id).toBe(game);
    }
  });

  it('regular start without a record picks at random and stores the choice', async () => {
    for (const [value, expected] of [[0, 'hammer_nail'], [0xffffffff, 'tower_stack']] as const) {
      const db = database();
      randomReturns(value);
      const run = await start(db, 'bob');
      expect(run.pace).toBeNull();
      expect(run.miniGameId).toBe(expected);
      expect(rowOf(db, run.runId).mini_game_id).toBe(expected);
      vi.restoreAllMocks();
    }
  });

  it('practice against a bot picks at random', async () => {
    const db = database();
    randomReturns(0xffffffff);
    const run = await start(db, 'bob', { botLevel: 'amateur' });
    expect(run.rulesVersion).toBe(PRACTICE_RULES_VERSION);
    expect(run.miniGameId).toBe('tower_stack');
    expect(rowOf(db, run.runId).mini_game_id).toBe('tower_stack');
  });

  it('friend link: the run plays the game of the author record', async () => {
    const db = database();
    insertRecord(db, 'ann-run', 'telegram:42', 'tower_stack');
    await insertOpenInviteOnce(db.binding, {
      id: 'rm_openannrun0000000000AB', challengerRunId: 'ann-run', category: 'geography', challengerProgress: 100, now: NOW,
    });
    const run = await start(db, 'bob', { rematchInviteId: 'rm_openannrun0000000000AB' });
    expect(run.miniGameId).toBe('tower_stack');
    expect(rowOf(db, run.runId).mini_game_id).toBe('tower_stack');
  });

  it('rematch: the new run plays the game of the record it is matched with', async () => {
    const db = database();
    const bob = guest('bob');
    insertRecord(db, 'bob-first', bob.playerId, 'hammer_nail', 0);
    insertRecord(db, 'ann-run', 'telegram:42', 'hammer_nail', 0);
    insertRecord(db, 'carol-run', 'telegram:43', 'tower_stack', 1);
    await insertInviteOnce(db.binding, {
      id: 'rm_rematch0000000000000AB',
      recipientPlayerId: bob.playerId,
      recipientRunId: 'bob-first',
      challengerRunId: 'ann-run',
      category: 'geography',
      recipientProgress: 100,
      challengerProgress: 100,
    });
    const run = await start(db, 'bob', { rematchInviteId: 'rm_rematch0000000000000AB' });
    expect(run.pace?.id).toBe('carol-run');
    expect(run.miniGameId).toBe('tower_stack');
  });

  it('resume and snapshot return the stored game', async () => {
    const db = database();
    insertRecord(db, 'ann-run', 'telegram:42', 'tower_stack');
    const first = await start(db, 'bob');
    const again = await start(db, 'bob');
    expect(again.runId).toBe(first.runId);
    expect(again.miniGameId).toBe('tower_stack');
    const snapshot = await (await call(db, 'bob', `/api/solo-runs/${first.runId}`)).json() as SoloRunSnapshot;
    expect(snapshot.miniGameId).toBe('tower_stack');
  });

  it('refuses a run with an unknown mini-game id', async () => {
    const db = database();
    const run = await start(db, 'bob');
    db.sqlite.prepare('UPDATE match_runs SET mini_game_id = ? WHERE id = ?').run('darts', run.runId);
    const response = await call(db, 'bob', `/api/solo-runs/${run.runId}`);
    expect(response.status).toBe(409);
  });
});
