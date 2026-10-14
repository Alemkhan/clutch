/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_SOLO_RUN_CONDITIONS, FRIEND_RULES_VERSION, PRACTICE_RULES_VERSION, type SoloProfileResponse } from '@clutch/shared';
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

function insertRun(db: TestD1, input: {
  id: string;
  playerId: string;
  rulesVersion?: string;
  rounds?: number;
  reachedTarget?: boolean;
  completed?: boolean;
}) {
  const completed = input.completed ?? true;
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, reached_target
    ) VALUES (?, ?, 'Игрок', 'general', '[]', ?, ?, 0, ?, 1, ?, ?, ?)
  `).run(
    input.id,
    input.playerId,
    completed ? JSON.stringify(Array.from({ length: input.rounds ?? 0 }, () => ({}))) : null,
    input.reachedTarget ? 100 : 40,
    completed ? 'completed' : 'in_progress',
    completed ? 2 : null,
    input.rulesVersion ?? CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
    completed ? (input.reachedTarget ? 1 : 0) : null,
  );
}

function request(db: TestD1, authorization?: string) {
  return app.request('/api/profile', {
    headers: authorization ? { authorization } : undefined,
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

describe('solo profile route', () => {
  it('requires a verified current player', async () => {
    expect((await request(database())).status).toBe(401);
  });

  it('returns an honest empty server summary', async () => {
    const db = database();
    const player = guest('empty');
    const response = await request(db, player.authorization);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completedRuns: 0, reachedTargetRuns: 0, bestRounds: null });
  });

  it('aggregates only completed current-rule ranked solo runs owned by the player', async () => {
    const db = database();
    const player = guest('owner');
    insertRun(db, { id: 'six', playerId: player.playerId, rounds: 6, reachedTarget: true });
    insertRun(db, { id: 'four', playerId: player.playerId, rounds: 4, reachedTarget: true });
    insertRun(db, { id: 'miss', playerId: player.playerId, rounds: 20, reachedTarget: false });
    insertRun(db, { id: 'active', playerId: player.playerId, completed: false });
    insertRun(db, { id: 'practice', playerId: player.playerId, rulesVersion: PRACTICE_RULES_VERSION, rounds: 3, reachedTarget: true });
    insertRun(db, { id: 'friend', playerId: player.playerId, rulesVersion: FRIEND_RULES_VERSION, rounds: 3, reachedTarget: true });
    insertRun(db, { id: 'legacy', playerId: player.playerId, rulesVersion: 'race-to-100-v3', rounds: 2, reachedTarget: true });
    insertRun(db, { id: 'other', playerId: guest('other').playerId, rounds: 2, reachedTarget: true });

    const response = await request(db, player.authorization);
    expect(response.status).toBe(200);
    expect(await response.json() as SoloProfileResponse).toEqual({
      completedRuns: 3,
      reachedTargetRuns: 2,
      bestRounds: 4,
    });
  });
});
