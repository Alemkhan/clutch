import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_HAMMER_MINI_GAME } from '@clutch/shared';
import { HammerGame, HammerIntro } from './HammerGame';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('HammerIntro markup', () => {
  it('contains the verbatim explanation and the start button', () => {
    const html = renderToStaticMarkup(<HammerIntro onConfirm={() => {}} />);
    for (const text of [
      'Как забить гвоздь',
      'Маркер бежит по полосе туда и обратно.',
      'Тапни, чтобы остановить его в целевой зоне.',
      'Чем ближе к центру, тем больше прогресса за удар.',
      'Промах не даёт прогресса, но попытку не отнимает.',
      'С каждым удачным ударом зоны становятся уже.',
      'Понятно, бью',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('role="region"');
  });
});

describe('HammerGame first-visit gating', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  const props = {
    config: CURRENT_HAMMER_MINI_GAME.config,
    questionId: 'q1',
    previousSkillResults: [],
    onComplete: () => {},
  } as unknown as Parameters<typeof HammerGame>[0];

  it('renders the intro on empty storage', () => {
    const html = renderToStaticMarkup(<HammerGame {...props} />);
    expect(html).toContain('Как забить гвоздь');
    expect(html).toContain('Понятно, бью');
    expect(html).not.toContain('Как это работает');
  });

  it('does not render the intro after it was seen', () => {
    localStorage.setItem('clutch_hammer_intro_seen_v1', '1');
    const html = renderToStaticMarkup(<HammerGame {...props} />);
    expect(html).not.toContain('Как забить гвоздь');
    expect(html).not.toContain('Как это работает');
  });
});
