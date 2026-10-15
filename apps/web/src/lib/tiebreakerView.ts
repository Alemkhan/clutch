import {
  isBestAnswerOfDay,
  TIEBREAKER_BUCKET_COUNT,
  TIEBREAKER_BUCKET_LOG_MAX,
  TIEBREAKER_BUCKET_LOG_MIN,
  tiebreakerBucketIndex,
  type TiebreakerAnsweredView,
} from '@clutch/shared';

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function exponentForm(value: number): string {
  const [mantissa, exponent] = value.toExponential(1).split('e');
  const power = String(Number(exponent)).split('').map((char) => SUPERSCRIPT[char] ?? char).join('');
  return `${mantissa.replace('.', ',')}×10${power}`;
}

/** Множитель промаха: «×1,4», запятая, один знак. Очень большие — степенью, чтобы не ломать строку. */
export function formatMultiplier(multiplier: number): string {
  if (multiplier >= 1e6) return `×${exponentForm(multiplier)}`;
  const fixed = multiplier.toFixed(1).replace('.', ',');
  const [whole, fraction] = fixed.split(',');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `×${grouped},${fraction}`;
}

/** Число из вопроса или ответа: тысячи через неразрывный пробел, запятая, без хвоста нулей. */
export function formatTiebreakerNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e15 || (value > 0 && value < 1e-6)) return exponentForm(value);
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6, useGrouping: true }).format(value);
  return text.replace(/[\s ]/g, ' ');
}

export function formatQuantity(value: number, unit: string): string {
  const number = formatTiebreakerNumber(value);
  return unit.trim() ? `${number} ${unit.trim()}` : number;
}

/**
 * Число с единицей для строк, где значение стоит в узкой колонке: между числом и единицей обычный
 * пробел, поэтому длинная единица («контейнеров») переносится целиком, а не рвётся посреди слова.
 * Тысячи внутри числа по-прежнему неразрывные.
 */
export function formatQuantityBreakable(value: number, unit: string): string {
  const number = formatTiebreakerNumber(value);
  return unit.trim() ? `${number} ${unit.trim()}` : number;
}

/** «2026-03-12» → «12.03.2026»; всё остальное (например, только год) показываем как есть. */
export function formatAsOfDate(asOfDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOfDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : asOfDate;
}

/** Только http(s): ссылка из данных не должна оказаться javascript:. */
export function safeSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export interface DistributionBar {
  index: number;
  count: number;
  /** Доля от самой высокой корзины, 0..1. */
  height: number;
  mine: boolean;
  /** Сторона от правильного ответа: «занизили» (guess < answer) или «завысили». */
  side: BucketSide;
}

export type BucketSide = 'under' | 'over';

/** Корзины левее середины — отношение ниже 1 («занизили»), остальные — от 1 и выше. */
export function bucketSide(index: number): BucketSide {
  return index < TIEBREAKER_BUCKET_COUNT / 2 ? 'under' : 'over';
}

/** Столбики графика. Своя корзина — по отношению guess/answer, как и считает сервер. */
export function distributionBars(answered: Pick<TiebreakerAnsweredView, 'distribution' | 'guess' | 'answer'>): DistributionBar[] {
  const counts = Array.from({ length: TIEBREAKER_BUCKET_COUNT }, (_, index) => answered.distribution[index] ?? 0);
  const max = Math.max(1, ...counts);
  const mine = tiebreakerBucketIndex(answered.guess / answered.answer);
  return counts.map((count, index) => ({ index, count, height: count / max, mine: index === mine, side: bucketSide(index) }));
}

export interface AxisTick {
  label: string;
  /** Положение на оси, 0..1 слева направо. */
  position: number;
  exact: boolean;
}

/**
 * Деления под гистограммой на целых степенях десяти: ÷1000 ÷100 ÷10 точно ×10 ×100 ×1000. Выводятся
 * из границ шкалы корзин в shared, а не хардкодом: сменится шкала — подписи поедут вместе с ней.
 */
export function distributionAxisTicks(): AxisTick[] {
  const ticks: AxisTick[] = [];
  for (let log = Math.ceil(TIEBREAKER_BUCKET_LOG_MIN); log <= TIEBREAKER_BUCKET_LOG_MAX; log += 1) {
    const factor = 10 ** Math.abs(log);
    ticks.push({
      label: log === 0 ? 'точно' : log < 0 ? `÷${factor}` : `×${factor}`,
      position: (log - TIEBREAKER_BUCKET_LOG_MIN) / (TIEBREAKER_BUCKET_LOG_MAX - TIEBREAKER_BUCKET_LOG_MIN),
      exact: log === 0,
    });
  }
  return ticks;
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «2026-10-16» → «16 октября»; не дата — как есть. */
export function formatDayMonth(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const month = match ? MONTHS_GENITIVE[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month}` : dateKey;
}

/** «214 ответов», «1 ответ», «3 ответа». */
export function answersText(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? 'ответов' : mod10 === 1 ? 'ответ' : mod10 >= 2 && mod10 <= 4 ? 'ответа' : 'ответов';
  return `${formatTiebreakerNumber(count)} ${word}`;
}

/**
 * Место среди ответивших: «Лучший ответ дня» (строго ближе всех), «Точнее 72%» или null — перцентиля
 * нет, пока ответов меньше порога, и тогда ничего не обещаем.
 */
export function standingText(percentile: number | null): string | null {
  if (isBestAnswerOfDay(percentile)) return 'Лучший ответ дня';
  return percentile === null ? null : `Точнее ${percentile}%`;
}

/** Короткий текст для скринридера вместо графика из столбиков. */
export function distributionSummary(answered: TiebreakerAnsweredView): string {
  const bars = distributionBars(answered);
  const mine = bars.find((bar) => bar.mine);
  const side = answered.guess === answered.answer
    ? 'совпал с правильным'
    : mine && mine.index < TIEBREAKER_BUCKET_COUNT / 2 ? 'ниже правильного' : 'выше правильного';
  return `Распределение ответов: всего ${answered.totalAnswers}. Твой ответ ${side}.`;
}
