/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  dailyQuestionSet,
  type AsyncMatchRound,
  type Question,
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

function inviteRows(db: TestD1) {
  return db.sqlite.prepare('SELECT * FROM rematch_invites').all() as Array<Record<string, unknown>>;
}

/** Рекорд-получатель (Алем) и забег-вызов (Боб); гонки больше нет, поэтому сообщение шлётся напрямую. */
function bobBeatsAlem(db: TestD1, seed = true) {
  if (seed) {
    insertCompleted(db, 'alem-run', 'telegram:42', 'Алем');
    insertCompleted(db, 'bob-run', 'guest:11111111-1111-4111-8111-111111111111', 'Боб', [25, 25, 25, 25]);
  }
  return notifyOutbid(env(db) as never, {
    recipientRun: { id: 'alem-run', playerId: 'telegram:42', category: 'geography' },
    challengerRunId: 'bob-run',
    challengerName: 'Игрок',
    recipientProgress: 50,
    challengerProgress: 100,
  });
}

describe('outbid notification', () => {
  it('messages a Telegram owner once per bypass', async () => {
    const db = database();
    await bobBeatsAlem(db);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest/sendMessage');
    const payload = JSON.parse(init.body as string);
    expect(payload.chat_id).toBe('42');
    expect(payload.text).toBe('Игрок обошёл вашу запись: 100% против 50%. Можно сыграть реванш: вопросы будут новые.');
    const [[rematch], [stop]] = payload.reply_markup.inline_keyboard;
    const rows = inviteRows(db);
    expect(rows).toHaveLength(1);
    expect(rematch.url).toBe(`https://t.me/testbot?startapp=${rows[0].id}`);
    expect(stop.url).toBe('https://t.me/testbot?startapp=unsub');
    expect(rows[0]).toMatchObject({
      recipient_player_id: 'telegram:42',
      recipient_run_id: 'alem-run',
      challenger_run_id: 'bob-run',
      notify_status: 'sent',
    });
    expect(String(rows[0].id)).toMatch(/^rm_[A-Za-z0-9_-]{22}$/u);

    // Повтор для той же пары остановлен ограничением UNIQUE.
    await bobBeatsAlem(db, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inviteRows(db)).toHaveLength(1);
  });

  it('respects unsubscribe and can be re-enabled', async () => {
    const db = database();
    const off = await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: false }),
    });
    expect(await off.json()).toEqual({ enabled: false });
    await bobBeatsAlem(db);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inviteRows(db)).toHaveLength(0);

    const status = await request(db, '/api/notifications/outbid', alem);
    expect(await status.json()).toEqual({ enabled: false });
    expect((await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: 'yes' }),
    })).status).toBe(400);
    expect((await request(db, '/api/notifications/outbid', 'Bearer bad')).status).toBe(401);
  });

  it('stops messaging a user who blocked the bot', async () => {
    fetchMock.mockImplementation(async () => new Response('{"ok":false}', { status: 403 }));
    const db = database();
    await bobBeatsAlem(db);
    const status = await request(db, '/api/notifications/outbid', alem);
    expect(await status.json()).toEqual({ enabled: false });
  });
});

describe('rematch invite preview', () => {
  it('does not show an unknown or malformed invite', async () => {
    const db = database();
    expect((await request(db, '/api/rematch/not-an-invite', alem)).status).toBe(404);
    expect((await request(db, '/api/rematch/rm_AAAAAAAAAAAAAAAAAAAAAA', alem)).status).toBe(404);
  });
});
