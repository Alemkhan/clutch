/// <reference types="node" />
import {
  CURRENT_HAMMER_MINI_GAME,
  hammerAttemptRules,
  type AsyncMatchRoundInput,
  type Question,
  type SkillResult,
  type SoloRoundResponse,
} from '@clutch/shared';
import type { TestD1 } from './testD1';

const hammerConfig = CURRENT_HAMMER_MINI_GAME.config;

/**
 * Момент удара, который приводит маркер ровно в центр цели. Нужен потому, что оценку удара
 * больше нельзя прислать числом: сервер выводит её из времени, так что тесту приходится
 * попадать по-настоящему. Маркер идёт от 0 вверх, поэтому первое попадание в центр — на
 * `центр / скорость` секунде. Цель и скорость зависят от стадии давления, то есть от уже
 * сыгранных кругов: их и передаёт `previousResults`.
 */
export function perfectTapElapsedMs(questionId: string, previousResults: readonly SkillResult[] = []): number {
  const attempt = hammerAttemptRules(questionId, previousResults, hammerConfig);
  return (attempt.targetCenter / attempt.markerSpeed) * 1000;
}

/** Момент удара в половине дорожки от цели: гарантированный промах, награда 0. */
export function missTapElapsedMs(questionId: string, previousResults: readonly SkillResult[] = []): number {
  const attempt = hammerAttemptRules(questionId, previousResults, hammerConfig);
  const position = attempt.targetCenter > 0.5 ? attempt.targetCenter - 0.5 : attempt.targetCenter + 0.5;
  return (position / attempt.markerSpeed) * 1000;
}

/** Полные вопросы забега (с ответами) из базы: клиентам ответы не отдаются, а тестам они нужны. */
export function fullQuestions(db: TestD1, runId: string): Question[] {
  const row = db.sqlite.prepare('SELECT questions_json FROM match_runs WHERE id = ?').get(runId) as
    | { questions_json: string } | undefined;
  if (!row) throw new Error(`no run ${runId}`);
  return JSON.parse(row.questions_json) as Question[];
}

/**
 * Круги с верными (correct) или заведомо неверными ответами. Момент удара не задаётся: его
 * считает `playRounds` по ходу игры, потому что цель зависит от стадии давления, а значит —
 * от результатов предыдущих кругов, которых здесь ещё нет.
 */
export function roundInputs(questions: Question[], count: number, correct: boolean): AsyncMatchRoundInput[] {
  return questions.slice(0, count).map((question) => ({
    questionId: question.id,
    selectedAnswer: question.answerType === 'open_answer'
      ? (correct ? question.correctAnswers![0] : '__wrong__')
      : (correct
        ? question.correctOptionId
        : question.options.find((option) => option.id !== question.correctOptionId)!.id),
    responseTimeMs: 1000,
  }));
}

export type PostFn = (path: string, body: unknown) => Promise<Response>;

/**
 * Проигрывает круги через покруговые маршруты, как клиент. Возвращает ответ с итогом забега (200),
 * ошибку первого неудачного запроса либо 400, если круги забег не закрыли.
 */
export async function playRounds(post: PostFn, runId: string, rounds: readonly AsyncMatchRoundInput[]): Promise<Response> {
  const played: SkillResult[] = [];
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex];
    const answered = await post(`/api/solo-runs/${runId}/answer`, {
      roundIndex,
      questionId: round.questionId,
      selectedAnswer: round.selectedAnswer,
      responseTimeMs: round.responseTimeMs,
    });
    if (answered.status !== 200) return answered;
    let verdict = await answered.json() as SoloRoundResponse;
    if (verdict.awaitingHammer) {
      const hammered = await post(`/api/solo-runs/${runId}/hammer`, {
        roundIndex,
        questionId: round.questionId,
        activeElapsedMs: round.activeElapsedMs ?? perfectTapElapsedMs(round.questionId, played),
      });
      if (hammered.status !== 200) return hammered;
      verdict = await hammered.json() as SoloRoundResponse;
    }
    if (verdict.skillResult) played.push(verdict.skillResult);
    if (verdict.result) return Response.json(verdict.result);
  }
  return Response.json({ error: 'The submitted rounds do not finish the run.' }, { status: 400 });
}
