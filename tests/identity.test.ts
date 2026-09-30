/// <reference types="@cloudflare/workers-types" />

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueGuestSession } from '../apps/api/src/auth/guest';
import { resolveRequestIdentity } from '../apps/api/src/auth/identity';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const telegramToken = '123456:test-token';
const env = { SESSION_SIGNING_SECRET: sessionSecret, TELEGRAM_BOT_TOKEN: telegramToken };

function telegramInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, first_name: 'Alem' }),
  });
  const checked = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(telegramToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checked).digest('hex'));
  return params.toString();
}

describe('request identity resolver', () => {
  it('accepts authorization schemes case-insensitively', async () => {
    const guest = await issueGuestSession(
      sessionSecret,
      Date.now(),
      '123e4567-e89b-42d3-a456-426614174000',
    );
    await expect(resolveRequestIdentity(`bEaReR ${guest!.token}`, env)).resolves.toEqual({
      playerId: 'guest:123e4567-e89b-42d3-a456-426614174000',
      kind: 'guest',
    });
    await expect(resolveRequestIdentity(`TmA ${telegramInitData()}`, env)).resolves.toMatchObject({
      playerId: 'telegram:42',
      displayName: 'Alem',
      kind: 'telegram',
    });
  });

  it('rejects malformed spacing and oversized Telegram initData', async () => {
    await expect(resolveRequestIdentity('Bearer  token', env)).resolves.toBeNull();
    await expect(resolveRequestIdentity(`tma ${'a'.repeat(8193)}`, env)).resolves.toBeNull();
  });
});
