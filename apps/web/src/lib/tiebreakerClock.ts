import { dailyKey, dayStartMs } from '@clutch/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько осталось до конца игровых суток (граница — `DAY_BOUNDARY_OFFSET_MINUTES` в shared). */
export function msUntilDayEnd(nowMs: number): number {
  return Math.max(0, dayStartMs(dailyKey(nowMs)) + DAY_MS - nowMs);
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** «5:12:40»: часы без нуля впереди, минуты и секунды двузначные. Отрицательное — 0:00:00. */
export function formatCountdownClock(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}:${pad2(minutes)}:${pad2(totalSeconds % 60)}`;
}

/** «5:12»: то же без секунд, для строки, которая не должна дёргаться каждую секунду. */
export function formatCountdownShort(ms: number): string {
  return formatCountdownClock(ms).replace(/:\d{2}$/, '');
}

/** Шапка главной: «Новый набор через 5 ч»; последний час — «меньше чем через час». Часы округляются вниз. */
export function newSetLabel(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  return hours < 1 ? 'Новый набор меньше чем через час' : `Новый набор через ${hours} ч`;
}

/** Под заголовком таблицы дня: «Обнулится через 5 ч · полночь по Алматы». Часы округляются вниз. */
export function resetLabel(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  const when = hours < 1 ? 'меньше чем через час' : `через ${hours} ч`;
  return `Обнулится ${when} · полночь по Алматы`;
}
