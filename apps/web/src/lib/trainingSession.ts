import { generateQuestionById, isAnswerCorrect, type Question } from '@clutch/shared';
import { selectTrainingIds, type MistakeEntry } from './mistakeLog';

export type TrainingStep = 'question' | 'resolution' | 'done';

export interface TrainingState {
  questions: Question[];
  index: number;
  step: TrainingStep;
  correctCount: number;
  lastCorrect: boolean;
  selectedOption: string;
}

export function buildTrainingQuestions(list: readonly MistakeEntry[]): Question[] {
  return selectTrainingIds(list)
    .map((id) => generateQuestionById(id))
    .filter((q): q is Question => q !== null);
}

export function createTrainingState(questions: Question[]): TrainingState {
  return {
    questions,
    index: 0,
    step: questions.length > 0 ? 'question' : 'done',
    correctCount: 0,
    lastCorrect: false,
    selectedOption: '',
  };
}

export function isTrainingAnswerCorrect(question: Question, answer: string): boolean {
  return question.answerType === 'open_answer'
    ? isAnswerCorrect(answer, question.correctAnswers ?? []).correct
    : answer === question.correctOptionId;
}

export function answerTraining(state: TrainingState, answer: string): TrainingState {
  if (state.step !== 'question') return state;
  const question = state.questions[state.index];
  const correct = Boolean(question) && isTrainingAnswerCorrect(question, answer);
  return {
    ...state,
    step: 'resolution',
    lastCorrect: correct,
    selectedOption: answer,
    correctCount: state.correctCount + (correct ? 1 : 0),
  };
}

export function continueTraining(state: TrainingState): TrainingState {
  if (state.step !== 'resolution') return state;
  const next = state.index + 1;
  return next >= state.questions.length
    ? { ...state, step: 'done' }
    : { ...state, index: next, step: 'question', lastCorrect: false, selectedOption: '' };
}
