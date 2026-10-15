/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIEBREAKER_BUCKET_COUNT, tiebreakerBucketIndex } from '@clutch/shared';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
const databases: TestD1[] = [];

// 12:00 UTC 15 октября: сутки dailyKey (+5 ч) — 2026-10-15.
const NOON = new Date('2026-10-15T12:00:00Z');
const TODAY = '2026-10-15';

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
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return {
    authorization: `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`,
    playerId: `guest:${subject}`,
  };
}

function env(db: TestD1, limiter: RateLimit = allowRateLimiter) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: limiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
  };
}

function get(db: TestD1, authorization?: string) {
  return app.request('/api/tiebreaker/today', { headers: authorization ? { authorization } : {} }, env(db));
}

function answer(db: TestD1, authorization: string, body: unknown, limiter?: RateLimit) {
  return app.request('/api/tiebreaker/answer', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env(db, limiter));
}

// Фикстура-вопрос: только в тестах, не в миграциях.
const EXPLANATION = {
  steps: [
    { label: 'Секретный-шаг-один', value: 1400, unit: 'полей', sourceUrl: 'https://example.org/step-one', sourceTitle: 'Источник-раз', asOf: '2025' },
    { label: 'Секретный-шаг-два', value: 2000, unit: 'деталей', sourceUrl: 'https://example.org/step-two', sourceTitle: 'Источник-два' },
  ],
  summary: 'Секретная-формула ≈ 1 400 × 2 000',
};

function addQuestion(
  db: TestD1,
  id: string,
  activeDate: string,
  answerValue = 1000,
  explanationJson = JSON.stringify(EXPLANATION),
  cardPrompt: string | null = null,
) {
  db.sqlite.prepare(
    'INSERT INTO tiebreaker_questions (id, prompt, card_prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, `Сколько ${id}?`, cardPrompt, 'шт.', answerValue, 'https://example.org/secret-source', '2026-01-01', activeDate, explanationJson, 1);
}

function addAnswers(db: TestD1, questionId: string, count: number, answerValue = 1000) {
  const insert = db.sqlite.prepare(
    'INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < count; i += 1) {
    const guess = answerValue * (1 + i); // множители 1, 2, 3, ...
    insert.run(`other-${i}`, questionId, TODAY, guess, 1 + i, 1);
  }
}

describe('GET /api/tiebreaker/today', () => {
  it('requires identity', async () => {
    const db = database();
    expect((await get(db)).status).toBe(401);
  });

  it('returns question: null when there is no question today, even if another day has one', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'yesterday', '2026-10-14');
    const response = await get(db, guest('a').authorization);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dateKey: TODAY, question: null, answered: null, answersCount: 0 });
  });

  it('does not leak the answer, source, distribution or counts before the player answers', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 123456);
    addAnswers(db, 'q1', 12, 123456);
    const response = await get(db, guest('a').authorization);
    const text = await response.text();
    // До своего ответа: номер вопроса и число ответивших — и больше никакой статистики.
    expect(JSON.parse(text)).toEqual({
      dateKey: TODAY,
      question: { id: 'q1', number: 1, prompt: 'Сколько q1?', cardPrompt: null, unit: 'шт.' },
      answered: null,
      answersCount: 12,
    });
    for (const secret of ['123456', 'secret-source', 'source', 'distribution', 'totalAnswers', 'percentile', '2026-01-01', 'multiplier', 'explanation', 'Секретный-шаг', 'step-one', 'step-two', 'Источник-', 'Секретная-формула']) {
      expect(text).not.toContain(secret);
    }
  });

  it('numbers the question by the count of questions up to its date, not by insertion order', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'later', '2026-10-17');
    addQuestion(db, 'today', TODAY);
    addQuestion(db, 'first', '2026-10-01');
    addQuestion(db, 'second', '2026-10-09');
    const body = await (await get(db, guest('a').authorization)).json() as Record<string, any>;
    expect(body.question.id).toBe('today');
    expect(body.question.number).toBe(3);
  });

  it('returns the short card prompt when set, null when not, and keeps the full prompt', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const withCard = database();
    addQuestion(withCard, 'q1', TODAY, 1000, undefined, 'Коротко о q1?');
    const a = await (await get(withCard, guest('a').authorization)).json() as Record<string, any>;
    expect(a.question).toMatchObject({ prompt: 'Сколько q1?', cardPrompt: 'Коротко о q1?' });
    const without = database();
    addQuestion(without, 'q1', TODAY);
    const b = await (await get(without, guest('a').authorization)).json() as Record<string, any>;
    expect(b.question.cardPrompt).toBeNull();
  });

  it('counts answers before and after the own answer, from all players of this question only', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY);
    addQuestion(db, 'old', '2026-10-14');
    addAnswers(db, 'q1', 3);
    db.sqlite.prepare(
      'INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('x', 'old', '2026-10-14', 5, 1, 1);
    const player = guest('a');
    expect(((await (await get(db, player.authorization)).json()) as Record<string, any>).answersCount).toBe(3);
    const posted = await (await answer(db, player.authorization, { questionId: 'q1', guess: 700 })).json() as Record<string, any>;
    expect(posted.answersCount).toBe(4);
    expect(posted.answered.totalAnswers).toBe(4);
    expect(((await (await get(db, player.authorization)).json()) as Record<string, any>).answersCount).toBe(4);
  });

  it('does not leak the answer to a player who only answered another day', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 123456);
    addQuestion(db, 'old', '2026-10-14', 777);
    const player = guest('a');
    db.sqlite.prepare(
      'INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(player.playerId, 'old', '2026-10-14', 7, 111, 1);
    const text = await (await get(db, player.authorization)).text();
    expect(JSON.parse(text).answered).toBeNull();
    expect(text).not.toContain('123456');
  });

  it('uses one rate-limit bucket per route and returns 429 when limited', async () => {
    const db = database();
    const keys: string[] = [];
    const limiter: RateLimit = { limit: async (options) => { keys.push(options.key); return { success: false }; } };
    const player = guest('limited');
    const read = await app.request('/api/tiebreaker/today', { headers: { authorization: player.authorization } }, env(db, limiter));
    expect(read.status).toBe(429);
    expect(read.headers.get('retry-after')).toBe('60');
    const write = await answer(db, player.authorization, { questionId: 'q1', guess: 5 }, limiter);
    expect(write.status).toBe(429);
    expect(keys).toEqual([`tiebreaker:${player.playerId}`, `tiebreaker_answer:${player.playerId}`]);
  });
});

describe('POST /api/tiebreaker/answer', () => {
  it('requires identity', async () => {
    const db = database();
    const response = await app.request('/api/tiebreaker/answer', { method: 'POST', body: '{}' }, env(db));
    expect(response.status).toBe(401);
  });

  it('stores the answer with a server-computed multiplier and returns the reveal', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 1000);
    const player = guest('a');
    // Клиент пытается подсунуть свой множитель: он игнорируется.
    const response = await answer(db, player.authorization, { questionId: 'q1', guess: 250, multiplier: 1 });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, any>;
    expect(body.question).toEqual({ id: 'q1', number: 1, prompt: 'Сколько q1?', cardPrompt: null, unit: 'шт.' });
    expect(body.answered).toMatchObject({
      guess: 250,
      multiplier: 4,
      answer: 1000,
      sourceUrl: 'https://example.org/secret-source',
      asOfDate: '2026-01-01',
      totalAnswers: 1,
      percentile: null,
      explanation: EXPLANATION,
    });
    const row = db.sqlite.prepare('SELECT guess, multiplier, date_key FROM tiebreaker_answers WHERE player_id = ?').get(player.playerId);
    expect(row).toEqual({ guess: 250, multiplier: 4, date_key: TODAY });

    const reread = await (await get(db, player.authorization)).json();
    expect(reread).toEqual(body);
  });

  it('answers without an explanation, not with a 500, when the stored JSON is damaged', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 1000, JSON.stringify({ steps: [], summary: 'СЕКРЕТ-В-ЛОГЕ' }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = guest('a');
    const response = await answer(db, player.authorization, { questionId: 'q1', guess: 250 });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, any>;
    expect(body.answered.explanation).toBeNull();
    expect(body.answered.answer).toBe(1000);
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain('СЕКРЕТ-В-ЛОГЕ');
    logged.mockRestore();
  });

  it('rejects a repeated answer with 409 and keeps the stored one', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 1000);
    const player = guest('a');
    expect((await answer(db, player.authorization, { questionId: 'q1', guess: 500 })).status).toBe(201);
    const again = await answer(db, player.authorization, { questionId: 'q1', guess: 1000 });
    expect(again.status).toBe(409);
    const body = await again.json() as Record<string, any>;
    expect(body.reason).toBe('already_answered');
    expect(body.answered).toMatchObject({ guess: 500, multiplier: 2 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM tiebreaker_answers').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT guess, multiplier FROM tiebreaker_answers').get()).toEqual({ guess: 500, multiplier: 2 });
  });

  it('rejects past, future and unknown question ids with 409, and malformed ids with 400, storing nothing', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY);
    addQuestion(db, 'old', '2026-10-14');
    addQuestion(db, 'next', '2026-10-16');
    const { authorization } = guest('a');
    for (const questionId of ['old', 'next', 'nope']) {
      const response = await answer(db, authorization, { questionId, guess: 5 });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ reason: 'not_todays_question' });
    }
    expect((await answer(db, authorization, { guess: 5 })).status).toBe(400);
    expect((await answer(db, authorization, { questionId: 7, guess: 5 })).status).toBe(400);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM tiebreaker_answers').get()).toEqual({ n: 0 });
  });

  it('rejects an answer when there is no question today', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    const response = await answer(db, guest('a').authorization, { questionId: 'q1', guess: 5 });
    expect(response.status).toBe(409);
  });

  it('rejects invalid guesses with 400', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY);
    const { authorization } = guest('a');
    const bodies = [
      { questionId: 'q1', guess: 0 },
      { questionId: 'q1', guess: -5 },
      { questionId: 'q1', guess: '500' },
      { questionId: 'q1', guess: null },
      { questionId: 'q1' },
      { questionId: 'q1', guess: 1.0000001e30 },
      '{"questionId":"q1","guess":1e999}', // JSON.parse даёт Infinity
      '[1,2]',
      'not json',
    ];
    for (const body of bodies) {
      const response = await answer(db, authorization, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM tiebreaker_answers').get()).toEqual({ n: 0 });
  });

  it('rejects an oversized body with 413', async () => {
    const db = database();
    const response = await answer(db, guest('a').authorization, { questionId: 'x'.repeat(2000), guess: 5 });
    expect(response.status).toBe(413);
  });
});

describe('tiebreaker statistics', () => {
  it('hides the percentile at 9 answers and shows it at 10', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 1000);
    addAnswers(db, 'q1', 8, 1000); // множители 1..8
    const ninth = await (await answer(db, guest('a').authorization, { questionId: 'q1', guess: 4500 })).json() as Record<string, any>;
    expect(ninth.answered.totalAnswers).toBe(9);
    expect(ninth.answered.percentile).toBeNull();

    // Множитель 2 (guess 500): 10-й ответ. Строго хуже: 3..8 (шесть) и 4.5 — 7 из 9 чужих.
    const tenth = await (await answer(db, guest('b').authorization, { questionId: 'q1', guess: 500 })).json() as Record<string, any>;
    expect(tenth.answered.totalAnswers).toBe(10);
    expect(tenth.answered.percentile).toBe(Math.floor((7 / 9) * 100));
  });

  it('sums the distribution to totalAnswers and buckets by guess/answer', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'q1', TODAY, 1000);
    addAnswers(db, 'q1', 5, 1000);
    const body = await (await answer(db, guest('a').authorization, { questionId: 'q1', guess: 100 })).json() as Record<string, any>;
    const { distribution, totalAnswers } = body.answered as { distribution: number[]; totalAnswers: number };
    expect(distribution).toHaveLength(TIEBREAKER_BUCKET_COUNT);
    expect(totalAnswers).toBe(6);
    expect(distribution.reduce((a, b) => a + b, 0)).toBe(totalAnswers);
    expect(distribution[tiebreakerBucketIndex(0.1)]).toBeGreaterThanOrEqual(1);
  });
});

describe('day boundary', () => {
  it('switches the question at 19:00 UTC (dailyKey +5h)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T18:59:00Z'), toFake: ['Date'] });
    const db = database();
    addQuestion(db, 'day15', '2026-10-15');
    addQuestion(db, 'day16', '2026-10-16');
    const { authorization } = guest('a');

    const before = await (await get(db, authorization)).json() as Record<string, any>;
    expect(before.dateKey).toBe('2026-10-15');
    expect(before.question.id).toBe('day15');

    vi.setSystemTime(new Date('2026-10-15T19:01:00Z'));
    const after = await (await get(db, authorization)).json() as Record<string, any>;
    expect(after.dateKey).toBe('2026-10-16');
    expect(after.question.id).toBe('day16');

    // Вчерашний вопрос после границы не принимается, сегодняшний — принимается.
    expect((await answer(db, authorization, { questionId: 'day15', guess: 5 })).status).toBe(409);
    const ok = await answer(db, authorization, { questionId: 'day16', guess: 5 });
    expect(ok.status).toBe(201);
    expect(db.sqlite.prepare('SELECT date_key FROM tiebreaker_answers').get()).toEqual({ date_key: '2026-10-16' });
  });
});
