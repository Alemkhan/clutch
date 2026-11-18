/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DAILY_RULES_VERSION, type ClanMeResponse } from '@clutch/shared';
import app from '../apps/api/src/index';
import { buildClanCardSvg, emojiDataUri, twemojiName } from '../apps/api/src/clans/clanShare';
import { preparedClanMessageFor } from '../apps/api/src/share/prepared';
import { createSvgRenderer } from '../apps/api/src/share/renderCard';
import { createTestD1, type TestD1 } from './helpers/testD1';

const require = createRequire(import.meta.url);
const render = createSvgRenderer(async () => readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const secret = 'test-session-signing-secret-at-least-32-characters';
const allow: RateLimit = { limit: async () => ({ success: true }) };
const databases: TestD1[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close(); });

// Маленький «эмодзи» вместо похода в CDN: жёлтый круг.
const FAKE_EMOJI = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="18" fill="#FFCC4D"/></svg>').toString('base64')}`;

function guest(label: string) {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = '8';
  const sub = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const signed = `v1.${Buffer.from(JSON.stringify({ v: 1, sub, iat: now - 1, exp: now + 3600 })).toString('base64url')}`;
  return { authorization: `Bearer ${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`, playerId: `guest:${sub}` };
}

const env = (db: TestD1) => ({ DB: db.binding, API_RATE_LIMITER: allow, TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp' });

async function clanWithCode(db: TestD1): Promise<string> {
  const founder = guest('share-founder');
  db.sqlite.prepare(`INSERT INTO match_runs (id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, reached_target)
    VALUES ('r1', ?, 'Аня', 'general', '[]', '[]', 60, 0, 'completed', ?, ?, ?, 0)`)
    .run(founder.playerId, Date.now(), Date.now() + 1, DAILY_RULES_VERSION);
  const response = await app.request('/api/clans', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: founder.authorization }, body: JSON.stringify({ emoji: '🦆' }),
  }, env(db));
  const me = await response.json() as ClanMeResponse;
  return new URL(me.clan!.inviteLink!).searchParams.get('startapp')!.replace('cl_', '');
}

describe('clan invite card', () => {
  it('names Twemoji files the way the set does', () => {
    expect(twemojiName('🦆')).toBe('1f986');
    expect(twemojiName('❤️')).toBe('2764');
    expect(twemojiName('🏳️‍🌈')).toBe('1f3f3-fe0f-200d-1f308');
    expect(twemojiName('🇰🇿')).toBe('1f1f0-1f1ff');
  });

  it('falls back to no picture when the emoji CDN fails', async () => {
    expect(await emojiDataUri('🦆', async () => new Response('nope', { status: 500 }))).toBeNull();
    expect(await emojiDataUri('🦆', async () => { throw new Error('offline'); })).toBeNull();
    const ok = await emojiDataUri('🦆', async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(ok).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it.each(['ru', 'en', 'kk'] as const)('renders a 1200x630 PNG with the emoji picture (%s)', async (locale) => {
    const svg = buildClanCardSvg({ emojiImage: FAKE_EMOJI, inviterName: 'Аня <b>', members: 12, rank: 3, locale });
    expect(svg).toContain('&lt;b&gt;');
    const png = await render(svg);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    if (process.env.SHARE_CARD_DUMP) writeFileSync(`${process.env.SHARE_CARD_DUMP}/clan-${locale}.png`, png);
    // Без картинки эмодзи карточка тоже собирается.
    expect((await render(buildClanCardSvg({ emojiImage: null, inviterName: 'Аня', members: 1, rank: null, locale }))).length).toBeGreaterThan(1000);
  });

  it('serves a preview page that leads into the invite', async () => {
    const db = createTestD1(); databases.push(db);
    const code = await clanWithCode(db);
    const page = await app.request(`/api/share/clan?c=${code}&v=1&l=ru`, {}, env(db));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Тебя заражают 🦆!');
    expect(html).toContain(`startapp=cl_${code}`);
    expect(html).toContain('/api/share/clan.png?c=');
    expect((await app.request('/api/share/clan?c=AAAAAAAAAA', {}, env(db))).status).toBe(404);
    expect((await app.request('/api/share/clan?c=bad', {}, env(db))).status).toBe(404);
  });

  it('prepares a Telegram message with a join button', async () => {
    const db = createTestD1(); databases.push(db);
    const code = await clanWithCode(db);
    const message = await preparedClanMessageFor(`https://x.example/api/share/clan?c=${code}&v=1&l=en&evil=1`, 'https://api.example', env(db) as never);
    expect(message).toMatchObject({
      title: "You're being infected with 🦆!",
      button: 'Join',
      target: `https://t.me/testbot?startapp=cl_${code}`,
      previewUrl: `https://api.example/api/share/clan?c=${code}&v=1&l=en`,
    });
    expect(message?.text).toContain('1 member');
    expect(await preparedClanMessageFor('https://x.example/api/share/run?t=P', 'https://api.example', env(db) as never)).toBeNull();
  });
});
