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
      <img
        className={`resolution-impact ${correct ? 'correct' : 'incorrect'}`}
        src={correct ? '/sprites/burst-correct.png' : '/sprites/smoke-incorrect.png'}
        alt=""
        aria-hidden="true"
      />

      <div className={`resolution-status ${correct ? 'correct' : 'incorrect'}`}>
        {correct ? 'Correct!' : 'Wrong'}
      </div>
      {correct ? (
        <p className="resolution-message">Hammer strike earned.</p>
      ) : (
        <p className="resolution-message">No strike this round.</p>
      )}
      <p className="resolution-explanation">{question.explanation}</p>
      {correct ? (
        <div className="hammer-earned">Tap to strike</div>
      ) : (
        <div className="continue-hint">Tap to continue</div>
      )}
    </div>
  );
}
