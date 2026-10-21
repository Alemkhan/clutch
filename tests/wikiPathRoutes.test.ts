/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHmac, createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
const databases: TestD1[] = [];
const NOON = new Date('2026-10-21T12:00:00Z');
const TODAY = '2026-10-21';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  // Route fixtures control the game day; seeded production challenges must not leak into them.
  result.sqlite.exec('DELETE FROM wiki_path_challenges');
  databases.push(result);
  return result;
}

function guest(label: string) {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return { authorization: `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`, playerId: `guest:${subject}` };
}

async function telegram(id: number) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: `Player ${id}` }) });
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test').digest();
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return { authorization: `tma ${fields.toString()}`, playerId: `telegram:${id}` };
}

function env(db: TestD1, limiter: RateLimit = allowRateLimiter) {
  return { DB: db.binding, API_RATE_LIMITER: limiter, TELEGRAM_BOT_TOKEN: 'test', SESSION_SIGNING_SECRET: sessionSecret, ENVIRONMENT: 'test' };
}

function addChallenge(db: TestD1, start = 'Start', target = 'Goal') {
  db.sqlite.prepare('INSERT INTO wiki_path_challenges (id, date_key, start_title, target_title, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`fixture-${TODAY}`, TODAY, start, target, 1);
}

interface MockPage { pageid: number; revid: number; title: string; text?: string; links?: Array<{ ns: number; title: string }> }
function mockWiki(pages: Record<string, MockPage>) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const query = new URL(request.url).searchParams;
    const requested = query.get('page') ?? '';
    const oldId = Number(query.get('oldid'));
    const page = requested
      ? pages[requested]
      : Object.values(pages).find((candidate) => candidate.revid === oldId);
    if (!page) return Response.json({ error: { code: 'missingtitle' } }, { status: 200 });
    return Response.json({ parse: { pageid: page.pageid, revid: page.revid, title: page.title, text: page.text ?? `<p>${page.title}</p>`, links: page.links ?? [] } });
  }));
  return requests;
}

async function json(response: Response) { return await response.json() as Record<string, any>; }

describe('Wiki Path daily API', () => {
  it('requires identity and returns null challenge when there is no challenge today', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('wiki_path_page_revisions') WHERE name = 'html'").get())
      .toEqual({ count: 0 });
    expect((await app.request('/api/wiki-path/today', {}, env(db))).status).toBe(401);
    const response = await app.request('/api/wiki-path/today', { headers: { authorization: guest('no-challenge').authorization } }, env(db));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ challenge: null, run: null });
  });

  it('starts once, resumes from the immutable snapshot, validates edges and safely replays a click', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db);
    const requests = mockWiki({
      Start: { pageid: 1, revid: 11, title: 'Start', links: [{ ns: 0, title: 'Middle' }, { ns: 1, title: 'Not article' }] },
      Goal: { pageid: 3, revid: 33, title: 'Goal' },
      Middle: { pageid: 2, revid: 22, title: 'Middle', links: [{ ns: 0, title: 'Goal' }] },
    });
    const player = guest('resume');
    const startedResponse = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    expect(startedResponse.status).toBe(201);
    const started = await json(startedResponse);
    expect(started.challenge).toMatchObject({ id: `fixture-${TODAY}`, date: TODAY, startTitle: 'Start', targetTitle: 'Goal' });
    expect(started.run).toMatchObject({ status: 'in_progress', clicks: 0, path: ['1'], completedAt: null });
    expect(started.currentPage).toMatchObject({ pageId: '1', revisionId: '11' });
    expect(started.currentPage.allowedLinks).toEqual([{ title: 'Middle' }]);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get('User-Agent')).toContain('ClutchWikiPath/1.0');
      expect(request.headers.get('Api-User-Agent')).toContain('ClutchWikiPath/1.0');
    }

    const invalid = await app.request(`/api/wiki-path/runs/${started.run.runId}/click`, {
      method: 'POST', headers: { authorization: player.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Goal' }),
    }, env(db));
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({ reason: 'invalid_edge' });

    const clickUrl = `/api/wiki-path/runs/${started.run.runId}/click`;
    const clickInit = { method: 'POST', headers: { authorization: player.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Middle' }) };
    const clicked = await app.request(clickUrl, clickInit, env(db));
    expect(clicked.status).toBe(200);
    expect(await json(clicked)).toMatchObject({ run: { clicks: 1, path: ['1', '2'] }, currentPage: { title: 'Middle' } });
    const replay = await app.request(clickUrl, clickInit, env(db));
    expect(replay.status).toBe(200);
    expect(await json(replay)).toMatchObject({ run: { clicks: 1, path: ['1', '2'] }, currentPage: { title: 'Middle' } });
    expect(db.sqlite.prepare('SELECT clicks FROM wiki_path_runs').get()).toEqual({ clicks: 1 });
    const resume = await app.request(`/api/wiki-path/runs/${started.run.runId}`, { headers: { authorization: player.authorization } }, env(db));
    expect(await json(resume)).toMatchObject({ run: { clicks: 1 }, currentPage: { title: 'Middle' } });
  });

  it('recognizes a canonical redirect as the goal and ranks Telegram players with shared places', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db, 'Start', 'Goal alias');
    mockWiki({
      Start: { pageid: 1, revid: 11, title: 'Start', links: [{ ns: 0, title: 'Goal alias' }] },
      'Goal alias': { pageid: 9, revid: 90, title: 'Canonical Goal' },
    });
    const a = await telegram(1001);
    const b = await telegram(1002);
    const c = await telegram(1003);
    for (const [player, clicks, completedAt] of [[a, 2, 30], [b, 2, 20], [c, 4, 10]] as const) {
      db.sqlite.prepare(`INSERT INTO wiki_path_runs
        (id, player_id, display_name, challenge_id, date_key, status, clicks, current_page_id, current_revision_id, current_title, path_json, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'completed', ?, 9, 90, 'Canonical Goal', '["1","9"]', ?, 1)`)
        .run(`run-${player.playerId}`, player.playerId, player.playerId, `fixture-${TODAY}`, TODAY, clicks, completedAt);
    }
    const player = guest('redirect');
    const start = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    const started = await json(start);
    const click = await app.request(`/api/wiki-path/runs/${started.run.runId}/click`, {
      method: 'POST', headers: { authorization: player.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Goal alias' }),
    }, env(db));
    expect(await json(click)).toMatchObject({ run: { status: 'completed', clicks: 1 }, currentPage: { pageId: '9', title: 'Canonical Goal' } });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_path_runs WHERE status = \'completed\'').get()).toEqual({ count: 4 });

    const board = await app.request(`/api/wiki-path/board?date=${TODAY}`, { headers: { authorization: a.authorization } }, env(db));
    expect(board.status).toBe(200);
    expect(await json(board)).toMatchObject({
      challengeId: `fixture-${TODAY}`,
      entries: [{ rank: 1, playerId: b.playerId, clicks: 2 }, { rank: 1, playerId: a.playerId, clicks: 2 }, { rank: 3, playerId: c.playerId, clicks: 4 }],
      ownRank: 1,
    });
    const guestBoard = await app.request(`/api/wiki-path/board?date=${TODAY}`, { headers: { authorization: player.authorization } }, env(db));
    expect(guestBoard.status).toBe(200);
    const guestBoardBody = await json(guestBoard);
    expect(guestBoardBody.ownRank).toBeNull();
    expect(guestBoardBody.entries.map((entry: { playerId: string }) => entry.playerId))
      .toEqual([b.playerId, a.playerId, c.playerId]);
  });

  it('maps Wikimedia failures to gateway and timeout statuses', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'upstream' }, { status: 503 })));
    const player = guest('error');
    const unavailable = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    expect(unavailable.status).toBe(502);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    const timeout = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    expect(timeout.status).toBe(504);
  });
});
