import type { RequestIdentity } from './identity';

/** Имя, которое клиент сам выдаёт гостю: «Игрок» и 4 hex-символа (apps/web getPlayerName). */
const GUEST_NAME = /^Игрок [0-9a-f]{4}$/u;

/**
 * Имя игрока для таблиц и снимков соперника. Telegram-игрок — имя из подписанных initData.
 * Гость своё имя не задаёт: свободный текст из тела запроса попадал бы в общие рейтинги без
 * модерации (App Store 1.2). Принимается только сгенерированное «Игрок xxxx», иначе имя
 * выводится из id гостя.
 */
export function playerDisplayName(identity: RequestIdentity, requested?: string): string {
  const own = identity.displayName?.trim();
  if (own) return own;
  const candidate = requested?.trim() ?? '';
  if (GUEST_NAME.test(candidate)) return candidate;
  const suffix = identity.playerId.replace(/^guest:/u, '').replace(/[^0-9a-f]/giu, '').slice(0, 4).toLowerCase();
  return suffix.length === 4 ? `Игрок ${suffix}` : 'Игрок';
}
