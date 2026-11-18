import type { SoloLeaderboardStanding } from '@clutch/shared';
import { messagesFor } from '../../i18n/messages';
import { m } from './messages';

export interface HomeStandingLines {
  title: string;
  /** null — игрок первый, говорить «до N-го» не о чем. */
  hint: string | null;
}

/** «Ты 3-й сегодня. / До 2-го — один круг.» Первый — «Ты первый сегодня.» */
export function homeStandingLines(standing: SoloLeaderboardStanding): HomeStandingLines {
  const t = messagesFor(m);
  if (standing.rank <= 1) return { title: t.standingFirst, hint: null };
  if (standing.roundsToNext === null) return { title: t.standingRank(standing.rank), hint: null };
  const gap = t.standingGap(standing.roundsToNext);
  // Равных с теми же кругами обходит прикидка «На глазок»: «до N-го — 1 круг» было бы неправдой.
  if (standing.outrankedByGuess) return { title: t.standingRank(standing.rank), hint: t.standingByGuess };
  return { title: t.standingRank(standing.rank), hint: t.standingToNext(standing.placeAbove ?? standing.rank - 1, gap) };
}
