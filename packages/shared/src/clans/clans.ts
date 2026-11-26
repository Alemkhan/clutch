/**
 * Кланы-эмодзи. Каждое эмодзи существует один раз: кто первым его занял - основатель, остальные
 * вступают по ссылке-приглашению («заражение»). Клан выбирается навсегда.
 *
 * Война кланов - недельная: у каждого участника очки за забеги дня этой недели (за сутки - один
 * лучший забег, какой бы категории он ни был), у клана - сумма
 * десяти лучших участников, делённая на десять. Маленький активный клан может обойти большой,
 * но звать людей всё равно выгодно: пустые места в десятке считаются нулём.
 */

import { dailyKey, dayStartMs } from '../solo/dailyQuestionSet';

/**
 * Первый день кланов (игровые сутки по Алматы, понедельник): код выходит раньше, а кланы
 * включаются сами в начале этой недели - она же первая неделя войны.
 */
export const CLANS_FROM = '2026-11-23';

/** Кланы уже открыты в этот момент. */
export function clansActive(now: number): boolean {
  return dailyKey(now) >= CLANS_FROM;
}

/** Сколько лучших участников клана идёт в зачёт недели. */
export const CLAN_TOP_MEMBERS = 10;
/** Основатель, не игравший забег дня столько дней, уступает клан самому активному участнику. */
export const CLAN_FOUNDER_INACTIVE_DAYS = 30;
/** Код приглашения: в startapp-параметр Telegram эмодзи не помещается, поэтому ссылка несёт код. */
export const CLAN_INVITE_PREFIX = 'cl_';
export const CLAN_INVITE_CODE = /^[A-Za-z0-9]{10}$/;

const SKIN_TONES = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VARIATION_SELECTOR = /️/gu;

let rgiEmoji: RegExp | null | undefined;
/** «Ровно одно эмодзи» по Unicode (RGI). Флаг `v` есть не во всех webview - тогда грубая проверка. */
function isSingleEmoji(value: string): boolean {
  if (rgiEmoji === undefined) {
    try {
      rgiEmoji = new RegExp('^\\p{RGI_Emoji}$', 'v');
    } catch {
      rgiEmoji = null;
    }
  }
  if (rgiEmoji) return rgiEmoji.test(value);
  return /^\p{Extended_Pictographic}/u.test(value) && [...value].length <= 12;
}

export interface ClanEmoji {
  /** Как показывать: эмодзи без оттенка кожи. */
  emoji: string;
  /** Ключ клана: без оттенка кожи и без селектора варианта, чтобы «❤» и «❤️» были одним кланом. */
  key: string;
}

/**
 * Эмодзи клана из ввода игрока или null, если это не одно эмодзи. Оттенки кожи снимаются
 * (👍🏻 и 👍🏿 - один клан 👍); эмодзи, у которого без оттенка нет формы, остаётся как есть.
 */
export function normalizeClanEmoji(input: string): ClanEmoji | null {
  const raw = input.trim();
  if (!raw || raw.length > 40) return null;
  const candidates = [raw.replace(SKIN_TONES, ''), raw];
  for (const candidate of candidates) {
    const forms = [candidate];
    // Символ без селектора (❤, ☺) - эмодзи-форма с FE0F.
    if ([...candidate].length === 1) forms.push(`${candidate}️`);
    for (const form of forms) {
      if (isSingleEmoji(form)) return { emoji: form, key: form.replace(VARIATION_SELECTOR, '') };
    }
  }
  return null;
}

/** Ключ клана для адреса страницы клана: коды символов, `1f986` или `1f9d1-200d-1f680`. */
export function clanKeyToSlug(key: string): string {
  return [...key].map((char) => char.codePointAt(0)!.toString(16)).join('-');
}

export function clanSlugToKey(slug: string): string | null {
  if (!/^[0-9a-f]{1,6}(-[0-9a-f]{1,6}){0,15}$/.test(slug)) return null;
  try {
    return String.fromCodePoint(...slug.split('-').map((part) => Number.parseInt(part, 16)));
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface ClanWeek {
  /** Понедельник недели (игровые сутки по Алматы), он же ключ недели. */
  weekKey: string;
  /** Воскресенье - последний день в зачёте. */
  lastDayKey: string;
  startMs: number;
  endMs: number;
}

/** Неделя войны кланов, в которую попадает момент: с понедельника по воскресенье по Алматы. */
export function clanWeek(now: number): ClanWeek {
  const today = dailyKey(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekKey = shiftKey(today, -((weekday + 6) % 7));
  const lastDayKey = shiftKey(weekKey, 6);
  return { weekKey, lastDayKey, startMs: dayStartMs(weekKey), endMs: dayStartMs(weekKey) + 7 * DAY_MS };
}

export interface ClanRunResult {
  progress: number;
  reachedTarget: boolean;
  /** Круги относительно пара (меньше - лучше); есть только у дошедших до 100%. */
  soloScore: number | null;
}

/**
 * Очки за забег дня: прогресс (до 99), а дошедший до 100% получает 100 и бонус за скорость
 * до +100 - в пар это +50, вдвое быстрее пара - +100, в полтора пара и медленнее - 0.
 */
export function clanRunPoints(run: ClanRunResult): number {
  if (!run.reachedTarget) return Math.max(0, Math.min(99, Math.round(run.progress)));
  const score = run.soloScore ?? 1.5;
  return 100 + Math.max(0, Math.min(100, Math.round(100 * (1.5 - score))));
}

/**
 * Очки игрока за период: по одному лучшему забегу дня за сутки. Забеги дня есть в каждой
 * категории, и без этого неделю выигрывал бы тот, кто прогнал их все, а не кто точнее играет.
 */
export function clanPlayerPoints(runs: readonly (ClanRunResult & { dayKey: string })[]): number {
  const bestByDay = new Map<string, number>();
  for (const run of runs) bestByDay.set(run.dayKey, Math.max(bestByDay.get(run.dayKey) ?? 0, clanRunPoints(run)));
  return [...bestByDay.values()].reduce((sum, value) => sum + value, 0);
}

/** Очки клана за неделю: сумма десяти лучших участников / 10, недостающие места - ноль. */
export function clanWarScore(memberPoints: readonly number[]): number {
  const top = [...memberPoints].sort((a, b) => b - a).slice(0, CLAN_TOP_MEMBERS);
  return Math.round(top.reduce((sum, value) => sum + value, 0) / CLAN_TOP_MEMBERS);
}

// ---- Ответы API ----

export interface ClanMemberView {
  /** Номер участника внутри ответа: для дерева заражений (id игроков наружу не отдаются). */
  id: number;
  displayName: string;
  /** Кто заразил: id другого участника; null - основатель или пригласивший ушёл из игры. */
  parentId: number | null;
  weekPoints: number;
  infected: number;
  isFounder: boolean;
  isOriginalFounder: boolean;
  isYou: boolean;
}

export interface ClanView {
  emoji: string;
  slug: string;
  members: number;
  founderName: string;
  createdAt: number;
  week: { weekKey: string; score: number; rank: number | null };
}

export interface ClanMeResponse {
  clan: (ClanView & {
    isFounder: boolean;
    youWeekPoints: number;
    infectedByYou: number;
    invitedByName: string | null;
    /** Ссылка «заразить друга»; null - ссылка на Mini App не настроена. */
    inviteLink: string | null;
    /** Личный код приглашения: из него строится карточка-превью «заражения». */
    inviteCode: string;
  }) | null;
  /** Без клана: можно ли уже занять эмодзи (нужен хотя бы один законченный забег). */
  canFound: boolean;
}

export interface ClanDetailResponse extends ClanView {
  memberList: ClanMemberView[];
  isYours: boolean;
}

export interface ClanCheckResponse {
  emoji: string;
  slug: string;
  available: boolean;
  members: number;
}

export interface ClanInvitePreview {
  emoji: string;
  slug: string;
  members: number;
  inviterName: string;
}

export type ClanJoinResponse =
  | { status: 'joined'; me: ClanMeResponse }
  | { status: 'already'; me: ClanMeResponse };

export interface ClanBoardEntry {
  rank: number;
  emoji: string;
  slug: string;
  members: number;
  score: number;
}

export interface ClanBoardResponse {
  weekKey: string;
  lastDayKey: string;
  entries: ClanBoardEntry[];
  you: ClanBoardEntry | null;
}
