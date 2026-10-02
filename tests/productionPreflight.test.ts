/// <reference types="node" />

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertProductionResourcesDistinct,
  createProductionWranglerConfig,
  parseProductionPreflightArguments,
  PRODUCTION_ENV_KEYS,
  PRODUCTION_PREFLIGHT_FIXTURE_ENV,
  productionConfigOutputPath,
  validateProductionEnvironment,
} from '../scripts/lib/production-preflight.mjs';

const developmentConfig = `
name = "clutch-api-dev"
[[ratelimits]]
namespace_id = "1234567"
[[d1_databases]]
database_id = "22222222-2222-4222-8222-222222222222"
`;

describe('production preflight configuration', () => {
  it('requires every explicit production value without exposing supplied values', () => {
    expect(() => validateProductionEnvironment({})).toThrow(
      new RegExp(PRODUCTION_ENV_KEYS.join('.*'), 's'),
    );
    expect(() => validateProductionEnvironment({
      CLUTCH_PRODUCTION_WORKER_NAME: 'private VALUE',
    })).toThrowError(/CLUTCH_PRODUCTION_WORKER_NAME must be/u);
    try {
      validateProductionEnvironment({ CLUTCH_PRODUCTION_WORKER_NAME: 'private VALUE' });
    } catch (error) {
      expect(String(error)).not.toContain('private VALUE');
    }
  });

  it.each([
    ['CLUTCH_PRODUCTION_WORKER_NAME', 'Uppercase'],
    ['CLUTCH_PRODUCTION_D1_NAME', 'spaces are unsafe'],
    ['CLUTCH_PRODUCTION_D1_ID', 'not-a-uuid'],
    ['CLUTCH_PRODUCTION_D1_ID', '00000000-0000-0000-0000-000000000000'],
    ['CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID', '12x'],
    ['CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID', '0'],
    ['CLUTCH_PAGES_PROJECT_NAME', '-leading-hyphen'],
  ])('rejects invalid %s', (key, value) => {
    expect(() => validateProductionEnvironment({
      ...PRODUCTION_PREFLIGHT_FIXTURE_ENV,
      [key]: value,
    })).toThrowError(new RegExp(key));
  });

  it.each([
    'http://api.clutch.invalid',
    'https://user:password@api.clutch.invalid',
    'https://api.clutch.invalid?mode=production',
    'https://api.clutch.invalid#fragment',
    'not a URL',
  ])('rejects unsafe API URL %s', (apiUrl) => {
    expect(() => validateProductionEnvironment({
      ...PRODUCTION_PREFLIGHT_FIXTURE_ENV,
      CLUTCH_PRODUCTION_API_URL: apiUrl,
    })).toThrowError(/CLUTCH_PRODUCTION_API_URL/u);
  });

  it('normalizes only trailing slashes in the API URL', () => {
    expect(validateProductionEnvironment({
      ...PRODUCTION_PREFLIGHT_FIXTURE_ENV,
      CLUTCH_PRODUCTION_API_URL: 'https://api.clutch.invalid/base///',
    }).apiUrl).toBe('https://api.clutch.invalid/base');
  });

  it('generates an exact production-only Wrangler config', () => {
    const inputs = validateProductionEnvironment(PRODUCTION_PREFLIGHT_FIXTURE_ENV);
    const main = resolve('fixture-root', 'apps', 'api', 'src', 'index.ts');
    const migrations = resolve('fixture-root', 'apps', 'api', 'migrations');
    expect(createProductionWranglerConfig(inputs, {
      main,
      migrations,
    })).toEqual({
      name: 'clutch-api-production-fixture',
      main: main.replaceAll('\\', '/'),
      compatibility_date: '2024-10-01',
      vars: { ENVIRONMENT: 'production' },
      ratelimits: [{
        name: 'API_RATE_LIMITER',
        namespace_id: '9000002',
        simple: { limit: 30, period: 60 },
      }],
      d1_databases: [{
        binding: 'DB',
        database_name: 'clutch-production-fixture',
        database_id: '11111111-1111-4111-8111-111111111111',
        migrations_dir: migrations.replaceAll('\\', '/'),
      }],
      observability: { enabled: true },
    });
  });

  it('rejects relative source paths', () => {
    const inputs = validateProductionEnvironment(PRODUCTION_PREFLIGHT_FIXTURE_ENV);
    expect(() => createProductionWranglerConfig(inputs, {
      main: 'apps/api/src/index.ts',
      migrations: 'apps/api/migrations',
    })).toThrowError(/must be absolute/u);
  });

  it.each([
    ['CLUTCH_PRODUCTION_WORKER_NAME', 'clutch-api-dev', /WORKER_NAME/u],
    ['CLUTCH_PRODUCTION_D1_ID', '22222222-2222-4222-8222-222222222222', /D1_ID/u],
    ['CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID', '1234567', /NAMESPACE_ID/u],
  ])('rejects production resource reuse through %s', (key, value, message) => {
    const inputs = validateProductionEnvironment({
      ...PRODUCTION_PREFLIGHT_FIXTURE_ENV,
      [key]: value,
    });
    expect(() => assertProductionResourcesDistinct(inputs, developmentConfig))
      .toThrowError(message);
  });

  it('fails closed when tracked development resource IDs cannot be read', () => {
    const inputs = validateProductionEnvironment(PRODUCTION_PREFLIGHT_FIXTURE_ENV);
    expect(() => assertProductionResourcesDistinct(inputs, 'name = "only-name"'))
      .toThrowError(/missing database_id/u);
  });

  it('allows config persistence only in explicit real mode', () => {
    expect(parseProductionPreflightArguments([])).toEqual({
      testFixture: false,
      writeConfig: false,
    });
    expect(parseProductionPreflightArguments(['--write-config'])).toEqual({
      testFixture: false,
      writeConfig: true,
    });
    expect(parseProductionPreflightArguments(['--test-fixture'])).toEqual({
      testFixture: true,
      writeConfig: false,
    });
    expect(() => parseProductionPreflightArguments(['--test-fixture', '--write-config']))
      .toThrowError(/not allowed/u);
    expect(() => parseProductionPreflightArguments(['--write-config', '--write-config']))
      .toThrowError(/Usage/u);
    expect(() => parseProductionPreflightArguments(['--unknown']))
      .toThrowError(/Usage/u);
  });

  it('uses one fixed generated config path inside apps/api', () => {
    const repositoryRoot = resolve('fixture-root');
    expect(productionConfigOutputPath(repositoryRoot)).toBe(
      resolve(repositoryRoot, 'apps', 'api', 'wrangler.production.generated.jsonc'),
    );
    expect(() => productionConfigOutputPath('relative-root')).toThrowError(/must be absolute/u);
  });
});
