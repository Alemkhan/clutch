import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from '../apps/api/src/auth/telegram';

const token = '123456:test-token';

function signedInitData(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'test-query',
    user: JSON.stringify({ id: 42, first_name: 'Alem', last_name: 'Test' }),
    ...overrides,
  });
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('validateTelegramInitData', () => {
  it('accepts a correctly signed current payload', async () => {
    await expect(validateTelegramInitData(signedInitData(), token)).resolves.toEqual({
      id: 42,
      first_name: 'Alem',
      last_name: 'Test',
    });
  });

  it('rejects a modified payload', async () => {
    const raw = signedInitData().replace('Alem', 'Mallory');
    await expect(validateTelegramInitData(raw, token)).resolves.toBeNull();
  });

  it('rejects expired init data', async () => {
    const oldAuthDate = String(Math.floor(Date.now() / 1000) - 90_000);
    await expect(validateTelegramInitData(signedInitData({ auth_date: oldAuthDate }), token))
      .resolves.toBeNull();
  });
});
