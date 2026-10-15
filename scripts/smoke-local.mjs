import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerCli = join(repositoryRoot, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
const apiEntry = join(repositoryRoot, 'apps', 'api', 'src', 'index.ts');
const migrationsSource = join(repositoryRoot, 'apps', 'api', 'migrations');
const tempPrefix = 'clutch-smoke-';
const sessionSecret = 'local-smoke-session-secret-at-least-32-characters';
const startupTimeoutMs = 30_000;

let workerProcess;
let workerOutput = '';
let cleanupPromise;
let tempDirectory;

function childEnvironment() {
  const environment = { ...process.env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_EMAIL',
    'CF_ACCOUNT_ID',
    'CF_API_TOKEN',
    'SESSION_SIGNING_SECRET',
    'TELEGRAM_BOT_TOKEN',
  ]) {
    delete environment[key];
  }
  environment.CI = 'true';
  environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  environment.WRANGLER_SEND_METRICS = 'false';
  return environment;
}

async function copyMigrations(targetDirectory) {
  await mkdir(targetDirectory);
  const entries = await readdir(migrationsSource, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.ok(migrations.length > 0, 'No D1 migrations found for the smoke test.');
  for (const migration of migrations) {
    await copyFile(join(migrationsSource, migration.name), join(targetDirectory, migration.name));
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Could not reserve a local port.');
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

function spawnWrangler(arguments_, options = {}) {
  return spawn(process.execPath, [wranglerCli, ...arguments_], {
    cwd: tempDirectory,
    env: childEnvironment(),
    windowsHide: true,
    ...options,
  });
}

async function runWrangler(arguments_) {
  const child = spawnWrangler(arguments_, { stdio: 'inherit' });
  await new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectExit(new Error(`Wrangler command timed out: ${arguments_.slice(0, 3).join(' ')}`));
    }, startupTimeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolveExit();
      else rejectExit(new Error(
        `Wrangler command failed with ${code === null ? `signal ${signal}` : `exit ${code}`}.`,
      ));
    });
  });
}

function captureWorkerOutput(stream) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    workerOutput = `${workerOutput}${chunk}`.slice(-20_000);
  });
}

function startWorker({ configPath, persistDirectory, port }) {
  const child = spawnWrangler([
    'dev',
    '--local',
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--persist-to', persistDirectory,
    '--config', configPath,
    '--log-level', 'warn',
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  captureWorkerOutput(child.stdout);
  captureWorkerOutput(child.stderr);
  return child;
}

async function terminateWorker() {
  const child = workerProcess;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    await new Promise((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolveKill);
      killer.once('exit', resolveKill);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }

  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);

  if (child.exitCode === null && child.signalCode === null && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await terminateWorker();
    if (!tempDirectory) return;
    const target = resolve(tempDirectory);
    const temporaryRoot = resolve(tmpdir());
    assert.equal(dirname(target), temporaryRoot, 'Refusing to remove a non-temporary directory.');
    assert.ok(basename(target).startsWith(tempPrefix), 'Refusing to remove an unexpected directory.');
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
        return;
      } catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
        lastError = error;
        await delay(250);
      }
    }
    throw lastError;
  })();
  return cleanupPromise;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForReadiness(baseUrl) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (workerProcess.exitCode !== null || workerProcess.signalCode !== null) {
      throw new Error(`Wrangler dev exited before readiness.\n${workerOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/ready`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 200) return response;
      lastError = new Error(`Readiness returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Worker readiness timed out: ${lastError?.message ?? 'unknown error'}\n${workerOutput}`);
}

async function jsonRequest(baseUrl, path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(5_000),
    ...options,
  });
  const body = await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${options?.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

async function guestSession(baseUrl) {
  const body = await jsonRequest(baseUrl, '/api/auth/guest', { method: 'POST' }, 201);
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.length > 0);
  return body.token;
}

async function startSoloRun(baseUrl, token, displayName) {
  return jsonRequest(baseUrl, '/api/solo-runs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ displayName, category: 'general' }),
  }, 201);
}

const ANSWER_KEYS = ['correctOptionId', 'correctAnswers', 'explanation'];

/** Вопрос, на который игрок ещё не ответил, не должен нести ответа ни в одном поле. */
function assertNoAnswers(payload, where) {
  const text = JSON.stringify(payload);
  for (const key of ANSWER_KEYS) {
    assert.ok(!text.includes(`"${key}"`), `${where} carries ${key}`);
  }
}

/** Заведомое действие игрока: первый вариант либо строка, которой нет среди ответов. */
function someAnswer(question) {
  return question.answerType === 'open_answer' ? 'заведомо неверный ответ' : question.options[0].id;
}

function roundRequest(baseUrl, token, runId, path, body, expectedStatus = 200) {
  return jsonRequest(baseUrl, `/api/solo-runs/${runId}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }, expectedStatus);
}

async function verifyHttpFlow(baseUrl, readinessResponse) {
  const readiness = await readinessResponse.json();
  assert.deepEqual(readiness.checks, { d1: 'ok' });
  assert.equal(readiness.status, 'ok');
  assert.equal(readiness.environment, 'smoke');

  await jsonRequest(baseUrl, '/api/solo-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'No auth', category: 'general' }),
  }, 401);

  // Режим гонки удалён (R12): маршрута нет, а не «есть, но требует авторизации».
  // Ответ не JSON, поэтому проверяется сырым запросом.
  const removedRace = await fetch(`${baseUrl}/api/async-matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Race', category: 'geography' }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(removedRace.status, 404, 'the race route must be gone, not merely guarded');

  const tokenA = await guestSession(baseUrl);
  const runA = await startSoloRun(baseUrl, tokenA, 'Smoke A');
  assert.ok(Array.isArray(runA.questions) && runA.questions.length > 0);
  assertNoAnswers(runA.questions, 'solo start');

  // Круг идёт в два запроса: ответ, затем удар. Правильный ответ приходит только после ответа.
  const question = runA.questions[0];
  const answerBody = {
    roundIndex: 0,
    questionId: question.id,
    selectedAnswer: someAnswer(question),
    responseTimeMs: 1_000,
  };
  const verdict = await roundRequest(baseUrl, tokenA, runA.runId, 'answer', answerBody);
  assert.equal(verdict.roundIndex, 0);
  assert.equal(verdict.questionId, question.id);
  assert.equal(typeof verdict.correct, 'boolean');
  assert.ok(typeof verdict.explanation === 'string' && verdict.explanation.length > 0);

  // Повтор того же круга не считается дважды: сервер отдаёт уже записанное.
  const repeated = await roundRequest(baseUrl, tokenA, runA.runId, 'answer', answerBody);
  assert.deepEqual(repeated, verdict);

  if (verdict.awaitingHammer) {
    // Оценку удара прислать нельзя: принимается только момент удара, награду считает сервер.
    // Насколько именно момент хорош, проверяют route-тесты — здесь важно, что по HTTP
    // старый путь закрыт, невозможное время отклонено, а вердикт приходит от сервера.
    const legacy = await fetch(`${baseUrl}/api/solo-runs/${runA.runId}/hammer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ roundIndex: 0, questionId: question.id, skillDistance: 0 }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(legacy.status, 400, 'a hammer payload with a ready-made distance must be refused');

    const impossible = await fetch(`${baseUrl}/api/solo-runs/${runA.runId}/hammer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ roundIndex: 0, questionId: question.id, activeElapsedMs: 599_000 }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(impossible.status, 400, 'a tap claimed long after the round started must be refused');

    const struck = await roundRequest(baseUrl, tokenA, runA.runId, 'hammer', {
      roundIndex: 0,
      questionId: question.id,
      activeElapsedMs: 500,
    });
    assert.equal(struck.roundIndex, 0);
    assert.equal(struck.awaitingHammer, false);
    assert.equal(typeof struck.skillResult, 'string', 'the server must report the tier it derived itself');
    assert.equal(typeof struck.progressAwarded, 'number', 'the award must come from the server');
  } else {
    assert.equal(verdict.correct, false);
    assert.equal(verdict.progress, 0);
  }

  // Закрытая вкладка не теряет забег: он продолжается с уже сыгранными кругами.
  const snapshot = await jsonRequest(baseUrl, `/api/solo-runs/${runA.runId}`, {
    headers: { authorization: `Bearer ${tokenA}` },
  }, 200);
  assert.equal(snapshot.runId, runA.runId);
  assert.equal(snapshot.status, 'in_progress');
  assert.equal(snapshot.rounds.length, 1);
  assertNoAnswers(snapshot.questions, 'solo snapshot');

  // Второй игрок получает свой забег, а не чужой.
  // «На глазок»: на чистой базе вопроса дня нет (контент в миграции не сидируется), карточка прячется.
  const tiebreaker = await jsonRequest(baseUrl, '/api/tiebreaker/today', {
    headers: { authorization: `Bearer ${tokenA}` },
  }, 200);
  assert.equal(tiebreaker.question, null);
  assert.equal(tiebreaker.answered, null);
  assert.match(tiebreaker.dateKey, /^\d{4}-\d{2}-\d{2}$/);

  const tokenB = await guestSession(baseUrl);
  assert.notEqual(tokenB, tokenA);
  const runB = await startSoloRun(baseUrl, tokenB, 'Smoke B');
  assert.notEqual(runB.runId, runA.runId);
  assertNoAnswers(runB.questions, 'second solo start');
}

async function main() {
  tempDirectory = await mkdtemp(join(tmpdir(), tempPrefix));
  const persistDirectory = join(tempDirectory, 'state');
  const migrationsDirectory = join(tempDirectory, 'migrations');
  const configPath = join(tempDirectory, 'wrangler.jsonc');
  await mkdir(persistDirectory);
  await copyMigrations(migrationsDirectory);
  await writeFile(configPath, `${JSON.stringify({
    name: 'clutch-api-local-smoke',
    main: apiEntry.replaceAll('\\', '/'),
    compatibility_date: '2024-10-01',
    vars: {
      ENVIRONMENT: 'smoke',
      TELEGRAM_BOT_TOKEN: 'local-smoke-unused-bot-token',
      SESSION_SIGNING_SECRET: sessionSecret,
    },
    ratelimits: [{
      name: 'API_RATE_LIMITER',
      namespace_id: '9000001',
      simple: { limit: 1_000, period: 60 },
    }],
    d1_databases: [{
      binding: 'DB',
      database_name: 'clutch-smoke',
      database_id: '00000000-0000-4000-8000-000000000001',
      migrations_dir: 'migrations',
    }],
  }, null, 2)}\n`, 'utf8');

  console.log('Applying current migrations to an isolated local D1...');
  await runWrangler([
    'd1', 'migrations', 'apply', 'DB',
    '--local',
    '--persist-to', persistDirectory,
    '--config', configPath,
  ]);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  workerProcess = startWorker({ configPath, persistDirectory, port });
  const readinessResponse = await waitForReadiness(baseUrl);
  console.log(`Worker is ready at ${baseUrl}; running HTTP flow...`);
  await verifyHttpFlow(baseUrl, readinessResponse);
  console.log('Local Wrangler HTTP smoke passed.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (workerOutput) console.error(`Wrangler output:\n${workerOutput}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
