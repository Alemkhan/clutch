/** Shared client/server contracts for the daily Wikipedia navigation challenge. */

export const WIKI_PATH_TITLE_MAX_LENGTH = 300;
// Maximum HTML characters returned to the client. HTML is not persisted in D1;
// the Worker applies a separate byte limit to the complete MediaWiki response.
export const WIKI_PATH_HTML_MAX_LENGTH = 1_500_000;
export const WIKI_PATH_ALLOWED_LINKS_MAX_COUNT = 2_500;

/** The common daily route: every player starts and targets the same article titles. */
export interface WikiPathChallenge {
  id: string;
  /** Calendar date key used by the challenge, formatted YYYY-MM-DD. */
  date: string;
  startTitle: string;
  targetTitle: string;
}

export type WikiPathRunStatus = 'in_progress' | 'completed';

export interface WikiPathAllowedLink {
  title: string;
  /** Link text as shown in the article; omitted when it matches the title. */
  label?: string;
}

/** Sanitized article payload. HTML is presentational content; navigation uses allowedLinks. */
export interface WikiPathPage {
  pageId: string;
  title: string;
  revisionId: string;
  html: string;
  allowedLinks: WikiPathAllowedLink[];
}

/** Compact persisted progress returned by today/start/click endpoints. */
export interface WikiPathRunSummary {
  runId: string;
  challengeId: string;
  status: WikiPathRunStatus;
  /** Number of successful article transitions. */
  clicks: number;
  /** Visited article page IDs, including the starting article. */
  path: string[];
  startedAt: number;
  completedAt: number | null;
}

/** GET /api/wiki-path/today. Both are null when no challenge exists today. */
export interface WikiPathTodayResponse {
  challenge: WikiPathChallenge | null;
  run: WikiPathRunSummary | null;
}

/** POST /api/wiki-path/start; also used to resume the current unfinished daily run. */
export interface StartWikiPathResponse {
  challenge: WikiPathChallenge;
  run: WikiPathRunSummary;
  currentPage: WikiPathPage;
}

/** POST /api/wiki-path/click body. A title is checked against currentPage.allowedLinks by the server. */
export interface WikiPathClickRequest {
  title: string;
}

/** Successful click response; currentPage is the target page after the transition. */
export interface WikiPathClickResponse {
  run: WikiPathRunSummary;
  currentPage: WikiPathPage;
}

export interface WikiPathBoardEntry {
  rank: number;
  runId: string;
  playerId: string;
  displayName: string;
  clicks: number;
  completedAt: number;
}

export interface WikiPathBoardResponse {
  challengeId: string;
  entries: WikiPathBoardEntry[];
  ownRank: number | null;
}

/** Public article chain for one completed entry in today's Wiki Path board. */
export interface WikiPathBoardRouteResponse {
  runId: string;
  displayName: string;
  clicks: number;
  titles: string[];
}

/** Assign competition ranks (1, 2, 2, 4) after sorting by fewest clicks. */
export function rankWikiPathEntries(
  entries: readonly Omit<WikiPathBoardEntry, 'rank'>[],
): WikiPathBoardEntry[] {
  const sorted = entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.clicks - b.entry.clicks || a.index - b.index);
  let rank = 0;
  let previousClicks: number | undefined;
  return sorted.map(({ entry }, index) => {
    if (entry.clicks !== previousClicks) rank = index + 1;
    previousClicks = entry.clicks;
    return { ...entry, rank };
  });
}
