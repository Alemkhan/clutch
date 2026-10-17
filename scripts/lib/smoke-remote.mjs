// Проверки удалённого smoke: только GET, ничего не пишут в базу.
// fetch передаётся снаружи, чтобы разбор ответов проверялся юнит-тестом.

export const REMOTE_SMOKE_TIMEOUT_MS = 10_000;

export function normalizeBaseUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}: не абсолютный URL.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label}: нужен https.`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label}: без credentials, query и hash.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'clutch-smoke-remote' },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`таймаут ${timeoutMs} мс`);
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

/** Разбор /api/health или /api/ready. Возвращает список проблем (пусто = всё хорошо). */
export function inspectApiStatus(kind, status, body) {
  const problems = [];
  if (status !== 200) problems.push(`HTTP ${status}, ожидался 200`);
  if (body === null || typeof body !== 'object') {
    problems.push('ответ не JSON-объект');
    return problems;
  }
  if (body.status !== 'ok') problems.push(`status=${JSON.stringify(body.status)}, ожидался "ok"`);
  if (body.environment !== 'production') {
    problems.push(`environment=${JSON.stringify(body.environment)}, ожидался "production"`);
  }
  if (kind === 'ready' && body.checks?.d1 !== 'ok') {
    problems.push(`checks.d1=${JSON.stringify(body.checks?.d1)}, ожидался "ok"`);
  }
  return problems;
}

async function checkApi(fetchImpl, workerUrl, kind, timeoutMs) {
  const url = `${workerUrl}/api/${kind}`;
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
  } catch (error) {
    return { name: `GET /api/${kind}`, ok: false, details: [error.message] };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const problems = inspectApiStatus(kind, response.status, body);
  return { name: `GET /api/${kind}`, ok: problems.length === 0, details: problems };
}

/** Из html вытаскивает пути скриптов бандла (локальные, относительные или абсолютные). */
export function extractScriptPaths(html) {
  const paths = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)) {
    paths.push(match[1]);
  }
  return paths;
}

async function checkPages(fetchImpl, pagesUrl, workerUrl, timeoutMs) {
  const results = [];
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${pagesUrl}/`, timeoutMs);
  } catch (error) {
    return [{ name: 'GET Pages /', ok: false, details: [error.message] }];
  }
  const contentType = response.headers.get('content-type') ?? '';
  const html = await response.text();
  const htmlProblems = [];
  if (response.status !== 200) htmlProblems.push(`HTTP ${response.status}, ожидался 200`);
  if (!/text\/html/iu.test(contentType)) htmlProblems.push(`content-type=${JSON.stringify(contentType)}, ожидался text/html`);
  if (!/<html[\s>]/iu.test(html)) htmlProblems.push('в ответе нет <html>');
  results.push({ name: 'GET Pages /', ok: htmlProblems.length === 0, details: htmlProblems });
  if (htmlProblems.length > 0) return results;

  const scripts = extractScriptPaths(html);
  if (scripts.length === 0) {
    results.push({ name: 'Pages bundle', ok: false, details: ['в index.html нет <script src>'] });
    return results;
  }
  let found = false;
  const problems = [];
  for (const path of scripts) {
    let scriptUrl;
    try {
      scriptUrl = new URL(path, `${pagesUrl}/`).toString();
    } catch {
      continue;
    }
    try {
      const scriptResponse = await fetchWithTimeout(fetchImpl, scriptUrl, timeoutMs);
      if (scriptResponse.status !== 200) {
        problems.push(`${path}: HTTP ${scriptResponse.status}`);
        continue;
      }
      if ((await scriptResponse.text()).includes(workerUrl)) {
        found = true;
        break;
      }
    } catch (error) {
      problems.push(`${path}: ${error.message}`);
    }
  }
  if (!found) problems.push(`ни один скрипт не содержит URL воркера ${workerUrl}`);
  results.push({ name: 'Pages bundle ссылается на Worker', ok: found, details: found ? [] : problems });
  return results;
}

export async function runRemoteSmoke({ workerUrl, pagesUrl, fetchImpl = fetch, timeoutMs = REMOTE_SMOKE_TIMEOUT_MS }) {
  const worker = normalizeBaseUrl(workerUrl, 'worker-url');
  const results = [
    await checkApi(fetchImpl, worker, 'health', timeoutMs),
    await checkApi(fetchImpl, worker, 'ready', timeoutMs),
  ];
  if (pagesUrl) {
    const pages = normalizeBaseUrl(pagesUrl, 'pages-url');
    results.push(...await checkPages(fetchImpl, pages, worker, timeoutMs));
  }
  return results;
}
