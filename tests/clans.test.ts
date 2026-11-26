/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_RULES_VERSION,
  type ClanBoardResponse,
  type ClanCheckResponse,
  type ClanDetailResponse,
  type ClanMeResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { deletePlayerAccount } from '../apps/api/src/account/deleteAccount';
import { createTestD1, type TestD1 } from './helpers/testD1';

const secret = 'test-session-signing-secret-at-least-32-characters';
const databases: TestD1[] = [];
const allow: RateLimit = { limit: async () => ({ success: true }) };
afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.sqlite.close();
});

function database(): TestD1 {
  const db = createTestD1();
  databases.push(db);
  return db;
}

function guest(label: string) {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = '8';
  const sub = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const signed = `v1.${Buffer.from(JSON.stringify({ v: 1, sub, iat: now - 1, exp: now + 3600 })).toString('base64url')}`;
  return { authorization: `Bearer ${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`, playerId: `guest:${sub}` };
}

let runCounter = 0;
function dailyRun(db: TestD1, playerId: string, input: { progress?: number; reached?: boolean; score?: number; at?: number; name?: string } = {}) {
  runCounter += 1;
  const reached = input.reached ?? false;
  const at = input.at ?? Date.now();
  db.sqlite.prepare(`INSERT INTO match_runs (id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, reached_target, solo_score)
    VALUES (?, ?, ?, 'general', '[]', '[]', ?, 0, 'completed', ?, ?, ?, ?, ?)`)
    .run(`run-${runCounter}`, playerId, input.name ?? 'Игрок', reached ? 100 : input.progress ?? 50, at, at + 1,
      DAILY_RULES_VERSION, reached ? 1 : 0, reached ? input.score ?? 1 : null);
}

/** Вики-путь дня: пройденный за `clicks` переходов или сданный. Маршруты дней есть в миграциях. */
function wikiRun(db: TestD1, playerId: string, dateKey: string, input: { clicks: number; gaveUp?: boolean }) {
  runCounter += 1;
  const at = Date.now();
  db.sqlite.prepare(`INSERT INTO wiki_path_runs (id, player_id, display_name, challenge_id, date_key, status, clicks,
      current_page_id, current_revision_id, current_title, path_json, completed_at, created_at, gave_up_at)
    VALUES (?, ?, 'Игрок', ?, ?, ?, ?, 1, 1, 'Статья', '[]', ?, ?, ?)`)
    .run(`wiki-run-${runCounter}`, playerId, `wiki-${dateKey}`, dateKey, input.gaveUp ? 'in_progress' : 'completed', input.clicks,
      input.gaveUp ? null : at, at, input.gaveUp ? at : null);
}

function call(db: TestD1, method: 'GET' | 'POST', path: string, authorization: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: db.binding, API_RATE_LIMITER: allow, TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp' });
}

async function found(db: TestD1, player: ReturnType<typeof guest>, emoji: string) {
  const response = await call(db, 'POST', '/api/clans', player.authorization, { emoji });
  return { status: response.status, body: await response.json() as ClanMeResponse & { reason?: string } };
}

function inviteCode(me: ClanMeResponse): string {
  const link = new URL(me.clan!.inviteLink!);
  return link.searchParams.get('startapp')!;
}

describe('emoji clans', () => {
  it('needs a finished run before an emoji can be claimed', async () => {
    const db = database();
    const player = guest('newbie');
    const me = await call(db, 'GET', '/api/clans/me', player.authorization);
    expect(await me.json()).toEqual({ clan: null, canFound: false });
    expect((await found(db, player, '🦆')).status).toBe(403);
    dailyRun(db, player.playerId);
    expect((await call(db, 'GET', '/api/clans/me', player.authorization).then((r) => r.json()) as ClanMeResponse).canFound).toBe(true);
  });

  it('gives every emoji to the first player only', async () => {
    const db = database();
    const first = guest('first');
    const second = guest('second');
    dailyRun(db, first.playerId, { name: 'Аня' });
    dailyRun(db, second.playerId);
    const claimed = await found(db, first, '🦆');
    expect(claimed.status).toBe(201);
    expect(claimed.body.clan).toMatchObject({ emoji: '🦆', slug: '1f986', members: 1, isFounder: true, founderName: 'Аня' });
    expect(claimed.body.clan?.inviteLink).toMatch(/startapp=cl_[A-Za-z0-9]{10}$/);

    const taken = await found(db, second, '🦆');
    expect(taken).toMatchObject({ status: 409, body: { reason: 'taken' } });
    const check = await call(db, 'GET', `/api/clans/check?emoji=${encodeURIComponent('🦆')}`, second.authorization);
    expect(await check.json() as ClanCheckResponse).toMatchObject({ available: false, members: 1 });
    // Один игрок - один клан навсегда.
    expect((await found(db, first, '🐸')).body.reason).toBe('already_member');
  });

  it('treats skin tones as one clan', async () => {
    const db = database();
    const a = guest('tone-a');
    const b = guest('tone-b');
    dailyRun(db, a.playerId);
    dailyRun(db, b.playerId);
    expect((await found(db, a, '👍🏻')).body.clan?.emoji).toBe('👍');
    expect((await found(db, b, '👍🏿')).body.reason).toBe('taken');
    expect((await call(db, 'POST', '/api/clans', b.authorization, { emoji: 'ab' })).status).toBe(400);
  });

  it('infects friends through the invite link and keeps them forever', async () => {
    const db = database();
    const founder = guest('founder');
    const friend = guest('friend');
    const friendOfFriend = guest('fof');
    dailyRun(db, founder.playerId, { name: 'Основатель' });
    const code = inviteCode((await found(db, founder, '🦆')).body);

    // Вступить можно и без забега: ссылка друга - это и есть приглашение.
    const joined = await call(db, 'POST', '/api/clans/join', friend.authorization, { code });
    const joinedBody = await joined.json() as { status: string; me: ClanMeResponse };
    expect(joinedBody.status).toBe('joined');
    expect(joinedBody.me.clan).toMatchObject({ emoji: '🦆', members: 2, isFounder: false, invitedByName: 'Основатель' });

    const second = await call(db, 'POST', '/api/clans/join', friendOfFriend.authorization, { code: inviteCode(joinedBody.me) });
    expect((await second.json() as { status: string }).status).toBe('joined');

    // Уже в клане - остаётся в своём.
    dailyRun(db, friendOfFriend.playerId);
    const other = guest('other-founder');
    dailyRun(db, other.playerId);
    const otherCode = inviteCode((await found(db, other, '🐸')).body);
    const again = await call(db, 'POST', '/api/clans/join', friend.authorization, { code: otherCode });
    expect(await again.json()).toMatchObject({ status: 'already', me: { clan: { emoji: '🦆' } } });

    const detail = await call(db, 'GET', '/api/clans/1f986', founder.authorization).then((r) => r.json()) as ClanDetailResponse;
    expect(detail.members).toBe(3);
    const [root, child, grandchild] = detail.memberList;
    expect(root).toMatchObject({ isFounder: true, isOriginalFounder: true, parentId: null, infected: 1, isYou: true });
    expect(child).toMatchObject({ parentId: root.id, infected: 1 });
    expect(grandchild).toMatchObject({ parentId: child.id, infected: 0 });
    expect((await call(db, 'POST', '/api/clans/join', friend.authorization, { code: 'cl_nope' })).status).toBe(400);
    expect((await call(db, 'POST', '/api/clans/join', friend.authorization, { code: 'cl_AAAAAAAAAA' })).status).toBe(404);
  });

  it('scores the week by the best ten members, counting runs from the joining day on', async () => {
    const db = database();
    const big = guest('big');
    const small = guest('small');
    // Забеги до суток вступления не в зачёте.
    dailyRun(db, big.playerId, { at: Date.now() - 10 * 24 * 60 * 60 * 1000, progress: 90 });
    dailyRun(db, small.playerId, { at: Date.now() - 10 * 24 * 60 * 60 * 1000, progress: 90 });
    const bigCode = inviteCode((await found(db, big, '🐘')).body);
    await found(db, small, '🐜');
    // Слон: четыре участника по 40 очков. Муравей: один, два финиша по 200 за одни сутки - в зачёт один.
    for (let index = 0; index < 3; index += 1) {
      const member = guest(`elephant-${index}`);
      await call(db, 'POST', '/api/clans/join', member.authorization, { code: bigCode });
      dailyRun(db, member.playerId, { progress: 40 });
    }
    dailyRun(db, big.playerId, { progress: 40 });
    dailyRun(db, small.playerId, { reached: true, score: 0.5 });
    dailyRun(db, small.playerId, { reached: true, score: 0.5, at: Date.now() + 1000 });

    const board = await call(db, 'GET', '/api/clans/board', small.authorization).then((r) => r.json()) as ClanBoardResponse;
    expect(board.entries.map((entry) => [entry.emoji, entry.score, entry.members])).toEqual([
      ['🐜', 20, 1],
      ['🐘', 16, 4],
    ]);
    expect(board.you).toMatchObject({ emoji: '🐜', rank: 1 });
    const me = await call(db, 'GET', '/api/clans/me', small.authorization).then((r) => r.json()) as ClanMeResponse;
    expect(me.clan).toMatchObject({ youWeekPoints: 200, week: { score: 20, rank: 1 } });
  });

  it('adds a finished Wiki Path to the week from 2026-11-30, a given-up one earns nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-30T05:00:00Z')); // 10:00 по Алматы, понедельник
    const db = database();
    const owl = guest('owl');
    dailyRun(db, owl.playerId, { progress: 40 });
    const code = inviteCode((await found(db, owl, '🦉')).body);
    const mate = guest('owl-mate');
    await call(db, 'POST', '/api/clans/join', mate.authorization, { code });
    wikiRun(db, owl.playerId, '2026-11-30', { clicks: 2 });
    wikiRun(db, mate.playerId, '2026-11-30', { clicks: 4, gaveUp: true });

    vi.setSystemTime(Date.parse('2026-12-01T05:00:00Z'));
    wikiRun(db, owl.playerId, '2026-12-01', { clicks: 5 });
    wikiRun(db, mate.playerId, '2026-12-01', { clicks: 9 });
    const owlNow = guest('owl');
    // Сова: забег 40 + путь за 2 перехода 80 + за 5 переходов 60. Напарник: сдался (0) + 9 переходов (30).
    const me = await call(db, 'GET', '/api/clans/me', owlNow.authorization).then((r) => r.json()) as ClanMeResponse;
    expect(me.clan).toMatchObject({ youWeekPoints: 180, week: { score: 21 } });
    const board = await call(db, 'GET', '/api/clans/board', owlNow.authorization).then((r) => r.json()) as ClanBoardResponse;
    expect(board.entries.map((entry) => [entry.emoji, entry.score])).toEqual([['🦉', 21]]);
  });

  it('hands the clan to the most active member when the founder is gone for a month', async () => {
    const db = database();
    const founder = guest('sleepy');
    const lazy = guest('lazy');
    const active = guest('active');
    dailyRun(db, founder.playerId);
    const code = inviteCode((await found(db, founder, '🦉')).body);
    await call(db, 'POST', '/api/clans/join', lazy.authorization, { code });
    await call(db, 'POST', '/api/clans/join', active.authorization, { code });
    dailyRun(db, lazy.playerId, { progress: 10 });
    dailyRun(db, active.playerId, { reached: true });
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    db.sqlite.prepare('UPDATE clan_members SET joined_at = ? WHERE player_id = ?').run(old, founder.playerId);
    db.sqlite.prepare('UPDATE match_runs SET created_at = ? WHERE player_id = ?').run(old, founder.playerId);

    const detail = await call(db, 'GET', '/api/clans/1f989', founder.authorization).then((r) => r.json()) as ClanDetailResponse;
    const byName = detail.memberList.find((member) => member.isFounder)!;
    expect(byName.isYou).toBe(false);
    expect(detail.memberList.find((member) => member.isOriginalFounder)?.isYou).toBe(true);
    const activeMe = await call(db, 'GET', '/api/clans/me', active.authorization).then((r) => r.json()) as ClanMeResponse;
    expect(activeMe.clan?.isFounder).toBe(true);
  });

  it('frees the emoji when the last member deletes the account and re-links invitees', async () => {
    const db = database();
    const founder = guest('leaver');
    const friend = guest('stayer');
    const invitee = guest('invitee');
    dailyRun(db, founder.playerId);
    const code = inviteCode((await found(db, founder, '🦊')).body);
    const friendMe = (await call(db, 'POST', '/api/clans/join', friend.authorization, { code }).then((r) => r.json()) as { me: ClanMeResponse }).me;
    await call(db, 'POST', '/api/clans/join', invitee.authorization, { code: inviteCode(friendMe) });

    await deletePlayerAccount(db.binding, friend.playerId);
    const detail = await call(db, 'GET', '/api/clans/1f98a', founder.authorization).then((r) => r.json()) as ClanDetailResponse;
    expect(detail.members).toBe(2);
    expect(detail.memberList[1].parentId).toBe(detail.memberList[0].id);

    await deletePlayerAccount(db.binding, founder.playerId);
    const inviteeMe = await call(db, 'GET', '/api/clans/me', invitee.authorization).then((r) => r.json()) as ClanMeResponse;
    expect(inviteeMe.clan?.isFounder).toBe(true);
    await deletePlayerAccount(db.binding, invitee.playerId);
    const other = guest('next');
    dailyRun(db, other.playerId);
    expect((await found(db, other, '🦊')).status).toBe(201);
  });
});

describe('clans launch gate', () => {
  it('keeps clans closed in production until the launch day', async () => {
    const db = database();
    const player = guest('early');
    dailyRun(db, player.playerId);
    const prod = (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: player.authorization },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { DB: db.binding, API_RATE_LIMITER: allow, TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: secret, ENVIRONMENT: 'production', TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp' });
    const { clansActive } = await import('@clutch/shared');
    if (clansActive(Date.now())) return; // после запуска проверять нечего
    expect(await (await prod('/api/clans/me')).json()).toEqual({ clan: null, canFound: false });
    expect((await prod('/api/clans', 'POST', { emoji: '🦆' })).status).toBe(404);
    expect((await prod('/api/clans/board')).status).toBe(404);
    expect((await prod('/api/clans/join', 'POST', { code: 'AAAAAAAAAA' })).status).toBe(404);
    expect((await prod('/api/share/clan?c=AAAAAAAAAA')).status).toBe(404);
  });
});
