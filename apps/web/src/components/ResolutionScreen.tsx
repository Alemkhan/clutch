import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Question } from '@clutch/shared';
import { playSound } from '../lib/sounds';
import { shouldActivateAction } from '../lib/accessibility';

interface ResolutionScreenProps {
  question: Question;
  correct: boolean;
  selectedOptionId: string;
  onContinue: () => void;
}

export function ResolutionScreen({ question, correct, selectedOptionId, onContinue }: ResolutionScreenProps) {
  const continuedRef = useRef(false);

  useEffect(() => {
    playSound(correct ? 'correct' : 'incorrect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueOnce = () => {
    if (!shouldActivateAction(continuedRef.current)) return;
    continuedRef.current = true;
    onContinue();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!shouldActivateAction(false, event.key)) return;
    event.preventDefault();
    continueOnce();
  };

  const actionLabel = correct
    ? 'Верно. Перейти к мини-игре'
    : 'Неверно. Продолжить к следующему раунду';

  return (
    <div
      className="resolution-screen"
      role="button"
      tabIndex={0}
      aria-label={actionLabel}
      onClick={continueOnce}
      onKeyDown={handleKeyDown}
    >
      <div className={`resolution-card ${correct ? 'correct' : 'incorrect'}`}>
        <div className="resolution-symbol" aria-hidden="true">{correct ? '✓' : '×'}</div>
        <div className={`resolution-status ${correct ? 'correct' : 'incorrect'}`}>
          {correct ? 'Верно!' : 'Мимо'}
        </div>
        {correct ? (
          <p className="resolution-message">Попытка заработана</p>
        ) : (
          <p className="resolution-message">В этом раунде без мини-игры</p>
        )}
        <p className="resolution-explanation">{question.explanation}</p>
      </div>
      {correct ? (
        <div className="hammer-earned">Перейти к мини-игре <span aria-hidden="true">→</span></div>
      ) : (
        <div className="continue-hint">Тапни, чтобы продолжить</div>
      )}
    </div>
  );
}
