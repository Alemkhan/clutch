/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it } from 'vitest';
import {
  GUEST_RENEWAL_GRACE_MS,
  GUEST_SESSION_TTL_MS,
  issueGuestSession,
  verifyGuestToken,
} from '../apps/api/src/auth/guest';

const secret = 'test-session-signing-secret-at-least-32-characters';
const subject = '123e4567-e89b-42d3-a456-426614174000';
const now = 1_800_000_000_000;

describe('guest sessions', () => {
  it('issues and verifies a deterministic signed identity', async () => {
    const session = await issueGuestSession(secret, now, subject);
    expect(session).not.toBeNull();
    expect(session?.expiresAt).toBe(now + GUEST_SESSION_TTL_MS);
    await expect(verifyGuestToken(session!.token, secret, now)).resolves.toEqual({
      playerId: `guest:${subject}`,
      expiresAt: now + GUEST_SESSION_TTL_MS,
    });
  });

  it('rejects tampering, malformed tokens, expiry, and a different secret', async () => {
    const session = (await issueGuestSession(secret, now, subject))!;
    await expect(verifyGuestToken(`${session.token.slice(0, -1)}x`, secret, now)).resolves.toBeNull();
    await expect(verifyGuestToken('not.a.token.with.extra.parts', secret, now)).resolves.toBeNull();
    await expect(verifyGuestToken(session.token, secret, session.expiresAt)).resolves.toBeNull();
    await expect(verifyGuestToken(
      session.token,
      'different-session-signing-secret-at-least-32-chars',
      now,
    )).resolves.toBeNull();
  });

  it('accepts an expired token only for renewal, and only within the grace period', async () => {
    const session = (await issueGuestSession(secret, now, subject))!;
    const monthLater = session.expiresAt + 30 * 24 * 60 * 60 * 1000;
    await expect(verifyGuestToken(session.token, secret, monthLater)).resolves.toBeNull();
    await expect(verifyGuestToken(session.token, secret, monthLater, { renewalGraceMs: GUEST_RENEWAL_GRACE_MS }))
      .resolves.toMatchObject({ playerId: `guest:${subject}` });
    await expect(verifyGuestToken(session.token, secret, session.expiresAt + GUEST_RENEWAL_GRACE_MS, {
      renewalGraceMs: GUEST_RENEWAL_GRACE_MS,
    })).resolves.toBeNull();
  });

  it('fails closed for missing and short secrets', async () => {
    await expect(issueGuestSession(undefined, now, subject)).resolves.toBeNull();
    await expect(issueGuestSession('short', now, subject)).resolves.toBeNull();
    const session = (await issueGuestSession(secret, now, subject))!;
    await expect(verifyGuestToken(session.token, undefined, now)).resolves.toBeNull();
    await expect(verifyGuestToken(session.token, 'short', now)).resolves.toBeNull();
  });
});
