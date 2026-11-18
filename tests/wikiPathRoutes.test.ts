/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHmac, createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WIKI_PATH_HTML_MAX_LENGTH } from '@clutch/shared';
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

function addChallenge(db: TestD1, start = 'Start', target = 'Goal', lang: 'ru' | 'en' | 'kk' = 'ru') {
  const id = challengeId(lang);
  db.sqlite.prepare('INSERT INTO wiki_path_challenges (id, date_key, lang, start_title, target_title, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, TODAY, lang, start, target, 1);
  return id;
}

function challengeId(lang: 'ru' | 'en' | 'kk' = 'ru') {
  return lang === 'ru' ? `fixture-${TODAY}` : `fixture-${TODAY}-${lang}`;
}

interface MockPage { pageid: number; revid: number; title: string; text?: string; links?: Array<{ ns: number; title: string }> }
/** Serves `pages` from any Wikipedia, or `perLang[lang]` for the matching {lang}.wikipedia.org host. */
function mockWiki(pages: Record<string, MockPage>, perLang?: Record<string, Record<string, MockPage>>) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    const query = url.searchParams;
    const source = perLang ? perLang[url.hostname.split('.')[0]!] ?? {} : pages;
    const requested = query.get('page') ?? '';
    const oldId = Number(query.get('oldid'));
    const page = requested
      ? source[requested]
      : Object.values(source).find((candidate) => candidate.revid === oldId);
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
      expect(new URL(request.url).origin).toBe('https://ru.wikipedia.org');
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

  it('accepts a large Wikipedia article and caps only the HTML sent to the client', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db, 'Россия', 'Goal');
    const largeHtml = `<p>${'x'.repeat(WIKI_PATH_HTML_MAX_LENGTH + 25_000)}</p>`;
    mockWiki({
      'Россия': { pageid: 9, revid: 99, title: 'Россия', text: largeHtml, links: [{ ns: 0, title: 'Goal' }] },
      Goal: { pageid: 3, revid: 33, title: 'Goal' },
    });
    const player = guest('large-article');
    const response = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.currentPage).toMatchObject({ pageId: '9', title: 'Россия' });
    expect(body.currentPage.html).toHaveLength(WIKI_PATH_HTML_MAX_LENGTH);
    expect(db.sqlite.prepare('SELECT title FROM wiki_path_page_revisions WHERE page_id = 9').get()).toEqual({ title: 'Россия' });
  });

  it('loads the start and target articles concurrently before creating the run', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db);
    let releaseRequests!: () => void;
    const requestsMayFinish = new Promise<void>((resolve) => { releaseRequests = resolve; });
    let activeRequests = 0;
    let maxActiveRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await requestsMayFinish;
      activeRequests -= 1;
      const query = new URL(new Request(input, init).url).searchParams;
      const title = query.get('page');
      const page = title === 'Start'
        ? { pageid: 1, revid: 11, title: 'Start', text: '<p>Start</p>', links: [] }
        : { pageid: 3, revid: 33, title: 'Goal', text: '<p>Goal</p>', links: [] };
      return Response.json({ parse: page });
    }));
    const player = guest('parallel-start');
    const responsePromise = app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    await vi.waitFor(() => expect(activeRequests).toBe(2));
    releaseRequests();
    const response = await responsePromise;
    expect(response.status).toBe(201);
    expect(maxActiveRequests).toBe(2);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_path_page_revisions').get()).toEqual({ count: 2 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_path_runs').get()).toEqual({ count: 1 });
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

  it('reveals the ordered article chain for a completed board entry', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db);
    mockWiki({
      Start: { pageid: 1, revid: 11, title: 'Start', links: [{ ns: 0, title: 'Middle' }] },
      Middle: { pageid: 2, revid: 22, title: 'Middle', links: [{ ns: 0, title: 'Goal' }] },
      Goal: { pageid: 3, revid: 33, title: 'Goal' },
    });
    const player = await telegram(2001);
    const viewer = await telegram(2002);
    const start = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: player.authorization } }, env(db));
    const started = await json(start);
    const middle = await app.request(`/api/wiki-path/runs/${started.run.runId}/click`, {
      method: 'POST', headers: { authorization: player.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Middle' }),
    }, env(db));
    expect(middle.status).toBe(200);
    const finish = await app.request(`/api/wiki-path/runs/${started.run.runId}/click`, {
      method: 'POST', headers: { authorization: player.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Goal' }),
    }, env(db));
    expect(finish.status).toBe(200);

    const board = await app.request(`/api/wiki-path/board?date=${TODAY}`, { headers: { authorization: viewer.authorization } }, env(db));
    const boardBody = await json(board);
    expect(boardBody.entries[0]).toMatchObject({ runId: started.run.runId, clicks: 2 });
    const locked = await app.request(`/api/wiki-path/board/runs/${started.run.runId}`, { headers: { authorization: viewer.authorization } }, env(db));
    expect(locked.status).toBe(403);
    expect(await json(locked)).toMatchObject({ reason: 'complete_your_route' });

    const viewerStart = await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: viewer.authorization } }, env(db));
    const viewerStarted = await json(viewerStart);
    for (const title of ['Middle', 'Goal']) {
      const transition = await app.request(`/api/wiki-path/runs/${viewerStarted.run.runId}/click`, {
        method: 'POST', headers: { authorization: viewer.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title }),
      }, env(db));
      expect(transition.status).toBe(200);
    }
    const route = await app.request(`/api/wiki-path/board/runs/${started.run.runId}`, { headers: { authorization: viewer.authorization } }, env(db));
    expect(route.status).toBe(200);
    expect(await json(route)).toEqual({ runId: started.run.runId, displayName: 'Player 2001', clicks: 2, titles: ['Start', 'Middle', 'Goal'] });
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

describe('Wiki Path languages', () => {
  // Page ids coincide across Wikipedias on purpose: snapshots must be keyed by language.
  const ruPages: Record<string, MockPage> = {
    'Старт': { pageid: 1, revid: 11, title: 'Старт', links: [{ ns: 0, title: 'Цель' }] },
    'Цель': { pageid: 3, revid: 33, title: 'Цель' },
  };
  const enPages: Record<string, MockPage> = {
    Start: { pageid: 1, revid: 501, title: 'Start', links: [{ ns: 0, title: 'Middle' }, { ns: 14, title: 'Category:Things' }] },
    Middle: { pageid: 2, revid: 502, title: 'Middle', links: [{ ns: 0, title: 'Goal' }] },
    Goal: { pageid: 3, revid: 503, title: 'Goal' },
  };
  const hosts = (requests: Request[]) => [...new Set(requests.map((request) => new URL(request.url).hostname))];
  const withLocale = (authorization: string, locale?: string) => ({ authorization, ...(locale ? { 'X-Clutch-Locale': locale } : {}) });

  function completedRun(db: TestD1, playerId: string, challenge: string, clicks: number) {
    db.sqlite.prepare(`INSERT INTO wiki_path_runs
      (id, player_id, display_name, challenge_id, date_key, status, clicks, current_page_id, current_revision_id, current_title, path_json, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, 3, 33, 'Goal', '["1","3"]', 10, 1)`)
      .run(`run-${playerId}`, playerId, playerId, challenge, TODAY, clicks);
  }

  it('serves the English challenge from en.wikipedia to an English request', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    addChallenge(db, 'Старт', 'Цель', 'ru');
    const enId = addChallenge(db, 'Start', 'Goal', 'en');
    const requests = mockWiki({}, { ru: ruPages, en: enPages });
    const player = guest('english');

    const today = await json(await app.request('/api/wiki-path/today', { headers: withLocale(player.authorization, 'en') }, env(db)));
    expect(today).toEqual({ challenge: { id: enId, date: TODAY, startTitle: 'Start', targetTitle: 'Goal', lang: 'en' }, run: null });

    const startResponse = await app.request('/api/wiki-path/start', { method: 'POST', headers: withLocale(player.authorization, 'en') }, env(db));
    expect(startResponse.status).toBe(201);
    const started = await json(startResponse);
    expect(started.challenge).toMatchObject({ id: enId, lang: 'en' });
    expect(started.currentPage).toMatchObject({ pageId: '1', revisionId: '501', title: 'Start', allowedLinks: [{ title: 'Middle' }] });

    const click = await app.request(`/api/wiki-path/runs/${started.run.runId}/click`, {
      method: 'POST', headers: { ...withLocale(player.authorization, 'en'), 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Middle' }),
    }, env(db));
    expect(await json(click)).toMatchObject({ run: { clicks: 1, path: ['1', '2'] }, currentPage: { revisionId: '502', title: 'Middle' } });
    const resume = await app.request(`/api/wiki-path/runs/${started.run.runId}`, { headers: withLocale(player.authorization, 'en') }, env(db));
    expect(await json(resume)).toMatchObject({ challenge: { lang: 'en' }, currentPage: { revisionId: '502', title: 'Middle' } });
    expect(hosts(requests)).toEqual(['en.wikipedia.org']);

    // A Russian player on the same day plays the Russian route; page id 1 exists in both Wikipedias.
    const ruPlayer = guest('russian');
    const ruStart = await json(await app.request('/api/wiki-path/start', { method: 'POST', headers: { authorization: ruPlayer.authorization } }, env(db)));
    expect(ruStart.challenge).toMatchObject({ id: challengeId('ru'), lang: 'ru' });
    expect(ruStart.currentPage).toMatchObject({ pageId: '1', revisionId: '11', title: 'Старт' });
    expect(hosts(requests.slice(-2))).toEqual(['ru.wikipedia.org']);
    expect(db.sqlite.prepare('SELECT lang, page_id, revision_id FROM wiki_path_page_revisions WHERE page_id = 1 ORDER BY lang').all())
      .toEqual([{ lang: 'en', page_id: 1, revision_id: 501 }, { lang: 'ru', page_id: 1, revision_id: 11 }]);
    expect(db.sqlite.prepare('SELECT DISTINCT lang FROM wiki_path_page_refs WHERE challenge_id = ?').all(enId)).toEqual([{ lang: 'en' }]);
  });

  it('falls back to the Russian challenge when there is none in the requested language', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database(); addChallenge(db, 'Старт', 'Цель', 'ru');
    const requests = mockWiki({}, { ru: ruPages, en: enPages });
    const player = guest('fallback');
    const today = await json(await app.request('/api/wiki-path/today', { headers: withLocale(player.authorization, 'en') }, env(db)));
    expect(today.challenge).toMatchObject({ id: challengeId('ru'), lang: 'ru', startTitle: 'Старт' });
    const started = await app.request('/api/wiki-path/start', { method: 'POST', headers: withLocale(player.authorization, 'kk') }, env(db));
    expect(started.status).toBe(201);
    expect(await json(started)).toMatchObject({ challenge: { lang: 'ru' }, currentPage: { title: 'Старт', revisionId: '11' } });
    expect(hosts(requests)).toEqual(['ru.wikipedia.org']);
  });

  it('keeps a separate daily board per challenge language', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    const ruId = addChallenge(db, 'Старт', 'Цель', 'ru');
    const enId = addChallenge(db, 'Start', 'Goal', 'en');
    const ruA = await telegram(3001);
    const ruB = await telegram(3002);
    const enA = await telegram(3003);
    completedRun(db, ruA.playerId, ruId, 3);
    completedRun(db, ruB.playerId, ruId, 5);
    completedRun(db, enA.playerId, enId, 4);

    const viewer = guest('board-viewer');
    const enBoard = await json(await app.request(`/api/wiki-path/board?date=${TODAY}`, { headers: withLocale(viewer.authorization, 'en') }, env(db)));
    expect(enBoard).toMatchObject({ challengeId: enId, ownRank: null });
    expect(enBoard.entries.map((entry: { playerId: string }) => entry.playerId)).toEqual([enA.playerId]);
    const ruBoard = await json(await app.request(`/api/wiki-path/board?date=${TODAY}`, { headers: withLocale(viewer.authorization) }, env(db)));
    expect(ruBoard).toMatchObject({ challengeId: ruId });
    expect(ruBoard.entries.map((entry: { playerId: string }) => entry.playerId)).toEqual([ruA.playerId, ruB.playerId]);

    // The board follows the viewer's own run, not the language of the request.
    const ownRu = await json(await app.request(`/api/wiki-path/board?date=${TODAY}`, { headers: withLocale(ruB.authorization, 'en') }, env(db)));
    expect(ownRu).toMatchObject({ challengeId: ruId, ownRank: 2 });

    // Routes are only revealed within the viewer's own board.
    const crossLanguage = await app.request(`/api/wiki-path/board/runs/run-${ruA.playerId}`, { headers: withLocale(enA.authorization, 'en') }, env(db));
    expect(crossLanguage.status).toBe(404);
  });

  it('keeps a Russian run for a player who later switches to English', async () => {
    vi.useFakeTimers({ now: NOON, toFake: ['Date'] });
    const db = database();
    const ruId = addChallenge(db, 'Старт', 'Цель', 'ru');
    addChallenge(db, 'Start', 'Goal', 'en');
    const requests = mockWiki({}, { ru: ruPages, en: enPages });
    const player = guest('switcher');
    const started = await json(await app.request('/api/wiki-path/start', { method: 'POST', headers: withLocale(player.authorization, 'ru') }, env(db)));
    expect(started.challenge).toMatchObject({ id: ruId, lang: 'ru' });

    const today = await json(await app.request('/api/wiki-path/today', { headers: withLocale(player.authorization, 'en') }, env(db)));
    expect(today).toMatchObject({ challenge: { id: ruId, lang: 'ru' }, run: { runId: started.run.runId, challengeId: ruId } });
    const again = await app.request('/api/wiki-path/start', { method: 'POST', headers: withLocale(player.authorization, 'en') }, env(db));
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ challenge: { id: ruId }, run: { runId: started.run.runId }, currentPage: { title: 'Старт' } });
    const click = await app.request(`/api/wiki-path/runs/${started.run.runId}/click`, {
      method: 'POST', headers: { ...withLocale(player.authorization, 'en'), 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Цель' }),
    }, env(db));
    expect(await json(click)).toMatchObject({ run: { status: 'completed', clicks: 1 }, currentPage: { title: 'Цель' } });
    expect(hosts(requests)).toEqual(['ru.wikipedia.org']);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_path_runs').get()).toEqual({ count: 1 });
  });
});
