import {
  SKILL_REWARDS,
  isAnswerCorrect,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type Opponent,
  type Question,
  type StartAsyncMatchRequest,
} from '@clutch/shared';
import type { RunRow } from './types';

export const categories = new Set(['geography', 'history', 'languages']);

export function isStartRequest(value: unknown): value is StartAsyncMatchRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return body.playerId === undefined
    && body.telegramInitData === undefined
    && typeof body.displayName === 'string'
    && body.displayName.trim().length > 0
    && body.displayName.length <= 64
    && typeof body.category === 'string'
    && categories.has(body.category);
}

export function isRoundInput(value: unknown): value is AsyncMatchRoundInput {
  if (!value || typeof value !== 'object') return false;
  const round = value as Record<string, unknown>;
  return typeof round.questionId === 'string'
    && round.questionId.length > 0
    && round.questionId.length <= 128
    && typeof round.selectedAnswer === 'string'
    && round.selectedAnswer.length <= 512
    && typeof round.responseTimeMs === 'number'
    && Number.isFinite(round.responseTimeMs)
    && round.responseTimeMs >= 0
    && round.responseTimeMs <= 60_000
    && (round.skillDistance === undefined
      || (typeof round.skillDistance === 'number'
        && Number.isFinite(round.skillDistance)
        && round.skillDistance >= 0
        && round.skillDistance <= 1));
}

export function correctFor(question: Question, selectedAnswer: string): boolean {
  if (question.answerType === 'open_answer') {
    return isAnswerCorrect(selectedAnswer, question.correctAnswers ?? []).correct;
  }
  return selectedAnswer === question.correctOptionId;
}

export function parseQuestions(value: string): Question[] | null {
  try {
    const questions = JSON.parse(value) as unknown;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const ids = new Set<string>();
    for (const question of questions) {
      if (!question || typeof question !== 'object') return null;
      const candidate = question as Record<string, unknown>;
      const id = candidate.id;
      if (typeof id !== 'string' || id.length === 0 || ids.has(id)) return null;
      if (candidate.type !== 'multiple_choice'
        || (candidate.answerType !== 'multiple_choice' && candidate.answerType !== 'open_answer')
        || typeof candidate.prompt !== 'string'
        || !Array.isArray(candidate.options)
        || typeof candidate.correctOptionId !== 'string') return null;
      const optionIds = new Set<string>();
      for (const option of candidate.options) {
        if (!option || typeof option !== 'object') return null;
        const record = option as Record<string, unknown>;
        if (typeof record.id !== 'string' || record.id.length === 0
          || typeof record.text !== 'string' || optionIds.has(record.id)) return null;
        optionIds.add(record.id);
      }
      if (candidate.answerType === 'multiple_choice'
        && (optionIds.size === 0 || !optionIds.has(candidate.correctOptionId))) return null;
      if (candidate.answerType === 'open_answer'
        && (!Array.isArray(candidate.correctAnswers) || candidate.correctAnswers.length === 0
          || !candidate.correctAnswers.every(
            (answer) => typeof answer === 'string' && answer.trim().length > 0,
          ))) return null;
      ids.add(id);
    }
    return questions as Question[];
  } catch {
    return null;
  }
}

export function validOpponentForQuestions(value: unknown, questions: Question[]): value is Opponent {
  if (!value || typeof value !== 'object') return false;
  const opponent = value as Partial<Opponent>;
  if (typeof opponent.id !== 'string' || typeof opponent.displayName !== 'string'
    || !Array.isArray(opponent.rounds) || opponent.rounds.length > questions.length) return false;

  let progress = 0;
  const rewards = new Set<number>(Object.values(SKILL_REWARDS));
  for (let index = 0; index < opponent.rounds.length; index += 1) {
    const round = opponent.rounds[index];
    if (!round || round.questionId !== questions[index]?.id
      || typeof round.correct !== 'boolean'
      || !Number.isFinite(round.responseTimeMs) || round.responseTimeMs < 0
      || !Number.isFinite(round.skillScore) || round.skillScore < 0
      || !rewards.has(round.progressAwarded)
      || (!round.correct && round.progressAwarded !== 0)
      || progress === 100) return false;
    progress = Math.min(100, progress + round.progressAwarded);
  }
  return opponent.rounds.length === questions.length || progress === 100;
}

function ghostOpponent(row: RunRow, rounds: AsyncMatchRound[]): Opponent {
  return {
    id: row.id,
    displayName: row.display_name,
    rounds: rounds.map((round) => ({
      questionId: round.questionId,
      correct: round.correct,
      responseTimeMs: round.responseTimeMs,
      skillScore: round.progressAwarded / 25,
      progressAwarded: round.progressAwarded,
    })),
  };
}

export function candidateSnapshot(row: RunRow): { questions: Question[]; opponent: Opponent } | null {
  const questions = parseQuestions(row.questions_json);
  if (!questions || !row.rounds_json) return null;
  try {
    const rounds = JSON.parse(row.rounds_json) as AsyncMatchRound[];
    if (!Array.isArray(rounds)) return null;
    let progress = 0;
    for (const round of rounds) {
      if (!round || typeof round !== 'object'
        || typeof round.correct !== 'boolean'
        || !Number.isFinite(round.responseTimeMs) || round.responseTimeMs < 0
        || !Number.isFinite(round.progressAwarded)
        || round.playerProgressAfter !== Math.min(100, progress + round.progressAwarded)) return null;
      progress = round.playerProgressAfter;
    }
    const opponent = ghostOpponent(row, rounds);
    return validOpponentForQuestions(opponent, questions) ? { questions, opponent } : null;
  } catch {
    return null;
  }
}
