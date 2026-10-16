import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_HAMMER_MINI_GAME, type Question } from '@clutch/shared';
import { shouldActivateAction } from '../platform/accessibility';
import { ResolutionScreen } from '../features/round/ResolutionScreen';
import { HammerGame, HammerResult, HammerResultStatus, hammerActionSemantics } from '../features/hammer/HammerGame';
import { TimerBar } from './TimerBar';
import { MatchHud } from '../features/round/MatchHud';

const question: Question = {
  id: 'question-1', type: 'multiple_choice', answerType: 'multiple_choice',
  category: 'geography', difficulty: 'Easy', prompt: 'Столица Казахстана?',
  options: [{ id: 'a', text: 'Астана' }, { id: 'b', text: 'Алматы' }],
  correctOptionId: 'a', explanation: 'Астана — столица Казахстана.', status: 'approved',
  createdAt: '2026-10-01',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('accessible gameplay semantics', () => {
  it('renders resolution with one named native action button', () => {
    const html = renderToStaticMarkup(
      <ResolutionScreen
        correctAnswer="Астана"
        explanation={question.explanation}
        correct
        onContinue={vi.fn()}
      />,
    );

    // Действие — одна настоящая кнопка с понятным именем; стрелка скрыта от экранных дикторов.
    expect(html).toContain('<button type="button" class="resolution-action to-hammer">К мини-игре <span aria-hidden="true">→</span></button>');
    expect(html).not.toContain('role="button"');
    expect(shouldActivateAction(false)).toBe(true);
    expect(shouldActivateAction(false, 'Enter')).toBe(true);
    expect(shouldActivateAction(false, ' ')).toBe(true);
    expect(shouldActivateAction(false, 'Escape')).toBe(false);
    expect(shouldActivateAction(true, 'Enter')).toBe(false);
  });

  it('shows both distinct answers as rows of one card for a wrong training choice', () => {
    const html = renderToStaticMarkup(
      <ResolutionScreen
        correctAnswer="Астана"
        selectedAnswer="Алматы"
        explanation="Астана — столица Казахстана."
        correct={false}
        variant="training"
        onContinue={vi.fn()}
      />,
    );

    expect(html).toContain('Следующий вопрос <span aria-hidden="true">→</span>');
    expect(html).toContain('<span>Твой ответ</span><strong>Алматы</strong>');
    expect(html).toContain('<span>Правильный</span><strong>Астана</strong>');
  });

  it('names the hammer action and exposes its disabled-after-hit state', () => {
    // The explanation was already seen on this device, so the attempt is live.
    vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => undefined });
    const html = renderToStaticMarkup(
      <HammerGame
        config={CURRENT_HAMMER_MINI_GAME.config}
        questionId="question-1"
        previousSkillResults={[]}
        onComplete={vi.fn()}
      />,
    );

    expect(html).toContain(
      'class="hammer-game" role="button" tabindex="0" aria-disabled="false" aria-label="Нажмите, чтобы ударить по гвоздю"',
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
      '<div class="strike-result perfect" aria-hidden="true"><span class="strike-label">ИДЕАЛЬНО +25%</span></div>',
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
