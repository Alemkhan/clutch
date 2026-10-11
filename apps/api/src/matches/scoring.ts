import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  pressureStageFromResults,
  scoreHammerDistance,
  type AsyncMatchRoundInput,
  type Question,
  type SkillResult,
} from '@clutch/shared';
import { correctFor } from './validation';

/** Оценка одного присланного круга: верность, удар и награда. Прогресс считает вызывающий. */
export function scoreSubmittedRound(
  question: Question,
  submitted: AsyncMatchRoundInput,
  previousSkillResults: readonly SkillResult[],
): { correct: boolean; skillResult: SkillResult | undefined; progressAwarded: number } {
  const correct = correctFor(question, submitted.selectedAnswer);
  const scored = correct && submitted.skillDistance !== undefined
    ? scoreHammerDistance(
        submitted.skillDistance,
        pressureStageFromResults(previousSkillResults),
        CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
      )
    : undefined;
  return { correct, skillResult: scored?.result, progressAwarded: scored?.progressAwarded ?? 0 };
}
