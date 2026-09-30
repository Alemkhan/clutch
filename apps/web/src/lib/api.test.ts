import { describe, expect, it } from 'vitest';
import { guestRenewalAuthorization, isGuestSessionUsable } from './api';

describe('browser guest session validity', () => {
  const now = 1_800_000_000_000;

  it('requires validity beyond the refresh window', () => {
    expect(isGuestSessionUsable({ token: 'token', expiresAt: now + 300_001 }, now)).toBe(true);
    expect(isGuestSessionUsable({ token: 'token', expiresAt: now + 300_000 }, now)).toBe(false);
  });

  it('rejects invalid stored shapes', () => {
    expect(isGuestSessionUsable(null, now)).toBe(false);
    expect(isGuestSessionUsable({ token: '', expiresAt: now + 1_000_000 }, now)).toBe(false);
    expect(isGuestSessionUsable({ token: 'token', expiresAt: 'later' }, now)).toBe(false);
  });

  it('renews with the prior bearer only while the cached session is unexpired', () => {
    const session = { token: 'prior-token', expiresAt: now + 1 };
    expect(guestRenewalAuthorization(session, now)).toBe('Bearer prior-token');
    expect(guestRenewalAuthorization({ ...session, expiresAt: now }, now)).toBeNull();
    expect(guestRenewalAuthorization({ token: '', expiresAt: now + 1 }, now)).toBeNull();
  });
});
