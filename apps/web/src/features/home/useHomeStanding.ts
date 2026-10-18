import { useEffect, useState } from 'react';
import type { SoloLeaderboardResponse, SoloLeaderboardStanding } from '@clutch/shared';
import { fetchSoloLeaderboard } from '../../platform/api';

export type DailyAttempt = NonNullable<SoloLeaderboardResponse['dailyAttempt']>;

export interface HomeStanding {
  /** Своё место в таблице дня; null — забег дня не дошёл до 100% или данных нет. */
  standing: SoloLeaderboardStanding | null;
  /** Попытка забега дня: от неё зависит главная кнопка (забег дня или дуэль). */
  dailyAttempt: DailyAttempt;
}

/**
 * Своё место в таблице дня и попытка забега дня для главной. Категория — «Общие знания», с которой
 * стартует главная кнопка. Ошибка сети — как будто не играл: главная зовёт в забег дня, а сервер
 * сам скажет, если попытка уже потрачена. `refreshKey` меняется на смене суток.
 */
export function useHomeStanding(refreshKey = 0): HomeStanding {
  const [state, setState] = useState<HomeStanding>({ standing: null, dailyAttempt: 'none' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ standing: null, dailyAttempt: 'none' });
    fetchSoloLeaderboard('general', controller.signal)
      .then((board) => {
        if (!controller.signal.aborted) setState({ standing: board.you, dailyAttempt: board.dailyAttempt ?? 'none' });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ standing: null, dailyAttempt: 'none' }); });
    return () => controller.abort();
  }, [refreshKey]);

  return state;
}
