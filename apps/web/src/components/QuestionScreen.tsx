import { useState, useRef } from 'react';
import type { Question } from '@clutch/shared';
import { OpenAnswerInput } from './OpenAnswerInput';
import { TimerBar } from './TimerBar';
import { playSound } from '../lib/sounds';

const QUESTION_TIME = 15;

interface QuestionScreenProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (optionId: string, timeMs: number) => void;
}

export function QuestionScreen({ question, questionNumber, totalQuestions, onAnswer }: QuestionScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const startTimeRef = useRef(Date.now());

  const lockAnswer = (optionId: string) => {
    setSelected(optionId);
    const elapsed = Date.now() - startTimeRef.current;
    setTimeout(() => onAnswer(optionId, elapsed), 200);
  };

  const handleSelect = (optionId: string) => {
    if (selected) return;
    playSound('click');
    lockAnswer(optionId);
  };

  const handleOpenSubmit = (answer: string, timeMs: number) => {
    if (selected) return;
    playSound('click');
    setSelected(answer);
    onAnswer(answer, timeMs);
  };

  const handleExpire = () => {
    if (selected) return;
    lockAnswer('__timeout__');
  };

  const isOpen = question.answerType === 'open_answer';
  const timedOut = selected === '__timeout__';

  return (
    <div className="question-screen">
      <div className="question-meta">
        <span className="category-chip">{question.subcategory ?? question.category}</span>
        <TimerBar duration={QUESTION_TIME} onExpire={handleExpire} paused={selected !== null} />
        <span className="question-counter">{questionNumber} / {totalQuestions}</span>
      </div>

      {question.mediaUrl && (
        <img
          src={question.mediaUrl}
          alt={question.mediaType === 'outline' ? 'Country outline' : 'Flag'}
          className={`question-media ${question.mediaType === 'outline' ? 'outline' : ''}`}
          loading="lazy"
        />
      )}

      <h2 className="question-prompt">{question.prompt}</h2>

      {timedOut ? (
        <div className="timeout-message">Time's up!</div>
      ) : isOpen ? (
        <OpenAnswerInput onSubmit={handleOpenSubmit} disabled={selected !== null} />
      ) : (
        <div className="options">
          {question.options.map((option) => (
            <button
              key={option.id}
              className={`option-btn ${selected === option.id ? 'selected' : ''}`}
              onClick={() => handleSelect(option.id)}
              disabled={selected !== null}
            >
              <span className="option-letter">{option.id.toUpperCase()}</span>
              <span className="option-text">{option.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
