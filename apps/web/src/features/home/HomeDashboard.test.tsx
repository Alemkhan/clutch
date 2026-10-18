import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SoloLeaderboardStanding, TiebreakerTodayResponse } from '@clutch/shared';
import { HomeDashboardView } from './HomeDashboard';
import { homeStandingLines } from './homeStanding';
import type { TiebreakerTodayState } from '../tiebreaker/useTiebreakerToday';

const MS_LEFT = (5 * 3600 + 12 * 60 + 40) * 1000;

function standing(overrides: Partial<SoloLeaderboardStanding> = {}): SoloLeaderboardStanding {
  return {
    rank: 3,
    total: 41,
    entry: { rank: 3, displayName: 'Я', soloScore: 0.9, setPar: 8, roundsPlayed: 7, completedAt: 1 },
    roundsToNext: 1,
    placeAbove: (overrides.rank ?? 3) - 1,
    outrankedByGuess: false,
    tiebreak: 'answered',
    ...overrides,
  };
}

const today = (overrides: Partial<TiebreakerTodayResponse> = {}): TiebreakerTodayState => ({
  status: 'ready',
  today: {
    dateKey: '2026-10-16',
    question: { id: 'q1', number: 7, prompt: 'Полный вопрос?', cardPrompt: null, unit: 'м' },
    answered: null,
    answersCount: 0,
    ...overrides,
  },
});

const render = (props: {
  tiebreaker?: TiebreakerTodayState;
  standing?: SoloLeaderboardStanding | null;
  dailyAttempt?: 'none' | 'in_progress' | 'completed';
} = {}) => renderToStaticMarkup(
  <HomeDashboardView
    tiebreaker={props.tiebreaker ?? today()}
    msLeft={MS_LEFT}
    standing={props.standing ?? null}
    dailyAttempt={props.dailyAttempt ?? 'none'}
    onSolo={vi.fn()}
    onBoard={vi.fn()}
    onTiebreaker={vi.fn()}
  />,
);

describe('home header', () => {
  it('shows when the new set arrives, to the right of the logo', () => {
    const out = render();
    expect(out).toContain('Новый набор через 5 ч');
    expect(out.indexOf('CLUTCH')).toBeLessThan(out.indexOf('Новый набор через 5 ч'));
  });
});

describe('the place line after a counted finish', () => {
  it('shows «Ты N-й сегодня. До (N-1)-го — M кругов» from the leaderboard, with the real numbers', () => {
    const out = render({ standing: standing({ roundsToNext: 2 }), dailyAttempt: 'completed' });
    expect(out).toContain('Ты 3-й сегодня.');
    expect(out).toContain('До 2-го — 2 круга.');
    expect(out).toContain('3 / 41');
    expect(out).toContain('>7<');
    // Забег дня сыгран: главная зовёт в дуэль, второй раз забег дня не предлагает.
    expect(out).toMatch(/class="cta-btn"[^>]*>Дуэль/);
    expect(out).not.toMatch(/<button[^>]*>Забег дня/);
    expect(out).toContain('Свободная игра');
    expect(out.match(/class="cta-btn"/g)).toHaveLength(1);
  });

  it('says one round in the singular', () => {
    expect(render({ standing: standing() })).toContain('До 2-го — один круг.');
  });

  it('says first place plainly, with no «до» line', () => {
    const out = render({ standing: standing({ rank: 1, roundsToNext: null }) });
    expect(out).toContain('Ты первый сегодня.');
    expect(out).not.toContain('До 0-го');
    expect(out).not.toContain('До ');
  });

  it('shows no block and the usual hero without a place', () => {
    const out = render({ standing: null });
    expect(out).not.toContain('сегодня.');
    expect(out).not.toContain('home-stats');
    expect(out).toContain('Дойди до 100%');
    expect(out).toMatch(/class="cta-btn"[^>]*>Забег дня/);
    expect(out).toContain('>Дуэль<');
    expect(out).toContain('>Свободная игра<');
  });

  it('says the run of the day is played when it missed the target, and offers a duel', () => {
    const out = render({ standing: null, dailyAttempt: 'completed' });
    expect(out).toContain('Забег дня сыгран.');
    expect(out).toMatch(/class="cta-btn"[^>]*>Дуэль/);
  });

  it('continues an unfinished run of the day', () => {
    expect(render({ standing: null, dailyAttempt: 'in_progress' })).toContain('Продолжить забег дня');
  });

  it('uses the place above under ties and the guess wording for equal rounds', () => {
    expect(homeStandingLines(standing({ rank: 4, roundsToNext: 1, placeAbove: 2 }))).toEqual({ title: 'Ты 4-й сегодня.', hint: 'До 2-го — один круг.' });
    expect(homeStandingLines(standing({ rank: 3, outrankedByGuess: true }))).toEqual({ title: 'Ты 3-й сегодня.', hint: 'Выше — по «На глазок».' });
  });

  it('builds the lines as pure text', () => {
    expect(homeStandingLines(standing({ rank: 12, roundsToNext: 5 }))).toEqual({ title: 'Ты 12-й сегодня.', hint: 'До 11-го — 5 кругов.' });
    expect(homeStandingLines(standing({ rank: 1, roundsToNext: null }))).toEqual({ title: 'Ты первый сегодня.', hint: null });
  });
});

describe('the tiebreaker card on the home screen', () => {
  it('is part of the home screen after the hero, and absent without a question or on error', () => {
    const out = render();
    expect(out).toContain('На глазок');
    expect(out.indexOf('home-hero-card')).toBeLessThan(out.indexOf('tb-card'));
    expect(render({ tiebreaker: today({ question: null }) })).not.toContain('tb-card');
    expect(render({ tiebreaker: { status: 'error' } })).not.toContain('tb-card');
  });

  it('keeps the bottom navigation out of the home screen markup', () => {
    expect(render()).not.toContain('bottom-nav');
  });
});
