import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateQuestionById } from '@clutch/shared';
import { CategorySelect } from './CategorySelect';
import { LastStandIntro, LastStandLeaderboard } from './LastStand';
import { Matchmaking } from './Matchmaking';
import { Profile } from './Profile';
import { ScreenHeader } from './ScreenHeader';
import { Training } from './Training';

const noop = vi.fn();
const BUTTON = /<button type="button" class="back-btn"/g;

function backButtons(html: string): number {
  return (html.match(BUTTON) ?? []).length;
}

describe('ScreenHeader', () => {
  beforeEach(() => vi.stubGlobal('localStorage', {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  }));
  afterEach(() => vi.unstubAllGlobals());

  it('renders a typed button with a visible label and an optional title', () => {
    const html = renderToStaticMarkup(<ScreenHeader onBack={noop} title="Заголовок" />);
    expect(html).toContain('<header class="screen-header">');
    expect(html).toContain('<button type="button" class="back-btn">');
    expect(html).toContain('<span aria-hidden="true">←</span> Назад');
    expect(html).toContain('<h1 class="screen-title">Заголовок</h1>');
  });

  it('keeps a more precise accessible name and a custom label when given', () => {
    const html = renderToStaticMarkup(
      <ScreenHeader onBack={noop} backAriaLabel="Закрыть таблицу дня" backLabel="Выйти" titleAs="h2" title="Т" />,
    );
    expect(html).toContain('aria-label="Закрыть таблицу дня"');
    expect(html).toContain('>Выйти<');
    expect(html).not.toContain('←');
    expect(html).toContain('<h2 class="screen-title">Т</h2>');
  });

  it('draws the back button of all six screens with the same component', () => {
    const question = generateQuestionById('capital_li')!;
    const opponent = { id: 'o', displayName: 'Alex', rounds: [] };
    const screens = [
      renderToStaticMarkup(<CategorySelect onSelect={noop} onBack={noop} />),
      renderToStaticMarkup(
        <Matchmaking opponent={opponent} status="ready" source="player" onStart={noop} onRetry={noop} onBack={noop} />,
      ),
      renderToStaticMarkup(<Profile onBack={noop} />),
      renderToStaticMarkup(<Training questions={[question]} check={vi.fn()} onBack={noop} />),
      renderToStaticMarkup(<LastStandIntro onStart={noop} onLeaderboard={noop} onBack={noop} />),
      renderToStaticMarkup(
        <LastStandLeaderboard view={{ status: 'loading' }} onRetry={noop} onClose={noop} />,
      ),
    ];
    for (const html of screens) {
      expect(backButtons(html)).toBe(1);
      expect(html).toContain('<header class="screen-header');
    }
  });

  it('is the only place that writes the back button markup', () => {
    const dir = new URL('.', import.meta.url);
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx') && name !== 'ScreenHeader.tsx')
      .filter((name) => readFileSync(new URL(name, dir), 'utf8').includes('back-btn'));
    expect(offenders).toEqual([]);
  });
});
