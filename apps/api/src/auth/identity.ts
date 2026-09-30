import type { Env } from '../env';
import { verifyGuestToken } from './guest';
import { validateTelegramInitData } from './telegram';

export interface RequestIdentity {
  playerId: string;
  displayName?: string;
  kind: 'guest' | 'telegram';
}

export async function resolveRequestIdentity(
  authorization: string | undefined,
  env: Pick<Env, 'SESSION_SIGNING_SECRET' | 'TELEGRAM_BOT_TOKEN'>,
): Promise<RequestIdentity | null> {
  if (!authorization) return null;
  const telegramMatch = /^tma ([^\s]+)$/iu.exec(authorization);
  if (telegramMatch) {
    const raw = telegramMatch[1];
    if (raw.length > 8192) return null;
    const user = await validateTelegramInitData(raw, env.TELEGRAM_BOT_TOKEN);
    if (!user) return null;
    return {
      playerId: `telegram:${user.id}`,
      displayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
      kind: 'telegram',
    };
  }
  const bearerMatch = /^bearer ([^\s]+)$/iu.exec(authorization);
  if (bearerMatch) {
    const verified = await verifyGuestToken(bearerMatch[1], env.SESSION_SIGNING_SECRET);
    return verified ? { playerId: verified.playerId, kind: 'guest' } : null;
  }
  return null;
}
