import type { CompleteSoloRunResponse, MyRunOutcome } from '@clutch/shared';
import { SOLO_ROUND_CAP, SOLO_TARGET_PROGRESS } from '@clutch/shared';
import type { SoloRunView } from './soloRunSession';

/** Что показывает экран результата соло-забега. Чистая функция: тексты проверяются тестами. */

export type SoloSaveStatus = 'saving' | 'saved' | 'error';

/**
 * Исход глазами игрока. 'waiting' — соперника не было (сервер вернул outcome null):
 * забег сохранён и ждёт, пока кто-то сыграет тот же набор. Это НЕ ничья ('tie').
 */
export type SoloOutcomeKind = 'waiting' | 'win' | 'loss' | 'tie';

export type SoloEnd = 'target' | 'cap' | 'exhausted';

export interface SoloResultInput {
  view: SoloRunView;
  save: SoloSaveStatus;
  /** Ответ сервера; есть только при save === 'saved'. */
  response: CompleteSoloRunResponse | null;
  paceName: string | null;
}

export interface SoloResultView {
  end: SoloEnd;
  reachedTarget: boolean;
  headline: string;
  /** Достигнутый прогресс: сервер главнее, пока ответа нет — локальный. */
  progress: number;
  roundsPlayed: number;
  summary: string;
  /** Пояснение к score и par; null, пока сервер не посчитал или цель не достигнута. */
  scoreLine: string | null;
  score: string | null;
  par: string | null;
  outcome: { kind: SoloOutcomeKind; text: string } | null;
}

export function soloEnd(view: Pick<SoloRunView, 'reachedTarget' | 'roundsPlayed' | 'questionsLeft'>): SoloEnd {
  if (view.reachedTarget) return 'target';
  return view.roundsPlayed >= SOLO_ROUND_CAP ? 'cap' : 'exhausted';
}

function circles(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'кругов' : last === 1 ? 'круг' : last >= 2 && last <= 4 ? 'круга' : 'кругов';
  return `${count} ${word}`;
}

function number(value: number, digits = 2): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function outcomeOf(outcome: MyRunOutcome | null, paceName: string | null): SoloResultView['outcome'] {
  const name = paceName ?? 'соперник';
  switch (outcome) {
    case null:
      return {
        kind: 'waiting',
        text: 'Ждём результата соперника. Твой забег сохранён: пока по этому набору никто не играл, исход появится позже. Это не ничья.',
      };
    case 'player': return { kind: 'win', text: `Ты прошёл набор лучше, чем ${name}.` };
    case 'opponent': return { kind: 'loss', text: `${name} прошёл этот набор лучше тебя.` };
    case 'tie': return { kind: 'tie', text: `Ничья с ${name}: результаты совпали.` };
  }
}

function scoreLineOf(score: number, par: number, rounds: number): string {
  const rounded = Math.round(score * 100) / 100;
  const verdict = rounded < 1 ? 'быстрее эталонного игрока' : rounded > 1 ? 'медленнее эталонного игрока' : 'как эталонный игрок';
  const parWords = Number.isInteger(par) ? circles(par) : `${number(par, 1)} круга`;
  return `Эталон для этого набора — ${parWords}. Ты дошёл до 100% за ${circles(rounds)}: это ${verdict}. Чем меньше число, тем лучше, 1,00 — как эталонный игрок.`;
}

export function buildSoloResult({ view, save, response, paceName }: SoloResultInput): SoloResultView {
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
      summary: `Ты набрал ${SOLO_TARGET_PROGRESS}% за ${circles(roundsPlayed)}.`,
      scoreLine: server ? scoreLineOf(server.score, server.par, roundsPlayed) : null,
      score: server ? number(server.score) : null,
      par: server ? number(server.par, Number.isInteger(server.par) ? 0 : 1) : null,
      outcome: server ? outcomeOf(server.outcome, paceName) : null,
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
    scoreLine: null,
    score: null,
    par: null,
    outcome: server ? outcomeOf(server.outcome, paceName) : null,
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
