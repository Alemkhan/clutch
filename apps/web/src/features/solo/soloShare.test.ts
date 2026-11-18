import { describe, expect, it } from 'vitest';
import { buildSoloShareText, roundGrid } from './soloShare';

describe('solo result share text', () => {
  it('a run that stopped short says how far it got and invites to finish', () => {
    expect(buildSoloShareText({ reachedTarget: false, progress: 24, roundsPlayed: 20, perfectHits: 0, categoryLabel: 'Общие знания' }))
      .toBe('Clutch · Общие знания · 24% за 20 кругов. Дойдёшь до 100%?');
  });

  it('a finished run gives the rounds and perfect hits', () => {
    expect(buildSoloShareText({ reachedTarget: true, progress: 100, roundsPlayed: 9, perfectHits: 3, categoryLabel: 'География' }))
      .toBe('Clutch · География · 100% за 9 кругов · идеально: 3. Сможешь быстрее?');
  });

  it('leaves out perfect hits when there were none', () => {
    expect(buildSoloShareText({ reachedTarget: true, progress: 100, roundsPlayed: 2, perfectHits: 0, categoryLabel: 'Языки' }))
      .toBe('Clutch · Языки · 100% за 2 круга. Сможешь быстрее?');
  });

  it('builds a Wordle-style card with the day number and a grid of rounds', () => {
    const text = buildSoloShareText({
      reachedTarget: true, progress: 100, roundsPlayed: 12, perfectHits: 1, categoryLabel: 'Общие знания',
      roundAwards: [25, 18, 0, 12, 18, 18, 0, 25, 12, 18, 12, 18], dayNumber: 29,
    });
    expect(text.split('\n')).toEqual([
      'Clutch #29 · Общие знания',
      '🟩🟩🟥🟩🟩🟩🟥🟩🟩🟩',
      '🟩🟩',
      '100% за 12 кругов · идеально: 1. Сможешь быстрее?',
    ]);
  });

  it('has no day number outside the daily run', () => {
    expect(roundGrid([0, 5])).toBe('🟥🟩');
    expect(buildSoloShareText({ reachedTarget: false, progress: 40, roundsPlayed: 2, perfectHits: 0, categoryLabel: 'Общие знания', roundAwards: [0, 5] }))
      .toBe('Clutch · Общие знания\n🟥🟩\n40% за 2 круга. Дойдёшь до 100%?');
  });
});
