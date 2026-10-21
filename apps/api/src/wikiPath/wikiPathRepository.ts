import type { WikiLink, WikiPageSnapshot } from './wikiPages';

export type StoredWikiPage = Omit<WikiPageSnapshot, 'html'>;

export interface WikiChallengeRow {
  id: string;
  date_key: string;
  start_title: string;
  target_title: string;
}

export interface WikiRunRow {
  id: string;
  player_id: string;
  display_name: string;
  challenge_id: string;
  date_key: string;
  status: 'in_progress' | 'completed';
  clicks: number;
  current_page_id: number;
  current_revision_id: number;
  current_title: string;
  path_json: string;
  completed_at: number | null;
  created_at: number;
}

interface SnapshotRow {
  page_id: number;
  revision_id: number;
  title: string;
  allowed_links_json: string;
}

export async function findChallenge(db: D1Database, dateKey: string): Promise<WikiChallengeRow | null> {
  return db.prepare('SELECT id, date_key, start_title, target_title FROM wiki_path_challenges WHERE date_key = ?1')
    .bind(dateKey).first<WikiChallengeRow>();
}

export async function findRun(db: D1Database, runId: string, playerId: string): Promise<WikiRunRow | null> {
  return db.prepare('SELECT * FROM wiki_path_runs WHERE id = ?1 AND player_id = ?2')
    .bind(runId, playerId).first<WikiRunRow>();
}

export async function findPlayerRun(db: D1Database, playerId: string, dateKey: string): Promise<WikiRunRow | null> {
  return db.prepare('SELECT * FROM wiki_path_runs WHERE player_id = ?1 AND date_key = ?2')
    .bind(playerId, dateKey).first<WikiRunRow>();
}

export async function findPublicCompletedRun(db: D1Database, runId: string, dateKey: string): Promise<WikiRunRow | null> {
  return db.prepare(`SELECT * FROM wiki_path_runs
    WHERE id = ?1 AND date_key = ?2 AND status = 'completed' AND player_id LIKE 'telegram:%'`)
    .bind(runId, dateKey).first<WikiRunRow>();
}

export async function pathTitles(db: D1Database, challengeId: string, path: readonly string[]): Promise<string[] | null> {
  if (path.length === 0 || !path.every((pageId) => /^\d+$/.test(pageId))) return null;
  const result = await db.prepare(`SELECT s.page_id, s.title FROM wiki_path_page_refs a
    JOIN wiki_path_page_revisions s ON s.page_id = a.page_id AND s.revision_id = a.revision_id
    WHERE a.challenge_id = ?1
      AND s.page_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?2))
    GROUP BY s.page_id, s.title`)
    .bind(challengeId, JSON.stringify(path)).all<{ page_id: number; title: string }>();
  const titles = new Map((result.results ?? []).map((row) => [String(row.page_id), row.title]));
  const resolved = path.map((pageId) => titles.get(pageId));
  return resolved.every((title): title is string => typeof title === 'string') ? resolved : null;
}

export async function getSnapshot(db: D1Database, pageId: number, revisionId?: number): Promise<StoredWikiPage | null> {
  const query = revisionId === undefined
    ? 'SELECT * FROM wiki_path_page_revisions WHERE page_id = ?1 ORDER BY revision_id DESC LIMIT 1'
    : 'SELECT * FROM wiki_path_page_revisions WHERE page_id = ?1 AND revision_id = ?2';
  const statement = revisionId === undefined ? db.prepare(query).bind(pageId) : db.prepare(query).bind(pageId, revisionId);
  const row = await statement.first<SnapshotRow>();
  return row ? snapshotFromRow(row) : null;
}

export async function getSnapshotByTitle(db: D1Database, challengeId: string, title: string): Promise<StoredWikiPage | null> {
  const row = await db.prepare(`SELECT s.* FROM wiki_path_page_refs a JOIN wiki_path_page_revisions s
    ON s.page_id = a.page_id AND s.revision_id = a.revision_id
    WHERE a.challenge_id = ?1 AND a.normalized_title = ?2`)
    .bind(challengeId, titleKey(title)).first<SnapshotRow>();
  return row ? snapshotFromRow(row) : null;
}

function snapshotFromRow(row: SnapshotRow): StoredWikiPage {
  let allowedLinks: WikiLink[] = [];
  try {
    const parsed = JSON.parse(row.allowed_links_json) as unknown;
    if (Array.isArray(parsed)) allowedLinks = parsed.filter((item): item is WikiLink => Boolean(item)
      && typeof item === 'object' && typeof (item as WikiLink).title === 'string' && typeof (item as WikiLink).label === 'string');
  } catch { /* corrupted rows are handled as an empty link set */ }
  return { pageId: row.page_id, revisionId: row.revision_id, title: row.title, allowedLinks };
}

export async function saveSnapshot(db: D1Database, challengeId: string, page: WikiPageSnapshot, now: number, requestedTitle = page.title): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO wiki_path_page_revisions
    (page_id, revision_id, title, allowed_links_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(page.pageId, page.revisionId, page.title, JSON.stringify(page.allowedLinks), now).run();
  const alias = db.prepare(`INSERT OR IGNORE INTO wiki_path_page_refs
    (challenge_id, normalized_title, page_id, revision_id) VALUES (?1, ?2, ?3, ?4)`);
  await alias.bind(challengeId, titleKey(requestedTitle), page.pageId, page.revisionId).run();
  await alias.bind(challengeId, titleKey(page.title), page.pageId, page.revisionId).run();
}

export async function findChallengeTarget(db: D1Database, challengeId: string): Promise<{ pageId: number; canonicalTitle: string } | null> {
  const row = await db.prepare('SELECT page_id, canonical_title FROM wiki_path_challenge_targets WHERE challenge_id = ?1')
    .bind(challengeId).first<{ page_id: number; canonical_title: string }>();
  return row ? { pageId: row.page_id, canonicalTitle: row.canonical_title } : null;
}

export async function saveChallengeTarget(db: D1Database, challengeId: string, page: WikiPageSnapshot): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO wiki_path_challenge_targets (challenge_id, page_id, canonical_title)
    VALUES (?1, ?2, ?3)`).bind(challengeId, page.pageId, page.title).run();
}

export async function createRun(db: D1Database, input: {
  id: string; playerId: string; displayName: string; challenge: WikiChallengeRow; page: WikiPageSnapshot; now: number;
}): Promise<boolean> {
  const result = await db.prepare(`INSERT OR IGNORE INTO wiki_path_runs
    (id, player_id, display_name, challenge_id, date_key, status, clicks, current_page_id, current_revision_id, current_title, path_json, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 'in_progress', 0, ?6, ?7, ?8, ?9, ?10)`)
    .bind(input.id, input.playerId, input.displayName, input.challenge.id, input.challenge.date_key,
      input.page.pageId, input.page.revisionId, input.page.title, JSON.stringify([String(input.page.pageId)]), input.now)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function appendClick(db: D1Database, run: WikiRunRow, page: WikiPageSnapshot, complete: boolean, now: number): Promise<boolean> {
  let path: string[];
  try {
    const parsed = JSON.parse(run.path_json) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return false;
    path = parsed;
  } catch { return false; }
  path.push(String(page.pageId));
  const result = await db.prepare(`UPDATE wiki_path_runs SET
    status = ?1, clicks = clicks + 1, current_page_id = ?2, current_revision_id = ?3, current_title = ?4, path_json = ?5,
    completed_at = ?6
    WHERE id = ?7 AND player_id = ?8 AND status = 'in_progress' AND clicks = ?9 AND current_title = ?10`)
    .bind(complete ? 'completed' : 'in_progress', page.pageId, page.revisionId, page.title, JSON.stringify(path), complete ? now : null,
      run.id, run.player_id, run.clicks, run.current_title).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function isReplayedTarget(db: D1Database, run: WikiRunRow, targetTitle: string): Promise<boolean> {
  const target = await getSnapshotByTitle(db, run.challenge_id, targetTitle);
  return Boolean(target && target.pageId === run.current_page_id && run.clicks > 0);
}

export function titleKey(title: string): string {
  return title.replaceAll('_', ' ').trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('ru-RU');
}

export async function listBoard(db: D1Database, dateKey: string, limit = 50): Promise<Array<Pick<WikiRunRow, 'id' | 'player_id' | 'display_name' | 'clicks' | 'completed_at'>>> {
  const result = await db.prepare(`SELECT id, player_id, display_name, clicks, completed_at FROM wiki_path_runs
    WHERE date_key = ?1 AND status = 'completed' AND player_id LIKE 'telegram:%'
    ORDER BY clicks ASC, completed_at ASC, player_id ASC LIMIT ?2`).bind(dateKey, limit).all<Pick<WikiRunRow, 'id' | 'player_id' | 'display_name' | 'clicks' | 'completed_at'>>();
  return result.results ?? [];
}
