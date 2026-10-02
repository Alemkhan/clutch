import { isAbsolute, join } from 'node:path';

export const PRODUCTION_ENV_KEYS = [
  'CLUTCH_PRODUCTION_WORKER_NAME',
  'CLUTCH_PRODUCTION_D1_NAME',
  'CLUTCH_PRODUCTION_D1_ID',
  'CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID',
  'CLUTCH_PRODUCTION_API_URL',
  'CLUTCH_PAGES_PROJECT_NAME',
];

export function parseProductionPreflightArguments(arguments_) {
  const known = new Set(['--test-fixture', '--write-config']);
  const unknown = arguments_.filter((argument) => !known.has(argument));
  const duplicated = arguments_.filter((argument, index) => arguments_.indexOf(argument) !== index);
  if (unknown.length > 0 || duplicated.length > 0) {
    throw new Error('Usage: node scripts/preflight-production.mjs [--test-fixture | --write-config]');
  }
  const testFixture = arguments_.includes('--test-fixture');
  const writeConfig = arguments_.includes('--write-config');
  if (testFixture && writeConfig) {
    throw new Error('--write-config is not allowed with --test-fixture.');
  }
  return { testFixture, writeConfig };
}

export function productionConfigOutputPath(repositoryRoot) {
  if (!isAbsolute(repositoryRoot)) throw new Error('Repository root must be absolute.');
  return join(repositoryRoot, 'apps', 'api', 'wrangler.production.generated.jsonc');
}

const resourceNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredValue(environment, key, errors) {
  const value = environment[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${key} is required.`);
    return undefined;
  }
  return value.trim();
}

function validateResourceName(value, key, errors) {
  if (value !== undefined && !resourceNamePattern.test(value)) {
    errors.push(`${key} must be a lowercase Cloudflare resource name using letters, numbers, and hyphens.`);
  }
}

function normalizeApiUrl(value, errors) {
  if (value === undefined) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push('CLUTCH_PRODUCTION_API_URL must be a valid absolute URL.');
    return undefined;
  }
  if (url.protocol !== 'https:') {
    errors.push('CLUTCH_PRODUCTION_API_URL must use https.');
  }
  if (url.username || url.password) {
    errors.push('CLUTCH_PRODUCTION_API_URL must not contain credentials.');
  }
  if (value.includes('?') || value.includes('#')) {
    errors.push('CLUTCH_PRODUCTION_API_URL must not contain a query or hash.');
  }
  if (errors.some((error) => error.startsWith('CLUTCH_PRODUCTION_API_URL'))) {
    return undefined;
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname === '' ? '' : pathname}`;
}

export function validateProductionEnvironment(environment) {
  const errors = [];
  const workerName = requiredValue(environment, 'CLUTCH_PRODUCTION_WORKER_NAME', errors);
  const d1Name = requiredValue(environment, 'CLUTCH_PRODUCTION_D1_NAME', errors);
  const d1Id = requiredValue(environment, 'CLUTCH_PRODUCTION_D1_ID', errors);
  const rateLimitNamespaceId = requiredValue(
    environment,
    'CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID',
    errors,
  );
  const rawApiUrl = requiredValue(environment, 'CLUTCH_PRODUCTION_API_URL', errors);
  const pagesProjectName = requiredValue(environment, 'CLUTCH_PAGES_PROJECT_NAME', errors);

  validateResourceName(workerName, 'CLUTCH_PRODUCTION_WORKER_NAME', errors);
  validateResourceName(d1Name, 'CLUTCH_PRODUCTION_D1_NAME', errors);
  validateResourceName(pagesProjectName, 'CLUTCH_PAGES_PROJECT_NAME', errors);
  if (d1Id !== undefined && (!uuidPattern.test(d1Id)
    || d1Id.toLowerCase() === '00000000-0000-0000-0000-000000000000')) {
    errors.push('CLUTCH_PRODUCTION_D1_ID must be a non-nil UUID.');
  }
  if (rateLimitNamespaceId !== undefined && !/^[1-9]\d*$/.test(rateLimitNamespaceId)) {
    errors.push('CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID must be a positive numeric ID.');
  }
  const apiUrl = normalizeApiUrl(rawApiUrl, errors);

  if (errors.length > 0) {
    throw new Error(`Production preflight configuration is invalid:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return { workerName, d1Name, d1Id, rateLimitNamespaceId, apiUrl, pagesProjectName };
}

export function createProductionWranglerConfig(inputs, paths) {
  if (!isAbsolute(paths.main) || !isAbsolute(paths.migrations)) {
    throw new Error('Production Wrangler main and migrations paths must be absolute.');
  }
  return {
    name: inputs.workerName,
    main: paths.main.replaceAll('\\', '/'),
    compatibility_date: '2024-10-01',
    vars: { ENVIRONMENT: 'production' },
    ratelimits: [{
      name: 'API_RATE_LIMITER',
      namespace_id: inputs.rateLimitNamespaceId,
      simple: { limit: 30, period: 60 },
    }],
    d1_databases: [{
      binding: 'DB',
      database_name: inputs.d1Name,
      database_id: inputs.d1Id,
      migrations_dir: paths.migrations.replaceAll('\\', '/'),
    }],
    observability: { enabled: true },
  };
}

function trackedValue(configText, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'mu').exec(configText);
  if (!match) throw new Error(`Development Wrangler config is missing ${key}.`);
  return match[1];
}

export function assertProductionResourcesDistinct(inputs, developmentConfigText) {
  const developmentWorkerName = trackedValue(developmentConfigText, 'name');
  const developmentD1Id = trackedValue(developmentConfigText, 'database_id');
  const developmentRateLimitId = trackedValue(developmentConfigText, 'namespace_id');
  const conflicts = [];
  if (inputs.workerName === developmentWorkerName) {
    conflicts.push('CLUTCH_PRODUCTION_WORKER_NAME matches the development Worker.');
  }
  if (inputs.d1Id.toLowerCase() === developmentD1Id.toLowerCase()) {
    conflicts.push('CLUTCH_PRODUCTION_D1_ID matches the development D1 database.');
  }
  if (inputs.rateLimitNamespaceId === developmentRateLimitId) {
    conflicts.push('CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID matches the development namespace.');
  }
  if (conflicts.length > 0) {
    throw new Error(`Production resources must be distinct from development:\n${conflicts.map((conflict) => `- ${conflict}`).join('\n')}`);
  }
}

export const PRODUCTION_PREFLIGHT_FIXTURE_ENV = Object.freeze({
  CLUTCH_PRODUCTION_WORKER_NAME: 'clutch-api-production-fixture',
  CLUTCH_PRODUCTION_D1_NAME: 'clutch-production-fixture',
  CLUTCH_PRODUCTION_D1_ID: '11111111-1111-4111-8111-111111111111',
  CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID: '9000002',
  CLUTCH_PRODUCTION_API_URL: 'https://api.clutch.invalid/',
  CLUTCH_PAGES_PROJECT_NAME: 'clutch-production-fixture',
});
