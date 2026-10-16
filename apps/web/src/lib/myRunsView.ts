import type { MyRematchInvite, MyRunSummary } from '@clutch/shared';
import { SOLO_TARGET_PROGRESS } from '@clutch/shared';

/** Тексты экрана «Мои партии». Чистые функции без React: время передаётся снаружи. */

export type RunStatusKind = 'win' | 'loss' | 'tie' | 'waiting' | 'missed' | 'unknown';

export interface RunStatus {
  kind: RunStatusKind;
  text: string;
}

const CATEGORY_NAMES: Record<MyRunSummary['category'], string> = {
  general: 'Общие знания',
  geography: 'География',
  history: 'Другие флаги',
  languages: 'Языки',
};

export function categoryName(category: MyRunSummary['category']): string {
  return CATEGORY_NAMES[category] ?? 'Категория';
}

function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  return last >= 2 && last <= 4 ? few : many;
}

export function roundsText(run: Pick<MyRunSummary, 'roundsPlayed'>): string {
  return `${run.roundsPlayed} ${plural(run.roundsPlayed, 'круг', 'круга', 'кругов')}`;
}

/** «7 кругов» — тем же числительным, что и в «Моих партиях», чтобы счёт читался одинаково. */
export function soloRoundsText(count: number): string {
  return `${count} ${plural(count, 'круг', 'круга', 'кругов')}`;
}

/**
 * Чем закончилась партия. Нет соперника у дошедшего до цели забега — «ждём соперника»;
 * у не дошедшего ждать нечего: такой забег в пул не попадает, поэтому «ждём» ему не пишем.
 */
export function runStatus(run: Pick<MyRunSummary, 'reachedTarget' | 'outcome' | 'opponent' | 'friendDuel'>): RunStatus {
  if (!run.reachedTarget && run.friendDuel !== 'hosted') return { kind: 'missed', text: 'Не дошёл до цели' };
  switch (run.outcome) {
    case 'player': return { kind: 'win', text: 'Победа' };
    case 'opponent': return { kind: 'loss', text: 'Поражение' };
    case 'tie': return { kind: 'tie', text: 'Ничья' };
    default:
      return run.opponent === null
        ? { kind: 'waiting', text: 'Ждём соперника' }
        : { kind: 'unknown', text: 'Исход не определён' };
  }
}

const BADGE_TEXT: Record<RunStatusKind, string> = {
  win: 'Победа',
  loss: 'Поражение',
  tie: 'Ничья',
  waiting: 'Ждём',
  missed: 'Не дошёл',
  unknown: 'Без исхода',
};

/** Короткая плашка исхода для строки истории; kind тот же, что у runStatus. */
export function runBadge(run: Parameters<typeof runStatus>[0]): RunStatus {
  const { kind } = runStatus(run);
  return { kind, text: BADGE_TEXT[kind] };
}

/**
 * Главная строка партии: «7 кругов против 9». Круги соперника есть не всегда (бот, старые данные) —
 * тогда только свои. Чужой забег по моей записи — цифры друга, с его именем.
 */
export function runRoundsLine(run: MyRunSummary): string {
  const own = roundsText(run);
  if (run.friendDuel === 'hosted') return `${run.opponent?.displayName ?? 'Друг'}: ${own}`;
  return typeof run.opponentRoundsPlayed === 'number' ? `${own} против ${run.opponentRoundsPlayed}` : own;
}

/** Части строки вызова: выделенное «N кругов» показывается жирным. Нет кругов с обеих сторон — null. */
export function inviteRoundsParts(
  invite: Pick<MyRematchInvite, 'challengerRoundsPlayed' | 'recipientRoundsPlayed'>,
): { lead: string; strong: string; rest: string } | null {
  const { challengerRoundsPlayed: theirs, recipientRoundsPlayed: yours } = invite;
  if (typeof theirs !== 'number' || typeof yours !== 'number') return null;
  return { lead: 'Обошёл тебя: ', strong: soloRoundsText(theirs), rest: ` против твоих ${yours}` };
}

/** «из 1 дошедшего», «из 3 дошедших», «из 21 дошедшего»: родительный падеж, ед. ч. только для …1 (кроме 11). */
export function finishedText(total: number): string {
  const lastTwo = total % 100;
  return `из ${total} ${total % 10 === 1 && lastTwo !== 11 ? 'дошедшего' : 'дошедших'}`;
}

/** Короткая запись кругов в списке таблицы: «7 кр.». */
export function roundsShort(count: number): string {
  return `${count} кр.`;
}

/**
 * Инициалы для квадрата-аватара. «Игрок 5cb9» у всех начинается одинаково, поэтому для безымянных
 * берутся последние два знака кода, как в макете; иначе — первые два знака имени.
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  const anonymous = /^Игрок\s+(\S+)$/u.exec(trimmed);
  const chars = Array.from(anonymous ? anonymous[1].slice(-2) : trimmed).slice(0, 2);
  return (chars.join('') || '?').toLocaleUpperCase('ru-RU');
}

export function runSummary(run: MyRunSummary): string {
  const rounds = roundsText(run);
  // Чужой забег по моей записи: цифры друга, поэтому без «дошёл» от первого лица.
  if (run.friendDuel === 'hosted') {
    const name = run.opponent?.displayName ?? 'Друг';
    return run.reachedTarget ? `${name}: ${SOLO_TARGET_PROGRESS}% за ${rounds}` : `${name}: ${run.progress}% за ${rounds}`;
  }
  if (run.reachedTarget) return `Дошёл до ${SOLO_TARGET_PROGRESS}% за ${rounds}`;
  return `${run.progress}% за ${rounds}`;
}

/** Пометка дружеской игры в «Моих партиях»; у обычной партии пусто. */
export function friendDuelNote(run: Pick<MyRunSummary, 'friendDuel'>): string | null {
  if (run.friendDuel === 'hosted') return 'Друг сыграл вашу запись · не в зачёт';
  return run.friendDuel === 'played' ? 'Дружеская игра · не в зачёт' : null;
}

const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** «Сегодня, 14:30», «Вчера, 09:05» или «3 октября, 18:20». */
export function formatRunTime(timestamp: number, now: number = Date.now()): string {
  const time = new Date(timestamp).toLocaleTimeString('ru-RU', TIME);
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days === 0) return `Сегодня, ${time}`;
  if (days === 1) return `Вчера, ${time}`;
  const date = new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${date}, ${time}`;
}

/** Срок приглашения: «Ещё 2 дн.», «Ещё 5 ч», «Ещё 12 мин». Просроченное — null. */
export function inviteDeadline(expiresAt: number, now: number = Date.now()): string | null {
  const left = expiresAt - now;
  if (left <= 0) return null;
  const days = Math.floor(left / DAY_MS);
  if (days >= 1) return `Ещё ${days} дн.`;
  const hours = Math.floor(left / (60 * 60 * 1000));
  if (hours >= 1) return `Ещё ${hours} ч`;
  return `Ещё ${Math.max(1, Math.floor(left / (60 * 1000)))} мин`;
}
