import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Opponent } from '@clutch/shared';
import { Matchmaking } from './Matchmaking';

const opponent: Opponent = {
  id: 'opponent-1',
  displayName: 'Скрытый соперник',
  rounds: [],
};

const actions = {
  onStart: vi.fn(),
  onRetry: vi.fn(),
  onLocalPractice: vi.fn(),
  onBack: vi.fn(),
};

describe('Matchmaking states', () => {
  it('does not reveal the placeholder opponent while loading', () => {
    const html = renderToStaticMarkup(
      <Matchmaking {...actions} opponent={opponent} status="loading" source="local" />,
    );
    expect(html).toContain('Ищем соперника');
    expect(html).not.toContain(opponent.displayName);
    expect(html).not.toContain('Локальная практика');
  });

  it('shows recovery actions without pretending a match exists', () => {
    const html = renderToStaticMarkup(
      <Matchmaking
        {...actions}
        opponent={opponent}
        status="error"
        source="local"
        error="Матчмейкинг временно недоступен."
      />,
    );
    expect(html).toContain('Матчмейкинг временно недоступен.');
    expect(html).toContain('Повторить');
    expect(html).toContain('Локальная практика');
    expect(html).not.toContain(opponent.displayName);
  });

  it.each([
    ['player', 'Запись игрока'],
    ['bot', 'Бот'],
    ['local', 'Локальная практика'],
  ] as const)('labels a ready %s match honestly', (source, label) => {
    const html = renderToStaticMarkup(
      <Matchmaking {...actions} opponent={opponent} status="ready" source={source} />,
    );
    expect(html).toContain(opponent.displayName);
    expect(html).toContain(label);
    expect(html).toContain('Начать');
  });
});
