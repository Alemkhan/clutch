import { useEffect, useRef, useState } from 'react';
import type { PublicQuestion } from '@clutch/shared';
import { OpenAnswerInput } from './OpenAnswerInput';
import { TimerBar } from '../../ui/TimerBar';
import { playSound } from '../../platform/sounds';
import {
  createQuestionReadiness,
  markQuestionMediaError,
  markQuestionMediaReady,
  retryQuestionMedia,
  isTooEarlyForOptionTap,
  type QuestionDecision,
  QuestionSubmissionGate,
} from './questionTiming';

const QUESTION_TIME_MS = 15_000;
const FEEDBACK_DELAY_MS = 200;

interface QuestionScreenProps {
  question: PublicQuestion;
  onAnswer: (optionId: string, timeMs: number) => void;
}

export function QuestionScreen({ question, onAnswer }: QuestionScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [readiness, setReadiness] = useState(() => (
    createQuestionReadiness(Boolean(question.mediaUrl), Date.now(), QUESTION_TIME_MS)
  ));
  const gateRef = useRef<QuestionSubmissionGate | null>(null);
  const delayedAnswerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (delayedAnswerRef.current !== null) clearTimeout(delayedAnswerRef.current);
  }, []);

  const applyDecision = (decision: QuestionDecision, delay: boolean) => {
    setSelected(decision.answer);
    // Picking an answer is silent now; only running out of time still speaks.
    if (decision.kind === 'timeout') playSound('timeout');

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
    if (!readiness.timing) return;
    if (isTooEarlyForOptionTap(readiness.timing, Date.now())) return;
    gateRef.current ??= new QuestionSubmissionGate(readiness.timing);
    const decision = gateRef.current.answer(optionId, Date.now());
    if (decision) applyDecision(decision, true);
  };

  const handleOpenSubmit = (answer: string) => {
    if (!readiness.timing) return;
    gateRef.current ??= new QuestionSubmissionGate(readiness.timing);
    const decision = gateRef.current.answer(answer, Date.now());
    if (decision) applyDecision(decision, decision.kind === 'timeout');
  };

  const handleExpire = () => {
    if (!readiness.timing) return;
    gateRef.current ??= new QuestionSubmissionGate(readiness.timing);
    const decision = gateRef.current.expire(Date.now());
    if (decision) applyDecision(decision, true);
  };

  const handleMediaLoad = () => {
    const requestKey = readiness.requestKey;
    const loadedAtMs = Date.now();
    setReadiness((current) => (
      markQuestionMediaReady(current, requestKey, loadedAtMs, QUESTION_TIME_MS)
    ));
  };

  const handleMediaError = () => {
    const requestKey = readiness.requestKey;
    setReadiness((current) => markQuestionMediaError(current, requestKey));
  };
  const handleMediaRetry = () => setReadiness(retryQuestionMedia);

  const isOpen = question.answerType === 'open_answer';
  const timedOut = selected === '__timeout__';
  const ready = readiness.status === 'ready';

  return (
    <div className="question-screen">
      <div className="question-meta">
        <span className="category-chip">{question.subcategory ?? question.category}</span>
        {readiness.timing && (
          <TimerBar
            durationMs={QUESTION_TIME_MS}
            deadlineMs={readiness.timing.deadlineMs}
            onExpire={handleExpire}
            paused={selected !== null}
          />
        )}
      </div>

      {question.mediaUrl && (
        <div className={`question-media-slot ${readiness.status}${question.mediaType === 'image' ? ' artwork' : ''}`}>
          <img
            key={readiness.requestKey}
            src={question.mediaUrl}
            alt={question.mediaType === 'outline' ? 'Контур страны' : question.mediaType === 'image' ? 'Иллюстрация к вопросу' : 'Флаг'}
            className={`question-media ${question.mediaType === 'outline' ? 'outline' : question.mediaType === 'image' ? 'artwork' : ''}`}
            loading="eager"
            onLoad={handleMediaLoad}
            onError={handleMediaError}
          />
          {readiness.status === 'pending' && (
            <div className="question-media-status" role="status">
              Загружаем изображение вопроса…
            </div>
          )}
          {readiness.status === 'error' && (
            <div className="question-media-status error" role="alert">
              <span>Не удалось загрузить изображение вопроса.</span>
              <button type="button" className="question-media-retry" onClick={handleMediaRetry}>
                Повторить загрузку
              </button>
            </div>
          )}
        </div>
      )}

      {ready && question.mediaText && (
        <div className="question-media-text">{question.mediaText}</div>
      )}

      {ready && <h2 className="question-prompt">{question.prompt}</h2>}

      {ready && (timedOut ? (
        <div className="timeout-message" role="alert">Время вышло!</div>
      ) : isOpen ? (
        <OpenAnswerInput onSubmit={handleOpenSubmit} onSkip={() => handleOpenSubmit('')} disabled={selected !== null} />
      ) : (
        <div className="options">
          {question.options.map((option) => (
            <button
              type="button"
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
      ))}
    </div>
  );
}
