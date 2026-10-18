import { MINI_GAME_IDS, hashSeed, isMiniGameId, type MiniGameId } from '@clutch/shared';

/** Источник случайности в [0, 1); подменяется в тестах. */
export type RandomSource = () => number;

export const cryptoRandom: RandomSource = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 0x1_0000_0000;
};

/**
 * Игра нового забега. Есть запись человека как темп: играем в ту же игру, что и она. Записи нет
 * (забег без темпа) или соперник — бот: случайно, поровну между играми.
 */
export function pickMiniGameId(
  ghost: { row: { mini_game_id: string | null } } | null,
  random: RandomSource = cryptoRandom,
): MiniGameId {
  const inherited = ghost?.row.mini_game_id;
  if (isMiniGameId(inherited)) return inherited;
  return MINI_GAME_IDS[Math.min(MINI_GAME_IDS.length - 1, Math.floor(random() * MINI_GAME_IDS.length))];
}

/**
 * Игра забега дня: одна на категорию и сутки, у всех одинаковая. Набор дня общий, и таблица
 * сравнивает круги: разные игры у соседей по таблице сделали бы сравнение нечестным.
 */
export function dailyMiniGameId(category: string, dateKey: string): MiniGameId {
  return MINI_GAME_IDS[hashSeed(`daily-game:${category}:${dateKey}`) % MINI_GAME_IDS.length];
}
