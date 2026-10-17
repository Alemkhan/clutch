import { describe, expect, it } from 'vitest';
import {
  extractScriptPaths,
  inspectApiStatus,
  normalizeBaseUrl,
  runRemoteSmoke,
} from '../scripts/lib/smoke-remote.mjs';

const worker = 'https://api.clutch.invalid';
const pages = 'https://web.clutch.invalid';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return (async (input: string | URL | Request) => {
    const handler = routes[String(input)];
    if (!handler) return new Response('not found', { status: 404 });
    return handler();
  }) as typeof fetch;
}

const okApi = {
  [`${worker}/api/health`]: () => json({ status: 'ok', environment: 'production' }),
  [`${worker}/api/ready`]: () => json({ status: 'ok', environment: 'production', checks: { d1: 'ok' } }),
};

describe('remote smoke', () => {
  it('passes when the Worker and Pages are healthy', async () => {
    const results = await runRemoteSmoke({
      workerUrl: `${worker}/`,
      pagesUrl: pages,
      fetchImpl: fakeFetch({
        ...okApi,
        [`${pages}/`]: () => new Response('<html><script src="/assets/app.js"></script></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
        [`${pages}/assets/app.js`]: () => new Response(`fetch("${worker}/api/x")`),
      }),
    });
    expect(results.map((result) => result.ok)).toEqual([true, true, true, true]);
  });

  it('fails when D1 is unavailable or the environment is not production', () => {
    expect(inspectApiStatus('ready', 503, { status: 'unavailable', environment: 'production', checks: { d1: 'unavailable' } }))
      .not.toEqual([]);
    expect(inspectApiStatus('health', 200, { status: 'ok', environment: 'development' }))
      .toEqual(['environment="development", ожидался "production"']);
    expect(inspectApiStatus('ready', 200, { status: 'ok', environment: 'production', checks: {} }))
      .toHaveLength(1);
    expect(inspectApiStatus('health', 200, null)).toContain('ответ не JSON-объект');
  });

  it('fails when the bundle points to another Worker', async () => {
    const results = await runRemoteSmoke({
      workerUrl: worker,
      pagesUrl: pages,
      fetchImpl: fakeFetch({
        ...okApi,
        [`${pages}/`]: () => new Response('<html><script src="/assets/app.js"></script></html>', {
          headers: { 'content-type': 'text/html' },
        }),
        [`${pages}/assets/app.js`]: () => new Response('fetch("https://other.invalid")'),
      }),
    });
    expect(results.at(-1)?.ok).toBe(false);
  });

  it('reports a timeout instead of hanging', async () => {
    const hanging = ((_: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const results = await runRemoteSmoke({ workerUrl: worker, fetchImpl: hanging, timeoutMs: 20 });
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0].details[0]).toContain('таймаут');
  });

  it('rejects non-https URLs and extracts script paths', () => {
    expect(() => normalizeBaseUrl('http://x.invalid', 'u')).toThrowError(/https/u);
    expect(extractScriptPaths('<script type="module" crossorigin src="/a.js"></script>')).toEqual(['/a.js']);
  });
});
