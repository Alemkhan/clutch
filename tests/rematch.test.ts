/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  dailyQuestionSet,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type Question,
  type StartAsyncMatchResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { notifyOutbid } from '../apps/api/src/notifications/outbid';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config);
const databases: TestD1[] = [];
let pending: Promise<unknown>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

beforeEach(() => {
  pending = [];
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function env(db: TestD1) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  };
}

const executionCtx = {
  waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  passThroughOnException() {},
} as unknown as ExecutionContext;

async function settle(): Promise<void> {
  await Promise.all(pending);
}

function request(db: TestD1, path: string, authorization: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization },
  }, env(db), executionCtx);
}

function guestAuthorization(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`;
}

function telegramAuthorization(user: { id: number; first_name: string }): string {
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

const alem = telegramAuthorization({ id: 42, first_name: 'Алем' });
const SET = dailyQuestionSet('geography', Date.now(), 0);

function rounds(questions: Question[], awards: number[]): AsyncMatchRound[] {
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

/** A finished, pool-eligible run of `playerId` on the day's set 0. */
function insertCompleted(db: TestD1, id: string, playerId: string, name: string, awards = [25, 25, 0, 0]) {
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id
    ) VALUES (?, ?, ?, 'geography', ?, ?, ?, 2, 'completed', 1, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    playerId,
    name,
    JSON.stringify(SET.questions),
    JSON.stringify(rounds(SET.questions, awards)),
    awards.reduce((sum, award) => Math.min(100, sum + award), 0),
    Date.now() - 1000,
    CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    configJson,
    SET.questionSetId,
  );
}

async function startMatch(db: TestD1, authorization: string, extra: Record<string, unknown> = {}) {
  const response = await request(db, '/api/async-matches', authorization, {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Игрок', category: 'geography', ...extra }),
  });
  return response;
}

function inputs(questions: Question[], count: number, correct: boolean): AsyncMatchRoundInput[] {
  return questions.slice(0, count).map((question) => ({
    questionId: question.id,
    selectedAnswer: question.answerType === 'open_answer'
      ? (correct ? question.correctAnswers![0] : '__wrong__')
      : (correct
        ? question.correctOptionId
        : question.options.find((option) => option.id !== question.correctOptionId)!.id),
    responseTimeMs: 1000,
    ...(correct ? { skillDistance: 0 } : {}),
  }));
}

async function finish(db: TestD1, authorization: string, match: StartAsyncMatchResponse, win: boolean) {
  const response = await request(db, `/api/async-matches/${match.matchId}/complete`, authorization, {
    method: 'POST',
    body: JSON.stringify({ rounds: inputs(match.questions, win ? 4 : match.questions.length, win) }),
  });
  await settle();
  return response;
}

/** Alem (telegram:42) has a recorded run; Bob (guest) faces it. Returns Bob's started match. */
async function bobFacesAlem(db: TestD1, bob = guestAuthorization('bob')) {
  insertCompleted(db, 'alem-run', 'telegram:42', 'Алем');
  const response = await startMatch(db, bob);
  expect(response.status).toBe(201);
  const match = await response.json() as StartAsyncMatchResponse;
  expect(match.opponentSource).toBe('player');
  expect(match.opponent.id).toBe('alem-run');
  return match;
}

function inviteRows(db: TestD1) {
  return db.sqlite.prepare('SELECT * FROM rematch_invites').all() as Array<Record<string, unknown>>;
}

describe('outbid notification', () => {
  it('messages a Telegram owner when their record is beaten, without blocking the response', async () => {
    const db = database();
    const match = await bobFacesAlem(db);
    const bob = guestAuthorization('bob');
    const response = await request(db, `/api/async-matches/${match.matchId}/complete`, bob, {
      method: 'POST',
      body: JSON.stringify({ rounds: inputs(match.questions, 4, true) }),
    });
    expect(response.status).toBe(200);
    // Work was handed to waitUntil, so it has not necessarily run when the response is ready.
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest/sendMessage');
    const payload = JSON.parse(init.body as string);
    expect(payload.chat_id).toBe('42');
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.text).toBe('Игрок обошёл вашу запись: 100% против 50%. Можно сыграть реванш: вопросы будут новые.');
    const [[rematch], [stop]] = payload.reply_markup.inline_keyboard;
    const rows = inviteRows(db);
    expect(rows).toHaveLength(1);
    expect(rematch.url).toBe(`https://t.me/testbot?startapp=${rows[0].id}`);
    expect(stop.url).toBe('https://t.me/testbot?startapp=unsub');
    expect(rows[0]).toMatchObject({
      recipient_player_id: 'telegram:42',
      recipient_run_id: 'alem-run',
      challenger_run_id: match.matchId,
      notify_status: 'sent',
    });
    expect(String(rows[0].id)).toMatch(/^rm_[A-Za-z0-9_-]{22}$/u);
  });

  it('race mode: stays silent on a loss, and does not repeat for the same bypass (solo notifies both outcomes: tests/soloOutcome.test.ts)', async () => {
    const db = database();
    const lost = await bobFacesAlem(db);
    expect((await finish(db, guestAuthorization('bob'), lost, false)).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inviteRows(db)).toHaveLength(0);

    const db2 = database();
    const won = await bobFacesAlem(db2);
    await finish(db2, guestAuthorization('bob'), won, true);
    // A retried completion is canonical and must not notify again.
    await finish(db2, guestAuthorization('bob'), won, true);
    // Even a direct second attempt for the same pair is stopped by the UNIQUE constraint.
    await notifyOutbid(env(db2) as never, {
      recipientRun: { id: 'alem-run', playerId: 'telegram:42', category: 'geography' },
      challengerRunId: won.matchId,
      challengerName: 'Игрок',
      recipientProgress: 50,
      challengerProgress: 100,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inviteRows(db2)).toHaveLength(1);
  });

  it('skips guests silently', async () => {
    const db = database();
    insertCompleted(db, 'guest-run', 'guest:11111111-1111-4111-8111-111111111111', 'Гость');
    const started = await startMatch(db, guestAuthorization('bob'));
    const match = await started.json() as StartAsyncMatchResponse;
    expect(match.opponent.id).toBe('guest-run');
    expect((await finish(db, guestAuthorization('bob'), match, true)).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inviteRows(db)).toHaveLength(0);
  });

  it('respects unsubscribe and can be re-enabled', async () => {
    const db = database();
    const off = await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: false }),
    });
    expect(await off.json()).toEqual({ enabled: false });
    const match = await bobFacesAlem(db);
    await finish(db, guestAuthorization('bob'), match, true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inviteRows(db)).toHaveLength(0);

    const status = await request(db, '/api/notifications/outbid', alem);
    expect(await status.json()).toEqual({ enabled: false });
    expect((await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: 'yes' }),
    })).status).toBe(400);
    expect((await request(db, '/api/notifications/outbid', 'Bearer bad')).status).toBe(401);

    await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: true }),
    });
    // A fresh record of Alem is beaten by Carol: a new bypass, a new message.
    insertCompleted(db, 'alem-run-2', 'telegram:42', 'Алем');
    db.sqlite.prepare("UPDATE match_runs SET completed_at = ? WHERE id = 'alem-run-2'").run(Date.now());
    const carol = guestAuthorization('carol');
    const carolMatch = await (await startMatch(db, carol)).json() as StartAsyncMatchResponse;
    expect(carolMatch.opponent.id).toBe('alem-run-2');
    await finish(db, carol, carolMatch, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the challenger response intact when Telegram fails or throws', async () => {
    for (const failure of [
      async () => new Response('{"ok":false}', { status: 500 }),
      async () => { throw new Error('network down'); },
    ]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(failure);
      const db = database();
      const match = await bobFacesAlem(db);
      const response = await finish(db, guestAuthorization('bob'), match, true);
      expect(response.status).toBe(200);
      expect((await response.json() as { playerProgress: number }).playerProgress).toBe(100);
      expect(inviteRows(db)[0].notify_status).toBe('failed');
    }
  });

  it('stops messaging a user who blocked the bot', async () => {
    fetchMock.mockImplementation(async () => new Response('{"ok":false}', { status: 403 }));
    const db = database();
    const match = await bobFacesAlem(db);
    await finish(db, guestAuthorization('bob'), match, true);
    const status = await request(db, '/api/notifications/outbid', alem);
    expect(await status.json()).toEqual({ enabled: false });
  });
});

describe('rematch invite', () => {
  async function invited() {
    const db = database();
    const match = await bobFacesAlem(db);
    await finish(db, guestAuthorization('bob'), match, true);
    const inviteId = String(inviteRows(db)[0].id);
    return { db, match, inviteId };
  }

  it('shows the invite only to its addressee', async () => {
    const { db, inviteId } = await invited();
    const preview = await request(db, `/api/rematch/${inviteId}`, alem);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      inviteId, category: 'geography', challengerName: 'Игрок', challengerProgress: 100, yourProgress: 50,
    });
    expect((await request(db, `/api/rematch/${inviteId}`, guestAuthorization('mallory'))).status).toBe(404);
    expect((await request(db, `/api/rematch/${inviteId}`, telegramAuthorization({ id: 43, first_name: 'Eve' }))).status)
      .toBe(404);
    expect((await request(db, '/api/rematch/not-an-invite', alem)).status).toBe(404);
  });

  it('puts the addressee on a new set, once, and only for them', async () => {
    const { db, inviteId } = await invited();
    const playedBefore = (db.sqlite.prepare(
      "SELECT question_set_id FROM match_runs WHERE player_id = 'telegram:42'",
    ).all() as Array<{ question_set_id: string }>).map((row) => row.question_set_id);
    expect(playedBefore).toEqual([SET.questionSetId]);

    // Someone else cannot use or burn the invite.
    const stolen = await startMatch(db, guestAuthorization('mallory'), { rematchInviteId: inviteId });
    expect(stolen.status).toBe(404);
    expect(inviteRows(db)[0].consumed_at).toBeNull();

    const rematch = await startMatch(db, alem, { rematchInviteId: inviteId });
    expect(rematch.status).toBe(201);
    const started = await rematch.json() as StartAsyncMatchResponse;
    const row = db.sqlite.prepare('SELECT question_set_id, category FROM match_runs WHERE id = ?')
      .get(started.matchId) as { question_set_id: string; category: string };
    // Единое правило: набор, который получатель уже играл, не выдаётся и по приглашению.
    expect(playedBefore).not.toContain(row.question_set_id);
    expect(started.questions.map((question) => question.id))
      .not.toEqual(SET.questions.map((question) => question.id));
    expect(row.category).toBe('geography');
    expect(inviteRows(db)[0].rematch_run_id).toBe(started.matchId);

    // One use per invite.
    expect((await startMatch(db, alem, { rematchInviteId: inviteId })).status).toBe(410);
    expect((await request(db, `/api/rematch/${inviteId}`, alem)).status).toBe(410);
  });

  it('rejects malformed and expired invites', async () => {
    const { db, inviteId } = await invited();
    expect((await startMatch(db, alem, { rematchInviteId: 'rm_short' })).status).toBe(400);
    expect((await startMatch(db, alem, { rematchInviteId: 'rm_AAAAAAAAAAAAAAAAAAAAAA' })).status).toBe(404);
    db.sqlite.prepare('UPDATE rematch_invites SET expires_at = 1 WHERE id = ?').run(inviteId);
    expect((await startMatch(db, alem, { rematchInviteId: inviteId })).status).toBe(410);
  });

  it('releases the invite when the match cannot be created', async () => {
    const { db, inviteId } = await invited();
    // Вставка матча падает уже после гашения приглашения: оно должно вернуться.
    db.sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON match_runs BEGIN SELECT RAISE(ABORT, 'boom'); END");
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await startMatch(db, alem, { rematchInviteId: inviteId })).status).toBe(500);
    expect(inviteRows(db)[0].consumed_at).toBeNull();
  });
});
