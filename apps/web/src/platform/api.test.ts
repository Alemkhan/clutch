import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, answerSoloRound, checkTrainingAnswer, fetchMyRuns, fetchSoloProfile, fetchSoloRunSnapshot, fetchTrainingMistakes, fetchTrainingQuestions, hammerSoloRound, guestRenewalAuthorization, isGuestSessionUsable, isTransientApiError, logAnalyticsEvent, startSoloRun, submitQuestionReport } from './api';

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
    const request = startSoloRun('geography', controller.signal);
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

  it('requests the authenticated server profile', async () => {
    const fetchMock = stubApi();
    await fetchSoloProfile();
    const [path, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [string, RequestInit];
    expect(path).toBe('/api/profile');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer guest-token');
  });

  it('posts solo start, answer and hammer to their own routes, and reads the snapshot with GET', async () => {
    const fetchMock = stubApi();
    await startSoloRun('geography');
    await answerSoloRound('run/1', { roundIndex: 0, questionId: 'q', selectedAnswer: 'a', responseTimeMs: 5 });
    await hammerSoloRound('run/1', { roundIndex: 0, questionId: 'q', activeElapsedMs: 420 });
    await fetchSoloRunSnapshot('run/1');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const paths = calls.map(([input]) => String(input));
    expect(paths).toContain('/api/solo-runs');
    expect(paths).toContain('/api/solo-runs/run%2F1/answer');
    expect(paths).toContain('/api/solo-runs/run%2F1/hammer');
    const snapshot = calls.find(([path, init]) => path === '/api/solo-runs/run%2F1' && init.method === 'GET');
    expect(snapshot).toBeDefined();
    // Уходит только момент удара: ни расстояния, ни награды клиент не присылает.
    const hammer = calls.find(([path]) => path.endsWith('/hammer'));
    expect(JSON.parse(String(hammer?.[1].body))).toEqual({ roundIndex: 0, questionId: 'q', activeElapsedMs: 420 });
  });

  it('asks the server for mistake-training questions and verdicts', async () => {
    const fetchMock = stubApi();
    await fetchTrainingMistakes();
    await fetchTrainingQuestions(['capital_li']);
    await checkTrainingAnswer('capital_li', 'Вадуц');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const mistakes = calls.find(([path]) => path === '/api/training/mistakes');
    expect(mistakes?.[1].method).toBe('GET');
    const questions = calls.find(([path]) => path === '/api/training/questions');
    const check = calls.find(([path]) => path === '/api/training/check');
    expect(JSON.parse(String(questions?.[1].body))).toEqual({ ids: ['capital_li'] });
    expect(JSON.parse(String(check?.[1].body))).toEqual({ questionId: 'capital_li', answer: 'Вадуц' });
  });

  it('sends the rematch invite to the solo route', async () => {
    const fetchMock = stubApi();
    await startSoloRun('geography', undefined, 'rm_soloinvite');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const solo = calls.find(([path]) => path === '/api/solo-runs');
    expect(JSON.parse(String(solo?.[1].body)).rematchInviteId).toBe('rm_soloinvite');
  });
});

describe('reports and analytics calls', () => {
  function stubApi() {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      const body = path.includes('/api/auth/guest')
        ? { token: 'guest-token', expiresAt: Date.now() + 60 * 60 * 1000 }
        : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('submits a question report as an awaited call', async () => {
    const fetchMock = stubApi();
    await submitQuestionReport({
      questionId: 'capital_li', runId: 'run-1', category: 'geography',
      mode: 'solo', kind: 'wrong_answer', verdict: false, comment: 'Ответ другой.',
    });
    const call = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const report = call.find(([path, init]) => path === '/api/reports' && init.method === 'POST');
    expect(report).toBeDefined();
    expect((report?.[1].headers as Record<string, string>).Authorization).toBe('Bearer guest-token');
    expect(JSON.parse(String(report?.[1].body))).toEqual({
      questionId: 'capital_li', runId: 'run-1', category: 'geography',
      mode: 'solo', kind: 'wrong_answer', verdict: false, comment: 'Ответ другой.',
    });
  });

  it('sends allowlisted analytics events fire-and-forget with the payload', async () => {
    const fetchMock = stubApi();
    logAnalyticsEvent('sound_failure', { reason: 'play-rejected', phase: 'play', sound: 'correct' });
    await vi.waitFor(() => {
      const event = (fetchMock.mock.calls as unknown as [string, RequestInit][])
        .find(([path]) => path === '/api/events');
      expect(event).toBeDefined();
    });
    const event = (fetchMock.mock.calls as unknown as [string, RequestInit][])
      .find(([path]) => path === '/api/events');
    expect(JSON.parse(String(event?.[1].body))).toEqual({
      event: 'sound_failure',
      payload: { reason: 'play-rejected', phase: 'play', sound: 'correct' },
    });
  });

  it('drops non-allowlisted event names without touching the network', () => {
    const fetchMock = stubApi();
    // @ts-expect-error — runtime-защита от опечатки в имени события
    logAnalyticsEvent('question_answered');
    expect((fetchMock.mock.calls as unknown as [string, RequestInit][])
      .filter(([path]) => path === '/api/events')).toHaveLength(0);
  });

  it('never surfaces a network failure from an analytics event', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      if (path.includes('/api/auth/guest')) {
        return Promise.resolve(new Response(JSON.stringify({
          token: 'guest-token', expiresAt: Date.now() + 60 * 60 * 1000,
        }), { status: 200 }));
      }
      return Promise.reject(new TypeError('offline'));
    });
    vi.stubGlobal('fetch', fetchMock);
    logAnalyticsEvent('training_started', { category: 'general' });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/events')).toHaveLength(1);
  });
});
