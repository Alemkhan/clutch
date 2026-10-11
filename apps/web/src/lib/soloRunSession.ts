import {
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  evaluateSoloRun,
  type Opponent,
  type Question,
  type SoloRunRound,
  type SoloRunState,
} from '@clutch/shared';

/**
 * Состояние соло-забега на клиенте. Правила (цель, потолок, закрытие забега) живут
 * в shared/soloRun.ts; здесь только хранение и выдача данных экрану. Без DOM и таймеров.
 */
export interface SoloRunSession {
  questions: readonly Question[];
  /** Темп соперника: данные для отрисовки. В правила забега не попадает. null — записи нет. */
  pace: Opponent | null;
  rounds: readonly SoloRunRound[];
  run: SoloRunState;
}

export interface SoloRunView {
  progress: number;
  target: number;
  /** Номер текущего круга с 1; после конца забега равен числу сыгранных. */
  round: number;
  roundsPlayed: number;
  /** Сколько кругов осталось до потолка. */
  roundsToCap: number;
  /** Вопросов в наборе осталось: набор может кончиться раньше потолка. */
  questionsLeft: number;
  completed: boolean;
  reachedTarget: boolean;
  /** Прогресс темпа после того же числа кругов; null — темпа нет. Только для полосы. */
  paceProgress: number | null;
}

export function createSoloRunSession(
  questions: readonly Question[],
  pace: Opponent | null = null,
): SoloRunSession {
  return { questions, pace, rounds: [], run: evaluate(questions, []) };
}

/** Применяет оценённый круг текущего вопроса. На завершённом забеге бросает ошибку shared. */
export function applySoloSessionRound(
  session: SoloRunSession,
  progressAwarded: number,
): SoloRunSession {
  const question = session.questions[session.run.roundsPlayed];
  if (!question) throw new Error('no question left in the solo run');
  const round: SoloRunRound = { questionId: question.id, progressAwarded };
  const rounds = [...session.rounds, round];
  return { ...session, rounds, run: evaluate(session.questions, rounds) };
}

/** Единственная точка правил: shared сам бросит на круге после конца и закроет забег по набору. */
function evaluate(questions: readonly Question[], rounds: readonly SoloRunRound[]): SoloRunState {
  return evaluateSoloRun(questions.map((question) => question.id), rounds);
}

/** Прогресс темпа считается теми же правилами, но в состояние игрока не подмешивается. */
function paceProgressAfter(session: SoloRunSession, rounds: number): number | null {
  if (!session.pace) return null;
  const ids = session.questions.map((question) => question.id);
  const prefix = session.pace.rounds.slice(0, Math.min(rounds, ids.length));
  try {
    return evaluateSoloRun(ids, prefix).progress;
  } catch {
    // Темп не совпал с набором: честнее не рисовать его, чем рисовать неверный.
    return null;
  }
}

export function soloRunView(session: SoloRunSession): SoloRunView {
  const { run } = session;
  const completed = run.status === 'completed';
  return {
    progress: run.progress,
    target: SOLO_TARGET_PROGRESS,
    round: completed ? run.roundsPlayed : run.roundsPlayed + 1,
    roundsPlayed: run.roundsPlayed,
    roundsToCap: Math.max(0, SOLO_ROUND_CAP - run.roundsPlayed),
    questionsLeft: Math.max(0, session.questions.length - run.roundsPlayed),
    completed,
    reachedTarget: run.reachedTarget,
    paceProgress: paceProgressAfter(session, run.roundsPlayed),
  };
}
