import { useEffect } from 'react';
import type { Question } from '@clutch/shared';
import { playSound } from '../lib/sounds';

interface ResolutionScreenProps {
  question: Question;
  correct: boolean;
  selectedOptionId: string;
  onContinue: () => void;
}

export function ResolutionScreen({ question, correct, selectedOptionId, onContinue }: ResolutionScreenProps) {
  useEffect(() => {
    playSound(correct ? 'correct' : 'incorrect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="resolution-screen" onClick={onContinue}>
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
