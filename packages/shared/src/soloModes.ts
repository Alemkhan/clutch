import type { Opponent } from './index';
import { SOLO_ROUND_CAP, SOLO_TARGET_PROGRESS } from './soloRun';

/**
 * Три режима соло-забега (решение владельца 2026-10-19). Победы и поражения есть только у дуэлей:
 * когда одна партия одновременно шла в таблицу и в «победу» над чужой записью, игроки не понимали,
 * что такое победа.
 *
 * - `daily` — «Забег дня»: один общий набор дня на категорию, в таблицу идёт первая попытка,
 *   на полосе только сам игрок. Сравнимо у всех, как Wordle.
 * - `free` — «Свободная игра»: свежий набор без уже виденных вопросов, вне таблицы и без соперника.
 * - `duel` — «Дуэль»: против записи другого игрока на её наборе; без записи — свежий набор, и забег
 *   сам ждёт соперника. Партия кончается, как только соперник оказался быстрее.
 *
 * Режим живёт в версии правил забега. Дуэль оставлена на прежней версии `solo-to-100-v2`: её
 * завершённые забеги и есть пул соперников, и ждущие записи не теряются.
 */
export const DAILY_RULES_VERSION = 'solo-daily-v1';
export const FREE_RULES_VERSION = 'solo-free-v1';
export const DUEL_RULES_VERSION = 'solo-to-100-v2';

export const SOLO_MODES = ['daily', 'free', 'duel'] as const;
export type SoloMode = (typeof SOLO_MODES)[number];

export function isSoloMode(value: unknown): value is SoloMode {
  return SOLO_MODES.some((mode) => mode === value);
}

export const SOLO_MODE_RULES: Readonly<Record<SoloMode, string>> = {
  daily: DAILY_RULES_VERSION,
  free: FREE_RULES_VERSION,
  duel: DUEL_RULES_VERSION,
};

/** Режим по версии правил; null — не один из трёх (тренировка, дружеская дуэль, старые версии). */
export function soloModeOf(rulesVersion: string | null | undefined): SoloMode | null {
  return SOLO_MODES.find((mode) => SOLO_MODE_RULES[mode] === rulesVersion) ?? null;
}

/** Круг, на котором запись соперника дошла до цели; null — не дошла (или записи нет). */
export function opponentFinishRound(pace: Pick<Opponent, 'rounds'> | null): number | null {
  if (!pace) return null;
  let progress = 0;
  for (let index = 0; index < pace.rounds.length; index++) {
    progress += pace.rounds[index].progressAwarded;
    if (progress >= SOLO_TARGET_PROGRESS) return index + 1;
  }
  return null;
}

/**
 * Потолок кругов забега против записи. Запись дошла до 100% за N кругов: если игрок не дошёл за те же
 * N, он уже проиграл (лучше счёт только у меньшего числа кругов на том же наборе), и партия кончается
 * сразу, а не тянется до конца набора. Ровно за N — ничья по кругам, её решает «На глазок».
 */
export function duelRoundCap(pace: Pick<Opponent, 'rounds'> | null): number {
  const finish = opponentFinishRound(pace);
  return finish === null ? SOLO_ROUND_CAP : Math.min(SOLO_ROUND_CAP, finish);
}
