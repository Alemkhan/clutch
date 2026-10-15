import type { MyRunOutcome } from './index';

/**
 * «На глазок»: прикидка дня, которая разрешает ничью матча (docs/ROADMAP.md, R24).
 * Здесь только чистые правила; где именно тайбрейк включается в сравнение забегов, решается отдельно
 * и `compareSoloRuns` он не затрагивает.
 */

/** Верхняя граница прикидки: выше — заведомо не число из жизни, и отношение не уйдёт в Infinity. */
export const TIEBREAKER_MAX_GUESS = 1e30;

/** Сколько знаков после запятой хранится у множителя. */
const MULTIPLIER_DECIMALS = 4;

/** Ответ игрока годится: конечное число, 0 < x ≤ 1e30. */
export function isValidTiebreakerGuess(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= TIEBREAKER_MAX_GUESS;
}

/** Проверка ввода для API: возвращает число или бросает RangeError. */
export function parseTiebreakerGuess(value: unknown): number {
  if (!isValidTiebreakerGuess(value)) {
    throw new RangeError(`guess must be a finite number in (0, ${TIEBREAKER_MAX_GUESS}]`);
  }
  return value;
}

/**
 * Множитель промаха: max(guess/answer, answer/guess), не меньше 1, ниже — лучше. Округляется до
 * четырёх знаков: сравнение идёт по сохранённому округлённому значению, поэтому равенство
 * не ломается из-за float-шума. Невалидный ввод — RangeError.
 */
export function tiebreakerMultiplier(guess: number, answer: number): number {
  parseTiebreakerGuess(guess);
  if (!Number.isFinite(answer) || answer <= 0) {
    throw new RangeError('answer must be a finite positive number');
  }
  const ratio = Math.max(guess / answer, answer / guess);
  const scale = 10 ** MULTIPLIER_DECIMALS;
  return Math.max(1, Math.round(ratio * scale) / scale);
}

/** Прикидка одной стороны ничьей: вопрос дня и сохранённый множитель. */
export interface TiebreakAnswer {
  questionId: string;
  multiplier: number;
}

/**
 * Исход ничьей глазами `own`. Обе стороны ответили на один вопрос — меньший множитель побеждает,
 * равные — ничья. Ответила одна — побеждает она. Никто или разные вопросы (сутки сменились между
 * забегами) — ничья остаётся.
 */
export function resolveTiebreak(own: TiebreakAnswer | null, other: TiebreakAnswer | null): MyRunOutcome {
  if (own && other) {
    if (own.questionId !== other.questionId) return 'tie';
    if (own.multiplier === other.multiplier) return 'tie';
    return own.multiplier < other.multiplier ? 'player' : 'opponent';
  }
  if (own) return 'player';
  if (other) return 'opponent';
  return 'tie';
}

/** Порог, с которого показывается перцентиль: на меньшей выборке «ближе, чем N%» вводит в заблуждение. */
export const TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE = 10;

/**
 * Лог-корзины распределения по отношению guess/answer (не по множителю: так видно, в какую сторону
 * ошиблись). Корзина — полдекады по log10: границы -3, -2.5, ..., 3, всего 12 корзин; отношения за
 * пределами [10^-3, 10^3] попадают в крайние. Индекс 5 — [10^-0.5, 10^0), индекс 6 — [10^0, 10^0.5).
 */
export const TIEBREAKER_BUCKET_LOG_MIN = -3;
export const TIEBREAKER_BUCKET_LOG_MAX = 3;
export const TIEBREAKER_BUCKET_LOG_STEP = 0.5;
export const TIEBREAKER_BUCKET_COUNT = (TIEBREAKER_BUCKET_LOG_MAX - TIEBREAKER_BUCKET_LOG_MIN) / TIEBREAKER_BUCKET_LOG_STEP;

/** Индекс корзины для отношения guess/answer; не конечное или ≤ 0 — RangeError. */
export function tiebreakerBucketIndex(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('ratio must be a finite positive number');
  const raw = Math.floor((Math.log10(ratio) - TIEBREAKER_BUCKET_LOG_MIN) / TIEBREAKER_BUCKET_LOG_STEP);
  return Math.min(TIEBREAKER_BUCKET_COUNT - 1, Math.max(0, raw));
}

/** Раскладывает отношения guess/answer по корзинам: массив счётчиков длины `TIEBREAKER_BUCKET_COUNT`. */
export function tiebreakerDistribution(ratios: readonly number[]): number[] {
  const counts = new Array<number>(TIEBREAKER_BUCKET_COUNT).fill(0);
  for (const ratio of ratios) counts[tiebreakerBucketIndex(ratio)] += 1;
  return counts;
}

/**
 * «Ближе, чем N%»: доля чужих ответов с множителем строго больше своего, целым процентом (вниз).
 * `allMultipliers` — множители всех ответов дня, включая свой. Ответов меньше
 * `TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE` — null.
 */
export function tiebreakerPercentile(ownMultiplier: number, allMultipliers: readonly number[]): number | null {
  if (allMultipliers.length < TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE) return null;
  const others = allMultipliers.length - 1;
  const worse = allMultipliers.filter((multiplier) => multiplier > ownMultiplier).length;
  return Math.floor((worse / others) * 100);
}

/** Вопрос дня для клиента: без ответа, источника и чужих данных. */
export interface TiebreakerQuestionView {
  id: string;
  prompt: string;
  unit: string;
}

// ---- Разбор (R24d) ----

/** Шаг прикидки: что взяли, сколько это и откуда число. */
export interface TiebreakerExplanationStep {
  label: string;
  value: number;
  /** Единица шага; может быть пустой строкой. */
  unit: string;
  sourceUrl: string;
  sourceTitle: string;
  /** Дата среза данных шага, например «2025» или «2026-03-12»; необязательна. */
  asOf?: string;
}

/** Разбор вопроса: цепочка шагов и формула словами («≈ 1 400 полей × 2 000 деталей»). */
export interface TiebreakerExplanation {
  steps: TiebreakerExplanationStep[];
  summary: string;
}

export const TIEBREAKER_EXPLANATION_MAX_STEPS = 8;
export const TIEBREAKER_LABEL_MAX = 200;
export const TIEBREAKER_UNIT_MAX = 40;
export const TIEBREAKER_SOURCE_URL_MAX = 500;
export const TIEBREAKER_SOURCE_TITLE_MAX = 200;
export const TIEBREAKER_AS_OF_MAX = 40;
export const TIEBREAKER_SUMMARY_MAX = 400;

const STEP_KEYS = ['label', 'value', 'unit', 'sourceUrl', 'sourceTitle', 'asOf'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(text: string): boolean {
  try {
    const protocol = new URL(text).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function textField(source: Record<string, unknown>, key: string, max: number, where: string, allowEmpty = false): string {
  const value = source[key];
  if (typeof value !== 'string') throw new RangeError(`${where}.${key} must be a string`);
  if (!allowEmpty && value.trim().length === 0) throw new RangeError(`${where}.${key} must not be empty`);
  if (value.length > max) throw new RangeError(`${where}.${key} is longer than ${max}`);
  return value;
}

/**
 * Проверка разбора из базы или файла заливки: возвращает чистую копию или бросает RangeError.
 * Лишние поля — ошибка (опечатка в ключе не должна молча потерять источник). sourceUrl — только
 * http(s), value — конечное число.
 */
export function parseTiebreakerExplanation(input: unknown): TiebreakerExplanation {
  if (!isPlainObject(input)) throw new RangeError('explanation must be an object');
  const extra = Object.keys(input).filter((key) => key !== 'steps' && key !== 'summary');
  if (extra.length > 0) throw new RangeError(`explanation has unknown field: ${extra[0]}`);
  const rawSteps = input.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > TIEBREAKER_EXPLANATION_MAX_STEPS) {
    throw new RangeError(`explanation.steps must have 1..${TIEBREAKER_EXPLANATION_MAX_STEPS} items`);
  }
  const steps = rawSteps.map((raw, index): TiebreakerExplanationStep => {
    const where = `steps[${index}]`;
    if (!isPlainObject(raw)) throw new RangeError(`${where} must be an object`);
    const unknownKey = Object.keys(raw).find((key) => !STEP_KEYS.includes(key));
    if (unknownKey) throw new RangeError(`${where} has unknown field: ${unknownKey}`);
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      throw new RangeError(`${where}.value must be a finite number`);
    }
    const sourceUrl = textField(raw, 'sourceUrl', TIEBREAKER_SOURCE_URL_MAX, where);
    if (!isHttpUrl(sourceUrl)) throw new RangeError(`${where}.sourceUrl must be an http(s) URL`);
    const step: TiebreakerExplanationStep = {
      label: textField(raw, 'label', TIEBREAKER_LABEL_MAX, where),
      value: raw.value,
      unit: textField(raw, 'unit', TIEBREAKER_UNIT_MAX, where, true),
      sourceUrl,
      sourceTitle: textField(raw, 'sourceTitle', TIEBREAKER_SOURCE_TITLE_MAX, where),
    };
    if (raw.asOf !== undefined) step.asOf = textField(raw, 'asOf', TIEBREAKER_AS_OF_MAX, where);
    return step;
  });
  return { steps, summary: textField(input, 'summary', TIEBREAKER_SUMMARY_MAX, 'explanation') };
}

/** Вскрытие: отдаётся только игроку, который уже ответил на вопрос дня. */
export interface TiebreakerAnsweredView {
  guess: number;
  multiplier: number;
  answer: number;
  sourceUrl: string;
  asOfDate: string;
  /** Счётчики по `TIEBREAKER_BUCKET_COUNT` лог-корзинам guess/answer, все ответы дня. */
  distribution: number[];
  totalAnswers: number;
  /** «Ближе, чем N%»; null, пока ответов меньше `TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE`. */
  percentile: number | null;
  /** Разбор вопроса; null — в базе повреждён (маршрут не падает, UI блок прячет). */
  explanation: TiebreakerExplanation | null;
}

/** Ответ GET /api/tiebreaker/today и успешного POST /api/tiebreaker/answer. */
export interface TiebreakerTodayResponse {
  dateKey: string;
  /** null — на сегодня вопроса нет, карточку прячут. */
  question: TiebreakerQuestionView | null;
  /** null — игрок ещё не отвечал (или вопроса нет). */
  answered: TiebreakerAnsweredView | null;
}

/** Тело POST /api/tiebreaker/answer. */
export interface TiebreakerAnswerRequest {
  questionId: string;
  guess: number;
}
