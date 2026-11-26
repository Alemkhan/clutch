import { describe, expect, it } from 'vitest';
import { dayStartMs } from '../solo/dailyQuestionSet';
import {
  clanKeyToSlug,
  clanPlayerPoints,
  clanRunPoints,
  clanSlugToKey,
  clanWarScore,
  clanWeek,
  clansActive,
  normalizeClanEmoji,
} from './clans';

describe('normalizeClanEmoji', () => {
  it('accepts exactly one emoji, including ZWJ sequences and flags', () => {
    expect(normalizeClanEmoji('🦆')).toEqual({ emoji: '🦆', key: '🦆' });
    expect(normalizeClanEmoji(' 🧑‍🚀 ')?.emoji).toBe('🧑‍🚀');
    expect(normalizeClanEmoji('🇰🇿')?.emoji).toBe('🇰🇿');
    expect(normalizeClanEmoji('👨‍👩‍👧‍👦')?.emoji).toBe('👨‍👩‍👧‍👦');
  });

  it('rejects text, several emoji and empty input', () => {
    expect(normalizeClanEmoji('a')).toBeNull();
    expect(normalizeClanEmoji('🦆🦆')).toBeNull();
    expect(normalizeClanEmoji('🦆 a')).toBeNull();
    expect(normalizeClanEmoji('')).toBeNull();
  });

  it('drops skin tones: every tone is the same clan', () => {
    const light = normalizeClanEmoji('👍🏻');
    const dark = normalizeClanEmoji('👍🏿');
    expect(light).toEqual({ emoji: '👍', key: '👍' });
    expect(dark?.key).toBe(light?.key);
    expect(normalizeClanEmoji('🧑🏽‍🚀')?.emoji).toBe('🧑‍🚀');
  });

  it('treats text and emoji presentation as one clan', () => {
    const bare = normalizeClanEmoji('❤');
    const full = normalizeClanEmoji('❤️');
    expect(bare?.emoji).toBe('❤️');
    expect(bare?.key).toBe(full?.key);
  });
});

describe('clan slug', () => {
  it('round-trips through code points', () => {
    for (const key of ['🦆', '🧑‍🚀', '🇰🇿', '❤']) expect(clanSlugToKey(clanKeyToSlug(key))).toBe(key);
    expect(clanKeyToSlug('🦆')).toBe('1f986');
  });

  it('rejects garbage', () => {
    expect(clanSlugToKey('zz')).toBeNull();
    expect(clanSlugToKey('')).toBeNull();
    expect(clanSlugToKey('110000')).toBeNull();
  });
});

describe('clans launch', () => {
  it('opens on Monday 23 November by the game day', () => {
    expect(clansActive(dayStartMs('2026-11-22') + 23 * 60 * 60 * 1000)).toBe(false);
    expect(clansActive(dayStartMs('2026-11-23'))).toBe(true);
  });
});

describe('clanWeek', () => {
  it('runs Monday to Sunday by the game day', () => {
    // 2026-11-16 - понедельник.
    const monday = clanWeek(dayStartMs('2026-11-16') + 1000);
    expect(monday.weekKey).toBe('2026-11-16');
    expect(monday.lastDayKey).toBe('2026-11-22');
    expect(clanWeek(dayStartMs('2026-11-22') + 1000).weekKey).toBe('2026-11-16');
    expect(clanWeek(dayStartMs('2026-11-23') + 1000).weekKey).toBe('2026-11-23');
    expect(monday.endMs - monday.startMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('clan points', () => {
  it('gives progress for an unfinished run and a speed bonus for a finish', () => {
    expect(clanRunPoints({ progress: 64, reachedTarget: false, soloScore: null })).toBe(64);
    expect(clanRunPoints({ progress: 100, reachedTarget: true, soloScore: 1 })).toBe(150);
    expect(clanRunPoints({ progress: 100, reachedTarget: true, soloScore: 0.5 })).toBe(200);
    expect(clanRunPoints({ progress: 100, reachedTarget: true, soloScore: 2 })).toBe(100);
  });

  it('counts one best run per game day', () => {
    expect(clanPlayerPoints([
      { dayKey: '2026-11-16', progress: 100, reachedTarget: true, soloScore: 1 },
      { dayKey: '2026-11-16', progress: 100, reachedTarget: true, soloScore: 0.5 },
      { dayKey: '2026-11-16', progress: 40, reachedTarget: false, soloScore: null },
      { dayKey: '2026-11-17', progress: 70, reachedTarget: false, soloScore: null },
    ])).toBe(200 + 70);
  });

  it('averages the best ten, empty places count as zero', () => {
    expect(clanWarScore([200])).toBe(20);
    expect(clanWarScore(Array.from({ length: 10 }, () => 100))).toBe(100);
    // Одиннадцатый и дальше не мешают и не помогают.
    expect(clanWarScore([...Array.from({ length: 10 }, () => 100), 1, 1, 1])).toBe(100);
  });
});
