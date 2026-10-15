import {
  TIEBREAKER_BUCKET_COUNT,
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
}

/** Столбики графика. Своя корзина — по отношению guess/answer, как и считает сервер. */
export function distributionBars(answered: Pick<TiebreakerAnsweredView, 'distribution' | 'guess' | 'answer'>): DistributionBar[] {
  const counts = Array.from({ length: TIEBREAKER_BUCKET_COUNT }, (_, index) => answered.distribution[index] ?? 0);
  const max = Math.max(1, ...counts);
  const mine = tiebreakerBucketIndex(answered.guess / answered.answer);
  return counts.map((count, index) => ({ index, count, height: count / max, mine: index === mine }));
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
