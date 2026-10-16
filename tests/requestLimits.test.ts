/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHmac, createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../apps/api/src/index';
import { readJsonBody } from '../apps/api/src/http/jsonBody';
import { MAX_DAILY_SET_SIZE } from '@clutch/shared';
import { isRoundInput } from '../apps/api/src/solo/validation';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const databases: TestD1[] = [];
const validRound = { questionId: 'question', selectedAnswer: '', responseTimeMs: 60_000 };

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1(true);
  databases.push(result);
  return result;
}

class FakeRateLimiter implements RateLimit {
  readonly keys: string[] = [];

  constructor(private readonly outcome: 'allow' | 'deny' | 'error') {}

  async limit(options: RateLimitOptions): Promise<RateLimitOutcome> {
    this.keys.push(options.key);
    if (this.outcome === 'error') throw new Error('simulated binding failure');
    return { success: this.outcome === 'allow' };
  }
}

function env(db: TestD1, limiter: RateLimit) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: limiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
  };
}

function guestAuthorization(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 }))
    .toString('base64url');
  const signedValue = `v1.${payload}`;
  const signature = createHmac('sha256', sessionSecret).update(signedValue).digest('base64url');
  return `Bearer ${signedValue}.${signature}`;
}

describe('bounded JSON body reader', () => {
  it('rejects a declared oversized body before parsing it', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'Content-Length': '1025' },
      body: '{}',
    });
    await expect(readJsonBody(request, 1024)).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'Request body is too large.',
    });
  });

  it('measures actual UTF-8 bytes and rejects malformed or empty JSON', async () => {
    const multibyte = JSON.stringify({ value: 'я'.repeat(10) });
    expect(multibyte.length).toBeLessThan(30);
    await expect(readJsonBody(new Request('https://example.test', {
      method: 'POST', body: multibyte,
    }), 30)).resolves.toMatchObject({ ok: false, status: 413 });
    await expect(readJsonBody(new Request('https://example.test', {
      method: 'POST', body: '{broken',
    }), 1024)).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(readJsonBody(new Request('https://example.test', {
      method: 'POST', body: '',
    }), 1024)).resolves.toMatchObject({ ok: false, status: 400 });
  });
});

describe('R2b request shape limits', () => {
  it('applies route byte limits before validation and database work', async () => {
    const db = database();
    const limiter = new FakeRateLimiter('allow');
    const authorization = guestAuthorization('body-limits');
    const declared = await app.request('/api/solo-runs', {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        'content-length': '1025',
      },
      body: '{}',
    }, env(db, limiter));
    expect(declared.status).toBe(413);

    const actual = await app.request('/api/solo-runs/not-present/answer', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ ...validRound, roundIndex: 0, selectedAnswer: 'я'.repeat(9_000) }),
    }, env(db, limiter));
    expect(actual.status).toBe(413);

    const malformed = await app.request('/api/solo-runs', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: '{broken',
    }, env(db, limiter));
    expect(malformed.status).toBe(400);
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM match_runs').get() as { count: number }).count)
      .toBe(0);
  });

  it('bounds question ids, answers, and response time', () => {
    expect(isRoundInput(validRound)).toBe(true);
    expect(isRoundInput({ ...validRound, questionId: '' })).toBe(false);
    expect(isRoundInput({ ...validRound, questionId: 'q'.repeat(129) })).toBe(false);
    expect(isRoundInput({ ...validRound, selectedAnswer: 'a'.repeat(513) })).toBe(false);
    expect(isRoundInput({ ...validRound, responseTimeMs: 60_001 })).toBe(false);
  });

  it('rejects a solo round index beyond the largest set before looking up the run', async () => {
    const db = database();
    const limiter = new FakeRateLimiter('allow');
    const response = await app.request('/api/solo-runs/no-such-run/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: guestAuthorization('huge-index') },
      body: JSON.stringify({ roundIndex: MAX_DAILY_SET_SIZE, questionId: 'q', selectedAnswer: 'a', responseTimeMs: 1 }),
    }, env(db, limiter));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid answer.' });
  });
});

describe('R2b route rate limits', () => {
  it.each([
    ['guest:203.0.113.9', '/api/auth/guest', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } }],
    ['solo-start:guest:', '/api/solo-runs', {
      method: 'POST',
      headers: { authorization: guestAuthorization('start'), 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Player', category: 'geography' }),
    }],
    ['solo-round:guest:', '/api/solo-runs/not-present/answer', {
      method: 'POST',
      headers: { authorization: guestAuthorization('solo-round'), 'content-type': 'application/json' },
      body: JSON.stringify({ roundIndex: 0, questionId: 'q', selectedAnswer: 'a', responseTimeMs: 1 }),
    }],
    ['training:guest:', '/api/training/check', {
      method: 'POST',
      headers: { authorization: guestAuthorization('training'), 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'capital_bf', answer: 'x' }),
    }],
    // Единственный маршрут с ключом по IP: сессию гостя выдают ещё без identity.
    ['guest:203.0.113.9', '/api/auth/guest', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.9', 'content-type': 'application/json' },
      body: '{}',
    }],
  ])('returns 429 with a separate %s bucket', async (keyPrefix, path, init) => {
    const db = database();
    const limiter = new FakeRateLimiter('deny');
    const response = await app.request(path, init, env(db, limiter));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({ error: 'Too many requests.' });
    expect(limiter.keys).toHaveLength(1);
    expect(limiter.keys[0].startsWith(keyPrefix)).toBe(true);
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM match_runs').get() as { count: number }).count)
      .toBe(0);
  });

  it('fails closed with 503 when the binding throws', async () => {
    const db = database();
    const response = await app.request('/api/auth/guest', { method: 'POST' }, env(db, new FakeRateLimiter('error')));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Rate limiter unavailable.' });
  });
});
