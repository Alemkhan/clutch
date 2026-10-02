import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProductionResourcesDistinct,
  createProductionWranglerConfig,
  parseProductionPreflightArguments,
  PRODUCTION_ENV_KEYS,
  PRODUCTION_PREFLIGHT_FIXTURE_ENV,
  productionConfigOutputPath,
  validateProductionEnvironment,
} from './lib/production-preflight.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerCli = join(repositoryRoot, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
const apiEntry = join(repositoryRoot, 'apps', 'api', 'src', 'index.ts');
const migrationsDirectory = join(repositoryRoot, 'apps', 'api', 'migrations');
const developmentWranglerConfig = join(repositoryRoot, 'apps', 'api', 'wrangler.toml');
const webDistDirectory = join(repositoryRoot, 'apps', 'web', 'dist');
const tempPrefix = 'clutch-production-preflight-';
const commandTimeoutMs = 120_000;

let tempDirectory;

function safeChildEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_EMAIL',
    'CLOUDFLARE_ENV',
    'CLOUDFLARE_INCLUDE_PROCESS_ENV',
    'CF_ACCOUNT_ID',
    'CF_API_TOKEN',
    'SESSION_SIGNING_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'CLUTCH_VITE_ENV_DIR',
    'VITE_API_URL',
    ...PRODUCTION_ENV_KEYS,
  ]) {
    delete environment[key];
  }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('VITE_')) delete environment[key];
  }
  environment.CI = 'true';
  environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  environment.WRANGLER_SEND_METRICS = 'false';
  return { ...environment, ...overrides };
}

async function terminateProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
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
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await Promise.race([exited, delay(1_000)]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error('Timed-out process tree did not terminate.');
  }
}

async function runCommand(command, arguments_, options) {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    windowsHide: true,
  });
  await new Promise((resolveExit, rejectExit) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateProcess(child).catch(rejectExit);
    }, commandTimeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        rejectExit(new Error(`${options.label} timed out.`));
        return;
      }
      if (code === 0) resolveExit();
      else rejectExit(new Error(
        `${options.label} failed with ${code === null ? `signal ${signal}` : `exit ${code}`}.`,
      ));
    });
  });
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return nested.flat();
}

async function verifyWorkerBundle(bundleDirectory) {
  const files = await filesBelow(bundleDirectory);
  const JavaScriptFiles = files.filter((file) => file.endsWith('.js'));
  assert.ok(JavaScriptFiles.length > 0, 'Wrangler dry-run did not produce a JavaScript bundle.');
  const sizes = await Promise.all(JavaScriptFiles.map(async (file) => (await stat(file)).size));
  assert.ok(sizes.some((size) => size > 0), 'Wrangler dry-run bundle is empty.');
}

async function verifyWebBuild(apiUrl) {
  const files = await filesBelow(webDistDirectory);
  assert.ok(files.some((file) => basename(file) === 'index.html'), 'Web build has no index.html.');
  const expected = Buffer.from(apiUrl);
  for (const file of files) {
    if ((await readFile(file)).includes(expected)) return;
  }
  throw new Error('Built web client does not contain the exact production API URL.');
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function cleanup() {
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
}

async function main() {
  const options = parseProductionPreflightArguments(process.argv.slice(2));
  const inputs = validateProductionEnvironment(
    options.testFixture ? PRODUCTION_PREFLIGHT_FIXTURE_ENV : process.env,
  );
  const developmentConfigText = await readFile(developmentWranglerConfig, 'utf8');
  assertProductionResourcesDistinct(inputs, developmentConfigText);
  tempDirectory = await mkdtemp(join(tmpdir(), tempPrefix));
  const configPath = join(tempDirectory, 'wrangler.production.jsonc');
  const workerBundleDirectory = join(tempDirectory, 'worker-bundle');
  const emptyWebEnvDirectory = join(tempDirectory, 'web-env');
  const config = createProductionWranglerConfig(inputs, {
    main: apiEntry,
    migrations: migrationsDirectory,
  });
  const serializedConfig = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(configPath, serializedConfig, 'utf8');
  await mkdir(emptyWebEnvDirectory);

  console.log('Building the production Worker bundle with Wrangler dry-run...');
  await runCommand(process.execPath, [
    wranglerCli,
    'deploy',
    '--dry-run',
    '--outdir', workerBundleDirectory,
    '--config', configPath,
  ], {
    cwd: tempDirectory,
    env: safeChildEnvironment(),
    label: 'Wrangler production dry-run',
  });
  await verifyWorkerBundle(workerBundleDirectory);

  console.log('Running the full production web build with the validated API URL...');
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is required to run the production build safely.');
  await runCommand(process.execPath, [npmCli, 'run', 'build'], {
    cwd: repositoryRoot,
    env: safeChildEnvironment({
      CLUTCH_VITE_ENV_DIR: emptyWebEnvDirectory,
      VITE_API_URL: inputs.apiUrl,
    }),
    label: 'Production web build',
  });
  await verifyWebBuild(inputs.apiUrl);

  if (options.writeConfig) {
    const outputPath = productionConfigOutputPath(repositoryRoot);
    try {
      await writeFile(outputPath, serializedConfig, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Refusing to overwrite existing ${outputPath}. Remove it explicitly before regenerating.`);
      }
      throw error;
    }
    console.log(`Validated production config written to ${outputPath}.`);
  }

  console.log(`Production preflight passed for Worker "${inputs.workerName}" and Pages "${inputs.pagesProjectName}".`);
  console.log('No upload, deploy, remote migration, secret mutation, or Cloudflare API call was performed.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
