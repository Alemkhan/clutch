import { useEffect, useRef, useState } from 'react';
import { dailyKey } from '@clutch/shared';
import { msUntilDayEnd } from './tiebreakerClock';

/**
 * Оставшееся до конца игровых суток, раз в секунду. Один setInterval на хук, очищается при
 * размонтировании. При смене суток один раз вызывает `onNewDay` (карточке нужно перечитать вопрос).
 * Это только текст: скринридеру таймер не объявляется (aria-live на нём нет).
 */
export function useDayCountdown(onNewDay?: () => void): number {
  const [msLeft, setMsLeft] = useState(() => msUntilDayEnd(Date.now()));
  const callback = useRef(onNewDay);
  callback.current = onNewDay;

  useEffect(() => {
    let day = dailyKey(Date.now());
    const tick = () => {
      const now = Date.now();
      setMsLeft(msUntilDayEnd(now));
      const current = dailyKey(now);
      if (current !== day) {
        day = current;
        callback.current?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return msLeft;
}
