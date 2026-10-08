import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Opponent } from '@clutch/shared';
import { Matchmaking } from '../components/Matchmaking';
import { abandonedNote } from './matchmaking';

function opponent(awards: number[]): Opponent {
  return {
    id: 'o',
    displayName: 'Соперник',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: `q${index + 1}`,
      correct: progressAwarded > 0,
      responseTimeMs: 1000,
      skillScore: progressAwarded / 25,
      progressAwarded,
    })),
  };
}

describe('abandonedNote', () => {
  it('names the last recorded question of a cut-short player record', () => {
    expect(abandonedNote('player', opponent([25, 0, 5, 0, 0, 5]), 10)).toBe('Запись оборвалась на 6-м вопросе');
  });

  it('does not label an early 100, a full record, a bot or a local match', () => {
    expect(abandonedNote('player', opponent([25, 25, 25, 25]), 10)).toBeNull();
    expect(abandonedNote('player', opponent(Array(10).fill(5)), 10)).toBeNull();
    expect(abandonedNote('bot', opponent([5, 5, 5]), 10)).toBeNull();
    expect(abandonedNote('local', opponent([5, 5, 5]), 10)).toBeNull();
  });

  it('renders the note in the lobby only when given', () => {
    const props = {
      opponent: opponent([5, 5, 5]), status: 'ready' as const, source: 'player' as const,
      onStart: vi.fn(), onRetry: vi.fn(), onLocalPractice: vi.fn(), onBack: vi.fn(),
    };
    const withNote = renderToStaticMarkup(<Matchmaking {...props} abandonedNote="Запись оборвалась на 3-м вопросе" />);
    expect(withNote).toContain('Запись оборвалась на 3-м вопросе');
    expect(renderToStaticMarkup(<Matchmaking {...props} />)).not.toContain('оборвалась');
  });
});
