import { describe, expect, it } from 'vitest';
import { buildSoloShareText } from './soloShare';

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
});
