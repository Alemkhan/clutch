/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHmac, createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  generateMatch,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type Opponent,
  type Question,
  type StartAsyncMatchResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { issueGuestSession, verifyGuestToken } from '../apps/api/src/auth/guest';
import { applyR1bMigration, createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
const configJson = JSON.stringify(CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config);
const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const matchAuthorization = new Map<string, string>();

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
  matchAuthorization.clear();
});

function database(current = true): TestD1 {
  const result = createTestD1(current);
  databases.push(result);
  return result;
}

const allowRateLimiter: RateLimit = {
  limit: async () => ({ success: true }),
};

function env(db: TestD1, rateLimiter: RateLimit = allowRateLimiter) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: rateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
  };
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function guestIdentity(label: string): { authorization: string; playerId: string } {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 }));
  const signedValue = `v1.${payload}`;
  const signature = createHmac('sha256', sessionSecret).update(signedValue).digest('base64url');
  return { authorization: `Bearer ${signedValue}.${signature}`, playerId: `guest:${subject}` };
}

function telegramAuthorization(user: { id: number; first_name: string; last_name?: string }): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test').digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return `tma ${params.toString()}`;
}

async function start(db: TestD1, playerId = 'player-1'): Promise<StartAsyncMatchResponse> {
  const identity = guestIdentity(playerId);
  const response = await app.request('/api/async-matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: identity.authorization },
    body: JSON.stringify({ displayName: playerId, category: 'geography' }),
  }, env(db));
  expect(response.status).toBe(201);
  const result = await response.json() as StartAsyncMatchResponse;
  matchAuthorization.set(result.matchId, identity.authorization);
  return result;
}

async function complete(
  db: TestD1,
  matchId: string,
  rounds: AsyncMatchRoundInput[],
  authorization = matchAuthorization.get(matchId),
) {
  return app.request(`/api/async-matches/${matchId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ rounds }),
  }, env(db));
}

function selectedAnswer(question: Question, correct: boolean): string {
  if (question.answerType === 'open_answer') {
    return correct ? question.correctAnswers![0] : '__definitely_wrong__';
  }
  if (correct) return question.correctOptionId;
  return question.options.find((option) => option.id !== question.correctOptionId)?.id
    ?? '__definitely_wrong__';
}

function inputs(questions: Question[], count: number, correct: boolean, skillDistance?: number) {
  return questions.slice(0, count).map((question) => ({
    questionId: question.id,
    selectedAnswer: selectedAnswer(question, correct),
    responseTimeMs: 1000,
    ...(skillDistance === undefined ? {} : { skillDistance }),
  }));
}

function opponent(questions: Question[], awards: number[]): Opponent {
  return {
    id: 'snapshot',
    displayName: 'Snapshot',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: questions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 1000,
      skillScore: progressAwarded / 25,
      progressAwarded,
    })),
  };
}

function insertRun(db: TestD1, options: {
  id: string;
  playerId?: string;
  questions: Question[];
  snapshot?: Opponent | null;
  rounds?: AsyncMatchRound[] | null;
  status?: 'in_progress' | 'completed';
  eligible?: number;
  rulesVersion?: string | null;
  miniGameId?: string | null;
  config?: string | null;
  completedAt?: number | null;
  opponentRunId?: string | null;
}) {
  const identity = guestIdentity(options.playerId ?? options.id);
  matchAuthorization.set(options.id, identity.authorization);
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, opponent_run_id, created_at, completed_at, rules_version,
      mini_game_id, mini_game_config_json, opponent_json, ghost_eligible
    ) VALUES (?, ?, ?, 'geography', ?, ?, 0, 0, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  `).run(
    options.id,
    identity.playerId,
    options.playerId ?? options.id,
    JSON.stringify(options.questions),
    options.rounds ? JSON.stringify(options.rounds) : null,
    options.status ?? 'in_progress',
    options.opponentRunId ?? null,
    options.completedAt ?? null,
    options.rulesVersion === undefined
      ? CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion
      : options.rulesVersion,
    options.miniGameId === undefined
      ? CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id
      : options.miniGameId,
    options.config === undefined ? configJson : options.config,
    options.snapshot === undefined ? null : JSON.stringify(options.snapshot),
    options.eligible ?? 0,
  );
}

function storedRounds(questions: Question[], awards: number[]): AsyncMatchRound[] {
  let progress = 0;
  return awards.map((progressAwarded, index) => {
    progress = Math.min(100, progress + progressAwarded);
    return {
      questionId: questions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 1000,
      progressAwarded,
      playerProgressAfter: progress,
    };
  });
}

describe('R1b migration', () => {
  it('preserves legacy rows with null conditions and makes them ineligible', () => {
    const db = database(false);
    db.sqlite.prepare(`
      INSERT INTO match_runs (id, player_id, display_name, category, questions_json, created_at)
      VALUES ('legacy', 'legacy', 'Legacy', 'geography', '[]', 1)
    `).run();
    applyR1bMigration(db.sqlite);

    const row = db.sqlite.prepare(`
      SELECT rules_version, mini_game_id, mini_game_config_json, opponent_json, ghost_eligible
      FROM match_runs WHERE id = 'legacy'
    `).get() as Record<string, unknown>;
    expect(row).toEqual({
      rules_version: null,
      mini_game_id: null,
      mini_game_config_json: null,
      opponent_json: null,
      ghost_eligible: 0,
    });
  });
});

describe('R2a authenticated match ownership', () => {
  it('renews a valid guest session without changing its identity', async () => {
    const db = database();
    const oldNow = Date.now() - 24 * 60 * 60 * 1000;
    const old = await issueGuestSession(
      sessionSecret,
      oldNow,
      '123e4567-e89b-42d3-a456-426614174000',
    );
    const response = await app.request('/api/auth/guest', {
      method: 'POST',
      headers: { authorization: `Bearer ${old!.token}` },
    }, env(db));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const renewed = await response.json() as { token: string; expiresAt: number };
    expect(renewed.expiresAt).toBeGreaterThan(old!.expiresAt);
    await expect(verifyGuestToken(renewed.token, sessionSecret)).resolves.toMatchObject({
      playerId: old!.playerId,
    });
  });

  it('issues different identities for independent fresh guest sessions', async () => {
    const db = database();
    const first = await app.request('/api/auth/guest', { method: 'POST' }, env(db));
    const second = await app.request('/api/auth/guest', { method: 'POST' }, env(db));
    const firstSession = await first.json() as { token: string };
    const secondSession = await second.json() as { token: string };
    const firstIdentity = await verifyGuestToken(firstSession.token, sessionSecret);
    const secondIdentity = await verifyGuestToken(secondSession.token, sessionSecret);
    expect(firstIdentity?.playerId).not.toBe(secondIdentity?.playerId);
  });

  it('rejects invalid bearer and Telegram auth on guest renewal', async () => {
    const db = database();
    for (const authorization of ['Bearer invalid', telegramAuthorization({ id: 42, first_name: 'Alem' })]) {
      const response = await app.request('/api/auth/guest', {
        method: 'POST', headers: { authorization },
      }, env(db));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('issues a guest session and persists its derived identity', async () => {
    const db = database();
    const sessionResponse = await app.request('/api/auth/guest', { method: 'POST' }, env(db));
    expect(sessionResponse.status).toBe(201);
    expect(sessionResponse.headers.get('cache-control')).toBe('no-store');
    const session = await sessionResponse.json() as { token: string; expiresAt: number };
    expect(session.token).toMatch(/^v1\./u);
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const createdResponse = await app.request('/api/async-matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ displayName: 'Browser player', category: 'geography' }),
    }, env(db));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as StartAsyncMatchResponse;
    const row = db.sqlite.prepare('SELECT player_id, display_name FROM match_runs WHERE id = ?')
      .get(created.matchId) as { player_id: string; display_name: string };
    expect(row.player_id).toMatch(/^guest:[0-9a-f-]{36}$/u);
    expect(row.display_name).toBe('Browser player');
  });

  it('fails guest issuance closed when the signing secret is missing or short', async () => {
    const db = database();
    const base = env(db);
    for (const secret of ['', 'too-short']) {
      const response = await app.request('/api/auth/guest', { method: 'POST' }, {
        ...base,
        SESSION_SIGNING_SECRET: secret,
      });
      expect(response.status).toBe(503);
    }
  });

  it('rejects missing and forged auth before starting and rejects body identity', async () => {
    const db = database();
    const body = JSON.stringify({ displayName: 'Mallory', category: 'geography' });
    const missing = await app.request('/api/async-matches', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }, env(db));
    const forged = await app.request('/api/async-matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer forged' },
      body,
    }, env(db));
    expect(missing.status).toBe(401);
    expect(forged.status).toBe(401);

    const identity = guestIdentity('mallory');
    const suppliedPlayerId = await app.request('/api/async-matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: identity.authorization },
      body: JSON.stringify({
        playerId: 'telegram:42', displayName: 'Mallory', category: 'geography',
      }),
    }, env(db));
    expect(suppliedPlayerId.status).toBe(400);
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM match_runs').get() as { count: number }).count)
      .toBe(0);
  });

  it('derives Telegram id and display name from verified initData', async () => {
    const db = database();
    const response = await app.request('/api/async-matches', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: telegramAuthorization({ id: 42, first_name: 'Alem', last_name: 'Test' }),
      },
      body: JSON.stringify({ displayName: 'Forged name', category: 'geography' }),
    }, env(db));
    expect(response.status).toBe(201);
    const created = await response.json() as StartAsyncMatchResponse;
    expect(db.sqlite.prepare('SELECT player_id, display_name FROM match_runs WHERE id = ?')
      .get(created.matchId)).toEqual({ player_id: 'telegram:42', display_name: 'Alem Test' });
  });

  it('hides existing matches from other identities, including completed matches', async () => {
    const db = database();
    const created = await start(db, 'owner');
    const foreign = guestIdentity('foreign').authorization;
    const missingIdentity = await complete(db, created.matchId, inputs(created.questions, 4, true, 0), '');
    expect(missingIdentity.status).toBe(401);

    const absent = await complete(db, 'does-not-exist', inputs(created.questions, 4, true, 0), foreign);
    const existing = await complete(db, created.matchId, inputs(created.questions, 4, true, 0), foreign);
    expect(absent.status).toBe(404);
    expect(existing.status).toBe(404);
    expect(await existing.json()).toEqual(await absent.json());

    expect((await complete(db, created.matchId, inputs(created.questions, 4, true, 0))).status).toBe(200);
    expect((await complete(db, created.matchId, inputs(created.questions, 1, false), foreign)).status)
      .toBe(404);
    expect((await complete(db, created.matchId, inputs(created.questions, 1, false))).status).toBe(200);
  });
});

describe('async match routes with persisted rules', () => {
  it('stores a trimmed bot snapshot and returns current conditions', async () => {
    const db = database();
    const created = await start(db);
    expect(created.conditions).toEqual(CURRENT_ASYNC_MATCH_CONDITIONS);
    expect(created.opponentSource).toBe('bot');
    expect(created.opponent.rounds).toHaveLength(8);
    expect(created.opponent.rounds.at(-1)?.questionId).toBe(created.questions[7].id);

    const row = db.sqlite.prepare(`
      SELECT rules_version, mini_game_id, mini_game_config_json, opponent_json
      FROM match_runs WHERE id = ?
    `).get(created.matchId) as Record<string, unknown>;
    expect(row.rules_version).toBe(CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion);
    expect(row.mini_game_config_json).toBe(configJson);
    expect(JSON.parse(row.opponent_json as string)).toEqual(created.opponent);
  });

  it('makes an own early win eligible and reuses its exact quiz as a ghost', async () => {
    const db = database();
    const first = await start(db, 'winner');
    const response = await complete(db, first.matchId, inputs(first.questions, 4, true, 0));
    expect(response.status).toBe(200);
    expect((db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id = ?')
      .get(first.matchId) as { ghost_eligible: number }).ghost_eligible).toBe(1);

    const second = await start(db, 'challenger');
    expect(second.opponentSource).toBe('player');
    expect(second.questions).toEqual(first.questions);
    expect(second.conditions).toEqual(first.conditions);
    expect(second.opponent.id).toBe(first.matchId);
  });

  it('saves an early loss but excludes it from the opponent pool', async () => {
    const db = database();
    const first = await start(db, 'loser');
    const response = await complete(db, first.matchId, inputs(first.questions, 8, false));
    expect(response.status).toBe(200);
    const row = db.sqlite.prepare('SELECT status, ghost_eligible FROM match_runs WHERE id = ?')
      .get(first.matchId) as { status: string; ghost_eligible: number };
    expect(row).toEqual({ status: 'completed', ghost_eligible: 0 });
    expect((await start(db, 'next')).opponentSource).toBe('bot');
  });

  it('rejects a nonterminal prefix without writing completion fields', async () => {
    const db = database();
    const created = await start(db);
    const response = await complete(db, created.matchId, inputs(created.questions, 1, false));
    expect(response.status).toBe(400);
    const row = db.sqlite.prepare('SELECT status, rounds_json, completed_at FROM match_runs WHERE id = ?')
      .get(created.matchId) as Record<string, unknown>;
    expect(row).toEqual({ status: 'in_progress', rounds_json: null, completed_at: null });
  });

  it('rejects wrong order and rounds after the terminal round', async () => {
    const db = database();
    const first = await start(db, 'wrong-order');
    const wrongOrder = inputs(first.questions, 4, true, 0);
    wrongOrder[1].questionId = first.questions[2].id;
    expect((await complete(db, first.matchId, wrongOrder)).status).toBe(400);

    const second = await start(db, 'extra');
    expect((await complete(db, second.matchId, inputs(second.questions, 5, true, 0))).status).toBe(400);
  });

  it('accepts a full below-100 loss and marks it eligible', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, { id: 'full', questions, snapshot: opponent(questions, Array(10).fill(5)) });
    const response = await complete(db, 'full', inputs(questions, 10, false));
    expect(response.status).toBe(200);
    const row = db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id = ?')
      .get('full') as { ghost_eligible: number };
    expect(row.ghost_eligible).toBe(1);
  });

  it('re-scores distances sequentially and does not advance pressure on wrong answers or misses', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, { id: 'pressure', questions, snapshot: opponent(questions, Array(10).fill(0)) });
    const rounds = inputs(questions, 10, false);
    rounds[0] = { ...rounds[0], selectedAnswer: selectedAnswer(questions[0], true), skillDistance: 0.14 };
    rounds[1] = { ...rounds[1], selectedAnswer: selectedAnswer(questions[1], true), skillDistance: 0.14 };
    rounds[2] = { ...rounds[2], skillDistance: 0 };
    rounds[3] = { ...rounds[3], selectedAnswer: selectedAnswer(questions[3], true), skillDistance: 0.9 };
    rounds[4] = { ...rounds[4], selectedAnswer: selectedAnswer(questions[4], true), skillDistance: 0.14 };

    const response = await complete(db, 'pressure', rounds);
    expect(response.status).toBe(200);
    const body = await response.json() as { rounds: AsyncMatchRound[]; playerProgress: number };
    expect(body.rounds.slice(0, 5).map((round) => round.skillResult)).toEqual([
      'perfect', 'great', undefined, 'miss', 'great',
    ]);
    expect(body.rounds.slice(0, 5).map((round) => round.progressAwarded)).toEqual([25, 18, 0, 0, 18]);
    expect(body.playerProgress).toBe(61);
  });

  it('accepts simultaneous 100 and keeps the run eligible', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, { id: 'tie', questions, snapshot: opponent(questions, [25, 25, 25, 25]) });
    const response = await complete(db, 'tie', inputs(questions, 4, true, 0));
    expect(response.status).toBe(200);
    const body = await response.json() as { playerProgress: number };
    expect(body.playerProgress).toBe(100);
    const row = db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id = ?')
      .get('tie') as { ghost_eligible: number };
    expect(row.ghost_eligible).toBe(1);
  });

  it.each([
    ['legacy', null, null, null],
    ['v1', 'race-to-100-v1', CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id, configJson],
    ['unknown-version', 'race-to-100-v3', CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id, configJson],
    ['unknown-config', CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
      CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id, '{"markerSpeed":1}'],
  ])('returns 409 for unfinished %s conditions', async (id, rulesVersion, miniGameId, config) => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, {
      id,
      questions,
      snapshot: opponent(questions, Array(10).fill(0)),
      rulesVersion,
      miniGameId,
      config,
    });
    expect((await complete(db, id, inputs(questions, 10, false))).status).toBe(409);
  });

  it('returns stored results for an already-completed legacy run', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    const rounds = storedRounds(questions, [25, 25, 25, 25]);
    insertRun(db, {
      id: 'legacy-completed', questions, rounds, status: 'completed', eligible: 0,
      rulesVersion: null, miniGameId: null, config: null,
    });
    const response = await complete(db, 'legacy-completed', inputs(questions, 1, false));
    expect(response.status).toBe(200);
    expect((await response.json() as { rounds: AsyncMatchRound[] }).rounds).toEqual(rounds);
  });

  it('filters incompatible ghosts on unused and repeat selection paths', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    const rounds = storedRounds(questions, Array(10).fill(5));
    insertRun(db, { id: 'compatible', playerId: 'ghost', questions, rounds, status: 'completed', eligible: 1, completedAt: 1 });
    insertRun(db, {
      id: 'incompatible', playerId: 'newer-ghost', questions, rounds, status: 'completed',
      eligible: 1, completedAt: 2, rulesVersion: 'race-to-100-v1',
    });
    insertRun(db, {
      id: 'wrong-game', playerId: 'wrong-game-player', questions, rounds, status: 'completed',
      eligible: 1, completedAt: 3, miniGameId: 'future_game',
    });
    insertRun(db, {
      id: 'wrong-config', playerId: 'wrong-config-player', questions, rounds, status: 'completed',
      eligible: 1, completedAt: 4, config: '{"markerSpeed":1}',
    });
    const unused = await start(db, 'chooser');
    expect(unused.opponent.id).toBe('compatible');
    const repeat = await start(db, 'chooser');
    expect(repeat.opponent.id).toBe('compatible');
  });

  it('uses the stored snapshot even after the source ghost is edited', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    const rounds = storedRounds(questions, [25, 25, 25, 25]);
    insertRun(db, { id: 'source', playerId: 'source-player', questions, rounds, status: 'completed', eligible: 1, completedAt: 1 });
    const created = await start(db, 'challenger');
    db.sqlite.prepare("UPDATE match_runs SET rounds_json = 'not json' WHERE id = 'source'").run();
    expect((await complete(db, created.matchId, inputs(created.questions, 4, false))).status).toBe(200);
  });

  it('skips malformed and short flagged ghosts', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, {
      id: 'short', playerId: 'short-player', questions,
      rounds: storedRounds(questions, [25]), status: 'completed', eligible: 1, completedAt: 2,
    });
    const malformedQuestions = questions.map((question, index) => (
      index === 0 ? { ...question, options: [null] } : question
    )) as unknown as Question[];
    insertRun(db, {
      id: 'malformed', playerId: 'malformed-player', questions: malformedQuestions,
      rounds: storedRounds(malformedQuestions, [25, 25, 25, 25]),
      status: 'completed', eligible: 1, completedAt: 3,
    });
    insertRun(db, {
      id: 'bad-round', playerId: 'bad-round-player', questions,
      rounds: [{
        questionId: questions[0].id,
        correct: true,
        responseTimeMs: 1000,
        progressAwarded: 100,
        playerProgressAfter: 99,
      }],
      status: 'completed', eligible: 1, completedAt: 4,
    });
    expect((await start(db, 'chooser')).opponentSource).toBe('bot');
  });

  it('returns the first stored response on repeated completion', async () => {
    const db = database();
    const created = await start(db);
    const rounds = inputs(created.questions, 4, true, 0);
    const first = await complete(db, created.matchId, rounds);
    const second = await complete(db, created.matchId, inputs(created.questions, 1, false));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('returns one canonical result for concurrent completion requests', async () => {
    const db = database();
    const created = await start(db);
    const [winningResponse, losingResponse] = await Promise.all([
      complete(db, created.matchId, inputs(created.questions, 4, true, 0)),
      complete(db, created.matchId, inputs(created.questions, 8, false)),
    ]);

    expect(winningResponse.status).toBe(200);
    expect(losingResponse.status).toBe(200);
    expect(await losingResponse.json()).toEqual(await winningResponse.json());
  });
});
