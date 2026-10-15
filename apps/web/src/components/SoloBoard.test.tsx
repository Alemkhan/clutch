import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryId, SoloLeaderboardEntry, SoloLeaderboardResponse, SoloLeaderboardStanding } from '@clutch/shared';
import { msUntilDayEnd, resetLabel } from '../lib/tiebreakerClock';
import { SoloBoardView, standingHint, type SoloBoardState } from './SoloBoard';

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

const handlers = {
  onCategory: vi.fn(),
  onBack: vi.fn(),
  onRetry: vi.fn(),
  onPlay: vi.fn(),
};

function entry(name: string, roundsPlayed: number, setPar = 8): SoloLeaderboardEntry {
  return { displayName: name, soloScore: roundsPlayed / setPar, setPar, roundsPlayed, completedAt: NOW };
}

function standing(overrides: Partial<SoloLeaderboardStanding> = {}): SoloLeaderboardStanding {
  return { rank: 37, total: 140, entry: entry('Я', 11), roundsToNext: 1, ...overrides };
}

function board(overrides: Partial<SoloLeaderboardResponse> = {}): SoloLeaderboardResponse {
  return { category: 'general', dateKey: '2026-10-13', entries: [], you: null, ...overrides };
}

function render(state: SoloBoardState, category: CategoryId = 'general') {
  return renderToStaticMarkup(<SoloBoardView state={state} msLeft={5 * 3_600_000 + 1000} category={category} {...handlers} />);
}

const ready = (overrides: Partial<SoloLeaderboardResponse> = {}): SoloBoardState => (
  { status: 'ready', board: board(overrides) }
);

describe('the day board', () => {
  it('shows loading and an error with a way back and a retry', () => {
    const loading = render({ status: 'loading' });
    expect(loading).toContain('screen-header');
    expect(loading).toContain('Загружаем таблицу');

    const failed = render({ status: 'error' });
    expect(failed).toContain('Не удалось загрузить таблицу');
    expect(failed).toContain('Повторить');
  });

  it('marks the open category and offers the others', () => {
    const html = render(ready(), 'geography');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('География');
    expect(html).toContain('Общие знания');
    expect(html).toContain('Языки');
  });

  it('lists the top with places and rounds, not raw scores', () => {
    const html = render(ready({ entries: [entry('Ann', 7), entry('Боб', 9)] }));
    expect(html).toContain('Ann');
    expect(html).toContain('7 кругов');
    expect(html).toContain('9 кругов');
    // Сырой счёт игроку не показывается: 0.875 ни о чём не говорит.
    expect(html).not.toContain('0.875');
  });

  it('shows my own place even when I am far outside the listed top', () => {
    const html = render(ready({ entries: [entry('Ann', 7)], you: standing() }));
    expect(html).toContain('37-й');
    expect(html).toContain('из 140');
    expect(html).toContain('Сыграть ещё набор');
    expect(html).toContain('11 кругов');
    // Цель достижимая, а не «попади в топ-50».
    expect(html).toContain('До 36-го места — один круг.');
  });

  it('says plainly when my run is not in today\'s board at all', () => {
    const html = render(ready({ entries: [entry('Ann', 7)], you: null }));
    expect(html).toContain('Твоего забега сегодня здесь нет');
    expect(html).not.toContain('из 140');
  });

  it('offers a game when nobody finished the day yet', () => {
    const html = render(ready());
    expect(html).toContain('ещё никто не дошёл до цели');
    expect(html).toContain('Играть');
  });

  it('marks my own row when I am inside the listed top', () => {
    const mine = standing({ rank: 1, total: 3, entry: entry('Я', 7), roundsToNext: null });
    const html = render(ready({ entries: [entry('Я', 7), entry('Ann', 9)], you: mine }));
    expect(html).toContain('solo-board-row mine');
  });

  it('survives a long name', () => {
    const long = 'Очень'.repeat(30);
    expect(render(ready({ entries: [entry(long, 7)] }))).toContain(long);
  });
});

afterEach(() => vi.useRealTimers());

describe('the reset line and the footer', () => {
  it('says when the board resets, in Almaty midnight terms', () => {
    expect(render(ready())).toContain('Обнулится через 5 ч · полночь по Алматы');
  });

  it('counts down to the day boundary with fake timers', () => {
    vi.useFakeTimers();
    // Граница суток — 00:00 по Алматы (UTC+5): 19:00 UTC.
    vi.setSystemTime(Date.UTC(2026, 9, 13, 18, 30, 0));
    expect(resetLabel(msUntilDayEnd(Date.now()))).toBe('Обнулится меньше чем через час · полночь по Алматы');
    vi.setSystemTime(Date.UTC(2026, 9, 13, 14, 30, 0));
    expect(resetLabel(msUntilDayEnd(Date.now()))).toBe('Обнулится через 4 ч · полночь по Алматы');
    vi.setSystemTime(Date.UTC(2026, 9, 13, 19, 0, 1));
    expect(resetLabel(msUntilDayEnd(Date.now()))).toBe('Обнулится через 23 ч · полночь по Алматы');
  });

  it('keeps the tie-break rule under the list', () => {
    expect(render(ready({ entries: [entry('Ann', 7)] }))).toContain('При равных кругах выше тот, кто быстрее.');
    expect(render(ready())).not.toContain('При равных кругах');
  });

  it('wires the play buttons and does not highlight a row when I am absent', () => {
    handlers.onPlay.mockClear();
    const html = render(ready({ entries: [entry('Ann', 7)], you: null }));
    expect(html).toContain('Играть');
    expect(html).not.toContain('solo-board-row mine');
  });
});

describe('the hint under my place', () => {
  it('counts the rounds needed to pass the player above', () => {
    expect(standingHint(standing({ rank: 5, roundsToNext: 1 }))).toBe('До 4-го места — один круг.');
    expect(standingHint(standing({ rank: 5, roundsToNext: 2 }))).toBe('До 4-го места — 2 круга.');
    expect(standingHint(standing({ rank: 9, roundsToNext: 5 }))).toBe('До 8-го места — 5 кругов.');
  });

  it('says there is nobody above the first place', () => {
    expect(standingHint(standing({ rank: 1, roundsToNext: null }))).toBe('Ты первый сегодня.');
  });
});
