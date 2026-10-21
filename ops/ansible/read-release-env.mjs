import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const allowedKeys = new Set([
  'CLUTCH_PRODUCTION_WORKER_NAME',
  'CLUTCH_PRODUCTION_D1_NAME',
  'CLUTCH_PRODUCTION_D1_ID',
  'CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID',
  'CLUTCH_PRODUCTION_API_URL',
  'CLUTCH_PAGES_PROJECT_NAME',
  'CLUTCH_PRODUCTION_TELEGRAM_MINI_APP_LINK',
  'CLUTCH_PRODUCTION_TELEGRAM_BOT_LINK',
  'CLUTCH_PRODUCTION_PUBLIC_WEB_ORIGIN',
]);

export function parseReleaseEnv(source) {
  const values = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsAt = line.indexOf('=');
    if (equalsAt < 1) throw new Error(`Invalid release.env line ${index + 1}.`);
    const key = line.slice(0, equalsAt).trim();
    const value = line.slice(equalsAt + 1).trim();
    if (!allowedKeys.has(key)) continue;
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate release.env key at line ${index + 1}.`);
    values[key] = value;
  }
  return values;
}

async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) {
    console.error('Usage: node ops/ansible/read-release-env.mjs <release.env>');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(JSON.stringify(parseReleaseEnv(await readFile(path, 'utf8'))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
