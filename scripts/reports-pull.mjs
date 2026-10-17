// Снимок prod-D1 для отчётов telemetry-view.
//
// `wrangler d1 export <db> --remote` выгружает SQL, скрипт собирает из него .sqlite в
// git-ignored каталоге /.prod-data/ (node:sqlite) и печатает, как запускать отчёты.
// Только читает remote: ничего в prod не пишет. Имя базы берётся из
// apps/api/wrangler.production.generated.jsonc (его создаёт preflight:production:write-config).
//
// Запуск: npm run reports:pull

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// createRequire: vitest (vite) не умеет резолвить node:sqlite через import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROD_CONFIG = join(repositoryRoot, 'apps', 'api', 'wrangler.production.generated.jsonc');
export const PROD_DATA_DIRECTORY = join(repositoryRoot, '.prod-data');

export class PullError extends Error {}

/** Имя D1-базы из jsonc-конфига; регулярка, чтобы не зависеть от комментариев в файле. */
export function readDatabaseName(configText) {
  const match = /"database_name"\s*:\s*"([^"]+)"/.exec(configText);
  return match ? match[1] : null;
}

/** Собирает .sqlite из SQL-выгрузки; существующий файл перезаписывается. */
export function buildSqliteFromSql(sqlPath, sqlitePath) {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  rmSync(sqlitePath, { force: true });
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(readFileSync(sqlPath, 'utf8'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    return tables;
  } finally {
    db.close();
  }
}

function defaultExport(databaseName, configPath, sqlPath) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npx,
    ['wrangler', 'd1', 'export', databaseName, '--remote', '--output', sqlPath, '--config', configPath],
    { cwd: repositoryRoot, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) throw new PullError(`wrangler d1 export завершился с кодом ${result.status ?? 'неизвестно'}.`);
}

/**
 * runExport(databaseName, configPath, sqlPath) подменяется в тестах; по умолчанию вызывает wrangler.
 * Возвращает путь к собранному .sqlite.
 */
export function pull({ configPath = PROD_CONFIG, outputDirectory = PROD_DATA_DIRECTORY, runExport = defaultExport, now = new Date() } = {}) {
  if (!existsSync(configPath)) {
    throw new PullError('Нет apps/api/wrangler.production.generated.jsonc. Сначала: npm run preflight:production:write-config');
  }
  const databaseName = readDatabaseName(readFileSync(configPath, 'utf8'));
  if (!databaseName) throw new PullError('В wrangler.production.generated.jsonc не найден database_name.');

  const workDirectory = mkdtempSync(join(tmpdir(), 'clutch-d1-export-'));
  const sqlPath = join(workDirectory, 'export.sql');
  try {
    runExport(databaseName, configPath, sqlPath);
    if (!existsSync(sqlPath)) throw new PullError('wrangler не создал файл выгрузки.');
    const stamp = now.toISOString().slice(0, 10);
    const sqlitePath = join(outputDirectory, `prod-${stamp}.sqlite`);
    buildSqliteFromSql(sqlPath, sqlitePath);
    return sqlitePath;
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

function main() {
  try {
    const sqlitePath = pull();
    const shown = relative(repositoryRoot, sqlitePath).replace(/\\/g, '/');
    console.log(`Снимок prod собран: ${shown}`);
    console.log('Отчёты на нём:');
    for (const command of ['funnel', 'retention', 'errors', 'activity', 'reports']) {
      console.log(`  npm run ${command} -- --db ${shown}`);
    }
  } catch (error) {
    if (error instanceof PullError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
