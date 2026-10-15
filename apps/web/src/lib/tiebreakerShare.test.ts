import { describe, expect, it, vi } from 'vitest';
import { buildTiebreakerShareText, resolveGameLink, shareTiebreakerResult } from './tiebreakerShare';

describe('share text', () => {
  it('has the number, the miss and the percentile', () => {
    expect(buildTiebreakerShareText(7, { multiplier: 1.3, percentile: 72 })).toBe('На глазок #7 · промах ×1,3 · точнее 72%');
  });

  it('says «лучший ответ дня» instead of a percentile for a strictly best answer', () => {
    expect(buildTiebreakerShareText(7, { multiplier: 1, percentile: 100 })).toBe('На глазок #7 · промах ×1,0 · лучший ответ дня');
  });

  it('leaves the percentile out when the server sent none', () => {
    expect(buildTiebreakerShareText(12, { multiplier: 4.28, percentile: null })).toBe('На глазок #12 · промах ×4,3');
  });

  it('never carries the own guess or the correct answer', () => {
    // Тип принимает только множитель и перцентиль; число в тексте могло бы быть только от них.
    const text = buildTiebreakerShareText(7, { multiplier: 2, percentile: 40 });
    expect(text).not.toMatch(/\d{3,}/);
  });
});

describe('game link', () => {
  it('prefers the bot link and falls back to the page origin', () => {
    expect(resolveGameLink('https://t.me/playclutchbot?startapp', 'https://app.example')).toBe('https://t.me/playclutchbot?startapp');
    expect(resolveGameLink('  ', 'https://app.example')).toBe('https://app.example');
    expect(resolveGameLink(undefined, 'https://app.example')).toBe('https://app.example');
  });
});

describe('sharing strategy', () => {
  const answered = { multiplier: 1.3, percentile: 72 };
  const url = 'https://t.me/playclutchbot?startapp';
  const text = 'На глазок #7 · промах ×1,3 · точнее 72%';

  it('uses the Telegram share when it is there', async () => {
    const telegramShare = vi.fn(() => true);
    const copy = vi.fn();
    const result = await shareTiebreakerResult(7, answered, url, { telegramShare: true, nativeShare: true, effects: { telegramShare, copy } });
    expect(result).toBe('shared');
    expect(telegramShare).toHaveBeenCalledWith(url, text);
    expect(copy).not.toHaveBeenCalled();
  });

  it('uses navigator.share in a browser that has it', async () => {
    const nativeShare = vi.fn(async () => undefined);
    const result = await shareTiebreakerResult(7, answered, url, {
      telegramShare: false, nativeShare: true, effects: { telegramShare: vi.fn(), nativeShare },
    });
    expect(result).toBe('shared');
    expect(nativeShare).toHaveBeenCalledWith({ text, url });
  });

  it('copies text and link to the clipboard when nothing else exists', async () => {
    const copy = vi.fn(async () => undefined);
    const result = await shareTiebreakerResult(7, answered, url, {
      telegramShare: false, nativeShare: false, effects: { telegramShare: vi.fn(), copy },
    });
    expect(result).toBe('copied');
    expect(copy).toHaveBeenCalledWith(`${text}\n${url}`);
  });

  it('reports a failed copy and a cancelled native share without pretending success', async () => {
    const failing = await shareTiebreakerResult(7, answered, url, {
      telegramShare: false, nativeShare: false, effects: { telegramShare: vi.fn(), copy: async () => { throw new Error('denied'); } },
    });
    expect(failing).toBe('failed');
    const cancelled = await shareTiebreakerResult(7, answered, url, {
      telegramShare: false,
      nativeShare: true,
      effects: { telegramShare: vi.fn(), nativeShare: async () => { throw new DOMException('cancel', 'AbortError'); } },
    });
    expect(cancelled).toBe('cancelled');
  });
});
