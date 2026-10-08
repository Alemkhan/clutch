import { useReducer } from 'react';
import type { Question } from '@clutch/shared';
import { QuestionScreen } from './QuestionScreen';
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
}

export const TRAINING_NOT_SAVED_NOTE =
  'Результат тренировки не сохраняется: он не попадает ни в пул соперников, ни в таблицу, ни в статистику.';

type Action = { type: 'answer'; answer: string } | { type: 'continue' };

function reducer(state: TrainingState, action: Action): TrainingState {
  return action.type === 'answer' ? answerTraining(state, action.answer) : continueTraining(state);
}

export function Training({ questions, onAnswered, onBack }: TrainingProps) {
  const [state, dispatch] = useReducer(reducer, questions, createTrainingState);
  const question = state.questions[state.index];

  if (questions.length === 0) {
    return (
      <section className="training-screen">
        <h2 className="training-title">Тренировка по ошибкам</h2>
        <p className="training-text">
          Пока здесь пусто: тренировка наполняется вопросами, в которых ты ошибся или не успел ответить в матчах.
        </p>
        <p className="training-note">{TRAINING_NOT_SAVED_NOTE}</p>
        <button type="button" className="cta-btn" onClick={() => { playSound('click'); onBack(); }}>
          На главный
        </button>
      </section>
    );
  }

  if (state.step === 'done') {
    return (
      <section className="training-screen">
        <h2 className="training-title">Тренировка завершена</h2>
        <p className="training-text">
          Верно: {state.correctCount} из {state.questions.length}. Верный ответ уменьшает счётчик ошибок по вопросу.
        </p>
        <p className="training-note">{TRAINING_NOT_SAVED_NOTE}</p>
        <button type="button" className="cta-btn" onClick={() => { playSound('click'); onBack(); }}>
          На главный
        </button>
      </section>
    );
  }

  return (
    <section className="training-screen">
      <div className="training-header">
        <span className="chip">Тренировка · {state.index + 1} из {state.questions.length}</span>
        <button type="button" className="training-exit" onClick={() => { playSound('click'); onBack(); }}>
          Выйти
        </button>
      </div>
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
