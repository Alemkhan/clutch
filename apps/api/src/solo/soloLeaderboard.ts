import {
  CURRENT_SOLO_RUN_CONDITIONS,
  dailyKey,
  dayStartMs,
  type SoloLeaderboardResponse,
} from '@clutch/shared';
import { soloLeaderboard, soloStanding } from './soloRepository';
import { categories } from './validation';
import { authenticate, type AppContext } from './soloShared';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

// Таблица соло за сутки по UTC: лучший забег каждого игрока, только дошедшие до цели.
export async function handleSoloLeaderboard(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-board');
  if (identity instanceof Response) return identity;
  const category = c.req.query('category') ?? 'general';
  if (!categories.has(category)) return c.json({ error: 'Invalid category.' }, 400);
  const dateKey = c.req.query('date') ?? dailyKey(Date.now());
  const dayStart = DATE_KEY.test(dateKey) ? dayStartMs(dateKey) : Number.NaN;
  if (!Number.isFinite(dayStart) || dailyKey(dayStart) !== dateKey) {
    return c.json({ error: 'Invalid date.' }, 400);
  }
  // Своё место считается отдельным запросом по тому же окну: попадание в топ-50 на него не влияет,
  // иначе не попавший в список игрок не видел бы о себе ничего.
  const [entries, you] = await Promise.all([
    soloLeaderboard(
      c.env.DB,
      category,
      CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
      dayStart,
      dayStart + DAY_MS,
      dateKey,
    ),
    soloStanding(
      c.env.DB,
      category,
      CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
      dayStart,
      dayStart + DAY_MS,
      dateKey,
      identity.playerId,
    ),
  ]);
  const response: SoloLeaderboardResponse = {
    category: category as SoloLeaderboardResponse['category'],
    dateKey,
    entries,
    you,
  };
  return c.json(response);
}
