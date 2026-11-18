import type { MyRematchInvite, MyRunSummary } from '@clutch/shared';
import { SOLO_TARGET_PROGRESS, type Locale } from '@clutch/shared';
import { messagesFor } from '../../i18n/messages';
import { currentLocale } from '../../i18n/locale';
import { m } from './messages';

/** Тексты экрана «Мои партии». Чистые функции без React: время передаётся снаружи. */

export type RunStatusKind = 'win' | 'loss' | 'tie' | 'waiting' | 'missed' | 'unknown';

export interface RunStatus {
  kind: RunStatusKind;
  text: string;
}

const CATEGORY_KEYS = {
  general: 'catGeneral',
  geography: 'catGeography',
  history: 'catHistory',
  languages: 'catLanguages',
  kz_history: 'catKzHistory',
} as const satisfies Record<MyRunSummary['category'], keyof typeof m.ru>;

export function categoryName(category: MyRunSummary['category']): string {
  const t = messagesFor(m);
  const key = CATEGORY_KEYS[category];
  return key ? t[key] : t.catFallback;
}

export function roundsText(run: Pick<MyRunSummary, 'roundsPlayed'>): string {
  return messagesFor(m).rounds(run.roundsPlayed);
}

/** «7 кругов» — тем же числительным, что и в «Моих партиях», чтобы счёт читался одинаково. */
export function soloRoundsText(count: number): string {
  return messagesFor(m).rounds(count);
}

/**
 * Чем закончилась партия. Исход дуэли главнее всего: партия обрывается на финише соперника, и
 * не дошедший до 100% против записи — это поражение, а не «не дошёл». «Не дошёл» — только без
 * соперника. Нет соперника у дошедшего до цели забега — «ждём соперника»; у не дошедшего ждать
 * нечего: такой забег в пул не попадает, поэтому «ждём» ему не пишем.
 */
export function runStatus(run: Pick<MyRunSummary, 'reachedTarget' | 'outcome' | 'opponent' | 'friendDuel'>): RunStatus {
  const t = messagesFor(m);
  if (!run.outcome && !run.reachedTarget && run.friendDuel !== 'hosted') return { kind: 'missed', text: t.statusMissed };
  switch (run.outcome) {
    case 'player': return { kind: 'win', text: t.statusWin };
    case 'opponent': return { kind: 'loss', text: t.statusLoss };
    case 'tie': return { kind: 'tie', text: t.statusTie };
    default:
      return run.opponent === null
        ? { kind: 'waiting', text: t.statusWaiting }
        : { kind: 'unknown', text: t.statusUnknown };
  }
}

const BADGE_KEYS = {
  win: 'statusWin',
  loss: 'statusLoss',
  tie: 'statusTie',
  waiting: 'badgeWaiting',
  missed: 'badgeMissed',
  unknown: 'badgeUnknown',
} as const satisfies Record<RunStatusKind, keyof typeof m.ru>;

/** Короткая плашка исхода для строки истории; kind тот же, что у runStatus. */
export function runBadge(run: Parameters<typeof runStatus>[0]): RunStatus {
  const { kind } = runStatus(run);
  return { kind, text: messagesFor(m)[BADGE_KEYS[kind]] };
}

/**
 * Главная строка партии: «7 кругов против 9». Круги соперника есть не всегда (бот, старые данные) —
 * тогда только свои. Чужой забег по моей записи — цифры друга, с его именем.
 */
export function runRoundsLine(run: MyRunSummary): string {
  const t = messagesFor(m);
  const own = roundsText(run);
  if (run.friendDuel === 'hosted') return `${run.opponent?.displayName ?? t.friend}: ${own}`;
  return typeof run.opponentRoundsPlayed === 'number' ? t.versus(own, run.opponentRoundsPlayed) : own;
}

/** Части строки вызова: выделенное «N кругов» показывается жирным. Нет кругов с обеих сторон — null. */
export function inviteRoundsParts(
  invite: Pick<MyRematchInvite, 'challengerRoundsPlayed' | 'recipientRoundsPlayed'>,
): { lead: string; strong: string; rest: string } | null {
  const { challengerRoundsPlayed: theirs, recipientRoundsPlayed: yours } = invite;
  if (typeof theirs !== 'number' || typeof yours !== 'number') return null;
  const t = messagesFor(m);
  return { lead: t.inviteLead, strong: soloRoundsText(theirs), rest: t.inviteRest(yours) };
}

/** «из 1 дошедшего», «из 3 дошедших», «из 21 дошедшего»: родительный падеж, ед. ч. только для …1 (кроме 11). */
export function finishedText(total: number): string {
  return messagesFor(m).finished(total);
}

/** Короткая запись кругов в списке таблицы: «7 кр.». */
export function roundsShort(count: number): string {
  return messagesFor(m).roundsShort(count);
}

/**
 * Инициалы для квадрата-аватара. «Игрок 5cb9» у всех начинается одинаково, поэтому для безымянных
 * берутся последние два знака кода, как в макете; иначе — первые два знака имени.
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  const anonymous = /^(?:Игрок|Player|Ойыншы)\s+(\S+)$/u.exec(trimmed);
  const chars = Array.from(anonymous ? anonymous[1].slice(-2) : trimmed).slice(0, 2);
  return (chars.join('') || '?').toLocaleUpperCase('ru-RU');
}

export function runSummary(run: MyRunSummary): string {
  const t = messagesFor(m);
  const rounds = roundsText(run);
  // Чужой забег по моей записи: цифры друга, поэтому без «дошёл» от первого лица.
  if (run.friendDuel === 'hosted') {
    const name = run.opponent?.displayName ?? t.friend;
    return `${name}: ${t.summaryProgress(run.reachedTarget ? SOLO_TARGET_PROGRESS : run.progress, rounds)}`;
  }
  if (run.reachedTarget) return t.summaryReached(SOLO_TARGET_PROGRESS, rounds);
  return t.summaryProgress(run.progress, rounds);
}

/** Пометка дружеской игры в «Моих партиях»; у обычной партии пусто. */
export function friendDuelNote(run: Pick<MyRunSummary, 'friendDuel'>): string | null {
  const t = messagesFor(m);
  if (run.friendDuel === 'hosted') return t.friendHosted;
  return run.friendDuel === 'played' ? t.friendPlayed : null;
}

const DATE_LOCALE: Record<Locale, string> = { ru: 'ru-RU', en: 'en-GB', kk: 'kk-KZ' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** «Сегодня, 14:30», «Вчера, 09:05» или «3 октября, 18:20». */
export function formatRunTime(timestamp: number, now: number = Date.now()): string {
  const t = messagesFor(m);
  const tag = DATE_LOCALE[currentLocale()];
  const time = new Date(timestamp).toLocaleTimeString(tag, TIME);
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days === 0) return t.today(time);
  if (days === 1) return t.yesterday(time);
  const date = new Date(timestamp).toLocaleDateString(tag, { day: 'numeric', month: 'long' });
  return `${date}, ${time}`;
}

/** Срок приглашения: «Ещё 2 дн.», «Ещё 5 ч», «Ещё 12 мин». Просроченное — null. */
export function inviteDeadline(expiresAt: number, now: number = Date.now()): string | null {
  const left = expiresAt - now;
  if (left <= 0) return null;
  const t = messagesFor(m);
  const days = Math.floor(left / DAY_MS);
  if (days >= 1) return t.leftDays(days);
  const hours = Math.floor(left / (60 * 60 * 1000));
  if (hours >= 1) return t.leftHours(hours);
  return t.leftMinutes(Math.max(1, Math.floor(left / (60 * 1000))));
}
