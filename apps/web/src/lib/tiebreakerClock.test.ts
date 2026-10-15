import { describe, expect, it } from 'vitest';
import { DAY_BOUNDARY_OFFSET_MINUTES } from '@clutch/shared';
import { formatCountdownClock, formatCountdownShort, msUntilDayEnd, newSetLabel } from './tiebreakerClock';

const HOUR = 3_600_000;
const MINUTE = 60_000;

describe('countdown format', () => {
  it('shows hours without a leading zero and two-digit minutes and seconds', () => {
    expect(formatCountdownClock((5 * 3600 + 12 * 60 + 40) * 1000)).toBe('5:12:40');
    expect(formatCountdownClock(0)).toBe('0:00:00');
    expect(formatCountdownClock(59_999)).toBe('0:00:59');
    expect(formatCountdownClock(23 * HOUR + 59 * MINUTE + 59_000)).toBe('23:59:59');
  });

  it('never goes negative', () => {
    expect(formatCountdownClock(-5000)).toBe('0:00:00');
    expect(formatCountdownShort(-5000)).toBe('0:00');
  });

  it('drops the seconds in the short form without rounding up', () => {
    expect(formatCountdownShort((5 * 3600 + 12 * 60 + 59) * 1000)).toBe('5:12');
    expect(formatCountdownShort(59_000)).toBe('0:00');
  });
});

describe('time until the day ends', () => {
  it('counts to the next day boundary, which is shifted by the shared offset', () => {
    // Граница суток — 19:00 UTC (сдвиг 5 ч в shared).
    expect(DAY_BOUNDARY_OFFSET_MINUTES).toBe(300);
    const noon = Date.parse('2026-10-15T12:00:00Z');
    expect(msUntilDayEnd(noon)).toBe(7 * HOUR);
    expect(msUntilDayEnd(Date.parse('2026-10-15T18:59:59Z'))).toBe(1000);
    // Ровно на границе начинаются новые сутки: впереди целые 24 часа.
    expect(msUntilDayEnd(Date.parse('2026-10-15T19:00:00Z'))).toBe(24 * HOUR);
  });
});

describe('«новый набор через»', () => {
  it('rounds hours down, matching the 5 ч label next to a 5:12:40 timer', () => {
    expect(newSetLabel(5 * HOUR + 12 * MINUTE)).toBe('Новый набор через 5 ч');
    expect(newSetLabel(23 * HOUR)).toBe('Новый набор через 23 ч');
    expect(newSetLabel(HOUR)).toBe('Новый набор через 1 ч');
  });

  it('says less than an hour in the last hour of the day', () => {
    expect(newSetLabel(59 * MINUTE)).toBe('Новый набор меньше чем через час');
    expect(newSetLabel(0)).toBe('Новый набор меньше чем через час');
    expect(newSetLabel(-1)).toBe('Новый набор меньше чем через час');
  });
});
