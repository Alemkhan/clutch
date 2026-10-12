import type { CompleteSoloRunResponse, SoloRoundResponse } from '@clutch/shared';
import { SOLO_ROUND_CAP, SOLO_TARGET_PROGRESS } from '@clutch/shared';
import type { SoloRunView } from './soloRunSession';

/** Что показывает экран результата соло-забега. Чистая функция: тексты проверяются тестами. */

export type SoloSaveStatus = 'saving' | 'saved' | 'error';

export type SoloEnd = 'target' | 'cap' | 'exhausted';

export interface SoloResultInput {
  view: SoloRunView;
  save: SoloSaveStatus;
  /** Ответ сервера; есть только при save === 'saved'. */
  response: CompleteSoloRunResponse | null;
}

export interface SoloResultView {
  end: SoloEnd;
  reachedTarget: boolean;
  headline: string;
  /** Достигнутый прогресс: сервер главнее, пока ответа нет — локальный. */
  progress: number;
  roundsPlayed: number;
  summary: string;
}

export function soloEnd(view: Pick<SoloRunView, 'reachedTarget' | 'roundsPlayed' | 'questionsLeft'>): SoloEnd {
  if (view.reachedTarget) return 'target';
  return view.roundsPlayed >= SOLO_ROUND_CAP ? 'cap' : 'exhausted';
}

export function circles(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'кругов' : last === 1 ? 'круг' : last >= 2 && last <= 4 ? 'круга' : 'кругов';
  return `${count} ${word}`;
}

/**
 * Исход и эталонные числа игроку здесь не нужны: цель достигнута и сохранена — сообщаем только это,
 * а исход игрок увидит в «Моих партиях», когда с его результатом сыграют.
 */
export function buildSoloResult({ view, save, response }: SoloResultInput): SoloResultView {
  const server = save === 'saved' ? response : null;
  const progress = server ? server.progress : view.progress;
  const roundsPlayed = server ? server.roundsPlayed : view.roundsPlayed;
  const reachedTarget = server ? server.reachedTarget : view.reachedTarget;
  const end = soloEnd({ reachedTarget, roundsPlayed, questionsLeft: view.questionsLeft });

  if (reachedTarget) {
    return {
      end,
      reachedTarget,
      headline: 'Дошёл до 100%',
      progress,
      roundsPlayed,
      summary: server
        ? 'Результат зафиксирован. Мы сообщим о нём, когда с ним сыграют: исход появится и в «Моих партиях».'
        : `Ты набрал ${SOLO_TARGET_PROGRESS}% за ${circles(roundsPlayed)}.`,
    };
  }

  const why = end === 'cap'
    ? `Лимит забега — ${circles(SOLO_ROUND_CAP)}, и он закончился.`
    : 'Вопросы этого набора закончились.';
  return {
    end,
    reachedTarget,
    headline: 'До 100% не дошёл',
    progress,
    roundsPlayed,
    summary: `${why} Ты набрал ${progress}% из ${SOLO_TARGET_PROGRESS}% за ${circles(roundsPlayed)}.`,
  };
}

/** Проверка ответа сервера перед показом: чужой или битый ответ результатом не считаем. */
export function parseSoloCompletion(value: unknown, expectedRunId: string): CompleteSoloRunResponse | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Partial<CompleteSoloRunResponse>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const outcomeOk = response.outcome === null
    || response.outcome === 'player' || response.outcome === 'opponent' || response.outcome === 'tie';
  if (response.runId !== expectedRunId
    || !finite(response.progress) || response.progress < 0 || response.progress > SOLO_TARGET_PROGRESS
    || !finite(response.roundsPlayed) || response.roundsPlayed < 1
    || !finite(response.correctCount) || response.correctCount < 0
    || typeof response.reachedTarget !== 'boolean'
    || !finite(response.par) || response.par <= 0
    || !finite(response.score) || response.score < 0
    || !outcomeOk) return null;
  return response as CompleteSoloRunResponse;
}

const SKILL_RESULTS = new Set(['perfect', 'great', 'good', 'weak', 'miss']);

/** Проверка ответа сервера по кругу: чужой или битый ответ в состояние забега не попадает. */
export function parseSoloRound(value: unknown, expectedRunId: string): SoloRoundResponse | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Partial<SoloRoundResponse>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (response.runId !== expectedRunId
    || !Number.isInteger(response.roundIndex) || (response.roundIndex as number) < 0
    || typeof response.questionId !== 'string' || response.questionId.length === 0
    || typeof response.correct !== 'boolean'
    || typeof response.awaitingHammer !== 'boolean'
    || typeof response.explanation !== 'string'
    || !finite(response.progressAwarded) || response.progressAwarded < 0
    || !finite(response.progress) || response.progress < 0 || response.progress > SOLO_TARGET_PROGRESS
    || !finite(response.roundsPlayed) || response.roundsPlayed < 0
    || (response.status !== 'in_progress' && response.status !== 'completed')
    || typeof response.reachedTarget !== 'boolean'
    || (response.skillResult !== null && !SKILL_RESULTS.has(response.skillResult as string))
    || (response.awaitingHammer && !response.correct)) return null;
  if (response.result !== null && response.result !== undefined
    && !parseSoloCompletion(response.result, expectedRunId)) return null;
  return { ...(response as SoloRoundResponse), result: response.result ?? null };
}
