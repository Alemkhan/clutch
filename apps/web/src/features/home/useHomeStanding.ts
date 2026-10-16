import { useEffect, useState } from 'react';
import type { SoloLeaderboardStanding } from '@clutch/shared';
import { fetchSoloLeaderboard } from '../../platform/api';

/**
 * Своё место в таблице дня для главной («Ты 3-й сегодня»). Категория — «Общие знания», с которой
 * стартует «Играть». Ошибка сети или `you: null` — null: блок на главной просто не показывается.
 * `refreshKey` меняется на смене суток, чтобы вчерашнее место не висело в новых сутках.
 */
export function useHomeStanding(refreshKey = 0): SoloLeaderboardStanding | null {
  const [standing, setStanding] = useState<SoloLeaderboardStanding | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setStanding(null);
    fetchSoloLeaderboard('general', controller.signal)
      .then((board) => { if (!controller.signal.aborted) setStanding(board.you); })
      .catch(() => { if (!controller.signal.aborted) setStanding(null); });
    return () => controller.abort();
  }, [refreshKey]);

  return standing;
}
