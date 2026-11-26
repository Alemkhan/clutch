/**
 * Прогресс игрока: серия дней, опыт и уровень, достижения. Чистые функции: сервер собирает
 * статистику из своих таблиц и считает здесь, клиент только показывает готовый ответ.
 */

/** Сколько дней подряд игрок сыграл забег дня. */
export interface PlayerStreak {
  /** Текущая серия: дни подряд, заканчивающиеся сегодня или вчера (сегодня ещё можно продлить). */
  current: number;
  /** Лучшая серия за всё время. */
  best: number;
  /** Забег дня сегодня уже сыгран. */
  playedToday: boolean;
}

function previousDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Серия из игровых суток, в которые сыгран забег дня. `dayKeys` - YYYY-MM-DD, в любом порядке
 * и с повторами. Вчерашняя серия ещё жива: она сгорит, только если сегодня так и не сыграть.
 */
export function streakFromDays(dayKeys: readonly string[], todayKey: string): PlayerStreak {
  const days = new Set(dayKeys.filter((key) => key <= todayKey));
  const playedToday = days.has(todayKey);

  let current = 0;
  for (let day = playedToday ? todayKey : previousDay(todayKey); days.has(day); day = previousDay(day)) current += 1;

  let best = 0;
  for (const day of days) {
    if (days.has(previousDay(day))) continue; // не начало серии
    let length = 0;
    for (let next = day; days.has(next); next = nextDay(next)) length += 1;
    best = Math.max(best, length);
  }
  return { current, best: Math.max(best, current), playedToday };
}

function nextDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Сырые счётчики игрока: из них считаются опыт и достижения. */
export interface PlayerStats {
  completedRuns: number;
  reachedTargetRuns: number;
  /** Лучший финиш до 100% в кругах; null, пока финишей нет. */
  bestRounds: number | null;
  correctAnswers: number;
  duelWins: number;
  tiebreakerAnswers: number;
  wikiPathsCompleted: number;
  /** Вики-пути, где игрок честно сдался (а не просто закрыл приложение). */
  wikiPathsGivenUp?: number;
  /** Созданные вызовы друзьям (групповые и личные). */
  friendChallenges: number;
  bestStreak: number;
}

/** Опыт: за знания, финиши и ежедневные режимы. Формула открыта игроку в описании уровня. */
export const XP_RULES = {
  perCorrectAnswer: 10,
  perFinish: 25,
  perTiebreaker: 15,
  perWikiPath: 20,
  /** Сдаться лучше, чем бросить: попытка тоже чего-то стоит (решение владельца 2026-11-25). */
  perWikiGiveUp: 5,
} as const;

export function experienceOf(stats: PlayerStats): number {
  return stats.correctAnswers * XP_RULES.perCorrectAnswer
    + stats.reachedTargetRuns * XP_RULES.perFinish
    + stats.tiebreakerAnswers * XP_RULES.perTiebreaker
    + stats.wikiPathsCompleted * XP_RULES.perWikiPath
    + (stats.wikiPathsGivenUp ?? 0) * XP_RULES.perWikiGiveUp;
}

export interface PlayerLevel {
  level: number;
  /** Опыт внутри текущего уровня. */
  xpIntoLevel: number;
  /** Сколько опыта нужно на весь текущий уровень. */
  xpForLevel: number;
  totalXp: number;
}

/** Уровень 1 → 2 стоит 100 опыта, каждый следующий на 50 дороже: быстро в начале, дальше ровно. */
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

export function levelFromXp(totalXp: number): PlayerLevel {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level += 1;
  }
  return { level, xpIntoLevel: rest, xpForLevel: xpForLevel(level), totalXp: Math.max(0, Math.floor(totalXp)) };
}

export type AchievementId =
  | 'first_run' | 'first_finish' | 'fast_finish'
  | 'streak_3' | 'streak_7' | 'streak_30'
  | 'runs_10' | 'runs_50' | 'correct_100' | 'correct_500'
  | 'duel_wins_5' | 'tiebreaker_5' | 'wiki_path' | 'friend_challenge';

export interface AchievementDefinition {
  id: AchievementId;
  icon: string;
  title: string;
  description: string;
  /** Прогресс к цели: текущее значение и порог. */
  progress: (stats: PlayerStats) => { value: number; goal: number };
}

const fastFinishGoal = 10;

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'first_run', icon: '🎯', title: 'Первый забег', description: 'Закончи первый забег', progress: (s) => ({ value: s.completedRuns, goal: 1 }) },
  { id: 'first_finish', icon: '🏁', title: 'До 100%', description: 'Дойди до 100% в забеге', progress: (s) => ({ value: s.reachedTargetRuns, goal: 1 }) },
  {
    id: 'fast_finish', icon: '⚡', title: 'Молния', description: `Дойди до 100% за ${fastFinishGoal} кругов или быстрее`,
    progress: (s) => ({ value: s.bestRounds !== null && s.bestRounds <= fastFinishGoal ? 1 : 0, goal: 1 }),
  },
  { id: 'streak_3', icon: '🔥', title: 'Три дня подряд', description: 'Сыграй забег дня три дня подряд', progress: (s) => ({ value: s.bestStreak, goal: 3 }) },
  { id: 'streak_7', icon: '📅', title: 'Неделя', description: 'Сыграй забег дня семь дней подряд', progress: (s) => ({ value: s.bestStreak, goal: 7 }) },
  { id: 'streak_30', icon: '👑', title: 'Месяц без пропусков', description: 'Сыграй забег дня 30 дней подряд', progress: (s) => ({ value: s.bestStreak, goal: 30 }) },
  { id: 'runs_10', icon: '🎮', title: 'Завсегдатай', description: 'Закончи 10 забегов', progress: (s) => ({ value: s.completedRuns, goal: 10 }) },
  { id: 'runs_50', icon: '🏟️', title: 'Ветеран', description: 'Закончи 50 забегов', progress: (s) => ({ value: s.completedRuns, goal: 50 }) },
  { id: 'correct_100', icon: '🧠', title: 'Эрудит', description: 'Дай 100 верных ответов', progress: (s) => ({ value: s.correctAnswers, goal: 100 }) },
  { id: 'correct_500', icon: '📚', title: 'Ходячая энциклопедия', description: 'Дай 500 верных ответов', progress: (s) => ({ value: s.correctAnswers, goal: 500 }) },
  { id: 'duel_wins_5', icon: '⚔️', title: 'Дуэлянт', description: 'Выиграй 5 дуэлей', progress: (s) => ({ value: s.duelWins, goal: 5 }) },
  { id: 'tiebreaker_5', icon: '👁️', title: 'Глазомер', description: 'Ответь на «На глазок» 5 раз', progress: (s) => ({ value: s.tiebreakerAnswers, goal: 5 }) },
  { id: 'wiki_path', icon: '🔗', title: 'Путешественник', description: 'Пройди «Вики-путь» до цели', progress: (s) => ({ value: s.wikiPathsCompleted, goal: 1 }) },
  { id: 'friend_challenge', icon: '🤝', title: 'Позвал друзей', description: 'Брось вызов друзьям', progress: (s) => ({ value: s.friendChallenges, goal: 1 }) },
];

export interface PlayerAchievement {
  id: AchievementId;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  value: number;
  goal: number;
}

export function achievementsOf(stats: PlayerStats): PlayerAchievement[] {
  return ACHIEVEMENTS.map(({ id, icon, title, description, progress }) => {
    const { value, goal } = progress(stats);
    return { id, icon, title, description, unlocked: value >= goal, value: Math.min(value, goal), goal };
  });
}

/** Номер игрового дня для карточки «Clutch #N»: день 1-2026-10-19, как у «На глазок». */
export const GAME_DAY_ONE = '2026-10-19';

export function gameDayNumber(dateKey: string): number {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${GAME_DAY_ONE}T00:00:00Z`)) / 86_400_000) + 1;
}
