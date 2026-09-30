export interface TelegramUserPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

async function hmacSha256(
  key: Uint8Array,
  value: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function validateTelegramInitData(
  raw: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TelegramUserPayload | null> {
  const params = new URLSearchParams(raw);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  const userJson = params.get('user');
  if (!receivedHash || !Number.isInteger(authDate) || !userJson || !botToken) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const encoder = new TextEncoder();
  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const calculatedHash = bytesToHex(await hmacSha256(secretKey, dataCheckString));
  if (!equalHex(calculatedHash, receivedHash.toLowerCase())) return null;

  const now = nowSeconds;
  if (authDate > now + 300 || now - authDate > 86_400) return null;

  try {
    const user = JSON.parse(userJson) as TelegramUserPayload;
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') return null;
    return user;
  } catch {
    return null;
  }
}
