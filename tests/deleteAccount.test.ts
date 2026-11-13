/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../apps/api/src/index';
import { DELETED_PLAYER_NAME } from '../apps/api/src/account/deleteAccount';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
const databases: TestD1[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const db = createTestD1();
  databases.push(db);
  return db;
}

function env(db: TestD1) {
  return { DB: db.binding, API_RATE_LIMITER: allowRateLimiter, TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: sessionSecret, ENVIRONMENT: 'test' };
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

function insertRun(db: TestD1, id: string, playerId: string, name: string, opponent?: { runId: string; name: string }) {
  db.sqlite.prepare(`INSERT INTO match_runs (id, player_id, display_name, category, questions_json, status, created_at,
    opponent_run_id, opponent_json) VALUES (?, ?, ?, 'general', '[]', 'completed', 1, ?, ?)`)
    .run(id, playerId, name, opponent?.runId ?? null, opponent ? JSON.stringify({ id: opponent.runId, displayName: opponent.name, rounds: [] }) : null);
}

function deleteRequest(authorization: string, body: unknown = { confirm: 'delete' }) {
  return { method: 'DELETE', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('account deletion', () => {
  it('deletes personal data and anonymizes runs other players depend on', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const db = database();
    const me = guest('me');
    const rival = guest('rival');
    insertRun(db, 'my-run', me.playerId, 'Мирас');
    insertRun(db, 'rival-run', rival.playerId, 'Нур', { runId: 'my-run', name: 'Мирас' });
    db.sqlite.prepare(`INSERT INTO player_notification_prefs (player_id, outbid_enabled, daily_enabled, updated_at) VALUES (?, 1, 1, 1)`).run(me.playerId);
    db.sqlite.prepare(`INSERT INTO player_notification_prefs (player_id, outbid_enabled, daily_enabled, updated_at) VALUES (?, 1, 1, 1)`).run(rival.playerId);

    const response = await app.request('/api/account', deleteRequest(me.authorization), env(db));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });

    const all = (sql: string, ...args: string[]) => db.sqlite.prepare(sql).all(...args);
    expect(all('SELECT * FROM match_runs WHERE player_id = ?', me.playerId)).toEqual([]);
    expect(all('SELECT * FROM player_notification_prefs WHERE player_id = ?', me.playerId)).toEqual([]);
    const mine = db.sqlite.prepare("SELECT player_id, display_name FROM match_runs WHERE id = 'my-run'").get() as Record<string, string>;
    expect(mine.player_id).toMatch(/^deleted:[0-9a-f-]{36}$/);
    expect(mine.display_name).toBe(DELETED_PLAYER_NAME);
    const rivals = db.sqlite.prepare("SELECT player_id, display_name, opponent_json FROM match_runs WHERE id = 'rival-run'").get() as Record<string, string>;
    expect(rivals.player_id).toBe(rival.playerId);
    expect(rivals.display_name).toBe('Нур');
    expect(JSON.parse(rivals.opponent_json).displayName).toBe(DELETED_PLAYER_NAME);
    expect(all('SELECT * FROM player_notification_prefs WHERE player_id = ?', rival.playerId)).toHaveLength(1);
  });

  it('covers every table that stores a player id', () => {
    const db = database();
    // Новая таблица с player_id должна попасть в deletePlayerAccount — иначе удаление аккаунта неполное.
    const covered = new Set([
      'player_mistakes', 'player_notification_prefs', 'question_reports', 'analytics_events', 'tiebreaker_answers',
      'top_ten_notices', 'daily_notification_deliveries', 'announcement_deliveries', 'wiki_path_runs',
      'match_runs', 'last_stand_runs', 'group_challenge_entries', 'group_challenges', 'rematch_invites',
    ]);
    const tables = (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .filter(({ name }) => (db.sqlite.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>)
        .some((column) => /player_id$/.test(column.name)))
      .map(({ name }) => name);
    expect(tables.filter((name) => !covered.has(name))).toEqual([]);
  });

  it('requires authentication and an explicit confirmation', async () => {
    const db = database();
    const me = guest('me');
    insertRun(db, 'my-run', me.playerId, 'Мирас');
    expect((await app.request('/api/account', { method: 'DELETE' }, env(db))).status).toBe(401);
    expect((await app.request('/api/account', deleteRequest(me.authorization, {}), env(db))).status).toBe(400);
    expect(db.sqlite.prepare('SELECT player_id FROM match_runs').get()).toEqual({ player_id: me.playerId });
  });
});
