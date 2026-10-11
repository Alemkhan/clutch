import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, completeSoloRun, fetchMyRuns, guestRenewalAuthorization, isGuestSessionUsable, isTransientApiError, startAsyncMatch, startSoloRun } from './api';

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

describe('solo run and my-runs calls', () => {
  function stubApi() {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      const body = path.includes('/api/auth/guest')
        ? { token: 'guest-token', expiresAt: Date.now() + 60 * 60 * 1000 }
        : { runs: [], nextCursor: null, invites: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('requests the my-runs page with the cursor and the guest bearer', async () => {
    const fetchMock = stubApi();
    await fetchMyRuns({ limit: 10, before: '123_abc' });
    const [path, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [string, RequestInit];
    expect(path).toBe('/api/my-runs?limit=10&before=123_abc');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer guest-token');
  });

  it('posts solo start and complete to their own routes', async () => {
    const fetchMock = stubApi();
    await startSoloRun('geography');
    await completeSoloRun('run/1', { rounds: [] });
    const paths = fetchMock.mock.calls.map(([input]) => String(input));
    expect(paths).toContain('/api/solo-runs');
    expect(paths).toContain('/api/solo-runs/run%2F1/complete');
  });
});
