/**
 * Дружеская дуэль: забег, начатый по ссылке «Позвать друга». Друг играет тот же набор, что уже прошёл
 * пригласивший, поэтому такой забег вне соревнования: не в пул соперников, не в таблицу, не даёт
 * приглашений и рейтинга. В отличие от тренировки исход против записи пригласившего считается
 * (тем же compareSoloRuns) и виден обоим. Версия отделяет такие забеги так же, как PRACTICE_RULES_VERSION.
 * Префикс `solo-` оставляет их соло-забегами для истории и ответа сервера.
 */
export const FRIEND_RULES_VERSION = 'solo-friend-v1';

export function isFriendRulesVersion(value: unknown): value is typeof FRIEND_RULES_VERSION {
  return value === FRIEND_RULES_VERSION;
}
