import type { MyRunSummary } from '@clutch/shared';
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

export function roundsText(run: Pick<MyRunSummary, 'mode' | 'roundsPlayed'>): string {
  const [one, few, many] = run.mode === 'solo' ? ['круг', 'круга', 'кругов'] : ['раунд', 'раунда', 'раундов'];
  return `${run.roundsPlayed} ${plural(run.roundsPlayed, one, few, many)}`;
}

/** «7 кругов» — тем же числительным, что и в «Моих партиях», чтобы счёт читался одинаково. */
export function soloRoundsText(count: number): string {
  return `${count} ${plural(count, 'круг', 'круга', 'кругов')}`;
}

/**
 * Чем закончилась партия. Нет соперника у дошедшего до цели забега — «ждём соперника»;
 * у не дошедшего ждать нечего: такой забег в пул не попадает, поэтому «ждём» ему не пишем.
 */
export function runStatus(run: Pick<MyRunSummary, 'mode' | 'reachedTarget' | 'outcome' | 'opponent' | 'friendDuel'>): RunStatus {
  if (run.mode === 'solo' && run.reachedTarget === false && run.friendDuel !== 'hosted') return { kind: 'missed', text: 'Не дошёл до цели' };
  switch (run.outcome) {
    case 'player': return { kind: 'win', text: 'Победа' };
    case 'opponent': return { kind: 'loss', text: 'Поражение' };
    case 'tie': return { kind: 'tie', text: 'Ничья' };
    default:
      return run.mode === 'solo' && run.opponent === null
        ? { kind: 'waiting', text: 'Ждём соперника' }
        : { kind: 'unknown', text: 'Исход не определён' };
  }
}

export function runSummary(run: MyRunSummary): string {
  const rounds = roundsText(run);
  // Чужой забег по моей записи: цифры друга, поэтому без «дошёл» от первого лица.
  if (run.friendDuel === 'hosted') {
    const name = run.opponent?.displayName ?? 'Друг';
    return run.reachedTarget ? `${name}: ${SOLO_TARGET_PROGRESS}% за ${rounds}` : `${name}: ${run.progress}% за ${rounds}`;
  }
  if (run.mode === 'solo' && run.reachedTarget) return `Дошёл до ${SOLO_TARGET_PROGRESS}% за ${rounds}`;
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
