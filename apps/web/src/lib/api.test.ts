import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, guestRenewalAuthorization, isGuestSessionUsable, isTransientApiError, startAsyncMatch } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser guest session validity', () => {
  const now = 1_800_000_000_000;

  it('requires validity beyond the refresh window', () => {
    expect(isGuestSessionUsable({ token: 'token', expiresAt: now + 300_001 }, now)).toBe(true);
    expect(isGuestSessionUsable({ token: 'token', expiresAt: now + 300_000 }, now)).toBe(false);
  });

  it('rejects invalid stored shapes', () => {
    expect(isGuestSessionUsable(null, now)).toBe(false);
    expect(isGuestSessionUsable({ token: '', expiresAt: now + 1_000_000 }, now)).toBe(false);
    expect(isGuestSessionUsable({ token: 'token', expiresAt: 'later' }, now)).toBe(false);
  });

  it('renews with the prior bearer only while the cached session is unexpired', () => {
    const session = { token: 'prior-token', expiresAt: now + 1 };
    expect(guestRenewalAuthorization(session, now)).toBe('Bearer prior-token');
    expect(guestRenewalAuthorization({ ...session, expiresAt: now }, now)).toBeNull();
    expect(guestRenewalAuthorization({ token: '', expiresAt: now + 1 }, now)).toBeNull();
  });
});

describe('API error retry classification', () => {
  it('retries network, timeout, rate-limit and server failures', () => {
    expect(isTransientApiError(new TypeError('offline'))).toBe(true);
    expect(isTransientApiError(new ApiError(408))).toBe(true);
    expect(isTransientApiError(new ApiError(425))).toBe(true);
    expect(isTransientApiError(new ApiError(429))).toBe(true);
    expect(isTransientApiError(new ApiError(503))).toBe(true);
  });

  it('does not automatically retry authentication or validation failures', () => {
    expect(isTransientApiError(new ApiError(401))).toBe(false);
    expect(isTransientApiError(new ApiError(404))).toBe(false);
  });
});

describe('match start cancellation', () => {
  it('cascades a caller abort to the match fetch', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/api/auth/guest')) {
        return Promise.resolve(new Response(JSON.stringify({
          token: 'guest-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const request = startAsyncMatch('geography', controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
