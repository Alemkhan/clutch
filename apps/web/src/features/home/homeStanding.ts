import type { SoloLeaderboardStanding } from '@clutch/shared';
import { soloRoundsText } from '../myRuns/myRunsView';

export interface HomeStandingLines {
  title: string;
  /** null — игрок первый, говорить «до N-го» не о чем. */
  hint: string | null;
}

/** «Ты 3-й сегодня. / До 2-го — один круг.» Первый — «Ты первый сегодня.» */
export function homeStandingLines(standing: SoloLeaderboardStanding): HomeStandingLines {
  if (standing.rank <= 1) return { title: 'Ты первый сегодня.', hint: null };
  if (standing.roundsToNext === null) return { title: `Ты ${standing.rank}-й сегодня.`, hint: null };
  const gap = standing.roundsToNext === 1 ? 'один круг' : soloRoundsText(standing.roundsToNext);
  // Равных с теми же кругами обходит прикидка «На глазок»: «до N-го — 1 круг» было бы неправдой.
  if (standing.outrankedByGuess) return { title: `Ты ${standing.rank}-й сегодня.`, hint: 'Выше — по «На глазок».' };
  return { title: `Ты ${standing.rank}-й сегодня.`, hint: `До ${standing.placeAbove ?? standing.rank - 1}-го — ${gap}.` };
}
