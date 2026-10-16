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
    entry: { displayName: 'Я', soloScore: 0.9, setPar: 8, roundsPlayed: 7, completedAt: 1 },
    roundsToNext: 1,
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

const render = (props: { tiebreaker?: TiebreakerTodayState; standing?: SoloLeaderboardStanding | null } = {}) => renderToStaticMarkup(
  <HomeDashboardView
    tiebreaker={props.tiebreaker ?? today()}
    msLeft={MS_LEFT}
    standing={props.standing ?? null}
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
    const out = render({ standing: standing({ roundsToNext: 2 }) });
    expect(out).toContain('Ты 3-й сегодня.');
    expect(out).toContain('До 2-го — 2 круга.');
    expect(out).toContain('3 / 41');
    expect(out).toContain('>7<');
    expect(out).toContain('Сыграть ещё набор');
    // Играть остаётся единственной главной кнопкой.
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
    expect(out).toContain('Играть');
    expect(out).not.toContain('Сыграть ещё набор');
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
