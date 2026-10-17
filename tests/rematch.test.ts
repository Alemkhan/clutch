/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  dailyQuestionSet,
  type AsyncMatchRound,
  type Question,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { notifySoloResult } from '../apps/api/src/notifications/outbid';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
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

function guestSubject(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function guestAuthorization(label: string): string {
  const subject = guestSubject(label);
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
    CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
    CURRENT_HAMMER_MINI_GAME.id,
    configJson,
    SET.questionSetId,
  );
}

function inviteRows(db: TestD1) {
  return db.sqlite.prepare('SELECT * FROM rematch_invites').all() as Array<Record<string, unknown>>;
}

const bobAuthorization = guestAuthorization('bob');
const bobPlayerId = `guest:${guestSubject('bob')}`;

/**
 * Запись Алема и обошедший её забег Боба. Приглашения тут ещё нет: по DEC-09 его создаёт только
 * нажатие Боба, то есть `POST /api/solo-runs/bob-run/rematch`.
 */
function seedBeatenRecord(db: TestD1, outcome: 'player' | 'opponent' | 'tie' = 'player') {
  insertCompleted(db, 'alem-run', 'telegram:42', 'Алем');
  insertCompleted(db, 'bob-run', bobPlayerId, 'Боб', [25, 25, 25, 25]);
  db.sqlite.prepare(`
    UPDATE match_runs
    SET rules_version = ?, opponent_run_id = 'alem-run', solo_outcome = ?, reached_target = 1
    WHERE id = 'bob-run'
  `).run(CURRENT_SOLO_RUN_CONDITIONS.rulesVersion, outcome);
}

const callRematch = (db: TestD1, runId = 'bob-run', authorization = bobAuthorization) =>
  request(db, `/api/solo-runs/${runId}/rematch`, authorization, { method: 'POST', body: '{}' });

describe('a rematch is called by the player who played against a human record', () => {
  it('creates the invite on the press and messages the record owner once', async () => {
    const db = database();
    seedBeatenRecord(db);
    // До нажатия приглашения нет вовсе: исход уже известен, но никто никого не звал.
    expect(inviteRows(db)).toHaveLength(0);

    const response = await callRematch(db);
    expect(response.status).toBe(201);
    const rows = inviteRows(db);
    expect(rows).toHaveLength(1);
    expect(await response.json()).toEqual({ inviteId: rows[0].id, expiresAt: rows[0].expires_at });
    expect(rows[0]).toMatchObject({
      recipient_player_id: 'telegram:42',
      recipient_run_id: 'alem-run',
      challenger_run_id: 'bob-run',
      notify_status: 'sent',
    });
    expect(String(rows[0].id)).toMatch(/^rm_[A-Za-z0-9_-]{22}$/u);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottest/sendMessage');
    const payload = JSON.parse(init.body as string);
    expect(payload.chat_id).toBe('42');
    // Текст зовёт, и теперь это правда: за ним стоит нажатие Боба.
    expect(payload.text).toBe('Боб зовёт на реванш: вопросы будут новые.');
    const [[rematch], [stop]] = payload.reply_markup.inline_keyboard;
    expect(rematch.url).toBe(`https://t.me/testbot?startapp=${rows[0].id}`);
    expect(stop.url).toBe('https://t.me/testbot?startapp=unsub');

    // Повторное нажатие возвращает то же приглашение и не звонит получателю снова.
    const again = await callRematch(db);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ inviteId: rows[0].id, expiresAt: rows[0].expires_at });
    expect(inviteRows(db)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['opponent', 'tie'] as const)('creates the invite after a %s outcome too', async (outcome) => {
    const db = database();
    seedBeatenRecord(db, outcome);
    const response = await callRematch(db);
    expect(response.status).toBe(201);
    const rows = inviteRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient_run_id: 'alem-run', challenger_run_id: 'bob-run' });
    // Известие нейтрально к исходу: не говорит, что звавший победил.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toBe('Боб зовёт на реванш: вопросы будут новые.');
    // Пара уникальна: повторное нажатие возвращает то же приглашение.
    const again = await callRematch(db);
    expect(await again.json()).toEqual(await response.json());
    expect(inviteRows(db)).toHaveLength(1);
  });

  it('refuses a run without a human opponent record, a foreign run and an own run', async () => {
    const db = database();
    seedBeatenRecord(db);
    // Забег без записи-соперника (без темпа, бот): звать некого.
    db.sqlite.prepare("UPDATE match_runs SET opponent_run_id = NULL WHERE id = 'bob-run'").run();
    const noOpponent = await callRematch(db);
    expect(noOpponent.status).toBe(409);
    expect(await noOpponent.json()).toMatchObject({ reason: 'no_opponent' });
    expect(inviteRows(db)).toHaveLength(0);

    db.sqlite.prepare("UPDATE match_runs SET opponent_run_id = 'alem-run', solo_outcome = 'player' WHERE id = 'bob-run'").run();
    // Чужой забег неотличим от несуществующего.
    expect((await callRematch(db, 'bob-run', alem)).status).toBe(404);
    expect((await callRematch(db, 'no-such-run')).status).toBe(404);
    // Своя запись: звать себя нельзя.
    db.sqlite.prepare("UPDATE match_runs SET player_id = ? WHERE id = 'alem-run'").run(bobPlayerId);
    expect((await callRematch(db)).status).toBe(403);
    expect(inviteRows(db)).toHaveLength(0);
  });

  it('creates the invite even when the owner unsubscribed from bot messages', async () => {
    const db = database();
    seedBeatenRecord(db);
    const off = await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: false }),
    });
    expect(await off.json()).toEqual({ enabled: false });

    expect((await callRematch(db)).status).toBe(201);
    // Приглашение есть: отписка глушит сообщение бота, а не сам вызов — он виден в «Моих партиях».
    expect(inviteRows(db)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    expect((await request(db, '/api/notifications/outbid', alem, {
      method: 'PUT', body: JSON.stringify({ enabled: 'yes' }),
    })).status).toBe(400);
    expect((await request(db, '/api/notifications/outbid', 'Bearer bad')).status).toBe(401);
  });

  it('stops messaging a user who blocked the bot', async () => {
    fetchMock.mockImplementation(async () => new Response('{"ok":false}', { status: 403 }));
    const db = database();
    seedBeatenRecord(db);
    expect((await callRematch(db)).status).toBe(201);
    const status = await request(db, '/api/notifications/outbid', alem);
    expect(await status.json()).toEqual({ enabled: false });
  });

  it('logs a redacted failure with invite and run correlation ids', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 400,
      description: 'Bad Request: chat not found; test-bot-token; private Telegram message',
    }), { status: 400 }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = database();
    seedBeatenRecord(db);

    expect((await callRematch(db)).status).toBe(201);
    const invite = inviteRows(db)[0];
    expect(invite.notify_status).toBe('failed');
    expect(error).toHaveBeenCalledWith({
      event: 'telegram_notification_delivery',
      kind: 'rematch_offer',
      deliveryStatus: 'failed',
      reasonCode: 'chat_not_found',
      httpStatus: 400,
      inviteId: invite.id,
      recipientRunId: 'alem-run',
      challengerRunId: 'bob-run',
    });
    const serialized = JSON.stringify(error.mock.calls);
    expect(serialized).not.toContain('test-bot-token');
    expect(serialized).not.toContain('private Telegram message');
    expect(serialized).not.toContain('telegram:42');
    error.mockRestore();
  });
});

describe('the outcome notice does not invite anyone', () => {
  it('tells the owner their record lost without creating an invite', async () => {
    const db = database();
    seedBeatenRecord(db);
    await notifySoloResult(env(db) as never, {
      recipientRun: { id: 'alem-run', playerId: 'telegram:42', category: 'geography' },
      challengerRunId: 'bob-run',
      challengerName: 'Боб',
      recipientProgress: 50,
      challengerProgress: 100,
      outcome: 'record_lost',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    // Ни обещания реванша в тексте, ни кнопки, ни строки в базе: звать может только соперник.
    expect(payload.text).toBe('Боб обошёл вашу запись.');
    expect(payload.reply_markup.inline_keyboard).toHaveLength(1);
    expect(payload.reply_markup.inline_keyboard[0][0].url).toBe('https://t.me/testbot?startapp=unsub');
    expect(inviteRows(db)).toHaveLength(0);
  });
});

describe('rematch invite preview', () => {
  it('does not show an unknown or malformed invite', async () => {
    const db = database();
    expect((await request(db, '/api/rematch/not-an-invite', alem)).status).toBe(404);
    expect((await request(db, '/api/rematch/rm_AAAAAAAAAAAAAAAAAAAAAA', alem)).status).toBe(404);
  });
});
