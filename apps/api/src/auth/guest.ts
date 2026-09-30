const TOKEN_VERSION = 1;
const MIN_SECRET_LENGTH = 32;
export const GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface GuestTokenPayload {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface GuestSession {
  token: string;
  expiresAt: number;
  playerId: string;
}

function validSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

function parsePayload(bytes: Uint8Array): GuestTokenPayload | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (Object.keys(value).sort().join(',') !== 'exp,iat,sub,v'
      || value.v !== TOKEN_VERSION
      || typeof value.sub !== 'string'
      || !uuidPattern.test(value.sub)
      || !Number.isSafeInteger(value.iat)
      || !Number.isSafeInteger(value.exp)
      || (value.iat as number) <= 0
      || (value.exp as number) <= (value.iat as number)) return null;
    return value as unknown as GuestTokenPayload;
  } catch {
    return null;
  }
}

export async function issueGuestSession(
  secret: string | undefined,
  nowMs = Date.now(),
  subject = crypto.randomUUID(),
): Promise<GuestSession | null> {
  if (!validSecret(secret) || !Number.isSafeInteger(nowMs) || nowMs <= 0
    || !uuidPattern.test(subject)) return null;
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt * 1000 + GUEST_SESSION_TTL_MS;
  const payload: GuestTokenPayload = { v: TOKEN_VERSION, sub: subject, iat: issuedAt, exp: expiresAt / 1000 };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signedValue = `v${TOKEN_VERSION}.${encodedPayload}`;
  const signature = base64UrlEncode(await hmac(secret, signedValue));
  return { token: `${signedValue}.${signature}`, expiresAt, playerId: `guest:${subject}` };
}

export async function verifyGuestToken(
  token: string,
  secret: string | undefined,
  nowMs = Date.now(),
): Promise<{ playerId: string; expiresAt: number } | null> {
  if (!validSecret(secret) || typeof token !== 'string' || token.length > 2048
    || !Number.isSafeInteger(nowMs) || nowMs <= 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== `v${TOKEN_VERSION}`) return null;
  const payloadBytes = base64UrlDecode(parts[1]);
  const receivedSignature = base64UrlDecode(parts[2]);
  if (!payloadBytes || !receivedSignature) return null;
  const expectedSignature = await hmac(secret, `${parts[0]}.${parts[1]}`);
  if (!equalBytes(expectedSignature, receivedSignature)) return null;
  const payload = parsePayload(payloadBytes);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!payload || payload.iat > nowSeconds + 300 || payload.exp <= nowSeconds) return null;
  return { playerId: `guest:${payload.sub}`, expiresAt: payload.exp * 1000 };
}

export function hasValidSessionSecret(secret: string | undefined): boolean {
  return validSecret(secret);
}
