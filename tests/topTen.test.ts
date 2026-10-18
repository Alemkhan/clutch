/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  DAILY_RULES_VERSION,
  dailyKey,
  dailyQuestionSet,
  setPar,
  type AsyncMatchRound,
  type SoloLeaderboardResponse,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { notifyBumpedFromTopTen, outOfTopTenText, snapshotTopTen } from '../apps/api/src/notifications/outOfTop';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

// R25: порядок таблицы дня (равных разводит «На глазок», ничья делит место) и известие
// «выбили из первой десятки».
const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const TODAY = dailyKey(NOW);
// Таблица дня и известие о десятке читают только забеги дня.
const SOLO = DAILY_RULES_VERSION;
const SET = dailyQuestionSet('geography', NOW, 0);
const PAR = setPar(SET.questions);
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

function call(db: TestD1, path: string, authorization: string, body?: unknown) {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db), executionCtx);
}

function telegram(id: number, name = 'Игрок'): { authorization: string; playerId: string } {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: name }),
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

let finishOrder = 0;
/** Завершённый зачётный забег на наборе 0: `rounds` кругов, счёт rounds/пар. Порядок финиша — по вызову. */
function insertRun(db: TestD1, options: { id: string; playerId: string; rounds?: number; name?: string; category?: string }) {
  const roundsCount = options.rounds ?? 4;
  const rounds: AsyncMatchRound[] = Array.from({ length: roundsCount }, (_, index) => ({
    questionId: SET.questions[index].id,
    correct: true,
    responseTimeMs: 1000,
    progressAwarded: 25,
    playerProgressAfter: 100,
  }));
  finishOrder += 1;
  const completedAt = NOW - 100_000 + finishOrder * 10;
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score
    ) VALUES (?, ?, ?, ?, ?, ?, 100, ?, 'completed', ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
  `).run(
    options.id, options.playerId, options.name ?? options.id, options.category ?? 'geography',
    JSON.stringify(SET.questions), JSON.stringify(rounds), roundsCount, completedAt - 1000, completedAt,
    SOLO, CURRENT_HAMMER_MINI_GAME.id, configJson, SET.questionSetId, PAR, roundsCount / PAR,
  );
}

function ensureQuestion(db: TestD1) {
  db.sqlite.prepare(`
    INSERT OR IGNORE INTO tiebreaker_questions (id, prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at)
    VALUES (?, 'Сколько?', '', 100, 'https://example.com', '2026-01-01', ?, '{"steps":[{"label":"шаг","value":1,"unit":"","sourceUrl":"https://example.org","sourceTitle":"Пример"}],"summary":"итог"}', 1)
  `).run(`q-${TODAY}`, TODAY);
}

function answered(db: TestD1, playerId: string, multiplier: number) {
  ensureQuestion(db);
  db.sqlite.prepare(`
    INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at)
    VALUES (?, ?, ?, 100, ?, 1)
  `).run(playerId, `q-${TODAY}`, TODAY, multiplier);
}

const board = async (db: TestD1, who = guest('viewer'), query = '?category=geography') =>
  await (await call(db, `/api/solo-leaderboard${query}`, who.authorization)).json() as SoloLeaderboardResponse;
const order = (body: SoloLeaderboardResponse) => body.entries.map((entry) => entry.displayName);
const places = (body: SoloLeaderboardResponse) => body.entries.map((entry) => entry.rank);

describe('day board order: equal rounds are split by the guess', () => {
  it('a smaller multiplier is higher; a guess beats no guess; a guest counts as no guess', async () => {
    const db = database();
    insertRun(db, { id: 'noanswer', playerId: 'telegram:1' });
    insertRun(db, { id: 'worse', playerId: 'telegram:2' });
    insertRun(db, { id: 'guest', playerId: guest('g').playerId });
    insertRun(db, { id: 'better', playerId: 'telegram:3' });
    answered(db, 'telegram:2', 2.5);
    answered(db, 'telegram:3', 1.2);
    // Ответ гостя хранится, но в таблице не засчитывается.
    answered(db, guest('g').playerId, 1.01);
    const body = await board(db);
    expect(order(body)).toEqual(['better', 'worse', 'noanswer', 'guest']);
    // Оба без ответа (telegram без ответа и гость) делят место.
    expect(places(body)).toEqual([1, 2, 3, 3]);
  });

  it('fewer rounds still win over a better guess; ties share a place (1, 2, 2, 4)', async () => {
    const db = database();
    insertRun(db, { id: 'fast', playerId: 'telegram:1', rounds: 3 });
    insertRun(db, { id: 'twin-a', playerId: 'telegram:2' });
    insertRun(db, { id: 'twin-b', playerId: 'telegram:3' });
    insertRun(db, { id: 'slowest', playerId: 'telegram:4', rounds: 5 });
    answered(db, 'telegram:1', 9);
    answered(db, 'telegram:2', 1.5);
    answered(db, 'telegram:3', 1.5);
    answered(db, 'telegram:4', 1.01);
    const body = await board(db);
    expect(order(body)).toEqual(['fast', 'twin-a', 'twin-b', 'slowest']);
    expect(places(body)).toEqual([1, 2, 2, 4]);
  });

  it('a guess made after the run reorders the board at request time', async () => {
    const db = database();
    insertRun(db, { id: 'first', playerId: 'telegram:1' });
    insertRun(db, { id: 'second', playerId: 'telegram:2' });
    expect(order(await board(db))).toEqual(['first', 'second']);
    expect(places(await board(db))).toEqual([1, 1]);
    answered(db, 'telegram:2', 1.3);
    const after = await board(db);
    expect(order(after)).toEqual(['second', 'first']);
    expect(places(after)).toEqual([1, 2]);
  });

  it('run duration is ignored: the faster run does not outrank an equal one', async () => {
    const db = database();
    insertRun(db, { id: 'early', playerId: 'telegram:1' });
    insertRun(db, { id: 'late', playerId: 'telegram:2' });
    db.sqlite.prepare("UPDATE match_runs SET created_at = completed_at - 1 WHERE id = 'late'").run();
    db.sqlite.prepare("UPDATE match_runs SET created_at = completed_at - 900000 WHERE id = 'early'").run();
    expect(places(await board(db))).toEqual([1, 1]);
  });

  it("the guess belongs to the board day: yesterday's answer does not split today", async () => {
    const db = database();
    insertRun(db, { id: 'a', playerId: 'telegram:1' });
    insertRun(db, { id: 'b', playerId: 'telegram:2' });
    db.sqlite.prepare(`INSERT INTO tiebreaker_questions (id, prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at)
      VALUES ('old', 'x', '', 1, 'https://e.com', '2026-01-01', '2026-10-10', '{}', 1)`).run();
    db.sqlite.prepare(`INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at)
      VALUES ('telegram:2', 'old', '2026-10-10', 1, 1.1, 1)`).run();
    expect(places(await board(db))).toEqual([1, 1]);
  });
});

describe('my standing carries the facts for the hint', () => {
  it('equal rounds above me: outranked by the guess, with the viewer kind', async () => {
    const db = database();
    insertRun(db, { id: 'above', playerId: 'telegram:1' });
    answered(db, 'telegram:1', 1.1);
    const asGuest = guest('viewer');
    insertRun(db, { id: 'me-guest', playerId: asGuest.playerId });
    expect((await board(db, asGuest)).you).toMatchObject({ rank: 2, placeAbove: 1, outrankedByGuess: true, tiebreak: 'guest' });

    const me = telegram(2);
    insertRun(db, { id: 'me-tg', playerId: me.playerId });
    expect((await board(db, me)).you).toMatchObject({ outrankedByGuess: true, tiebreak: 'not_answered' });
    answered(db, me.playerId, 1.5);
    expect((await board(db, me)).you).toMatchObject({ rank: 2, placeAbove: 1, outrankedByGuess: true, tiebreak: 'answered' });
  });

  it('fewer rounds above me: not a guess case, and placeAbove follows ties', async () => {
    const db = database();
    insertRun(db, { id: 'top', playerId: 'telegram:1', rounds: 3 });
    insertRun(db, { id: 'a', playerId: 'telegram:2' });
    insertRun(db, { id: 'b', playerId: 'telegram:3' });
    const me = telegram(4);
    insertRun(db, { id: 'me', playerId: me.playerId, rounds: 5 });
    expect((await board(db, me)).you).toMatchObject({ rank: 4, placeAbove: 2, outrankedByGuess: false, roundsToNext: 2 });
  });
});

const bodies = (): Array<{ chat_id: string; text: string; reply_markup?: unknown }> =>
  fetchMock.mock.calls
    .map((call) => JSON.parse((call as [string, RequestInit])[1].body as string))
    .filter((body) => String(body.text).includes('выбил вас'));
const sentTexts = (): string[] => bodies().map((body) => body.text);
const sentTo = (): string[] => bodies().map((body) => String(body.chat_id));

/** Десять Telegram-игроков с равными кругами и прикидками 1,1…2,0: последний — на десятом месте. */
function fillTopTen(db: TestD1) {
  for (let index = 1; index <= 10; index += 1) {
    insertRun(db, { id: `f${index}`, playerId: `telegram:${100 + index}`, name: `Филлер ${index}` });
    answered(db, `telegram:${100 + index}`, 1 + index / 10);
  }
}

async function playRun(db: TestD1, who: { authorization: string }) {
  const started = await call(db, '/api/solo-runs', who.authorization, { displayName: 'Новичок', category: 'geography' });
  expect(started.status).toBe(201);
  const run = await started.json() as StartSoloRunResponse;
  const done = await playRounds(
    (path, body) => call(db, path, who.authorization, body),
    run.runId,
    roundInputs(fullQuestions(db, run.runId), 4, true),
  );
  expect(done.status).toBe(200);
  await Promise.all(pending);
  return run;
}

describe('notification: knocked out of the top ten', () => {
  it('completing a run that enters the top ten sends one message to the one pushed out', async () => {
    const db = database();
    fillTopTen(db);
    const newcomer = telegram(99, 'Новичок');
    answered(db, newcomer.playerId, 1.05);
    await playRun(db, newcomer);
    expect(sentTo()).toEqual(['110']);
    expect(sentTexts()[0]).toBe('Новичок выбил вас из первой десятки таблицы дня «География»: при равных кругах прикидка «На глазок» точнее. Сыграйте ещё набор, чтобы вернуться.');
    const markup = JSON.stringify(bodies()[0].reply_markup);
    expect(markup).toContain('Сыграть ещё набор');
    expect(markup).toContain('Не присылать такие сообщения');
    expect(db.sqlite.prepare('SELECT player_id, date_key FROM top_ten_notices').all())
      .toEqual([{ player_id: 'telegram:110', date_key: TODAY }]);
  });

  it('a second knock-out the same game day sends nothing', async () => {
    const db = database();
    fillTopTen(db);
    db.sqlite.prepare("INSERT INTO top_ten_notices (player_id, date_key, created_at) VALUES ('telegram:110', ?, 1)").run(TODAY);
    const newcomer = telegram(99);
    answered(db, newcomer.playerId, 1.05);
    await playRun(db, newcomer);
    expect(sentTexts()).toEqual([]);
  });

  it('an unsubscribed player is not messaged and does not spend the daily slot', async () => {
    const db = database();
    fillTopTen(db);
    db.sqlite.prepare("INSERT INTO player_notification_prefs (player_id, outbid_enabled, updated_at) VALUES ('telegram:110', 0, 1)").run();
    const newcomer = telegram(99);
    answered(db, newcomer.playerId, 1.05);
    await playRun(db, newcomer);
    expect(sentTexts()).toEqual([]);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM top_ten_notices').get()).toEqual({ n: 0 });
  });

  it('a guest pushed out of the top ten is never messaged', async () => {
    const db = database();
    for (let index = 1; index <= 9; index += 1) {
      insertRun(db, { id: `f${index}`, playerId: `telegram:${100 + index}` });
      answered(db, `telegram:${100 + index}`, 1 + index / 10);
    }
    insertRun(db, { id: 'g10', playerId: guest('tenth').playerId });
    const newcomer = telegram(99);
    answered(db, newcomer.playerId, 1.05);
    await playRun(db, newcomer);
    expect(sentTexts()).toEqual([]);
  });

  it('staying in the top ten sends nothing', async () => {
    const db = database();
    for (let index = 1; index <= 5; index += 1) {
      insertRun(db, { id: `f${index}`, playerId: `telegram:${100 + index}` });
      answered(db, `telegram:${100 + index}`, 1 + index / 10);
    }
    const newcomer = telegram(99);
    answered(db, newcomer.playerId, 1.05);
    await playRun(db, newcomer);
    expect(sentTexts()).toEqual([]);
  });

  it('a better guess after the run can push an equal player out of the ten', async () => {
    const db = database();
    fillTopTen(db);
    const late = telegram(99, 'Поздний');
    insertRun(db, { id: 'late', playerId: late.playerId, name: 'Поздний' });
    expect((await board(db, late)).you).toMatchObject({ rank: 11 });
    ensureQuestion(db);
    const response = await call(db, '/api/tiebreaker/answer', late.authorization, { questionId: `q-${TODAY}`, guess: 105 });
    expect(response.status).toBe(201);
    await Promise.all(pending);
    expect(sentTo()).toEqual(['110']);
    expect(sentTexts()[0]).toBe('Поздний выбил вас из первой десятки таблицы дня «География»: при равных кругах прикидка «На глазок» точнее. Сыграйте ещё набор, чтобы вернуться.');
  });

  it('a guest answering does not move or message anyone', async () => {
    const db = database();
    fillTopTen(db);
    const visitor = guest('visitor');
    insertRun(db, { id: 'visitor', playerId: visitor.playerId });
    ensureQuestion(db);
    const response = await call(db, '/api/tiebreaker/answer', visitor.authorization, { questionId: `q-${TODAY}`, guess: 100 });
    expect(response.status).toBe(201);
    await Promise.all(pending);
    expect(sentTexts()).toEqual([]);
  });

  it('two concurrent notifications for the same player deliver one message', async () => {
    const db = database();
    fillTopTen(db);
    const before = await snapshotTopTen(db.binding, ['geography'], TODAY);
    const newcomer = telegram(99, 'Новичок');
    insertRun(db, { id: 'n', playerId: newcomer.playerId, name: 'Новичок' });
    answered(db, newcomer.playerId, 1.05);
    const after = await snapshotTopTen(db.binding, ['geography'], TODAY);
    const input = { triggerPlayerId: newcomer.playerId, triggerName: 'Новичок', dateKey: TODAY, before, after };
    await Promise.all([notifyBumpedFromTopTen(env(db) as never, input), notifyBumpedFromTopTen(env(db) as never, input)]);
    expect(sentTexts()).toHaveLength(1);
  });

  it('the text without a guess reason is plain, and the name is trimmed', () => {
    expect(outOfTopTenText('  Аня   Ив  ', 'general', false))
      .toBe('Аня Ив выбил вас из первой десятки таблицы дня «Общие знания». Сыграйте ещё набор, чтобы вернуться.');
  });
});
