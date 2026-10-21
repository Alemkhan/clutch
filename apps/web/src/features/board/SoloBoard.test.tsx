import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryId, DuelBoardResponse, SoloLeaderboardEntry, SoloLeaderboardResponse, SoloLeaderboardStanding, WikiPathBoardResponse } from '@clutch/shared';
import { msUntilDayEnd, resetLabel } from '../tiebreaker/tiebreakerClock';
import { finishedText, initials, roundsShort } from '../myRuns/myRunsView';
import { BoardKindSwitch, DuelBoardView, SoloBoardView, WikiPathBoardView, duelRecord, standingHint, wikiPathClicksText, type DuelBoardState, type SoloBoardState, type WikiPathBoardState } from './SoloBoard';

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

const handlers = {
  onCategory: vi.fn(),
  onBack: vi.fn(),
  onRetry: vi.fn(),
  onPlay: vi.fn(),
};

function entry(name: string, roundsPlayed: number, setPar = 8, rank = 1): SoloLeaderboardEntry {
  return { rank, displayName: name, soloScore: roundsPlayed / setPar, setPar, roundsPlayed, completedAt: NOW };
}

function standing(overrides: Partial<SoloLeaderboardStanding> = {}): SoloLeaderboardStanding {
  return { rank: 37, total: 140, entry: entry('Я', 11), roundsToNext: 1, placeAbove: (overrides.rank ?? 37) - 1, outrankedByGuess: false, tiebreak: 'answered', ...overrides };
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
    expect(html).toContain('>7 кр.<');
    expect(html).toContain('>9 кр.<');
    expect(html).toContain('>AN<');
    expect(html).toContain('>БО<');
    // Сырой счёт игроку не показывается: 0.875 ни о чём не говорит.
    expect(html).not.toContain('0.875');
  });

  it('shows my own place even when I am far outside the listed top', () => {
    const html = render(ready({ entries: [entry('Ann', 7)], you: standing() }));
    expect(html).toMatch(/solo-board-you-rank">37</);
    // Попытка дня сыграна: таблица зовёт в дуэль, а не во второй забег дня.
    expect(html).toMatch(/cta-btn solo-board-play">Дуэль</);
    expect(html).toContain('Ты: 11 кругов · из 140 дошедших');
    // Цель достижимая, а не «попади в топ-50».
    expect(html).toContain('До 36-го места — один круг<');
  });

  it('says plainly when my run is not in today\'s board at all', () => {
    const html = render(ready({ entries: [entry('Ann', 7)], you: null }));
    expect(html).toContain('Твоего забега дня здесь нет');
    expect(html).not.toContain('из 140');
  });

  it('offers a game when nobody finished the day yet', () => {
    const html = render(ready());
    expect(html).toContain('ещё никто не дошёл до цели');
    expect(html).toContain('>Забег дня<');
  });

  it('marks my own row when I am inside the listed top', () => {
    const mine = standing({ rank: 1, total: 3, entry: entry('Я', 7), roundsToNext: null });
    const html = render(ready({ entries: [entry('Я', 7), entry('Ann', 9)], you: mine }));
    expect(html).toContain('solo-board-row mine');
    // В своей строке — «Ты» и «ТЫ» вместо имени и его инициалов; имя остаётся в title.
    expect(html).toContain('>ТЫ<');
    expect(html).toContain('title="Я">Ты<');
    expect(html).toContain('Ты первый сегодня<');
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
    expect(render(ready({ entries: [entry('Ann', 7)] }))).toContain('При равных кругах выше тот, чья прикидка «На глазок» точнее<');
    expect(render(ready())).not.toContain('При равных кругах');
  });

  it('shows the server place, shared by ties, and the new footer', () => {
    const html = render(ready({
      entries: [entry('Ann', 5, 8, 1), entry('Bob', 6, 8, 2), entry('Cat', 6, 8, 2), entry('Dan', 7, 8, 4)],
      you: null,
    }));
    expect([...html.matchAll(/solo-board-place">(\d+)</g)].map((m) => m[1])).toEqual(['1', '2', '2', '4']);
    expect(html).toContain('При равных кругах выше тот, чья прикидка «На глазок» точнее');
    expect(html).not.toContain('быстрее');
  });

  it('wires the play buttons and does not highlight a row when I am absent', () => {
    handlers.onPlay.mockClear();
    const html = render(ready({ entries: [entry('Ann', 7)], you: null }));
    expect(html).toContain('>Забег дня<');
    expect(html).not.toContain('solo-board-row mine');
  });
});

describe('the hint under my place', () => {
  it('counts the rounds needed to pass the player above', () => {
    expect(standingHint(standing({ rank: 5, roundsToNext: 1 }))).toBe('До 4-го места — один круг');
    expect(standingHint(standing({ rank: 5, roundsToNext: 2 }))).toBe('До 4-го места — 2 круга');
    expect(standingHint(standing({ rank: 9, roundsToNext: 5 }))).toBe('До 8-го места — 5 кругов');
  });

  it('names the place above when ties share a number (1, 2, 2, 4)', () => {
    expect(standingHint(standing({ rank: 4, roundsToNext: 1, placeAbove: 2 }))).toBe('До 2-го места — один круг');
  });

  it('explains an equal-rounds gap by the guess, per kind of viewer', () => {
    const tied = { rank: 3, roundsToNext: 1, placeAbove: 2, outrankedByGuess: true } as const;
    expect(standingHint(standing({ ...tied, tiebreak: 'not_answered' }))).toBe('Ответь «На глазок» — поднимет над равными');
    expect(standingHint(standing({ ...tied, tiebreak: 'answered' }))).toBe('Выше с теми же кругами — по «На глазок»');
    expect(standingHint(standing({ ...tied, tiebreak: 'guest' }))).toBe('Равных разводит «На глазок» — только с Telegram');
  });

  it('says there is nobody above the first place', () => {
    expect(standingHint(standing({ rank: 1, roundsToNext: null }))).toBe('Ты первый сегодня');
  });
});

describe('the list helpers', () => {
  it('declines «дошедший» by the count', () => {
    expect(finishedText(1)).toBe('из 1 дошедшего');
    expect(finishedText(3)).toBe('из 3 дошедших');
    expect(finishedText(11)).toBe('из 11 дошедших');
    expect(finishedText(21)).toBe('из 21 дошедшего');
    expect(finishedText(41)).toBe('из 41 дошедшего');
    expect(finishedText(111)).toBe('из 111 дошедших');
    expect(finishedText(12)).toBe('из 12 дошедших');
    expect(finishedText(140)).toBe('из 140 дошедших');
  });

  it('takes two initials: the code of an anonymous player, otherwise the first letters', () => {
    expect(initials('Игрок 5cb9')).toBe('B9');
    expect(initials('Анна')).toBe('АН');
    expect(initials('x')).toBe('X');
    expect(initials('😀😀a')).toBe('😀😀');
    expect(initials('  ')).toBe('?');
  });

  it('shortens rounds for the list', () => {
    expect(roundsShort(7)).toBe('7 кр.');
  });
});

describe('the duel board', () => {
  const board = (patch: Partial<DuelBoardResponse> = {}): DuelBoardState => ({
    status: 'ready',
    board: {
      dateKey: '2026-10-19',
      entries: [
        { rank: 1, displayName: 'Ann', wins: 5, draws: 1, losses: 0 },
        { rank: 2, displayName: 'Bob', wins: 5, draws: 0, losses: 2 },
      ],
      you: { rank: 2, displayName: 'Bob', wins: 5, draws: 0, losses: 2 },
      ...patch,
    },
  });
  const renderDuels = (state: DuelBoardState) => renderToStaticMarkup(
    <DuelBoardView state={state} msLeft={5 * 60 * 60 * 1000} onBack={vi.fn()} onRetry={vi.fn()} onDuel={vi.fn()} />,
  );

  it('shows each record as wins–draws–losses, mine on top, and calls to a duel', () => {
    const html = renderDuels(board());
    expect(html).toContain('Ты сегодня: 5–0–2 · 2-е место');
    expect(html).toContain('>5–1–0<');
    expect(html).toContain('>5–0–2<');
    expect(html).toMatch(/cta-btn solo-board-play">Дуэль</);
    expect(duelRecord({ wins: 3, draws: 2, losses: 1 })).toBe('3–2–1');
  });

  it('says so when nobody finished a duel today', () => {
    const html = renderDuels(board({ entries: [], you: null }));
    expect(html).toContain('Сегодня у тебя ещё нет законченных дуэлей.');
    expect(html).toContain('Сегодня ещё никто не довёл дуэль до конца.');
  });
});

describe('the shared Wiki Path board tab', () => {
  const wikiBoard = (patch: Partial<WikiPathBoardResponse> = {}): WikiPathBoardState => ({
    status: 'ready',
    board: {
      challengeId: 'wiki-2026-10-21',
      ownRank: 2,
      entries: [
        { rank: 1, runId: 'run-1', playerId: 'telegram:1', displayName: 'Аня', clicks: 5, completedAt: 1 },
        { rank: 2, runId: 'run-2', playerId: 'telegram:2', displayName: 'Бек', clicks: 7, completedAt: 2 },
        { rank: 2, runId: 'run-3', playerId: 'telegram:3', displayName: 'Алем', clicks: 7, completedAt: 3 },
      ],
      ...patch,
    },
  });
  const renderWiki = (state: WikiPathBoardState) => renderToStaticMarkup(
    <WikiPathBoardView state={state} msLeft={5 * 60 * 60 * 1000} onBack={vi.fn()} onRetry={vi.fn()} onPlay={vi.fn()} />,
  );

  it('is the third tab of the existing day board', () => {
    const html = renderToStaticMarkup(<BoardKindSwitch kind="wikiPath" onKind={vi.fn()} />);
    expect(html).toContain('Забег дня');
    expect(html).toContain('Дуэли');
    expect(html).toContain('Вики-путь');
    expect(html).toContain('aria-selected="true"');
  });

  it('shows shared places and click counts with the common board rows', () => {
    const html = renderWiki(wikiBoard());
    expect(html).toContain('Твоё место сегодня: 2');
    expect([...html.matchAll(/solo-board-place">(\d+)</g)].map((match) => match[1]))
      .toEqual(['1', '2', '2']);
    expect(html).toContain('5 переходов');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Меньше переходов — выше');
    expect(wikiPathClicksText(1)).toBe('1 переход');
    expect(wikiPathClicksText(2)).toBe('2 перехода');
    expect(wikiPathClicksText(11)).toBe('11 переходов');
  });

  it('offers the route from the empty personal state', () => {
    const html = renderWiki(wikiBoard({ ownRank: null }));
    expect(html).toContain('Ты ещё не завершил');
    expect(html).toMatch(/cta-btn solo-board-play">Вики-путь</);
    expect(html).toContain('Заверши маршрут, чтобы посмотреть пути других игроков.');
    expect(html).not.toContain('aria-expanded=');
  });
});
