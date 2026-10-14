/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const databases: TestD1[] = [];
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

afterEach(() => {
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

function post(db: TestD1, path: string, authorization: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

function reportRow(db: TestD1) {
  return db.sqlite.prepare('SELECT player_id, question_id, run_id, category, mode, kind, verdict, player_answer, comment FROM question_reports').get() as Record<string, unknown>;
}

function eventRow(db: TestD1) {
  return db.sqlite.prepare('SELECT player_id, event, run_id, question_id, payload_json FROM analytics_events').get() as Record<string, unknown>;
}

describe('telemetry routes require a verified player', () => {
  it('rejects reports and events without auth', async () => {
    const db = database();
    const report = await app.request('/api/reports', { method: 'POST' }, {
      DB: db.binding, API_RATE_LIMITER: allowRateLimiter,
      TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: sessionSecret, ENVIRONMENT: 'test',
    });
    expect(report.status).toBe(401);
    const event = await app.request('/api/events', { method: 'POST' }, {
      DB: db.binding, API_RATE_LIMITER: allowRateLimiter,
      TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: sessionSecret, ENVIRONMENT: 'test',
    });
    expect(event.status).toBe(401);
  });
});

describe('question reports route', () => {
  const validReport = {
    questionId: 'capital_li',
    runId: 'run-1',
    category: 'geography',
    mode: 'solo',
    kind: 'wrong_answer',
    verdict: false,
    playerAnswer: 'Берн',
    comment: 'Правильный ответ — Вадуц.',
  };

  it('stores a report with the verified identity and answers 201', async () => {
    const db = database();
    const player = guest('reporter');
    const response = await post(db, '/api/reports', player.authorization, validReport);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(reportRow(db)).toMatchObject({
      player_id: player.playerId,
      question_id: 'capital_li',
      run_id: 'run-1',
      category: 'geography',
      mode: 'solo',
      kind: 'wrong_answer',
      verdict: 0,
      player_answer: 'Берн',
      comment: 'Правильный ответ — Вадуц.',
    });
  });

  it('accepts a training report without run id and stores verdict as 1', async () => {
    const db = database();
    const player = guest('trainer');
    const response = await post(db, '/api/reports', player.authorization, {
      questionId: 'capital_li',
      category: 'geography',
      mode: 'training',
      kind: 'answer_not_accepted',
      verdict: true,
    });
    expect(response.status).toBe(201);
    expect(reportRow(db)).toMatchObject({
      player_id: player.playerId,
      run_id: null,
      mode: 'training',
      kind: 'answer_not_accepted',
      verdict: 1,
    });
  });

  it('rejects an unknown kind or mode with a short reason', async () => {
    const db = database();
    const player = guest('bad-kind');
    const kind = await post(db, '/api/reports', player.authorization, { ...validReport, kind: 'spam' });
    expect(kind.status).toBe(400);
    expect(await kind.json()).toMatchObject({ reason: 'invalid_kind' });
    const mode = await post(db, '/api/reports', player.authorization, { ...validReport, mode: 'race' });
    expect(mode.status).toBe(400);
    expect(await mode.json()).toMatchObject({ reason: 'invalid_mode' });
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM question_reports').get() as { count: number }).count).toBe(0);
  });

  it('rejects over-cap fields instead of truncating them', async () => {
    const db = database();
    const player = guest('too-long');
    for (const [field, value] of [
      ['questionId', 'q'.repeat(129)],
      ['comment', 'я'.repeat(501)],
      ['playerAnswer', 'a'.repeat(201)],
      ['category', 'c'.repeat(33)],
    ] as const) {
      const response = await post(db, '/api/reports', player.authorization, { ...validReport, [field]: value });
      expect(response.status, field).toBe(400);
      expect(await response.json()).toMatchObject({ reason: 'too_long' });
    }
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM question_reports').get() as { count: number }).count).toBe(0);
  });

  it('rejects a missing question id or a non-boolean verdict', async () => {
    const db = database();
    const player = guest('bad-shape');
    const missing = await post(db, '/api/reports', player.authorization, { ...validReport, questionId: undefined });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ reason: 'invalid_report' });
    const verdict = await post(db, '/api/reports', player.authorization, { ...validReport, verdict: 'yes' });
    expect(verdict.status).toBe(400);
    expect(await verdict.json()).toMatchObject({ reason: 'invalid_report' });
  });

  it('refuses an oversized body before validation', async () => {
    const db = database();
    const player = guest('huge-body');
    const response = await post(db, '/api/reports', player.authorization, {
      ...validReport,
      comment: 'я'.repeat(2_000),
    });
    expect(response.status).toBe(413);
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM question_reports').get() as { count: number }).count).toBe(0);
  });
});

describe('analytics events route', () => {
  it('stores an allowlisted event with a flat payload and answers 202', async () => {
    const db = database();
    const player = guest('runner');
    const response = await post(db, '/api/events', player.authorization, {
      event: 'solo_run_completed',
      runId: 'run-1',
      payload: { category: 'general', reachedTarget: true, roundsPlayed: 4 },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    const row = eventRow(db);
    expect(row).toMatchObject({
      player_id: player.playerId,
      event: 'solo_run_completed',
      run_id: 'run-1',
      question_id: null,
    });
    expect(JSON.parse(row.payload_json as string)).toEqual({
      category: 'general', reachedTarget: true, roundsPlayed: 4,
    });
  });

  it('stores an event without a payload', async () => {
    const db = database();
    const player = guest('bare');
    const response = await post(db, '/api/events', player.authorization, { event: 'sound_failure' });
    expect(response.status).toBe(202);
    expect(eventRow(db)).toMatchObject({ event: 'sound_failure', payload_json: null });
  });

  it('rejects an event outside the shared allowlist', async () => {
    const db = database();
    const player = guest('unknown');
    const response = await post(db, '/api/events', player.authorization, { event: 'question_answered' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'unknown_event' });
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_events').get() as { count: number }).count).toBe(0);
  });

  it('rejects payloads with more than four keys, nested values or long strings', async () => {
    const db = database();
    const player = guest('bad-payload');
    const fiveKeys = await post(db, '/api/events', player.authorization, {
      event: 'sound_failure',
      payload: { a: 1, b: 2, c: 3, d: 4, e: 5 },
    });
    expect(fiveKeys.status).toBe(400);
    expect(await fiveKeys.json()).toMatchObject({ reason: 'invalid_payload' });

    const nested = await post(db, '/api/events', player.authorization, {
      event: 'sound_failure',
      payload: { detail: { reason: 'play-rejected' } },
    });
    expect(nested.status).toBe(400);
    expect(await nested.json()).toMatchObject({ reason: 'invalid_payload' });

    const longString = await post(db, '/api/events', player.authorization, {
      event: 'sound_failure',
      payload: { reason: 'r'.repeat(65) },
    });
    expect(longString.status).toBe(400);
    expect(await longString.json()).toMatchObject({ reason: 'too_long' });

    // Четыре максимальных ключа и строки дают JSON длиннее 512 символов.
    const longJson = await post(db, '/api/events', player.authorization, {
      event: 'sound_failure',
      payload: Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
        `k${index}${'k'.repeat(62)}`, 'v'.repeat(64),
      ])),
    });
    expect(longJson.status).toBe(400);
    expect(await longJson.json()).toMatchObject({ reason: 'too_long' });
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_events').get() as { count: number }).count).toBe(0);
  });

  it('shares one rate-limit bucket per route per player', async () => {
    const db = createTestD1();
    databases.push(db);
    const keys: string[] = [];
    const limiter: RateLimit = {
      limit: async (options) => {
        keys.push(options.key);
        return { success: false };
      },
    };
    const player = guest('limited');
    const env = {
      DB: db.binding,
      API_RATE_LIMITER: limiter,
      TELEGRAM_BOT_TOKEN: 'test',
      SESSION_SIGNING_SECRET: sessionSecret,
      ENVIRONMENT: 'test',
    };
    const report = await app.request('/api/reports', {
      method: 'POST',
      headers: { authorization: player.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q', mode: 'solo', kind: 'other', verdict: false }),
    }, env);
    expect(report.status).toBe(429);
    expect(report.headers.get('retry-after')).toBe('60');
    const event = await app.request('/api/events', {
      method: 'POST',
      headers: { authorization: player.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'sound_failure' }),
    }, env);
    expect(event.status).toBe(429);
    expect(keys).toEqual([`reports:${player.playerId}`, `events:${player.playerId}`]);
  });
});
