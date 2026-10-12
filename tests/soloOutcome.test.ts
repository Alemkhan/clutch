/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  CURRENT_SOLO_RUN_CONDITIONS,
  dailyQuestionSet,
  setPar,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CompleteSoloRunResponse,
  type MyRunsResponse,
  type Question,
  type SoloLeaderboardResponse,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { soloResultText } from '../apps/api/src/notifications/outbid';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const SET = dailyQuestionSet('geography', NOW, 0);
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

function telegram(user: { id: number; first_name: string }): string {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test').digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return `tma ${params.toString()}`;
}

function guest(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(NOW / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`;
}

/** Завершённый соло-забег другого игрока на наборе дня 0: круги по 25. */
function insertSolo(db: TestD1, options: {
  id: string;
  playerId: string;
  name?: string;
  soloScore: number;
  reachedTarget?: number;
  completedAt?: number;
  /** Длительность забега, мс: created_at = completed_at - durationMs. */
  durationMs?: number;
  category?: string;
  rounds?: number;
}) {
  const roundsCount = options.rounds ?? 4;
  let progress = 0;
  const rounds: AsyncMatchRound[] = Array.from({ length: roundsCount }, (_, index) => {
    progress = Math.min(100, progress + 25);
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    options.id,
    options.playerId,
    options.name ?? options.id,
    options.category ?? 'geography',
    JSON.stringify(SET.questions),
    JSON.stringify(rounds),
    progress,
    roundsCount,
    (options.completedAt ?? NOW - 1000) - (options.durationMs ?? 1000),
    options.completedAt ?? NOW - 1000,
    SOLO,
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    configJson,
    SET.questionSetId,
    options.reachedTarget ?? 1,
    setPar(SET.questions),
    options.soloScore,
  );
}

async function start(db: TestD1, authorization: string): Promise<StartSoloRunResponse> {
  const response = await call(db, '/api/solo-runs', authorization, { displayName: 'Игрок', category: 'geography' });
  expect(response.status).toBe(201);
  return await response.json() as StartSoloRunResponse;
}

async function finish(db: TestD1, authorization: string, run: StartSoloRunResponse, count: number, correct: boolean) {
  const response = await playRounds(
    (path, body) => call(db, path, authorization, body),
    run.runId,
    roundInputs(fullQuestions(db, run.runId), count, correct),
  );
  await Promise.all(pending);
  return response;
}

function storedOutcome(db: TestD1, runId: string): unknown {
  return (db.sqlite.prepare('SELECT solo_outcome FROM match_runs WHERE id = ?').get(runId) as { solo_outcome: unknown })
    .solo_outcome;
}

function inviteRows(db: TestD1) {
  return db.sqlite.prepare('SELECT * FROM rematch_invites').all() as Array<Record<string, unknown>>;
}

const sentPayload = () => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);

describe('solo outcome against a pace', () => {
  const bob = guest('bob');

  it('the challenger wins on a lower score: saved, returned, and the record owner is told', async () => {
    const db = database();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 99 });
    const run = await start(db, bob);
    const result = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    expect(result.outcome).toBe('player');
    expect(storedOutcome(db, run.runId)).toBe('player');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = sentPayload();
    expect(payload.chat_id).toBe('42');
    expect(payload.text).toBe('Игрок обошёл вашу запись. Можно сыграть реванш: вопросы будут новые.');
    expect(inviteRows(db)).toHaveLength(1);
    expect(inviteRows(db)[0]).toMatchObject({
      recipient_run_id: 'alem-run', challenger_run_id: run.runId, notify_status: 'sent',
    });
    expect(payload.reply_markup.inline_keyboard[0][0].url)
      .toBe(`https://t.me/testbot?startapp=${inviteRows(db)[0].id}`);
  });

  it('the record wins on a better score: the owner is told that the record held', async () => {
    const db = database();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 0.01 });
    const run = await start(db, bob);
    const result = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    expect(result.outcome).toBe('opponent');
    expect(storedOutcome(db, run.runId)).toBe('opponent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentPayload().text).toBe('Ваша запись устояла: Игрок не смог её обойти.');
    // Победившей записи реванш не создаётся: раньше владелец видел у себя вызов, которого
    // соперник не отправлял.
    expect(inviteRows(db)).toHaveLength(0);
  });

  it('equal score and rounds go to the shorter run, not to whoever played first', async () => {
    const outcomeFor = async (paceDurationMs: number, challengerDurationMs: number) => {
      const db = database();
      insertSolo(db, {
        id: 'alem-run', playerId: 'telegram:42', name: 'Алем',
        soloScore: 4 / setPar(SET.questions), durationMs: paceDurationMs,
      });
      vi.setSystemTime(NOW);
      const run = await start(db, bob);
      expect(run.pace?.id).toBe('alem-run');
      vi.setSystemTime(NOW + challengerDurationMs);
      const result = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
      expect(result.score).toBe(4 / setPar(SET.questions));
      return result.outcome;
    };
    expect(await outcomeFor(9000, 5000)).toBe('player');
    expect(await outcomeFor(1000, 5000)).toBe('opponent');
    expect(await outcomeFor(5000, 5000)).toBe('tie');
  });

  it('a challenger who did not reach the target loses to a pace that did', async () => {
    const db = database();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 3 });
    const run = await start(db, bob);
    const result = await (await finish(db, bob, run, run.questions.length, false)).json() as CompleteSoloRunResponse;
    expect(result.reachedTarget).toBe(false);
    expect(result.outcome).toBe('opponent');
    expect(sentPayload().text).toContain('Ваша запись устояла');
  });

  it('no pace: the outcome stays null, nobody is messaged, and it is not a tie', async () => {
    const db = database();
    const run = await start(db, bob);
    expect(run.pace).toBeNull();
    const result = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    expect(result.outcome).toBeNull();
    expect(storedOutcome(db, run.runId)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inviteRows(db)).toHaveLength(0);

    const runs = await (await call(db, '/api/my-runs', bob)).json() as MyRunsResponse;
    expect(runs.runs[0]).toMatchObject({ mode: 'solo', outcome: null, opponent: null });
  });

  it('shows the outcome in my runs and repeats it on a retried completion without a second message', async () => {
    const db = database();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 99 });
    const run = await start(db, bob);
    const first = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    const again = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    expect(again).toEqual(first);
    expect(again.outcome).toBe('player');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inviteRows(db)).toHaveLength(1);

    const runs = await (await call(db, '/api/my-runs', bob)).json() as MyRunsResponse;
    expect(runs.runs[0]).toMatchObject({ mode: 'solo', outcome: 'player', opponent: { kind: 'player' } });
  });

  it('respects the unsubscribe: the outcome is saved, no message and no invite', async () => {
    const db = database();
    db.sqlite.prepare(
      "INSERT INTO player_notification_prefs (player_id, outbid_enabled, updated_at) VALUES ('telegram:42', 0, 1)",
    ).run();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 0.01 });
    const run = await start(db, bob);
    const result = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    expect(result.outcome).toBe('opponent');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inviteRows(db)).toHaveLength(0);
  });

  it('does not message a guest owner but still saves the outcome', async () => {
    const db = database();
    insertSolo(db, { id: 'guest-run', playerId: 'guest:11111111-1111-4111-8111-111111111111', soloScore: 99 });
    const run = await start(db, bob);
    const result = await (await finish(db, bob, run, 4, true)).json() as CompleteSoloRunResponse;
    expect(result.outcome).toBe('player');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the response intact when Telegram fails', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('network down'); });
    const db = database();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 99 });
    const run = await start(db, bob);
    const response = await finish(db, bob, run, 4, true);
    expect(response.status).toBe(200);
    expect(inviteRows(db)[0].notify_status).toBe('failed');
  });

  it('has a separate text for a tie', () => {
    expect(soloResultText('Игрок', 'tie'))
      .toBe('Ничья с Игрок: результаты сравнялись.');
  });
});

describe('solo leaderboard', () => {
  const viewer = guest('viewer');
  const board = (db: TestD1, query = '') => call(db, `/api/solo-leaderboard${query}`, viewer);

  it('sorts by score, drops runs that missed the target, other days and other categories', async () => {
    const db = database();
    insertSolo(db, { id: 'a', playerId: 'p:a', soloScore: 1.5 });
    insertSolo(db, { id: 'b', playerId: 'p:b', soloScore: 0.8 });
    insertSolo(db, { id: 'c', playerId: 'p:c', soloScore: 0.1, reachedTarget: 0 });
    insertSolo(db, { id: 'd', playerId: 'p:d', soloScore: 0.2, completedAt: NOW - 36 * 60 * 60 * 1000 });
    insertSolo(db, { id: 'e', playerId: 'p:e', soloScore: 0.3, category: 'history' });
    insertSolo(db, { id: 'f', playerId: 'p:f', soloScore: 1.1, rounds: 5 });
    // Второй, худший забег игрока a таблицу не дублирует.
    insertSolo(db, { id: 'a2', playerId: 'p:a', soloScore: 2, name: 'a-worse' });

    const response = await board(db, '?category=geography');
    expect(response.status).toBe(200);
    const body = await response.json() as SoloLeaderboardResponse;
    expect(body).toMatchObject({ category: 'geography', dateKey: '2026-10-11' });
    expect(body.entries.map((entry) => entry.displayName)).toEqual(['b', 'f', 'a']);
    expect(body.entries.map((entry) => entry.soloScore)).toEqual([0.8, 1.1, 1.5]);
    expect(body.entries[1]).toMatchObject({ roundsPlayed: 5, setPar: setPar(SET.questions) });
  });

  it('defaults to the general category', async () => {
    const db = database();
    insertSolo(db, { id: 'g', playerId: 'p:g', soloScore: 1, category: 'general' });
    insertSolo(db, { id: 'geo', playerId: 'p:geo', soloScore: 1 });
    const body = await (await board(db)).json() as SoloLeaderboardResponse;
    expect(body.category).toBe('general');
    expect(body.entries.map((entry) => entry.displayName)).toEqual(['g']);
  });

  it('breaks equal scores by fewer rounds, then shorter run duration', async () => {
    const db = database();
    insertSolo(db, { id: 'slow', playerId: 'p:1', soloScore: 1, completedAt: NOW - 500, durationMs: 9000 });
    insertSolo(db, { id: 'fast', playerId: 'p:2', soloScore: 1, completedAt: NOW - 10, durationMs: 2000 });
    insertSolo(db, { id: 'long', playerId: 'p:4', soloScore: 1, completedAt: NOW - 900, durationMs: 100, rounds: 6 });
    const body = await (await board(db, '?category=geography')).json() as SoloLeaderboardResponse;
    expect(body.entries.map((entry) => entry.displayName)).toEqual(['fast', 'slow', 'long']);
  });

  it('selects another UTC day and category, and validates input and auth', async () => {
    const db = database();
    insertSolo(db, { id: 'old', playerId: 'p:o', soloScore: 1, completedAt: NOW - 36 * 60 * 60 * 1000 });
    insertSolo(db, { id: 'hist', playerId: 'p:h', soloScore: 1, category: 'history' });
    const previous = await (await board(db, '?category=geography&date=2026-10-10')).json() as SoloLeaderboardResponse;
    expect(previous.entries.map((entry) => entry.displayName)).toEqual(['old']);
    const history = await (await board(db, '?category=history')).json() as SoloLeaderboardResponse;
    expect(history.entries.map((entry) => entry.displayName)).toEqual(['hist']);

    expect((await board(db, '?category=physics')).status).toBe(400);
    expect((await board(db, '?date=2026-13-40')).status).toBe(400);
    expect((await board(db, '?date=yesterday')).status).toBe(400);
    expect((await call(db, '/api/solo-leaderboard', '')).status).toBe(401);
  });

  it('does not leak solo runs into the race leaderboard', async () => {
    const db = database();
    insertSolo(db, { id: 'a', playerId: 'p:a', soloScore: 1 });
    const race = await call(db, '/api/leaderboard?category=geography', viewer);
    expect((await race.json() as { entries: unknown[] }).entries).toEqual([]);
  });
});

describe('solo rematch invite', () => {
  const bob = guest('bob');
  const alemAuth = () => telegram({ id: 42, first_name: 'Алем' });
  const startWith = (db: TestD1, authorization: string, rematchInviteId: string) =>
    call(db, '/api/solo-runs', authorization, { displayName: 'Алем', category: 'geography', rematchInviteId });

  /** Боб обыгрывает запись Алема в соло; Алем получает приглашение. */
  async function invited() {
    const db = database();
    insertSolo(db, { id: 'alem-run', playerId: 'telegram:42', name: 'Алем', soloScore: 99 });
    const run = await start(db, bob);
    await finish(db, bob, run, 4, true);
    const rows = inviteRows(db);
    expect(rows).toHaveLength(1);
    return { db, inviteId: String(rows[0].id) };
  }

  it('opens in solo mode on a new set, once, and only for the addressee', async () => {
    const { db, inviteId } = await invited();

    const stolen = await startWith(db, guest('mallory'), inviteId);
    expect(stolen.status).toBe(404);
    expect(inviteRows(db)[0].consumed_at).toBeNull();

    const response = await startWith(db, alemAuth(), inviteId);
    expect(response.status).toBe(201);
    const started = await response.json() as StartSoloRunResponse;
    expect(started.rulesVersion).toBe(SOLO);
    // Единое правило: набор, который получатель уже играл, не выдаётся и по приглашению.
    const row = db.sqlite.prepare('SELECT question_set_id, rules_version FROM match_runs WHERE id = ?')
      .get(started.runId) as { question_set_id: string; rules_version: string };
    expect(row.question_set_id).not.toBe(SET.questionSetId);
    expect(row.rules_version).toBe(SOLO);
    expect(started.questions.map((question) => question.id))
      .not.toEqual(SET.questions.map((question) => question.id));
    expect(inviteRows(db)[0].rematch_run_id).toBe(started.runId);

    expect((await startWith(db, alemAuth(), inviteId)).status).toBe(410);
  });

  it('rejects an expired invite', async () => {
    const { db, inviteId } = await invited();
    db.sqlite.prepare('UPDATE rematch_invites SET expires_at = 1 WHERE id = ?').run(inviteId);
    expect((await startWith(db, alemAuth(), inviteId)).status).toBe(410);
    expect(inviteRows(db)[0].consumed_at).toBeNull();
  });

  it('rejects malformed and unknown invites', async () => {
    const { db } = await invited();
    expect((await startWith(db, alemAuth(), 'rm_short')).status).toBe(400);
    expect((await startWith(db, alemAuth(), 'rm_AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  });

  it('releases the invite when the run cannot be created', async () => {
    const { db, inviteId } = await invited();
    db.sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON match_runs BEGIN SELECT RAISE(ABORT, 'boom'); END");
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await startWith(db, alemAuth(), inviteId)).status).toBe(500);
    expect(inviteRows(db)[0].consumed_at).toBeNull();
  });

  it('rejects an invite of the retired race mode with a clear error and does not spend it', async () => {
    const { db, inviteId } = await invited();
    // Тот же игрок, но приглашение из гонки: вызов брошен гоночным забегом.
    insertSolo(db, { id: 'race-challenger', playerId: 'p:race', soloScore: 1 });
    db.sqlite.prepare('UPDATE match_runs SET rules_version = ? WHERE id = ?')
      .run(CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion, 'race-challenger');
    const raceInviteId = 'rm_RRRRRRRRRRRRRRRRRRRRRR';
    db.sqlite.prepare(`
      INSERT INTO rematch_invites (
        id, recipient_player_id, recipient_run_id, challenger_run_id, category,
        recipient_progress, challenger_progress, created_at, expires_at
      ) VALUES (?, 'telegram:42', 'alem-run', 'race-challenger', 'geography', 50, 100, ?, ?)
    `).run(raceInviteId, NOW, NOW + 100_000);

    const soloWithRace = await startWith(db, alemAuth(), raceInviteId);
    expect(soloWithRace.status).toBe(409);
    expect(await soloWithRace.json()).toEqual({ error: 'This rematch invite is for race mode.' });

    const consumed = db.sqlite.prepare('SELECT COUNT(*) AS count FROM rematch_invites WHERE consumed_at IS NOT NULL')
      .get() as { count: number };
    expect(consumed.count).toBe(0);

    expect((await call(db, `/api/rematch/${inviteId}`, alemAuth())).status).toBe(200);
    // Режима гонки нет: приглашение на неё в превью выглядит как истёкшее.
    const racePreview = await call(db, `/api/rematch/${raceInviteId}`, alemAuth());
    expect(racePreview.status).toBe(410);
  });
});
