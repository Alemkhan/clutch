/**
 * Тренировка против бота: те же правила забега, но результат не идёт в соревнование.
 * Отдельная версия правил отделяет такие забеги от соло-пула, таблицы, приглашений и истории.
 */
export const PRACTICE_RULES_VERSION = 'solo-practice-v1';

export type PracticeLevelId = 'novice' | 'amateur' | 'skilled' | 'master';

export interface PracticeLevel {
  id: PracticeLevelId;
  /** Название уровня для игрока. */
  name: string;
  /** Одна строка о силе бота: проверяется тестом по реальным профилям. */
  caption: string;
}

/** От слабого к сильному. Профили ботов с наградами по кругам живут в api/matches/bots.ts. */
export const PRACTICE_LEVELS: readonly PracticeLevel[] = [
  { id: 'novice', name: 'Новичок', caption: '100% за 17 кругов' },
  { id: 'amateur', name: 'Любитель', caption: '100% за 13 кругов' },
  { id: 'skilled', name: 'Опытный', caption: '100% за 9 кругов' },
  { id: 'master', name: 'Мастер', caption: '100% за 6 кругов' },
];

export function isPracticeLevelId(value: unknown): value is PracticeLevelId {
  return PRACTICE_LEVELS.some((level) => level.id === value);
}
