import { evaluateSoloRun, type CompleteSoloRunResponse, type MyRunOutcome } from '@clutch/shared';
import { circles } from './soloResultModel';
import { formatMultiplier } from '../tiebreaker/tiebreakerView';
import { soloRunView, type SoloRunSession } from './soloRunSession';

/** Итог дружеской дуэли: исход считает сервер (тем же compareSoloRuns), клиент только подписывает. */
export interface FriendDuelSummary {
  /** null — ответа сервера ещё нет, исход не объявляем. */
  outcome: MyRunOutcome | null;
  headline: string;
  /** Одна строка с процентами обеих сторон; пусто, если запись друга не отрисована. */
  line: string;
  /** Строка про «На глазок», если ничью по забегу решила прикидка; иначе пусто. */
  tiebreakLine: string;
}

export const FRIEND_DUEL_CHIP = 'Дружеская игра · не в зачёт';

/** Имя в заголовке: запись друга без имени называем нейтрально. */
function nameOf(pace: SoloRunSession['pace']): string {
  return pace?.displayName.trim() || 'Друг';
}

/** Прикидка показывается только там, где виден исход: здесь, в дружеской дуэли. Числа — только те, что отдал сервер. */
export function tiebreakLine(tiebreak: CompleteSoloRunResponse['tiebreak']): string {
  if (!tiebreak) return '';
  const { ownMultiplier, opponentMultiplier } = tiebreak;
  const head = 'Ничья по забегу — решила «На глазок»';
  if (ownMultiplier !== null && opponentMultiplier !== null) {
    return `${head}: ${formatMultiplier(ownMultiplier)} против ${formatMultiplier(opponentMultiplier)}.`;
  }
  if (ownMultiplier !== null) return `${head}: ты ответил, а друг нет.`;
  if (opponentMultiplier !== null) return `${head}: друг ответил, а ты нет.`;
  return '';
}

export function buildFriendDuelSummary(
  session: SoloRunSession,
  response: Pick<CompleteSoloRunResponse, 'outcome' | 'tiebreak'> | null,
): FriendDuelSummary {
  const name = nameOf(session.pace);
  const outcome = response?.outcome ?? null;
  const own = soloRunView(session);
  let line = '';
  if (session.pace) {
    try {
      const other = evaluateSoloRun(session.questions.map((question) => question.id), session.pace.rounds);
      line = `Ты — ${own.progress}% за ${circles(own.roundsPlayed)}. ${name} — ${other.progress}% за ${circles(other.roundsPlayed)}.`;
    } catch {
      line = '';
    }
  }
  const headline = outcome === 'player'
    ? 'Ты обошёл друга'
    : outcome === 'opponent'
      ? 'Друг оказался сильнее'
      : outcome === 'tie'
        ? 'Ничья с другом'
        : 'Дуэль сыграна';
  return { outcome, headline, line, tiebreakLine: tiebreakLine(response?.tiebreak) };
}
