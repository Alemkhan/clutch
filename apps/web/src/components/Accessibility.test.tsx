import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '@clutch/shared';
import { shouldActivateAction } from '../lib/accessibility';
import { ResolutionScreen } from './ResolutionScreen';
import { HammerGame, HammerResult, HammerResultStatus, hammerActionSemantics } from './HammerGame';
import { TimerBar } from './TimerBar';
import { MatchHud } from './MatchHud';

const question: Question = {
  id: 'question-1', type: 'multiple_choice', answerType: 'multiple_choice',
  category: 'geography', difficulty: 'Easy', prompt: 'Столица Казахстана?',
  options: [{ id: 'a', text: 'Астана' }, { id: 'b', text: 'Алматы' }],
  correctOptionId: 'a', explanation: 'Астана — столица Казахстана.', status: 'approved',
  createdAt: '2026-10-01',
};

afterEach(() => vi.restoreAllMocks());

describe('accessible gameplay semantics', () => {
  it('renders resolution as one named keyboard action', () => {
    const html = renderToStaticMarkup(
      <ResolutionScreen question={question} correct selectedOptionId="a" onContinue={vi.fn()} />,
    );

    expect(html).toContain(
      'class="resolution-screen" role="button" tabindex="0" aria-label="Верно. Перейти к мини-игре"',
    );
    expect(shouldActivateAction(false)).toBe(true);
    expect(shouldActivateAction(false, 'Enter')).toBe(true);
    expect(shouldActivateAction(false, ' ')).toBe(true);
    expect(shouldActivateAction(false, 'Escape')).toBe(false);
    expect(shouldActivateAction(true, 'Enter')).toBe(false);
  });

  it('names the hammer action and exposes its disabled-after-hit state', () => {
    const html = renderToStaticMarkup(
      <HammerGame
        config={{ markerSpeed: 0.8, targetWidth: 0.85, perfectWidth: 0.15 }}
        onComplete={vi.fn()}
      />,
    );

    expect(html).toContain(
      'class="hammer-game" role="button" tabindex="0" aria-disabled="false" aria-label="Нажмите, чтобы ударить по пню"',
    );
    expect(hammerActionSemantics(true, 'great')).toEqual({
      tabIndex: -1,
      'aria-disabled': true,
      'aria-label': 'Удар завершён',
    });
  });

  it('keeps the visible hammer result decorative and announces one polite status', () => {
    const visibleHtml = renderToStaticMarkup(<HammerResult result="perfect" />);
    const statusHtml = renderToStaticMarkup(<HammerResultStatus result="perfect" />);

    expect(visibleHtml).toBe(
      '<div class="strike-result perfect" aria-hidden="true"><span class="strike-label">ИДЕАЛЬНО</span><span class="strike-progress">+25%</span></div>',
    );
    expect(statusHtml).toBe(
      '<span class="visually-hidden" role="status">Результат удара: Идеально, +25% прогресса.</span>',
    );
  });

  it('exposes the countdown as a non-live timer with decorative graphics', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const html = renderToStaticMarkup(
      <TimerBar durationMs={15_000} deadlineMs={16_000} onExpire={vi.fn()} paused={false} />,
    );

    expect(html).toContain('role="timer" aria-label="Осталось 15 сек." aria-live="off"');
    expect(html).toContain('<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">');
    expect(html).toContain('<span class="timer-ring-text" aria-hidden="true">15</span>');
  });

  it('exposes both match tracks as bounded progress bars', () => {
    const html = renderToStaticMarkup(
      <MatchHud player={35} opponent={140} opponentName="Алекс" round={2} totalRounds={10} />,
    );

    expect(html).toContain(
      'role="progressbar" aria-label="Прогресс: Ты" aria-valuemin="0" aria-valuemax="100" aria-valuenow="35" aria-valuetext="35%"',
    );
    expect(html).toContain(
      'role="progressbar" aria-label="Прогресс: Алекс" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" aria-valuetext="100%"',
    );
    expect(html.match(/class="match-hud-fill" aria-hidden="true"/g)).toHaveLength(2);
  });
});
