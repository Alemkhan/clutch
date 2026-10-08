import { describe, expect, it, vi } from 'vitest';
import {
  buildShareText,
  buildSharePayload,
  chooseShareStrategy,
  executeShare,
  buildShareUrl,
  type ShareInput,
} from './share';

const base: ShareInput = { playerProgress: 75, opponentProgress: 50, opponentName: 'Алекс', matchSource: 'player' };
const url = 'https://t.me/bot?startapp';

describe('buildShareUrl', () => {
  const parse = (value: string) => new URL(value);

  it('points at the /api/share preview page on the current origin', () => {
    const u = parse(buildShareUrl(base, '', 'https://app.example'));
    expect(u.origin).toBe('https://app.example');
    expect(u.pathname).toBe('/api/share');
    expect(u.searchParams.get('o')).toBe('win');
    expect(u.searchParams.get('p')).toBe('75');
    expect(u.searchParams.get('q')).toBe('50');
  });
  it('prefers VITE_API_URL and trims trailing slashes', () => {
    expect(buildShareUrl(base, 'https://api.example/', 'https://app.example')).toMatch(
      /^https:\/\/api\.example\/api\/share\?/,
    );
  });
  it('passes the opponent name only for a human opponent', () => {
    expect(parse(buildShareUrl(base, '', 'http://x')).searchParams.get('n')).toBe('Алекс');
    for (const matchSource of ['bot', 'local', 'challenge'] as const) {
      expect(parse(buildShareUrl({ ...base, matchSource }, '', 'http://x')).searchParams.has('n')).toBe(false);
    }
  });
  it('limits the name to 32 characters and omits it when blank', () => {
    const long = parse(buildShareUrl({ ...base, opponentName: 'я'.repeat(50) }, '', 'http://x'));
    expect(Array.from(long.searchParams.get('n') ?? '').length).toBe(32);
    expect(parse(buildShareUrl({ ...base, opponentName: '  ' }, '', 'http://x')).searchParams.has('n')).toBe(false);
  });
  it('encodes special characters in the name', () => {
    const value = buildShareUrl({ ...base, opponentName: 'A&B <x>' }, '', 'http://x');
    expect(value).not.toContain('<');
    expect(parse(value).searchParams.get('n')).toBe('A&B <x>');
  });
  it('reports loss and tie outcomes', () => {
    expect(parse(buildShareUrl({ ...base, playerProgress: 10 }, '', 'http://x')).searchParams.get('o')).toBe('loss');
    expect(parse(buildShareUrl({ ...base, playerProgress: 50 }, '', 'http://x')).searchParams.get('o')).toBe('tie');
  });
});

describe('buildShareText', () => {
  it('distinguishes win, loss and tie', () => {
    const win = buildShareText(base);
    const loss = buildShareText({ ...base, playerProgress: 40 });
    const tie = buildShareText({ ...base, playerProgress: 50 });
    expect(new Set([win, loss, tie]).size).toBe(3);
    expect(win).toContain('Обыграл');
    expect(loss).toContain('Уступил');
    expect(tie).toContain('Ничья');
  });
  it('does not present local practice as a saved match', () => {
    const text = buildShareText({ ...base, matchSource: 'local' });
    expect(text).toContain('результат не сохранён');
    expect(text).not.toContain('Алекс');
    expect(text).not.toContain('Обыграл');
  });
  it('does not claim the opponent is a human', () => {
    expect(buildShareText({ ...base, matchSource: 'bot' })).not.toMatch(/игрок|человек/i);
  });
});

describe('chooseShareStrategy', () => {
  it('prefers Telegram, then native, then copy', () => {
    expect(chooseShareStrategy({ telegramShare: true, nativeShare: true })).toBe('telegram');
    expect(chooseShareStrategy({ telegramShare: false, nativeShare: true })).toBe('native');
    expect(chooseShareStrategy({ telegramShare: false, nativeShare: false })).toBe('copy');
  });
});

describe('executeShare', () => {
  const payload = buildSharePayload(base, url);

  it('telegram passes url and text', async () => {
    const telegramShare = vi.fn(() => true);
    expect(await executeShare('telegram', payload, { telegramShare })).toBe('shared');
    expect(telegramShare).toHaveBeenCalledWith(url, payload.text);
  });
  it('native passes text and url', async () => {
    const nativeShare = vi.fn(async () => {});
    expect(await executeShare('native', payload, { telegramShare: () => false, nativeShare })).toBe('shared');
    expect(nativeShare).toHaveBeenCalledWith({ text: payload.text, url });
  });
  it('copy includes the url', async () => {
    const copy = vi.fn(async (_text: string) => {});
    expect(await executeShare('copy', payload, { telegramShare: () => false, copy })).toBe('copied');
    expect(copy.mock.calls[0][0]).toContain(url);
  });
  it('maps abort to cancelled and other errors to failed', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const eff = (e: Error) => ({ telegramShare: () => false, nativeShare: async () => { throw e; } });
    expect(await executeShare('native', payload, eff(abort))).toBe('cancelled');
    expect(await executeShare('native', payload, eff(new Error('boom')))).toBe('failed');
  });
});
