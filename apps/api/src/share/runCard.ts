import { DEFAULT_LOCALE, gameDayNumber, type CategoryId, type Locale } from '@clutch/shared';
import { PALETTE, ZONE, fitSize, footer, header, open, surface, text } from './cardKit';
import { displayName } from './cardLayout';
import { shareText } from './shareText';

/**
 * Карточки превью ссылок 1200x630 в цветах игры: результат соло-забега (он же приглашение
 * на дуэль), «На глазок» и общая карточка игры. SVG собирается вручную и растеризуется resvg,
 * поэтому ширина текста заранее не измеряется: длинные строки ужимаются по оценке ширины.
 */

/** Круг забега одной буквой: идеально, отлично, хорошо, слабо, ноль (мимо или неверный ответ). */
export type RoundTile = 'P' | 'G' | 'O' | 'W' | 'X';

export const MAX_TILES = 20;

export interface RunCardData {
  tiles: readonly RoundTile[];
  progress: number;
  category: CategoryId;
  /** Игровой день набора, YYYY-MM-DD; null — без даты. */
  day: string | null;
  /** Карточка приглашения: имя того, кто зовёт (null — без имени); null — обычный результат. */
  invite: { name: string | null } | null;
  /** Язык текста; без него — русский. */
  locale?: Locale;
}

export interface GuessCardData {
  number: number;
  multiplier: number;
  /** «Точнее N% игроков»; 'best' — лучший ответ дня; null — ответов пока мало. */
  percentile: number | 'best' | null;
  locale?: Locale;
}

const TILE: Record<RoundTile, { fill: string; label: string; text: string }> = {
  P: { fill: ZONE.perfect, label: '+25', text: PALETTE.primaryText },
  G: { fill: ZONE.great, label: '+18', text: '#ffffff' },
  O: { fill: ZONE.good, label: '+12', text: '#ffffff' },
  W: { fill: ZONE.weak, label: '+5', text: '#ffffff' },
  X: { fill: 'none', label: '0', text: PALETTE.dim },
};

/** Подпись даты: «17 окт», «Oct 17», «17 қазан». */
export function dayLabel(day: string | null, locale: Locale = DEFAULT_LOCALE): string | null {
  if (!day) return null;
  const [, month, date] = day.split('-').map(Number);
  return shareText(locale).date(month, date);
}

/** «Clutch #N» для игрового дня (день 1 — 2026-10-19); до первого дня номера нет. */
export function dayNumberLabel(day: string | null): string | null {
  if (!day) return null;
  const number = gameDayNumber(day);
  return Number.isFinite(number) && number >= 1 ? `Clutch #${number}` : null;
}

export function circles(count: number, locale: Locale = DEFAULT_LOCALE): string {
  return shareText(locale).rounds(count);
}

/** Квадраты кругов: цвет — зона удара, пустой — круг без прогресса. */
function tileGrid(tiles: readonly RoundTile[], x: number, y: number, width: number, height: number): string {
  const count = Math.min(tiles.length, MAX_TILES);
  const cols = Math.min(5, count);
  const rows = Math.ceil(count / 5);
  const gap = 14;
  const size = Math.min(80, (width - (cols - 1) * gap) / cols, (height - (rows - 1) * gap) / rows);
  const gridWidth = cols * size + (cols - 1) * gap;
  const gridHeight = rows * size + (rows - 1) * gap;
  const left = x + (width - gridWidth) / 2;
  const top = y + (height - gridHeight) / 2;
  const radius = Math.round(size * 0.22);
  const parts: string[] = [];
  tiles.slice(0, count).forEach((tile, index) => {
    const style = TILE[tile];
    const tx = left + (index % 5) * (size + gap);
    const ty = top + Math.floor(index / 5) * (size + gap);
    parts.push(tile === 'X'
      ? `<rect x="${tx + 1.5}" y="${ty + 1.5}" width="${size - 3}" height="${size - 3}" rx="${radius}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>`
      : `<rect x="${tx}" y="${ty}" width="${size}" height="${size}" rx="${radius}" fill="${style.fill}"/>`);
    parts.push(text(`x="${tx + size / 2}" y="${ty + size / 2 + size * 0.13}" font-size="${Math.round(size * 0.36)}" fill="${style.text}" text-anchor="middle"`, style.label, 'black'));
  });
  return parts.join('');
}

/** Вызов на карточке и в сообщении: обогнать запись, пройти быстрее или дойти до 100%. */
export function runCallLine(data: Pick<RunCardData, 'invite' | 'progress' | 'locale'>): string {
  const t = shareText(data.locale ?? DEFAULT_LOCALE);
  if (data.invite) return t.callInvite;
  return data.progress >= 100 ? t.callFaster : t.callReach;
}

export function buildRunCardSvg(data: RunCardData): string {
  const locale = data.locale ?? DEFAULT_LOCALE;
  const t = shareText(locale);
  const reached = data.progress >= 100;
  const caption = [dayNumberLabel(data.day), dayLabel(data.day, locale)].filter(Boolean).join(' · ') || null;
  const kicker = data.invite
    ? t.inviteKicker(data.invite.name ? displayName(data.invite.name, locale) : null)
    : t.runKicker;
  const under = t.inRounds(t.rounds(data.tiles.length));
  return [
    open(),
    header(caption ?? t.categories[data.category], caption ? t.categories[data.category] : null),
    text(`x="72" y="200" font-size="${fitSize(kicker, 520, 34, 'black')}" fill="${data.invite ? PALETTE.gold : PALETTE.dim}"`, kicker, 'black'),
    text(`x="62" y="378" font-size="190" letter-spacing="-8" fill="${reached ? PALETTE.success : PALETTE.text}"`, `${data.progress}%`, 'black'),
    text(`x="72" y="450" font-size="${fitSize(under, 520, 42, 'bold')}" fill="${PALETTE.dim}"`, under, 'bold'),
    surface(624, 156, 504, 328),
    tileGrid(data.tiles, 652, 176, 448, 248),
    text(`x="876" y="462" font-size="${fitSize(t.tilesCaption, 456, 22, 'bold', 16)}" fill="${PALETTE.dim}" text-anchor="middle"`, t.tilesCaption, 'bold'),
    footer(runCallLine(data), t.playInTelegram),
    '</svg>',
  ].join('');
}

export function formatMultiplierLabel(multiplier: number, locale: Locale = DEFAULT_LOCALE): string {
  return shareText(locale).multiplier(multiplier);
}

/** Шкала промаха: метка ответа в центре, догадка сдвинута на log10 промаха (×10 — край). */
function missScale(multiplier: number, locale: Locale): string {
  const t = shareText(locale).guess;
  const x0 = 676;
  const x1 = 1104;
  const mid = (x0 + x1) / 2;
  const shift = Math.min(1, Math.log10(Math.max(1, multiplier))) * (x1 - mid - 24);
  const guess = mid + shift;
  return [
    `<rect x="${x0}" y="330" width="${x1 - x0}" height="14" rx="7" fill="#ffffff" fill-opacity="0.14"/>`,
    `<rect x="${mid - 4}" y="300" width="8" height="74" rx="4" fill="${PALETTE.success}"/>`,
    text(`x="${mid}" y="282" font-size="24" fill="${PALETTE.success}" text-anchor="middle"`, t.answer, 'bold'),
    `<circle cx="${guess}" cy="337" r="22" fill="${PALETTE.gold}" stroke="${PALETTE.surface}" stroke-width="6"/>`,
    shift < 70 ? '' : text(`x="${Math.min(guess, x1 - 60)}" y="412" font-size="24" fill="${PALETTE.gold}" text-anchor="middle"`, t.myGuess, 'bold'),
  ].join('');
}

export function buildGuessCardSvg(data: GuessCardData): string {
  const locale = data.locale ?? DEFAULT_LOCALE;
  const t = shareText(locale);
  const g = t.guess;
  const best = data.percentile === 'best';
  const kicker = best ? g.kickerBest : data.percentile === null ? g.kickerMiss : g.kickerPercentile;
  const big = best ? g.bigBest : data.percentile === null ? formatMultiplierLabel(data.multiplier, locale) : `${data.percentile}%`;
  const under = best ? g.underBest : data.percentile === null ? g.underMiss : g.underPercentile;
  const miss = g.missLabel(formatMultiplierLabel(data.multiplier, locale));
  return [
    open(),
    header(`${g.mode} #${data.number}`),
    text(`x="72" y="200" font-size="${fitSize(kicker, 520, 34, 'black')}" fill="${PALETTE.dim}"`, kicker, 'black'),
    text(`x="62" y="372" font-size="${fitSize(big, 540, best ? 140 : 180, 'black', 72)}" letter-spacing="-6" fill="${best ? PALETTE.gold : PALETTE.text}"`, big, 'black'),
    text(`x="72" y="444" font-size="${fitSize(under, 520, 42, 'bold')}" fill="${PALETTE.dim}"`, under, 'bold'),
    surface(640, 156, 488, 328),
    text(`x="676" y="214" font-size="${fitSize(miss, 420, 34, 'black')}" fill="#ffffff"`, miss, 'black'),
    missScale(data.multiplier, locale),
    footer(g.call, t.playInTelegram),
    '</svg>',
  ].join('');
}

/** Полоса молотка во всю ширину: зоны +5…+25 цветами мини-игры и маркер в жёлтом центре. */
function lane(x: number, y: number, width: number): string {
  const h = 78;
  const zones: [number, number, string][] = [
    [0, 1, ZONE.weak], [0.22, 0.56, ZONE.good], [0.34, 0.32, ZONE.great], [0.47, 0.06, ZONE.perfect],
  ];
  const labels: [string, number][] = [['+5', 0.11], ['+12', 0.28], ['+18', 0.405], ['+25', 0.5], ['+18', 0.595], ['+12', 0.72], ['+5', 0.89]];
  return [
    `<clipPath id="lane"><rect x="${x}" y="${y}" width="${width}" height="${h}" rx="22"/></clipPath>`,
    `<g clip-path="url(#lane)">${zones.map(([left, w, fill]) => `<rect x="${x + left * width}" y="${y}" width="${w * width}" height="${h}" fill="${fill}"/>`).join('')}</g>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${h}" rx="22" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>`,
    `<rect x="${x + width / 2 - 11}" y="${y - 14}" width="22" height="${h + 28}" rx="10" fill="#ffffff" stroke="${PALETTE.primaryText}" stroke-width="5"/>`,
    ...labels.map(([label, at]) => text(
      `x="${x + at * width}" y="${y - 22}" font-size="24" fill="${label === '+25' ? PALETTE.gold : PALETTE.dim}" text-anchor="middle"`,
      label,
      'black',
    )),
  ].join('');
}

export function buildBrandCardSvg(locale: Locale = DEFAULT_LOCALE): string {
  const t = shareText(locale);
  const b = t.brand;
  return [
    open(),
    header(b.caption),
    text(`x="72" y="238" font-size="${fitSize(b.line1, 700, 80, 'black')}" letter-spacing="-3" fill="#ffffff"`, b.line1, 'black'),
    text(`x="72" y="328" font-size="${fitSize(b.line2, 700, 80, 'black')}" letter-spacing="-3" fill="${PALETTE.gold}"`, b.line2, 'black'),
    text(`x="1128" y="238" font-size="30" fill="${PALETTE.dim}" text-anchor="end"`, b.side1, 'bold'),
    text(`x="1128" y="278" font-size="30" fill="${PALETTE.dim}" text-anchor="end"`, b.side2, 'bold'),
    lane(72, 404, 1056),
    footer(b.call, t.playInTelegram),
    '</svg>',
  ].join('');
}
