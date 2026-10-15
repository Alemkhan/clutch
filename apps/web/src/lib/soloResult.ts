import type { CompleteSoloRunResponse, SkillResult, SoloLeaderboardStanding, SoloRoundResponse } from '@clutch/shared';
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
      // Заголовок и мета уже говорят «100% за N кругов», а про запись рассказывает её карточка.
      summary: '',
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
    summary: `${why} Ты набрал ${progress}% из ${SOLO_TARGET_PROGRESS}%.`,
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

/** Тир «идеально» берём из shared-типа, а не строкой в разметке. */
const PERFECT_TIER: SkillResult = 'perfect';

export interface RunReceiptStat {
  key: 'correct' | 'perfect' | 'place';
  value: string;
  label: string;
}

/** Место в таблице дня: загрузка и ошибка не ломают экран, число просто остаётся «—». */
export type RunStandingState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; standing: SoloLeaderboardStanding | null };

export function countPerfectStrikes(skillResults: readonly SkillResult[]): number {
  return skillResults.filter((result) => result === PERFECT_TIER).length;
}

/**
 * Три числа квитанции. Место показываем только тому, кто дошёл до 100%: у остальных его нет,
 * а тренировка и дружеская дуэль в таблицу дня не попадают, поэтому третьего числа нет вовсе.
 */
export function buildReceiptStats(input: {
  correctCount: number;
  /** Сыграно кругов (один круг — один вопрос): с ним «верных» читается как «7/8». */
  roundsPlayed?: number;
  skillResults: readonly SkillResult[];
  /** null — места у забега нет и блок не показывается. */
  standing: RunStandingState | null;
}): RunReceiptStat[] {
  const stats: RunReceiptStat[] = [
    { key: 'correct', value: input.roundsPlayed ? `${input.correctCount}/${input.roundsPlayed}` : String(input.correctCount), label: 'верных' },
    { key: 'perfect', value: String(countPerfectStrikes(input.skillResults)), label: 'идеально' },
  ];
  if (input.standing) {
    const you = input.standing.status === 'ready' ? input.standing.standing : null;
    stats.push({ key: 'place', value: you ? `${you.rank}-й` : '—', label: 'в таблице' });
  }
  return stats;
}
