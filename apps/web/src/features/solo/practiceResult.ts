import { compareSoloRuns, evaluateSoloRun, type MyRunOutcome, type SoloRunResult } from '@clutch/shared';
import { circles } from './soloResultModel';
import { soloRunView, type SoloRunSession } from './soloRunSession';

/** Итог тренировки против бота: считается на устройстве и нигде не сохраняется как достижение. */
export interface PracticeSummary {
  outcome: MyRunOutcome;
  headline: string;
  /** Одна строка с процентами обеих сторон. */
  line: string;
}

/** Имя бота на экране: прямо сказано, что это бот, а не запись игрока. */
export function practiceBotLabel(name: string): string {
  return `Бот ${name}`;
}

const HEADLINES: Record<MyRunOutcome, string> = {
  player: 'Ты обошёл бота',
  opponent: 'Бот оказался сильнее',
  tie: 'Ничья с ботом',
};

/**
 * Сравнивает забег игрока с полным прохождением бота теми же правилами, что и обычный забег.
 * Время не сравнивается: у тренировки нет секундомера, при равных кругах — ничья.
 */
export function buildPracticeSummary(session: SoloRunSession): PracticeSummary | null {
  const { pace } = session;
  if (!pace) return null;
  const own = soloRunView(session);
  let bot;
  try {
    bot = evaluateSoloRun(session.questions.map((question) => question.id), pace.rounds);
  } catch {
    return null;
  }
  const result = (state: { reachedTarget: boolean; progress: number; roundsPlayed: number }): SoloRunResult => ({
    reachedTarget: state.reachedTarget,
    progress: state.progress,
    roundsPlayed: state.roundsPlayed,
    soloScore: state.roundsPlayed,
    // Бот не отвечает на «На глазок», тренировка вне R24.
    tiebreak: null,
  });
  const outcome = compareSoloRuns(result(own), result(bot));
  return {
    outcome,
    headline: HEADLINES[outcome],
    line: `Ты — ${own.progress}% за ${circles(own.roundsPlayed)}. ${practiceBotLabel(pace.displayName)} — ${bot.progress}% за ${circles(bot.roundsPlayed)}.`,
  };
}
