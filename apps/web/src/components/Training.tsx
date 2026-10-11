import { useReducer } from 'react';
import type { Question } from '@clutch/shared';
import { QuestionScreen } from './QuestionScreen';
import { ScreenHeader } from './ScreenHeader';
import { ResolutionScreen } from './ResolutionScreen';
import {
  answerTraining,
  continueTraining,
  createTrainingState,
  type TrainingState,
} from '../lib/trainingSession';
import { playSound } from '../lib/sounds';

interface TrainingProps {
  questions: Question[];
  /** Called once per answered question, with the verdict. */
  onAnswered: (questionId: string, correct: boolean) => void;
  onBack: () => void;
  /** Подпись кнопки выхода на итоговых экранах. */
  exitLabel?: string;
}

export const TRAINING_NOT_SAVED_NOTE =
  'Результат тренировки не сохраняется: он не попадает ни в пул соперников, ни в таблицу, ни в статистику.';

type Action = { type: 'answer'; answer: string } | { type: 'continue' };

function reducer(state: TrainingState, action: Action): TrainingState {
  return action.type === 'answer' ? answerTraining(state, action.answer) : continueTraining(state);
}

export function Training({ questions, onAnswered, onBack, exitLabel = 'На главный' }: TrainingProps) {
  const [state, dispatch] = useReducer(reducer, questions, createTrainingState);
  const question = state.questions[state.index];

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
          onAnswer={(answer) => {
            onAnswered(question.id, answerTraining(state, answer).lastCorrect);
            dispatch({ type: 'answer', answer });
          }}
        />
      )}
      {state.step === 'resolution' && question && (
        <ResolutionScreen
          question={question}
          correct={state.lastCorrect}
          selectedOptionId={state.selectedOption}
          variant="training"
          onContinue={() => dispatch({ type: 'continue' })}
        />
      )}
    </section>
  );
}
