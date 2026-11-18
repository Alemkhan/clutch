/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerSettingsResponse } from '@clutch/shared';
import app from '../apps/api/src/index';
import { playerLocale } from '../apps/api/src/settings/settings';
import { createTestD1, type TestD1 } from './helpers/testD1';

const secret = 'test-session-signing-secret-at-least-32-characters';
const databases: TestD1[] = [];
const allow: RateLimit = { limit: async () => ({ success: true }) };
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close(); });

function guest(label: string) {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = '8';
  const sub = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const signed = `v1.${Buffer.from(JSON.stringify({ v: 1, sub, iat: now - 1, exp: now + 3600 })).toString('base64url')}`;
  return { authorization: `Bearer ${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`, playerId: `guest:${sub}` };
}

function call(db: TestD1, method: 'GET' | 'PUT', headers: Record<string, string>, body?: unknown) {
  return app.request('/api/settings', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: db.binding, API_RATE_LIMITER: allow, TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp' });
}

describe('player settings', () => {
  it('remembers the client language and starts with the automatic zone', async () => {
    const db = createTestD1(); databases.push(db);
    const player = guest('settings');
    const response = await call(db, 'GET', { authorization: player.authorization, 'X-Clutch-Locale': 'kk' });
    expect(response.status).toBe(200);
    expect(await response.json() as PlayerSettingsResponse).toMatchObject({ locale: 'kk', region: 'world', regionSource: 'auto' });
    expect(await playerLocale(db.binding, player.playerId)).toBe('kk');
  });

  it('lets the player pick a zone and go back to automatic', async () => {
    const db = createTestD1(); databases.push(db);
    const player = guest('zone');
    const picked = await call(db, 'PUT', { authorization: player.authorization }, { region: 'kz' });
    expect(await picked.json() as PlayerSettingsResponse).toMatchObject({ region: 'kz', regionSource: 'manual' });
    const again = await call(db, 'GET', { authorization: player.authorization });
    expect(await again.json() as PlayerSettingsResponse).toMatchObject({ region: 'kz', regionSource: 'manual' });
    const auto = await call(db, 'PUT', { authorization: player.authorization }, { region: 'auto' });
    expect(await auto.json() as PlayerSettingsResponse).toMatchObject({ region: 'world', regionSource: 'auto' });
    expect((await call(db, 'PUT', { authorization: player.authorization }, { region: 'mars' })).status).toBe(400);
  });
});
