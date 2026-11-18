import { WIKI_PATH_ALLOWED_LINKS_MAX_COUNT, WIKI_PATH_TITLE_MAX_LENGTH, type Locale } from '@clutch/shared';

export interface WikiLink {
  title: string;
  label: string;
}

export interface WikiPageSnapshot {
  pageId: number;
  title: string;
  revisionId: number;
  html: string;
  allowedLinks: WikiLink[];
}

interface ParseResponse {
  parse?: {
    pageid?: number;
    revid?: number;
    title?: string;
    text?: string;
    links?: Array<{ ns?: number; title?: string }>;
  };
  error?: { code?: string };
}

export type WikiFetchError = 'wiki_timeout' | 'wiki_unavailable';

/** Each challenge language plays inside its own Wikipedia (ru/en/kk). */
export function wikiApiUrl(lang: Locale): string {
  return `https://${lang}.wikipedia.org/w/api.php`;
}
const USER_AGENT = 'ClutchWikiPath/1.0 (https://clutch-app-ct8.pages.dev)';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export class WikiPageError extends Error {
  constructor(readonly reason: WikiFetchError) { super(reason); }
}

async function requestParsedPage(lang: Locale, query: URLSearchParams, immutableRevision = false): Promise<NonNullable<ParseResponse['parse']>> {
  let response: Response;
  try {
    response = await fetch(`${wikiApiUrl(lang)}?${query}`, {
      headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      ...(immutableRevision ? { cf: { cacheEverything: true, cacheTtl: 7 * 24 * 60 * 60 } } : {}),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new WikiPageError('wiki_timeout');
    }
    throw new WikiPageError('wiki_unavailable');
  }
  if (!response.ok) throw new WikiPageError('wiki_unavailable');
  try {
    const parsed = JSON.parse(await readBounded(response)) as ParseResponse;
    if (!parsed.parse) throw new WikiPageError('wiki_unavailable');
    return parsed.parse;
  } catch (error) {
    if (error instanceof WikiPageError) throw error;
    throw new WikiPageError('wiki_unavailable');
  }
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new WikiPageError('wiki_unavailable');
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new WikiPageError('wiki_unavailable');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new WikiPageError('wiki_unavailable');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function fetchWikiPage(lang: Locale, title: string): Promise<WikiPageSnapshot> {
  const query = new URLSearchParams({
    action: 'parse', page: title, prop: 'text|links|revid', redirects: '1',
    format: 'json', formatversion: '2', origin: '*', disableeditsection: '1', disabletoc: '1', mobileformat: '1',
  });
  const page = await requestParsedPage(lang, query);
  if (!page || !Number.isSafeInteger(page.pageid) || !Number.isSafeInteger(page.revid)
    || typeof page.title !== 'string' || typeof page.text !== 'string' || !Array.isArray(page.links)) {
    throw new WikiPageError('wiki_unavailable');
  }
  if (page.title.length > WIKI_PATH_TITLE_MAX_LENGTH) {
    throw new WikiPageError('wiki_unavailable');
  }
  const links = new Map<string, WikiLink>();
  for (const link of page.links) {
    // Only main-namespace articles (ns 0) are playable. MediaWiki reports the namespace number,
    // so category/file/help/template pages are excluded in every language without title prefixes.
    if (link.ns === 0 && typeof link.title === 'string' && link.title.length <= WIKI_PATH_TITLE_MAX_LENGTH) {
      const key = link.title.normalize('NFC').toLocaleLowerCase('ru-RU');
      links.set(key, { title: link.title, label: link.title.replaceAll('_', ' ') });
      if (links.size >= WIKI_PATH_ALLOWED_LINKS_MAX_COUNT) break;
    }
  }
  return { pageId: page.pageid!, title: page.title, revisionId: page.revid!, html: page.text, allowedLinks: [...links.values()] };
}

/** Reload presentational HTML for the exact revision stored in D1; Cloudflare may edge-cache it. */
export async function fetchWikiRevision(lang: Locale, revisionId: number): Promise<Omit<WikiPageSnapshot, 'allowedLinks'>> {
  const query = new URLSearchParams({
    action: 'parse', oldid: String(revisionId), prop: 'text|revid',
    format: 'json', formatversion: '2', origin: '*', disableeditsection: '1', disabletoc: '1', mobileformat: '1',
  });
  const page = await requestParsedPage(lang, query, true);
  if (!Number.isSafeInteger(page.pageid) || page.revid !== revisionId
    || typeof page.title !== 'string' || typeof page.text !== 'string'
    || page.title.length > WIKI_PATH_TITLE_MAX_LENGTH) {
    throw new WikiPageError('wiki_unavailable');
  }
  return { pageId: page.pageid!, title: page.title, revisionId, html: page.text };
}
