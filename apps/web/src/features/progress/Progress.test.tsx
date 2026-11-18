import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { achievementsOf, levelFromXp, type PlayerStats } from '@clutch/shared';
import { AchievementGrid, achievementStatus, daysText, LevelBar, StreakBadge, StreakHint } from './Progress';
import { WHATS_NEW, WHATS_NEW_RELEASE, WhatsNewDialog } from '../whatsNew/WhatsNew';
import { CategorySelect } from '../solo/CategorySelect';

const stats: PlayerStats = {
  completedRuns: 3,
  reachedTargetRuns: 1,
  bestRounds: 12,
  correctAnswers: 30,
  duelWins: 0,
  tiebreakerAnswers: 0,
  wikiPathsCompleted: 0,
  friendChallenges: 0,
  bestStreak: 3,
};

describe('progress widgets', () => {
  it('shows no flame without a streak and dims a streak not extended today', () => {
    expect(renderToStaticMarkup(<StreakBadge streak={{ current: 0, best: 4, playedToday: false }} />)).toBe('');
    const atRisk = renderToStaticMarkup(<StreakBadge streak={{ current: 3, best: 3, playedToday: false }} />);
    expect(atRisk).toContain('streak-badge at-risk');
    expect(atRisk).toContain('3 дня подряд, сегодня ещё не сыграно');
    expect(renderToStaticMarkup(<StreakBadge streak={{ current: 3, best: 3, playedToday: true }} />)).not.toContain('at-risk');
  });

  it('nudges to play only while the streak can still burn today', () => {
    expect(renderToStaticMarkup(<StreakHint streak={{ current: 5, best: 5, playedToday: false }} />)).toContain('Серия 5 дней');
    expect(renderToStaticMarkup(<StreakHint streak={{ current: 5, best: 5, playedToday: true }} />)).toBe('');
  });

  it('draws the level bar with the XP rules spelled out', () => {
    const html = renderToStaticMarkup(<LevelBar level={levelFromXp(130)} />);
    expect(html).toContain('Уровень 2');
    expect(html).toContain('30 / 150 опыта');
    expect(html).toContain('width:20%');
    expect(html).toContain('10 за верный ответ');
  });

  it('counts unlocked achievements and shows progress on locked ones', () => {
    const html = renderToStaticMarkup(<AchievementGrid achievements={achievementsOf(stats)} />);
    expect(html).toContain('3 из 14');
    expect(html).toContain('30 / 100');
    expect(html.match(/achievement unlocked/g)).toHaveLength(3);
  });

  it('declines day counts', () => {
    expect([1, 2, 5, 11, 21].map(daysText)).toEqual(['1 день', '2 дня', '5 дней', '11 дней', '21 день']);
  });
});

describe('category select', () => {
  it('keeps «Общие знания» in view and folds the niche categories', () => {
    const html = renderToStaticMarkup(<CategorySelect onSelect={() => {}} onBack={() => {}} />);
    const folded = html.slice(html.indexOf('<details'));
    expect(html.indexOf('Общие знания')).toBeLessThan(html.indexOf('<details'));
    expect(folded).toContain('Ещё категории');
    expect(folded).toContain('География');
    expect(folded).toContain('Языки');
  });
});

describe('achievement detail', () => {
  it('invites to tap a tile and words the progress of the selected one', () => {
    const html = renderToStaticMarkup(<AchievementGrid achievements={achievementsOf(stats)} />);
    expect(html).toContain('Нажми на достижение');
    expect(html).toContain('aria-pressed="false"');
    const [firstRun, , fast, , week] = achievementsOf(stats);
    expect(achievementStatus(firstRun)).toBe('Получено');
    expect(achievementStatus(week)).toBe('Прогресс: 3 из 7');
    expect(achievementStatus(fast)).toBe('Ещё не получено');
  });
});

describe('what is new', () => {
  it('lists the release changes with a single close button', () => {
    const html = renderToStaticMarkup(<WhatsNewDialog release={WHATS_NEW_RELEASE} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain(WHATS_NEW.title);
    expect(html.match(/whats-new-item/g)).toHaveLength(9);
    expect(html).toContain('Молоток стал сложнее');
    expect(html).toContain('Понятно, играть');
  });
});
