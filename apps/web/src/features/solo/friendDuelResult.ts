import { messagesFor } from '../../i18n/messages';
import { m } from './messages';
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

/** Подпись-чип дружеской дуэли на текущем языке. */
export function friendDuelChip(): string {
  return messagesFor(m).friendChip;
}

/** Русская подпись (для совместимости); на экране — friendDuelChip(). */
export const FRIEND_DUEL_CHIP = m.ru.friendChip;

/** Имя в заголовке: запись друга без имени называем нейтрально. */
function nameOf(pace: SoloRunSession['pace']): string {
  return pace?.displayName.trim() || messagesFor(m).friend;
}

/** Прикидка показывается только там, где виден исход: здесь, в дружеской дуэли. Числа — только те, что отдал сервер. */
export function tiebreakLine(tiebreak: CompleteSoloRunResponse['tiebreak']): string {
  if (!tiebreak) return '';
  const { ownMultiplier, opponentMultiplier } = tiebreak;
  const t = messagesFor(m);
  const head = t.tiebreakHead;
  if (ownMultiplier !== null && opponentMultiplier !== null) {
    return t.tiebreakBoth(head, formatMultiplier(ownMultiplier), formatMultiplier(opponentMultiplier));
  }
  if (ownMultiplier !== null) return t.tiebreakOwn(head);
  if (opponentMultiplier !== null) return t.tiebreakOther(head);
  return '';
}

export function buildFriendDuelSummary(
  session: SoloRunSession,
  response: Pick<CompleteSoloRunResponse, 'outcome' | 'tiebreak'> | null,
): FriendDuelSummary {
  const t = messagesFor(m);
  const name = nameOf(session.pace);
  const outcome = response?.outcome ?? null;
  const own = soloRunView(session);
  let line = '';
  if (session.pace) {
    try {
      const other = evaluateSoloRun(session.questions.map((question) => question.id), session.pace.rounds);
      line = t.duelLine(own.progress, circles(own.roundsPlayed), name, other.progress, circles(other.roundsPlayed));
    } catch {
      line = '';
    }
  }
  const headline = outcome === 'player'
    ? t.beatFriend
    : outcome === 'opponent'
      ? t.friendStronger
      : outcome === 'tie'
        ? t.tieFriend
        : t.duelPlayed;
  return { outcome, headline, line, tiebreakLine: tiebreakLine(response?.tiebreak) };
}
