import { CURRENT_ASYNC_MATCH_CONDITIONS, generateMatch } from '@clutch/shared';
import type { CategoryId, Opponent, Question } from '@clutch/shared';
import { normalizeScriptedOpponent } from './clientMatchRules';

export function createQuestions(category: CategoryId = 'geography') {
  return generateMatch(10, 0.3, category);
}

const sampleOpponentScript: Opponent = {
  id: 'contestant_001',
  displayName: 'Alex',
  rounds: [
    { questionId: 'q1', correct: true, responseTimeMs: 2800, skillScore: 0.82, progressAwarded: 18 },
    { questionId: 'q2', correct: true, responseTimeMs: 3200, skillScore: 0.65, progressAwarded: 12 },
    { questionId: 'q3', correct: false, responseTimeMs: 4500, skillScore: 0, progressAwarded: 0 },
    { questionId: 'q4', correct: true, responseTimeMs: 2600, skillScore: 0.90, progressAwarded: 25 },
    { questionId: 'q5', correct: true, responseTimeMs: 3100, skillScore: 0.70, progressAwarded: 18 },
    { questionId: 'q6', correct: false, responseTimeMs: 5100, skillScore: 0, progressAwarded: 0 },
    { questionId: 'q7', correct: true, responseTimeMs: 2900, skillScore: 0.75, progressAwarded: 18 },
    { questionId: 'q8', correct: true, responseTimeMs: 3400, skillScore: 0.60, progressAwarded: 12 },
    { questionId: 'q9', correct: true, responseTimeMs: 2700, skillScore: 0.85, progressAwarded: 25 },
    { questionId: 'q10', correct: true, responseTimeMs: 3000, skillScore: 0.70, progressAwarded: 18 },
  ],
};

export function createSampleOpponent(questions: readonly Question[]): Opponent {
  return normalizeScriptedOpponent(sampleOpponentScript, questions);
}

export const miniGameConfig = CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config;
