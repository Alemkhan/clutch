/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  PRACTICE_RULES_VERSION,
  SOLO_ROUND_CAP,
  dailyQuestionSet,
  toPublicQuestion,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CreateFriendInviteResponse,
  type Question,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { releaseExpiredRematchInvites } from '../apps/api/src/notifications/expiry';
import { OPEN_INVITE_TTL_MS } from '../apps/api/src/notifications/repository';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const databases: TestD1[] = [];
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
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

function call(db: TestD1, label: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: guest(label).authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

const startRun = (db: TestD1, label: string, extra: Record<string, unknown> = {}) =>
  call(db, label, 'POST', '/api/solo-runs', { displayName: label, category: 'geography', ...extra });

/** Игрок проходит забег через API до цели (четыре точных удара). */
async function finishedRun(db: TestD1, label: string): Promise<string> {
  const response = await startRun(db, label);
  expect(response.status).toBe(201);
  const run = await response.json() as StartSoloRunResponse;
  const done = await playRounds((path, body) => call(db, label, 'POST', path, body), run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
  expect(done.status).toBe(200);
  return run.runId;
}

const invite = (db: TestD1, label: string, runId: string) =>
  call(db, label, 'POST', `/api/solo-runs/${runId}/invite`, {});

async function createInvite(db: TestD1, label: string, runId: string): Promise<CreateFriendInviteResponse> {
  const response = await invite(db, label, runId);
  expect(response.status).toBe(201);
  return await response.json() as CreateFriendInviteResponse;
}

/** Забег на наборе дня с заданной версией правил и целью (без прохождения через API). */
function insertRun(
  db: TestD1,
  id: string,
  playerId: string,
  rulesVersion: string,
  reachedTarget: number | null,
  status = 'completed',
) {
  const set = dailyQuestionSet('geography', NOW, 0);
  let progress = 0;
  const rounds: AsyncMatchRound[] = [25, 25, 25, 25].map((progressAwarded, index) => {
    progress += progressAwarded;
    return { questionId: set.questions[index].id, correct: true, responseTimeMs: 1000, progressAwarded, playerProgressAfter: progress };
  });
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, playerId, id, JSON.stringify(set.questions), status === 'completed' ? JSON.stringify(rounds) : null,
    status, NOW - 2000, status === 'completed' ? NOW - 1000 : null, rulesVersion,
    CURRENT_HAMMER_MINI_GAME.id, configJson, set.questionSetId, reachedTarget,
  );
}

const inviteCount = (db: TestD1) => db.sqlite.prepare('SELECT COUNT(*) AS n FROM rematch_invites').get();

describe('friend invite: creation', () => {
  it('returns a link built from configuration, and the same live invite on a repeat call', async () => {
    const db = database();
    const runId = await finishedRun(db, 'ann');
    const first = await createInvite(db, 'ann', runId);
    expect(first.url).toBe(`https://t.me/testbot?startapp=${first.inviteId}`);
    expect(first.inviteId).toMatch(/^rm_[A-Za-z0-9_-]{22}$/u);
    // Открытая ссылка держит запись вне подбора, поэтому живёт сутки, а не неделю.
    expect(first.expiresAt).toBe(NOW + OPEN_INVITE_TTL_MS);
    expect(await createInvite(db, 'ann', runId)).toEqual(first);
    expect(inviteCount(db)).toEqual({ n: 1 });
  });

  it('refuses a run that belongs to someone else', async () => {
    const db = database();
    const runId = await finishedRun(db, 'ann');
    expect((await invite(db, 'bob', runId)).status).toBe(404);
    expect((await invite(db, 'ann', 'no-such-run')).status).toBe(404);
    expect(inviteCount(db)).toEqual({ n: 0 });
  });

  it('refuses a practice run', async () => {
    const db = database();
    insertRun(db, 'practice-run', guest('ann').playerId, PRACTICE_RULES_VERSION, 1);
    const response = await invite(db, 'ann', 'practice-run');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'not_solo' });
    expect(inviteCount(db)).toEqual({ n: 0 });
  });

  it('refuses an unfinished run and a run that did not reach the target', async () => {
    const db = database();
    insertRun(db, 'open-run', guest('ann').playerId, SOLO, null, 'in_progress');
    expect((await invite(db, 'ann', 'open-run')).status).toBe(409);

    const started = await (await startRun(db, 'ann')).json() as StartSoloRunResponse;
    expect((await invite(db, 'ann', started.runId)).status).toBe(409);

    const capped = await (await startRun(db, 'eve')).json() as StartSoloRunResponse;
    const done = await playRounds((path, body) => call(db, 'eve', 'POST', path, body), capped.runId, roundInputs(fullQuestions(db, capped.runId), SOLO_ROUND_CAP, false));
    expect(done.status).toBe(200);
    const response = await invite(db, 'eve', capped.runId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'not_reached' });
    expect(inviteCount(db)).toEqual({ n: 0 });
  });
});

describe('friend invite: claiming and reservation', () => {
  it('previews before it is claimed, with the author name and no addressee', async () => {
    const db = database();
    const link = await createInvite(db, 'ann', await finishedRun(db, 'ann'));
    const response = await call(db, 'bob', 'GET', `/api/rematch/${link.inviteId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inviteId: link.inviteId, friend: true, challengerName: 'ann', challengerProgress: 100,
    });
    expect(db.sqlite.prepare('SELECT consumed_at, recipient_player_id FROM rematch_invites').get())
      .toEqual({ consumed_at: null, recipient_player_id: null });
  });

  it('gives the link only to the first one who starts a run; the second is refused', async () => {
    const db = database();
    const authorRun = await finishedRun(db, 'ann');
    const link = await createInvite(db, 'ann', authorRun);

    const [bob, carol] = await Promise.all([
      startRun(db, 'bob', { rematchInviteId: link.inviteId }),
      startRun(db, 'carol', { rematchInviteId: link.inviteId }),
    ]);
    expect([bob.status, carol.status].sort()).toEqual([201, 410]);
    const winnerLabel = bob.status === 201 ? 'bob' : 'carol';
    const winner = bob.status === 201 ? bob : carol;
    const loser = bob.status === 201 ? carol : bob;
    expect(await loser.json()).toMatchObject({ reason: 'taken' });

    // Победитель играет против самой записи автора на её наборе.
    const run = await winner.json() as StartSoloRunResponse;
    expect(run.pace?.id).toBe(authorRun);
    const stored = db.sqlite.prepare('SELECT questions_json FROM match_runs WHERE id = ?').get(authorRun) as { questions_json: string };
    // Тот же набор, что у автора, но без ответов: клиент получает публичный вид вопросов.
    expect(run.questions).toEqual((JSON.parse(stored.questions_json) as Question[]).map(toPublicQuestion));
    const row = db.sqlite.prepare('SELECT recipient_player_id, rematch_run_id FROM rematch_invites').get() as Record<string, unknown>;
    expect(row).toEqual({ recipient_player_id: guest(winnerLabel).playerId, rematch_run_id: run.runId });

    const late = await call(db, 'dave', 'GET', `/api/rematch/${link.inviteId}`);
    expect(late.status).toBe(410);
    expect(await late.json()).toMatchObject({ reason: 'taken' });
  });

  it('does not let the author play against their own record', async () => {
    const db = database();
    const link = await createInvite(db, 'ann', await finishedRun(db, 'ann'));
    const preview = await call(db, 'ann', 'GET', `/api/rematch/${link.inviteId}`);
    expect(preview.status).toBe(403);
    expect(await preview.json()).toMatchObject({ reason: 'own' });
    const start = await startRun(db, 'ann', { rematchInviteId: link.inviteId });
    expect(start.status).toBe(403);
    expect(db.sqlite.prepare('SELECT consumed_at FROM rematch_invites').get()).toEqual({ consumed_at: null });
  });

  it('does not accept an expired link, and the record returns to the shared pool', async () => {
    const db = database();
    const authorRun = await finishedRun(db, 'ann');
    const link = await createInvite(db, 'ann', authorRun);

    // Пока ссылка жива, запись другим в общем подборе не выдаётся.
    const reserved = await (await startRun(db, 'dave')).json() as StartSoloRunResponse;
    expect(reserved.pace).toBeNull();

    db.sqlite.prepare('UPDATE rematch_invites SET expires_at = ?').run(NOW - 1);
    const preview = await call(db, 'bob', 'GET', `/api/rematch/${link.inviteId}`);
    expect(preview.status).toBe(410);
    expect(await preview.json()).toMatchObject({ reason: 'expired' });
    expect((await startRun(db, 'bob', { rematchInviteId: link.inviteId })).status).toBe(410);
    expect((await invite(db, 'ann', authorRun)).status).toBe(409);

    // Резерв снят по сроку ещё до планового прохода; проход лишь фиксирует отпускание.
    const returned = await (await startRun(db, 'erin')).json() as StartSoloRunResponse;
    expect(returned.pace?.id).toBe(authorRun);
    expect(await releaseExpiredRematchInvites(db.binding, NOW)).toEqual({ released: 1, claimsReleased: 0, more: false });
    // Запись забрал первый: матч — это пара, второму она уже не достаётся.
    const after = await (await startRun(db, 'frank')).json() as StartSoloRunResponse;
    expect(after.pace).toBeNull();
  });

  it('keeps the record out of the shared pool while the link is live and frees it once taken', async () => {
    const db = database();
    const authorRun = await finishedRun(db, 'ann');
    const link = await createInvite(db, 'ann', authorRun);
    const other = await (await startRun(db, 'dave')).json() as StartSoloRunResponse;
    expect(other.pace).toBeNull();

    expect((await startRun(db, 'bob', { rematchInviteId: link.inviteId })).status).toBe(201);
    const later = await (await startRun(db, 'carol')).json() as StartSoloRunResponse;
    expect(later.pace?.id).toBe(authorRun);
  });

  it('frees the link again when the friend run could not be created', async () => {
    const db = database();
    const link = await createInvite(db, 'ann', await finishedRun(db, 'ann'));
    db.sqlite.exec(`CREATE TRIGGER fail_solo BEFORE INSERT ON match_runs
      WHEN NEW.player_id = '${guest('bob').playerId}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    await startRun(db, 'bob', { rematchInviteId: link.inviteId }).catch(() => undefined);
    expect(db.sqlite.prepare('SELECT consumed_at, recipient_player_id FROM rematch_invites').get())
      .toEqual({ consumed_at: null, recipient_player_id: null });
    db.sqlite.exec('DROP TRIGGER fail_solo');
    expect((await startRun(db, 'carol', { rematchInviteId: link.inviteId })).status).toBe(201);
  });
});

describe('схема приглашений', () => {
  it('допускает приглашение без адресата и только одно открытое на забег', () => {
    // Раньше это проверялось как шаг миграции 0009 (пересборка таблицы, чтобы снять NOT NULL).
    // После сжатия истории шага нет, а свойства схемы остались и проверяются напрямую.
    const db = createTestD1();
    databases.push(db);
    insertRun(db, 'run-a', 'telegram:1', SOLO, 1);
    insertRun(db, 'run-b', 'telegram:2', SOLO, 1);
    db.sqlite.prepare(`
      INSERT INTO rematch_invites (id, recipient_player_id, recipient_run_id, challenger_run_id, category,
        recipient_progress, challenger_progress, created_at, expires_at, consumed_at, released_at)
      VALUES ('rm_old', 'telegram:1', 'run-a', 'run-b', 'geography', 50, 100, 1, 2, 3, 4)
    `).run();
    expect(db.sqlite.prepare('SELECT id, recipient_player_id, recipient_run_id, consumed_at, released_at FROM rematch_invites').all())
      .toEqual([{ id: 'rm_old', recipient_player_id: 'telegram:1', recipient_run_id: 'run-a', consumed_at: 3, released_at: 4 }]);
    // Открытое приглашение: адресата нет, пока ссылку не погасят.
    db.sqlite.prepare(`
      INSERT INTO rematch_invites (id, challenger_run_id, category, recipient_progress, challenger_progress, created_at, expires_at)
      VALUES ('rm_open', 'run-a', 'geography', 0, 100, 1, 2)
    `).run();
    // Второе открытое на тот же забег не пройдёт: частичный UNIQUE-индекс.
    expect(() => db.sqlite.prepare(`
      INSERT INTO rematch_invites (id, challenger_run_id, category, recipient_progress, challenger_progress, created_at, expires_at)
      VALUES ('rm_open2', 'run-a', 'geography', 0, 100, 1, 2)
    `).run()).toThrow();
  });
});
