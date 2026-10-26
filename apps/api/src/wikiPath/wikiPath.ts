import type { Context, Hono } from 'hono';
import {
  dailyKey,
  rankWikiPathEntries,
  WIKI_PATH_ALLOWED_LINKS_MAX_COUNT,
  WIKI_PATH_HTML_MAX_LENGTH,
  WIKI_PATH_TITLE_MAX_LENGTH,
  type WikiPathBoardEntry,
  type WikiPathBoardRouteResponse,
  type WikiPathChallenge,
  type WikiPathPage,
  type WikiPathRunSummary,
} from '@clutch/shared';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { fetchWikiPage, fetchWikiRevision, WikiPageError, type WikiPageSnapshot } from './wikiPages';
import {
  appendClick,
  createRun,
  findChallenge,
  findChallengeTarget,
  findPlayerRun,
  findPublicCompletedRun,
  findRun,
  getSnapshot,
  getSnapshotByTitle,
  isReplayedTarget,
  listBoard,
  pathTitles,
  saveChallengeTarget,
  saveSnapshot,
  titleKey,
  type StoredWikiPage,
  type WikiChallengeRow,
  type WikiRunRow,
} from './wikiPathRepository';

type AppContext = Context<{ Bindings: Env }>;
const CLICK_BODY_MAX_BYTES = 1024;

function challengeView(row: WikiChallengeRow): WikiPathChallenge {
  return { id: row.id, date: row.date_key, startTitle: row.start_title, targetTitle: row.target_title };
}

function parsePath(run: WikiRunRow): string[] | null {
  try {
    const path = JSON.parse(run.path_json) as unknown;
    if (!Array.isArray(path) || !path.every((item) => typeof item === 'string')) return null;
    return path;
  } catch { return null; }
}

function pageView(page: WikiPageSnapshot): WikiPathPage {
  return {
    pageId: String(page.pageId),
    title: page.title,
    revisionId: String(page.revisionId),
    html: page.html.slice(0, WIKI_PATH_HTML_MAX_LENGTH),
    allowedLinks: page.allowedLinks.slice(0, WIKI_PATH_ALLOWED_LINKS_MAX_COUNT)
      .map((link) => ({ title: link.title, ...(link.label === link.title ? {} : { label: link.label }) })),
  };
}

async function hydrateStoredPage(page: StoredWikiPage): Promise<WikiPageSnapshot> {
  const revision = await fetchWikiRevision(page.revisionId);
  if (revision.pageId !== page.pageId) throw new WikiPageError('wiki_unavailable');
  return { ...page, html: revision.html };
}

async function runView(db: D1Database, run: WikiRunRow, includePage: boolean, loadedPage?: WikiPageSnapshot) {
  const challenge = await findChallenge(db, run.date_key);
  const path = parsePath(run);
  if (!challenge || !path || path.length !== run.clicks + 1) return null;
  let currentPage: WikiPageSnapshot | null = null;
  if (includePage) {
    if (loadedPage?.pageId === run.current_page_id && loadedPage.revisionId === run.current_revision_id) {
      currentPage = loadedPage;
    } else {
      const stored = await getSnapshot(db, run.current_page_id, run.current_revision_id);
      if (!stored) return null;
      currentPage = await hydrateStoredPage(stored);
    }
  }
  return {
    challenge: challengeView(challenge),
    run: {
      runId: run.id,
      challengeId: run.challenge_id,
      status: run.status,
      clicks: run.clicks,
      path,
      startedAt: run.created_at,
      completedAt: run.completed_at,
    } satisfies WikiPathRunSummary,
    currentPage: currentPage ? pageView(currentPage) : null,
  };
}

async function authenticate(c: AppContext, scope: string): Promise<RequestIdentity | Response> {
  const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
  if (!identity) return c.json({ error: 'Authentication required.' }, 401);
  const limited = await checkRateLimit(c.env.API_RATE_LIMITER, `${scope}:${identity.playerId}`);
  if (limited === 'limited') {
    c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
    return c.json({ error: 'Too many requests.' }, 429);
  }
  if (limited === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
  return identity;
}

async function loadOrFetch(db: D1Database, challengeId: string, title: string, now: number): Promise<WikiPageSnapshot> {
  const cached = await getSnapshotByTitle(db, challengeId, title);
  if (cached) return hydrateStoredPage(cached);
  const page = await fetchWikiPage(title);
  await saveSnapshot(db, challengeId, page, now, title);
  // A concurrent request may have fixed a different revision first for this challenge.
  const stored = await getSnapshotByTitle(db, challengeId, title);
  if (!stored) return page;
  return stored.pageId === page.pageId && stored.revisionId === page.revisionId
    ? page
    : hydrateStoredPage(stored);
}

function wikiFailure(c: AppContext, error: unknown): Response {
  if (error instanceof WikiPageError) {
    const status = error.reason === 'wiki_timeout' ? 504 : 502;
    return c.json({ error: 'Wikipedia is temporarily unavailable.', reason: error.reason }, status);
  }
  return c.json({ error: 'Wiki Path is temporarily unavailable.', reason: 'wiki_storage_unavailable' }, 502);
}

async function targetForChallenge(db: D1Database, challenge: WikiChallengeRow, now: number) {
  const saved = await findChallengeTarget(db, challenge.id);
  if (saved) return saved;
  const page = await loadOrFetch(db, challenge.id, challenge.target_title, now);
  await saveChallengeTarget(db, challenge.id, page);
  return await findChallengeTarget(db, challenge.id) ?? { pageId: page.pageId, canonicalTitle: page.title };
}

export function registerWikiPathRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/wiki-path/today', async (c) => {
    const identity = await authenticate(c, 'wiki-path-today');
    if (identity instanceof Response) return identity;
    const dateKey = dailyKey(Date.now());
    const challenge = await findChallenge(c.env.DB, dateKey);
    if (!challenge) return c.json({ challenge: null, run: null });
    const run = await findPlayerRun(c.env.DB, identity.playerId, dateKey);
    const state = run ? await runView(c.env.DB, run, false) : null;
    return c.json({ challenge: challengeView(challenge), run: state?.run ?? null });
  });

  app.post('/api/wiki-path/start', async (c) => {
    const identity = await authenticate(c, 'wiki-path-start');
    if (identity instanceof Response) return identity;
    const now = Date.now();
    const dateKey = dailyKey(now);
    const challenge = await findChallenge(c.env.DB, dateKey);
    if (!challenge) return c.json({ error: 'There is no Wiki Path challenge today.', reason: 'no_challenge_today' }, 404);
    try {
      let run = await findPlayerRun(c.env.DB, identity.playerId, dateKey);
      let loadedPage: WikiPageSnapshot | undefined;
      const alreadyStarted = Boolean(run);
      if (!run) {
        // Fetch both immutable pages together: sequential Wikimedia requests can exceed the
        // browser's request budget even when each page is individually fast.
        const [page] = await Promise.all([
          loadOrFetch(c.env.DB, challenge.id, challenge.start_title, now),
          targetForChallenge(c.env.DB, challenge, now),
        ]);
        loadedPage = page;
        await createRun(c.env.DB, {
          id: crypto.randomUUID(), playerId: identity.playerId,
          displayName: identity.displayName?.trim().slice(0, 40) || 'Игрок', challenge, page, now,
        });
        run = await findPlayerRun(c.env.DB, identity.playerId, dateKey);
      }
      if (!run) return c.json({ error: 'Could not create a Wiki Path run.' }, 503);
      const state = await runView(c.env.DB, run, true, loadedPage);
      if (!state) return c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
      return c.json({ challenge: state.challenge, run: state.run, currentPage: state.currentPage }, alreadyStarted ? 200 : 201);
    } catch (error) { return wikiFailure(c, error); }
  });

  app.get('/api/wiki-path/runs/:runId', async (c) => {
    const identity = await authenticate(c, 'wiki-path-resume');
    if (identity instanceof Response) return identity;
    const run = await findRun(c.env.DB, c.req.param('runId'), identity.playerId);
    if (!run) return c.json({ error: 'Run not found.' }, 404);
    try {
      const state = await runView(c.env.DB, run, true);
      if (!state) return c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
      return c.json({ challenge: state.challenge, run: state.run, currentPage: state.currentPage });
    } catch (error) { return wikiFailure(c, error); }
  });

  app.post('/api/wiki-path/runs/:runId/click', async (c) => {
    const identity = await authenticate(c, 'wiki-path-click');
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, CLICK_BODY_MAX_BYTES);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return c.json({ error: 'Invalid link selection.', reason: 'invalid_target' }, 400);
    }
    const body = parsed.value as Record<string, unknown>;
    if (typeof body.title !== 'string' || body.title.length === 0 || body.title.length > WIKI_PATH_TITLE_MAX_LENGTH) {
      return c.json({ error: 'Invalid link selection.', reason: 'invalid_target' }, 400);
    }
    const runId = c.req.param('runId');
    let run = await findRun(c.env.DB, runId, identity.playerId);
    if (!run) return c.json({ error: 'Run not found.' }, 404);
    if (run.status === 'completed') {
      try {
        const state = await runView(c.env.DB, run, true);
        return state ? c.json(state) : c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
      } catch (error) { return wikiFailure(c, error); }
    }
    if (await isReplayedTarget(c.env.DB, run, body.title)) {
      try {
        const state = await runView(c.env.DB, run, true);
        return state ? c.json({ run: state.run, currentPage: state.currentPage }) : c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
      } catch (error) { return wikiFailure(c, error); }
    }
    const path = parsePath(run);
    const currentPageId = path?.length ? Number(path[path.length - 1]) : NaN;
    const snapshot = Number.isSafeInteger(currentPageId) ? await getSnapshot(c.env.DB, currentPageId, run.current_revision_id) : null;
    if (!snapshot) return c.json({ error: 'Stored Wiki Path page is invalid.' }, 409);
    const target = snapshot.allowedLinks.find((link) => titleKey(link.title) === titleKey(body.title as string));
    if (!target) return c.json({ error: 'That page is not linked from the current article.', reason: 'invalid_edge' }, 400);

    try {
      const page = await loadOrFetch(c.env.DB, run.challenge_id, target.title, Date.now());
      const challenge = await findChallenge(c.env.DB, run.date_key);
      if (!challenge) return c.json({ error: 'Challenge not found.' }, 409);
      const goal = await targetForChallenge(c.env.DB, challenge, Date.now());
      const complete = page.pageId === goal.pageId || titleKey(page.title) === titleKey(goal.canonicalTitle);
      const updated = await appendClick(c.env.DB, run, page, complete, Date.now());
      run = await findRun(c.env.DB, runId, identity.playerId) ?? run;
      if (!updated) {
        if (await isReplayedTarget(c.env.DB, run, body.title)) {
          const replay = await runView(c.env.DB, run, true);
          return replay ? c.json(replay) : c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
        }
        return c.json({ error: 'Run changed during this click.', reason: 'stale_page' }, 409);
      }
      const state = await runView(c.env.DB, run, true, page);
      if (!state) return c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
      return c.json({ run: state.run, currentPage: state.currentPage });
    } catch (error) { return wikiFailure(c, error); }
  });

  app.get('/api/wiki-path/board', async (c) => {
    const identity = await authenticate(c, 'wiki-path-board');
    if (identity instanceof Response) return identity;
    const dateKey = c.req.query('date') ?? dailyKey(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(Date.parse(`${dateKey}T00:00:00Z`))) {
      return c.json({ error: 'Invalid date.' }, 400);
    }
    const challenge = await findChallenge(c.env.DB, dateKey);
    if (!challenge) return c.json({ error: 'Challenge not found.', reason: 'no_challenge_today' }, 404);
    const rows = await listBoard(c.env.DB, dateKey, 1000);
    const ranked = rankWikiPathEntries(rows.map((row) => ({
      runId: row.id, playerId: row.player_id, displayName: row.display_name, clicks: row.clicks, completedAt: row.completed_at!,
    })));
    const entries: WikiPathBoardEntry[] = ranked.slice(0, 50);
    const own = identity.kind === 'telegram' ? ranked.find((entry) => entry.playerId === identity.playerId) : undefined;
    return c.json({ challengeId: challenge.id, entries, ownRank: own?.rank ?? null });
  });

  app.get('/api/wiki-path/board/runs/:runId', async (c) => {
    const identity = await authenticate(c, 'wiki-path-board-route');
    if (identity instanceof Response) return identity;
    const dateKey = dailyKey(Date.now());
    const viewerRun = await findPlayerRun(c.env.DB, identity.playerId, dateKey);
    if (identity.kind !== 'telegram' || viewerRun?.status !== 'completed') {
      return c.json({ error: 'Complete today\'s Wiki Path before viewing routes.', reason: 'complete_your_route' }, 403);
    }
    const run = await findPublicCompletedRun(c.env.DB, c.req.param('runId'), dateKey);
    if (!run) return c.json({ error: 'Completed board route not found.' }, 404);
    const path = parsePath(run);
    if (!path || path.length !== run.clicks + 1) return c.json({ error: 'Stored Wiki Path run is invalid.' }, 409);
    const titles = await pathTitles(c.env.DB, run.challenge_id, path);
    if (!titles) return c.json({ error: 'Stored Wiki Path route is incomplete.' }, 409);
    return c.json({ runId: run.id, displayName: run.display_name, clicks: run.clicks, titles } satisfies WikiPathBoardRouteResponse);
  });
}
