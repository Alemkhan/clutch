/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
const timestamp = 1_795_000_000_000;

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(current = true): TestD1 {
  const result = createTestD1(current);
  databases.push(result);
  return result;
}

function env(db: D1Database) {
  return {
    DB: db,
    API_RATE_LIMITER: {} as RateLimit,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: 'test-session-signing-secret-at-least-32-characters',
    ENVIRONMENT: 'test',
  };
}

describe('API liveness and readiness', () => {
  it('reports ready when the current D1 schema is available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(timestamp);
    const db = database();

    const response = await app.request('/api/ready', {}, env(db.binding));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      timestamp,
      environment: 'test',
      checks: { d1: 'ok' },
    });
  });

  it('reports unavailable when migration 0002 has not been applied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(timestamp);
    const db = database(false);

    const response = await app.request('/api/ready', {}, env(db.binding));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: 'unavailable',
      timestamp,
      environment: 'test',
      checks: { d1: 'unavailable' },
    });
    expect(JSON.stringify(body)).not.toContain('no such column');
  });

  it('reports unavailable without exposing a D1 exception', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(timestamp);
    const rawError = 'secret binding failure: SELECT token FROM private_table';
    const throwingDb = {
      prepare: vi.fn(() => {
        throw new Error(rawError);
      }),
    } as unknown as D1Database;

    const response = await app.request('/api/ready', {}, env(throwingDb));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: 'unavailable',
      timestamp,
      environment: 'test',
      checks: { d1: 'unavailable' },
    });
    expect(JSON.stringify(body)).not.toContain(rawError);
  });

  it('keeps health as a cheap liveness check that does not touch D1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(timestamp);
    const prepare = vi.fn(() => {
      throw new Error('health must not access D1');
    });
    const db = { prepare } as unknown as D1Database;

    const response = await app.request('/api/health', {}, env(db));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      timestamp,
      environment: 'test',
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});
