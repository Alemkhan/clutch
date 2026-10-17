/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';
// @ts-expect-error — .mjs без деклараций типов
import { buildSqliteFromSql, pull, PullError, readDatabaseName } from '../scripts/reports-pull.mjs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof import('node:sqlite').DatabaseSync;
};

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const databases: TestD1[] = [];
const directories: string[] = [];
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'clutch-telemetry-'));
  directories.push(directory);
  return directory;
}

function guestAuthorization(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  const signature = createHmac('sha256', sessionSecret).update(signed).digest('base64url');
  return `Bearer ${signed}.${signature}`;
}

function postEvent(db: TestD1, authorization: string, body: unknown) {
  return app.request('/api/events', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

describe('funnel and error events on the API', () => {
  it('accepts the new allowlisted events', async () => {
    const db = createTestD1();
    databases.push(db);
    const authorization = guestAuthorization('funnel');
    for (const body of [
      { event: 'client_error', payload: { kind: 'render', message: 'x is undefined', screen: 'solo', build: 'abc' } },
      { event: 'app_opened', payload: { source: 'telegram', entry: 'direct' } },
      { event: 'result_shared', payload: { reached: false } },
      { event: 'friend_invite_shared' },
    ]) {
      expect((await postEvent(db, authorization, body)).status).toBe(202);
    }
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_events').get() as { count: number }).count).toBe(4);
  });

  it('still rejects extra payload keys and long strings', async () => {
    const db = createTestD1();
    databases.push(db);
    const authorization = guestAuthorization('client-error-bad');
    const five = await postEvent(db, authorization, {
      event: 'client_error', payload: { kind: 'error', message: 'm', screen: 's', build: 'b', extra: 1 },
    });
    expect(five.status).toBe(400);
    const long = await postEvent(db, authorization, {
      event: 'client_error', payload: { kind: 'error', message: 'm'.repeat(65) },
    });
    expect(long.status).toBe(400);
  });
});

const DAY = 86_400_000;
// 2026-10-01 12:00 UTC: внутри игровых суток 2026-10-01 при границе +5 ч.
const BASE = Date.UTC(2026, 9, 1, 12, 0, 0);

function insertRun(db: TestD1, id: string, player: string, createdAt: number, reached: boolean) {
  const columns = db.sqlite.prepare('PRAGMA table_info(match_runs)').all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
  const values: Record<string, unknown> = {
    id, player_id: player, display_name: 'p', category: 'general', questions_json: '[]', status: 'completed',
    created_at: createdAt, completed_at: createdAt, rules_version: 'solo-to-100-v2', reached_target: reached ? 1 : 0,
    question_set_id: 'qs', progress: reached ? 100 : 40,
  };
  const names = Object.keys(values).filter((name) => columns.some((column) => column.name === name));
  db.sqlite.prepare(`INSERT INTO match_runs (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((name) => values[name] as string | number));
}

function insertEvent(db: TestD1, player: string, event: string, at: number, payload?: object) {
  db.sqlite.prepare('INSERT INTO analytics_events (player_id, event, run_id, question_id, payload_json, created_at) VALUES (?, ?, NULL, NULL, ?, ?)')
    .run(player, event, payload ? JSON.stringify(payload) : null, at);
}

function fixtureDatabase(): string {
  const db = createTestD1();
  databases.push(db);
  // a: приходит в день 0 и день 1; b: только день 0; c: день 0 и день 7.
  insertRun(db, 'r1', 'a', BASE, true);
  insertRun(db, 'r2', 'a', BASE + DAY, false);
  insertRun(db, 'r3', 'b', BASE, false);
  insertRun(db, 'r4', 'c', BASE, false);
  insertRun(db, 'r5', 'c', BASE + 7 * DAY, false);
  for (const player of ['a', 'b', 'c']) insertEvent(db, player, 'app_opened', BASE, { source: 'browser', entry: 'direct' });
  insertEvent(db, 'a', 'solo_run_started', BASE);
  insertEvent(db, 'a', 'result_shared', BASE, { reached: true });
  insertEvent(db, 'a', 'client_error', BASE, { kind: 'error', message: 'boom', screen: 'home' });
  insertEvent(db, 'b', 'client_error', BASE, { kind: 'error', message: 'boom', screen: 'home' });
  const file = join(tempDirectory(), 'fixture.sqlite');
  const copy = new DatabaseSync(file);
  const schema = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all() as Array<{ sql: string }>;
  for (const item of schema) copy.exec(item.sql);
  for (const table of ['match_runs', 'analytics_events', 'question_reports', 'rematch_invites']) {
    const rows = db.sqlite.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const keys = Object.keys(row);
      copy.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
        .run(...keys.map((key) => row[key] as string | number | null));
    }
  }
  copy.close();
  return file;
}

function view(command: string, file: string, ...extra: string[]) {
  return viewAt(undefined, command, file, ...extra);
}

function viewAt(now: string | undefined, command: string, file: string, ...extra: string[]) {
  const env = { ...process.env, ...(now ? { TELEMETRY_NOW: now } : {}) };
  const result = spawnSync(process.execPath, ['scripts/telemetry-view.mjs', command, '--db', file, ...extra], { encoding: 'utf8', env });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('telemetry-view funnel, retention, errors', () => {
  it('counts distinct players per game day in the funnel', () => {
    const file = fixtureDatabase();
    const out = view('funnel', file, '--days', '36500');
    const line = out.split('\n').find((row) => row.startsWith('2026-10-01')) ?? '';
    expect(line.split(/\s{2,}/).slice(0, 7)).toEqual(['2026-10-01', '3', '1', '0', '1', '1', '0']);
  });

  it('computes D1 and D7 return per first-run cohort', () => {
    const file = fixtureDatabase();
    const out = view('retention', file);
    const line = out.split('\n').find((row) => row.startsWith('2026-10-01')) ?? '';
    expect(line.split(/\s{2,}/)).toEqual(['2026-10-01', '3', '1 (33%)', '1 (33%)']);
  });

  it('shows «идёт» for a return day that has not ended and «—» for one not yet reached', () => {
    const file = fixtureDatabase();
    // Сутки D1 (BASE + 1 день) ещё идут: игрок a уже вернулся; D7 не наступил.
    const out = viewAt(new Date(BASE + DAY + 3_600_000).toISOString(), 'retention', file);
    const line = out.split('\n').find((row) => row.startsWith('2026-10-01')) ?? '';
    expect(line.split(/\s{2,}/)).toEqual(['2026-10-01', '3', 'идёт, 1 (33%)', '—']);
    // В день первого забега до D1 ещё далеко: «—».
    const early = viewAt(new Date(BASE + 3_600_000).toISOString(), 'retention', file);
    expect(early.split('\n').find((row) => row.startsWith('2026-10-01'))?.split(/\s{2,}/)).toEqual(['2026-10-01', '3', '—', '—']);
  });

  it('groups client errors by message and counts players', () => {
    const file = fixtureDatabase();
    const out = view('errors', file, '--days', '36500');
    const line = out.split('\n').find((row) => row.includes('boom')) ?? '';
    expect(line.split(/\s{2,}/).slice(0, 5)).toEqual(['2', '2', 'error', 'home', 'boom']);
  });
});

describe('reports-pull', () => {
  it('builds a sqlite file from an exported SQL dump', () => {
    const directory = tempDirectory();
    const sql = join(directory, 'dump.sql');
    writeFileSync(sql, "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);\nINSERT INTO t (v) VALUES ('a'), ('b');\n");
    const target = join(directory, 'nested', 'out.sqlite');
    expect(buildSqliteFromSql(sql, target)).toContain('t');
    const db = new DatabaseSync(target, { readOnly: true });
    expect((db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(2);
    db.close();
  });

  it('reads the database name from jsonc and explains a missing config', () => {
    expect(readDatabaseName('{ // comment\n "d1_databases": [{ "database_name": "clutch-prod" }] }')).toBe('clutch-prod');
    expect(() => pull({ configPath: join(tempDirectory(), 'none.jsonc') })).toThrow(/preflight:production:write-config/);
    expect(PullError).toBeDefined();
  });

  it('calls the injected wrangler export and returns the built file', () => {
    const directory = tempDirectory();
    const config = join(directory, 'wrangler.jsonc');
    writeFileSync(config, '{"d1_databases":[{"database_name":"clutch-prod"}]}');
    const calls: string[] = [];
    const result = pull({
      configPath: config,
      outputDirectory: join(directory, 'data'),
      now: new Date('2026-10-17T00:00:00Z'),
      runExport: (name: string, _config: string, out: string) => {
        calls.push(name);
        writeFileSync(out, 'CREATE TABLE analytics_events (id INTEGER);');
      },
    });
    expect(calls).toEqual(['clutch-prod']);
    expect(result.endsWith('prod-2026-10-17.sqlite')).toBe(true);
    expect(existsSync(result)).toBe(true);
  });
});
