export type LaunchIntent =
  | { type: 'rematch'; inviteId: string }
  | { type: 'unsubscribe' }
  | { type: 'daily-unsubscribe' }
  | { type: 'daily-tiebreaker' }
  | { type: 'daily-wiki-path' };

const INVITE_ID = /^rm_[A-Za-z0-9_-]{22}$/;

/** Maps a Telegram startapp payload to an intent. Anything unrecognised is ignored. */
export function parseLaunchPayload(payload: string | null | undefined): LaunchIntent | null {
  if (!payload) return null;
  if (payload === 'unsub') return { type: 'unsubscribe' };
  if (payload === 'daily_off') return { type: 'daily-unsubscribe' };
  if (payload === 'daily_guess') return { type: 'daily-tiebreaker' };
  if (payload === 'daily_wiki') return { type: 'daily-wiki-path' };
  if (INVITE_ID.test(payload)) return { type: 'rematch', inviteId: payload };
  return null;
}

/**
 * Telegram passes the startapp value as tgWebAppStartParam in the launch URL hash; the query
 * string is accepted too so a browser can be pointed at the same link when testing.
 */
export function readLaunchIntent(location: Pick<Location, 'hash' | 'search'> = window.location): LaunchIntent | null {
  for (const source of [location.hash.replace(/^#/, ''), location.search.replace(/^\?/, '')]) {
    const value = new URLSearchParams(source).get('tgWebAppStartParam');
    const intent = parseLaunchPayload(value);
    if (intent) return intent;
  }
  return null;
}
