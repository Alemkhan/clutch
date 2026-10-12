import { useEffect, useReducer, useRef } from 'react';
import type { PublicQuestion, TrainingCheckResponse } from '@clutch/shared';
import { QuestionScreen } from './QuestionScreen';
import { ScreenHeader } from './ScreenHeader';
import { ResolutionScreen } from './ResolutionScreen';
import {
  applyTrainingVerdict,
  beginTrainingAnswer,
  continueTraining,
  createTrainingState,
  failTrainingCheck,
  retryTrainingCheck,
  trainingAnswerText,
  type TrainingState,
} from '../lib/trainingSession';

interface TrainingProps {
  questions: PublicQuestion[];
  /** Проверка ответа на сервере: клиент не знает правильного ответа заранее. */
  check: (questionId: string, answer: string, signal?: AbortSignal) => Promise<TrainingCheckResponse>;
  /** Called once per answered question, with the verdict. */
  onAnswered: (questionId: string, correct: boolean) => void;
  onBack: () => void;
  /** Подпись кнопки выхода на итоговых экранах. */
  exitLabel?: string;
}

export const TRAINING_NOT_SAVED_NOTE =
  'Результат тренировки не сохраняется: он не попадает ни в пул соперников, ни в таблицу, ни в статистику.';

type Action =
  | { type: 'answer'; answer: string }
  | { type: 'verdict'; verdict: TrainingCheckResponse }
  | { type: 'failed' }
  | { type: 'retry' }
  | { type: 'continue' };

function reducer(state: TrainingState, action: Action): TrainingState {
  switch (action.type) {
    case 'answer': return beginTrainingAnswer(state, action.answer);
    case 'verdict': return applyTrainingVerdict(state, action.verdict);
    case 'failed': return failTrainingCheck(state);
    case 'retry': return retryTrainingCheck(state);
    case 'continue': return continueTraining(state);
  }
}

export function Training({ questions, check, onAnswered, onBack, exitLabel = 'На главный' }: TrainingProps) {
  const [state, dispatch] = useReducer(reducer, questions, createTrainingState);
  const question = state.questions[state.index];
  const checkRef = useRef(check);
  const answeredRef = useRef(onAnswered);
  checkRef.current = check;
  answeredRef.current = onAnswered;

  // Ответ уходит на проверку; при обрыве он сохраняется, а «Повторить» отправляет его снова.
  const checking = state.step === 'checking' && !state.checkFailed;
  useEffect(() => {
    if (!checking || !question) return undefined;
    const controller = new AbortController();
    void checkRef.current(question.id, trainingAnswerText(question, state.selectedOption), controller.signal)
      .then((verdict) => {
        if (controller.signal.aborted) return;
        answeredRef.current(question.id, verdict.correct);
        dispatch({ type: 'verdict', verdict });
      })
      .catch(() => {
        if (!controller.signal.aborted) dispatch({ type: 'failed' });
      });
    return () => controller.abort();
  }, [checking, question, state.selectedOption]);

  if (questions.length === 0) {
    return (
      <section className="training-screen">
        <h2 className="screen-title">Тренировка по ошибкам</h2>
        <p className="training-text">
          Пока здесь пусто: тренировка наполняется вопросами, в которых ты ошибся или не успел ответить в матчах.
        </p>
        <p className="training-note">{TRAINING_NOT_SAVED_NOTE}</p>
        <button type="button" className="cta-btn" onClick={() => { onBack(); }}>
          {exitLabel}
        </button>
      </section>
    );
  }

  if (state.step === 'done') {
    return (
      <section className="training-screen">
        <h2 className="screen-title">Тренировка завершена</h2>
        <p className="training-text">
          Верно: {state.correctCount} из {state.questions.length}. Верный ответ уменьшает счётчик ошибок по вопросу.
        </p>
        <p className="training-note">{TRAINING_NOT_SAVED_NOTE}</p>
        <button type="button" className="cta-btn" onClick={() => { onBack(); }}>
          {exitLabel}
        </button>
      </section>
    );
  }

  return (
    <section className="training-screen">
      <ScreenHeader
        className="training-header"
        leading={<span className="chip">Тренировка · {state.index + 1} из {state.questions.length}</span>}
        backLabel="Выйти"
        onBack={onBack}
      />
      <p className="training-note">{TRAINING_NOT_SAVED_NOTE}</p>
      {state.step === 'question' && question && (
        <QuestionScreen
          key={`${state.index}:${question.id}`}
          question={question}
          onAnswer={(answer) => dispatch({ type: 'answer', answer })}
        />
      )}
      {state.step === 'checking' && (
        state.checkFailed ? (
          <div className="training-check">
            <p className="matchmaking-error" role="alert">Не удалось проверить ответ. Проверь соединение и повтори.</p>
            <button type="button" className="cta-btn" onClick={() => dispatch({ type: 'retry' })}>Повторить</button>
          </div>
        ) : (
          <div className="matchmaking-loading training-check" role="status"><span /> Проверяем ответ</div>
        )
      )}
      {state.step === 'resolution' && question && (
        <ResolutionScreen
          explanation={state.explanation}
          correct={state.lastCorrect}
          selectedOptionId={state.selectedOption}
          variant="training"
          onContinue={() => dispatch({ type: 'continue' })}
        />
      )}
    </section>
  );
}
