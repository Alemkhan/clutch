import type { PublicQuestion, TrainingCheckResponse } from '@clutch/shared';

/**
 * Отработка ошибок. Вопросы приходят с сервера без ответов, а верность каждого ответа проверяет сервер:
 * клиент ничего не знает о правильном ответе, пока тот не сыгран. Состояние здесь только хранит ход сессии.
 */
export type TrainingStep = 'question' | 'checking' | 'resolution' | 'done';

export interface TrainingState {
  questions: PublicQuestion[];
  index: number;
  step: TrainingStep;
  correctCount: number;
  lastCorrect: boolean;
  selectedOption: string;
  /** Пояснение к сыгранному вопросу; приходит вместе с вердиктом сервера. */
  explanation: string;
  /** Проверка не дошла до сервера: ответ сохранён, ждём повтора. */
  checkFailed: boolean;
}

export function createTrainingState(questions: PublicQuestion[]): TrainingState {
  return {
    questions,
    index: 0,
    step: questions.length > 0 ? 'question' : 'done',
    correctCount: 0,
    lastCorrect: false,
    selectedOption: '',
    explanation: '',
    checkFailed: false,
  };
}

/**
 * Что уходит на проверку. Варианты ответа при каждом запросе собираются заново, поэтому для вопроса
 * с вариантами сервер сверяет ТЕКСТ выбранного варианта, а не его букву; открытый ответ идёт как есть.
 */
export function trainingAnswerText(question: PublicQuestion, answer: string): string {
  if (question.answerType === 'open_answer') return answer;
  return question.options.find((option) => option.id === answer)?.text ?? '';
}

export function beginTrainingAnswer(state: TrainingState, answer: string): TrainingState {
  if (state.step !== 'question') return state;
  return { ...state, step: 'checking', selectedOption: answer, checkFailed: false };
}

export function applyTrainingVerdict(state: TrainingState, verdict: TrainingCheckResponse): TrainingState {
  if (state.step !== 'checking') return state;
  return {
    ...state,
    step: 'resolution',
    lastCorrect: verdict.correct,
    explanation: verdict.explanation,
    correctCount: state.correctCount + (verdict.correct ? 1 : 0),
    checkFailed: false,
  };
}

export function failTrainingCheck(state: TrainingState): TrainingState {
  return state.step === 'checking' ? { ...state, checkFailed: true } : state;
}

export function retryTrainingCheck(state: TrainingState): TrainingState {
  return state.step === 'checking' ? { ...state, checkFailed: false } : state;
}

export function continueTraining(state: TrainingState): TrainingState {
  if (state.step !== 'resolution') return state;
  const next = state.index + 1;
  return next >= state.questions.length
    ? { ...state, step: 'done' }
    : { ...state, index: next, step: 'question', lastCorrect: false, selectedOption: '', explanation: '' };
}
