import { useEffect, useReducer, useRef, useState } from 'react';
import type { PublicQuestion, QuestionReportKind, TrainingCheckResponse } from '@clutch/shared';
import { QuestionScreen } from '../round/QuestionScreen';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { ResolutionScreen } from '../round/ResolutionScreen';
import type { ResolutionReportStatus } from '../round/reportPanel';
import {
  applyTrainingVerdict,
  beginTrainingAnswer,
  continueTraining,
  createTrainingState,
  failTrainingCheck,
  retryTrainingCheck,
  trainingAnswerText,
  type TrainingState,
} from './trainingSession';

/** Данные репорта, которые Training знает из своей сессии; сеть (mode 'training') подключает MistakePractice. */
export interface TrainingReportInput {
  questionId: string;
  category: string;
  verdict: boolean;
  kind: QuestionReportKind;
  playerAnswer?: string;
  comment?: string;
}

interface TrainingProps {
  questions: PublicQuestion[];
  /** Проверка ответа на сервере: клиент не знает правильного ответа заранее. */
  check: (questionId: string, answer: string, signal?: AbortSignal) => Promise<TrainingCheckResponse>;
  onBack: () => void;
  /** Подпись кнопки выхода на итоговых экранах. */
  exitLabel?: string;
  /** Репорт о проблеме с разбора; без пропа кнопки «Сообщить о проблеме» нет. */
  onReport?: (input: TrainingReportInput) => Promise<unknown>;
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

export function Training({ questions, check, onBack, exitLabel = 'На главный', onReport }: TrainingProps) {
  const [state, dispatch] = useReducer(reducer, questions, createTrainingState);
  const question = state.questions[state.index];
  const selectedAnswer = question?.answerType === 'multiple_choice'
    ? question.options.find((option) => option.id === state.selectedOption)?.text
    : undefined;
  const checkRef = useRef(check);
  checkRef.current = check;
  // Статус репорта привязан к вопросу: следующий разбор снова начинает с idle.
  const [report, setReport] = useState<{ questionId: string; status: ResolutionReportStatus } | null>(null);

  const submitReport = (kind: QuestionReportKind, comment: string): void => {
    const current = state.questions[state.index];
    if (!onReport || !current) return;
    const playerAnswer = current.answerType === 'multiple_choice'
      ? current.options.find((option) => option.id === state.selectedOption)?.text
      : state.selectedOption || undefined;
    setReport({ questionId: current.id, status: 'sending' });
    void onReport({
      questionId: current.id,
      category: current.category,
      verdict: state.lastCorrect,
      kind,
      ...(comment ? { comment } : {}),
      ...(playerAnswer ? { playerAnswer } : {}),
    })
      .then(() => setReport({ questionId: current.id, status: 'sent' }))
      .catch(() => setReport({ questionId: current.id, status: 'error' }));
  };

  // Ответ уходит на проверку; при обрыве он сохраняется, а «Повторить» отправляет его снова.
  const checking = state.step === 'checking' && !state.checkFailed;
  useEffect(() => {
    if (!checking || !question) return undefined;
    const controller = new AbortController();
    void checkRef.current(question.id, trainingAnswerText(question, state.selectedOption), controller.signal)
      .then((verdict) => {
        if (controller.signal.aborted) return;
        dispatch({ type: 'verdict', verdict });
      })
      .catch(() => {
        if (!controller.signal.aborted) dispatch({ type: 'failed' });
      });
    return () => controller.abort();
  }, [checking, question, state.selectedOption]);

  if (questions.length === 0) {
    return (
      <section className="training-screen root-tab">
        <h2 className="screen-title">Тренировка по ошибкам</h2>
        <p className="training-text">
          Пока здесь пусто: тренировка наполняется вопросами, в которых ты ошибся или не успел ответить в забегах.
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
      <section className="training-screen root-tab">
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
          correctAnswer={state.correctAnswer}
          selectedAnswer={state.lastCorrect ? undefined : selectedAnswer}
          explanation={state.explanation}
          correct={state.lastCorrect}
          timedOut={state.selectedOption === '__timeout__'}
          variant="training"
          final={state.index + 1 >= state.questions.length}
          onContinue={() => dispatch({ type: 'continue' })}
          report={onReport ? {
            onSend: submitReport,
            state: report?.questionId === question.id ? report.status : 'idle',
          } : undefined}
        />
      )}
    </section>
  );
}
