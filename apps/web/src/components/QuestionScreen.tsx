import { useEffect, useRef, useState } from 'react';
import type { Question } from '@clutch/shared';
import { OpenAnswerInput } from './OpenAnswerInput';
import { TimerBar } from './TimerBar';
import { playSound } from '../lib/sounds';
import {
  createQuestionTiming,
  type QuestionDecision,
  QuestionSubmissionGate,
} from '../lib/questionTiming';

const QUESTION_TIME_MS = 15_000;
const FEEDBACK_DELAY_MS = 200;

interface QuestionScreenProps {
  question: Question;
  onAnswer: (optionId: string, timeMs: number) => void;
}

export function QuestionScreen({ question, onAnswer }: QuestionScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const timingRef = useRef(createQuestionTiming(Date.now(), QUESTION_TIME_MS));
  const gateRef = useRef(new QuestionSubmissionGate(timingRef.current));
  const delayedAnswerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (delayedAnswerRef.current !== null) clearTimeout(delayedAnswerRef.current);
  }, []);

  const applyDecision = (decision: QuestionDecision, delay: boolean) => {
    setSelected(decision.answer);
    playSound(decision.kind === 'timeout' ? 'timeout' : 'click');

    if (!delay) {
      onAnswer(decision.answer, decision.elapsedMs);
      return;
    }

    delayedAnswerRef.current = setTimeout(() => {
      delayedAnswerRef.current = null;
      onAnswer(decision.answer, decision.elapsedMs);
    }, FEEDBACK_DELAY_MS);
  };

  const handleSelect = (optionId: string) => {
    const decision = gateRef.current.answer(optionId, Date.now());
    if (decision) applyDecision(decision, true);
  };

  const handleOpenSubmit = (answer: string) => {
    const decision = gateRef.current.answer(answer, Date.now());
    if (decision) applyDecision(decision, decision.kind === 'timeout');
  };

  const handleExpire = () => {
    const decision = gateRef.current.expire(Date.now());
    if (decision) applyDecision(decision, true);
  };

  const isOpen = question.answerType === 'open_answer';
  const timedOut = selected === '__timeout__';

  return (
    <div className="question-screen">
      <div className="question-meta">
        <span className="category-chip">{question.subcategory ?? question.category}</span>
        <TimerBar
          durationMs={QUESTION_TIME_MS}
          deadlineMs={timingRef.current.deadlineMs}
          onExpire={handleExpire}
          paused={selected !== null}
        />
      </div>

      {question.mediaUrl && (
        <img
          src={question.mediaUrl}
          alt={question.mediaType === 'outline' ? 'Контур страны' : 'Флаг'}
          className={`question-media ${question.mediaType === 'outline' ? 'outline' : ''}`}
          loading="lazy"
        />
      )}

      {question.mediaText && (
        <div className="question-media-text">{question.mediaText}</div>
      )}

      <h2 className="question-prompt">{question.prompt}</h2>

      {timedOut ? (
        <div className="timeout-message">Время вышло!</div>
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
