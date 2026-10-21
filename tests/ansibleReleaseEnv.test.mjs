import { describe, expect, it } from 'vitest';
import { parseReleaseEnv } from '../ops/ansible/read-release-env.mjs';

describe('Ansible release.env loader', () => {
  it('returns only allowlisted public production settings', () => {
    expect(parseReleaseEnv(`
      # Secrets and unrelated environment values must not reach Ansible.
      CLUTCH_PRODUCTION_WORKER_NAME=clutch-api-prod
      TELEGRAM_BOT_TOKEN=must-not-leak
      CLUTCH_PRODUCTION_API_URL=https://api.example.test
      PATH=must-not-leak
    `)).toEqual({
      CLUTCH_PRODUCTION_WORKER_NAME: 'clutch-api-prod',
      CLUTCH_PRODUCTION_API_URL: 'https://api.example.test',
    });
  });

  it('rejects duplicate allowlisted keys', () => {
    expect(() => parseReleaseEnv(`
      CLUTCH_PAGES_PROJECT_NAME=one
      CLUTCH_PAGES_PROJECT_NAME=two
    `)).toThrow(/Duplicate release\.env key/);
  });

  it('rejects malformed non-comment lines', () => {
    expect(() => parseReleaseEnv('CLUTCH_PRODUCTION_WORKER_NAME')).toThrow(/Invalid release\.env line/);
  });
});
