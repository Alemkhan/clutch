import type { CategoryId } from '@clutch/shared';
import { CARD_HEIGHT, CARD_WIDTH, CYRILLIC_FAMILY, displayName, escapeXml } from './cardLayout';

/**
 * Карточки превью ссылок 1200x630 в цветах игры: результат соло-забега (он же приглашение
 * на дуэль), «На глазок» и общая карточка игры. SVG собирается вручную и растеризуется resvg,
 * поэтому ширина текста заранее не измеряется: длинные строки ограничены по символам.
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
}

export interface GuessCardData {
  number: number;
  multiplier: number;
  /** «Точнее N% игроков»; 'best' — лучший ответ дня; null — ответов пока мало. */
  percentile: number | 'best' | null;
}

const C = {
  bg: '#f3f0e8',
  ink: '#171716',
  red: '#f04a3e',
  green: '#168c51',
  line: '#ddd5c4',
};

const TILE: Record<RoundTile, { fill: string; label: string; text: string }> = {
  P: { fill: C.red, label: '+25', text: '#ffffff' },
  G: { fill: '#ec9a2c', label: '+18', text: '#ffffff' },
  O: { fill: '#f3c46a', label: '+12', text: C.ink },
  W: { fill: '#f3e2b9', label: '+5', text: C.ink },
  X: { fill: 'none', label: '0', text: '#a59c8a' },
};

const CATEGORY: Record<CategoryId, string> = {
  general: 'Общие знания',
  geography: 'География',
  history: 'История',
  languages: 'Языки',
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function dayLabel(day: string | null): string | null {
  if (!day) return null;
  const [, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[month - 1]}`;
}

export function circles(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'кругов' : last === 1 ? 'круг' : last >= 2 && last <= 4 ? 'круга' : 'кругов';
  return `${count} ${word}`;
}

type Weight = 'bold' | 'black';

/** Текст с кириллицей и латиницей по своим семействам (см. CYRILLIC_FAMILY в renderCard.ts). */
function text(attrs: string, value: string, weight: Weight): string {
  const base = weight === 'black' ? 'Inter Black' : 'Inter';
  const cyrillic = weight === 'black' ? `${CYRILLIC_FAMILY} Black` : CYRILLIC_FAMILY;
  const spans = value
    .split(/([Ѐ-ӿ]+)/u)
    .filter(Boolean)
    .map((part) => `<tspan font-family="${/[Ѐ-ӿ]/u.test(part) ? cyrillic : base}">${escapeXml(part)}</tspan>`)
    .join('');
  return `<text ${attrs} font-family="${base}" font-weight="${weight === 'black' ? 900 : 700}">${spans}</text>`;
}

function open(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    '<defs><radialGradient id="glow" cx="1" cy="0" r="0.9"><stop offset="0" stop-color="#f04a3e" stop-opacity="0.18"/><stop offset="1" stop-color="#f04a3e" stop-opacity="0"/></radialGradient></defs>',
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${C.bg}"/>`,
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>`,
  ].join('');
}

/** Логотип слева сверху и подпись (категория, дата) справа. */
function header(caption: string | null): string {
  return [
    `<rect x="72" y="52" width="60" height="60" rx="16" fill="${C.ink}"/>`,
    text('x="102" y="97" font-size="42" fill="#ffffff" text-anchor="middle"', 'C', 'black'),
    text(`x="150" y="96" font-size="38" letter-spacing="6" fill="${C.ink}"`, 'CLUTCH', 'black'),
    caption ? text(`x="1128" y="94" font-size="30" fill="${C.ink}" fill-opacity="0.55" text-anchor="end"`, caption, 'bold') : '',
  ].join('');
}

/** Нижняя тёмная плашка: вопрос-вызов слева и кнопка «Играть в Telegram» справа. */
function footer(call: string): string {
  return [
    `<rect x="0" y="512" width="${CARD_WIDTH}" height="118" fill="${C.ink}"/>`,
    text('x="72" y="585" font-size="44" fill="#ffffff"', call, 'black'),
    `<rect x="788" y="535" width="340" height="72" rx="36" fill="${C.red}"/>`,
    text('x="958" y="582" font-size="30" fill="#ffffff" text-anchor="middle"', 'Играть в Telegram', 'black'),
  ].join('');
}

/** Квадраты кругов справа: цвет — точность удара, пустой — круг без прогресса. */
function tileGrid(tiles: readonly RoundTile[], x: number, y: number, width: number, height: number): string {
  const count = Math.min(tiles.length, MAX_TILES);
  const cols = Math.min(5, count);
  const rows = Math.ceil(count / 5);
  const gap = 14;
  const size = Math.min(84, (width - (cols - 1) * gap) / cols, (height - (rows - 1) * gap) / rows);
  const gridHeight = rows * size + (rows - 1) * gap;
  const top = y + (height - gridHeight) / 2;
  const parts: string[] = [];
  tiles.slice(0, count).forEach((tile, index) => {
    const style = TILE[tile];
    const tx = x + (index % 5) * (size + gap);
    const ty = top + Math.floor(index / 5) * (size + gap);
    parts.push(tile === 'X'
      ? `<rect x="${tx + 2}" y="${ty + 2}" width="${size - 4}" height="${size - 4}" rx="16" fill="none" stroke="${C.line}" stroke-width="4"/>`
      : `<rect x="${tx}" y="${ty}" width="${size}" height="${size}" rx="16" fill="${style.fill}"/>`);
    parts.push(text(`x="${tx + size / 2}" y="${ty + size / 2 + size * 0.13}" font-size="${Math.round(size * 0.36)}" fill="${style.text}" text-anchor="middle"`, style.label, 'black'));
  });
  return parts.join('');
}

/** Вызов на карточке и в сообщении: обогнать запись, пройти быстрее или дойти до 100%. */
export function runCallLine(data: Pick<RunCardData, 'invite' | 'progress'>): string {
  if (data.invite) return 'Обгонишь эту запись?';
  return data.progress >= 100 ? 'Сможешь быстрее?' : 'А ты дойдёшь до 100%?';
}

export function buildRunCardSvg(data: RunCardData): string {
  const reached = data.progress >= 100;
  const caption = [CATEGORY[data.category], dayLabel(data.day)].filter(Boolean).join(' · ');
  const kicker = data.invite
    ? data.invite.name ? `${displayName(data.invite.name)} зовёт на дуэль` : 'Тебя зовут на дуэль'
    : 'Мой результат дня';
  const call = runCallLine(data);
  return [
    open(),
    header(caption),
    text(`x="72" y="196" font-size="34" fill="${data.invite ? C.red : C.ink}" fill-opacity="${data.invite ? 1 : 0.6}"`, kicker, 'black'),
    text(`x="64" y="380" font-size="200" letter-spacing="-8" fill="${reached ? C.green : C.ink}"`, `${data.progress}%`, 'black'),
    text(`x="72" y="448" font-size="44" fill="${C.ink}" fill-opacity="0.7"`, `за ${circles(data.tiles.length)}`, 'bold'),
    tileGrid(data.tiles, 640, 150, 488, 280),
    text(`x="640" y="470" font-size="22" fill="${C.ink}" fill-opacity="0.5"`, 'Круг — верный ответ и удар молотком', 'bold'),
    footer(call),
    '</svg>',
  ].join('');
}

export function formatMultiplierLabel(multiplier: number): string {
  if (multiplier >= 1000) return `×${Math.round(multiplier).toLocaleString('ru-RU').replace(/\s/g, ' ')}`;
  return `×${multiplier.toFixed(1).replace('.', ',')}`;
}

/** Шкала промаха: метка ответа в центре, догадка сдвинута на log10 промаха (×10 — край). */
function missScale(multiplier: number): string {
  const x0 = 660;
  const x1 = 1120;
  const mid = (x0 + x1) / 2;
  const shift = Math.min(1, Math.log10(Math.max(1, multiplier))) * (x1 - mid - 24);
  const guess = mid + shift;
  return [
    `<rect x="${x0}" y="330" width="${x1 - x0}" height="14" rx="7" fill="${C.line}"/>`,
    `<rect x="${mid - 4}" y="300" width="8" height="74" rx="4" fill="${C.green}"/>`,
    text(`x="${mid}" y="282" font-size="24" fill="${C.green}" text-anchor="middle"`, 'ответ', 'bold'),
    `<circle cx="${guess}" cy="337" r="22" fill="${C.red}" stroke="#ffffff" stroke-width="6"/>`,
    shift < 70 ? '' : text(`x="${guess}" y="412" font-size="24" fill="${C.red}" text-anchor="middle"`, 'моя догадка', 'bold'),
  ].join('');
}

export function buildGuessCardSvg(data: GuessCardData): string {
  const best = data.percentile === 'best';
  const kicker = best ? 'Ближе всех за день' : data.percentile === null ? 'Мой промах' : 'Мой ответ точнее, чем у';
  const big = best ? 'Лучший' : data.percentile === null ? formatMultiplierLabel(data.multiplier) : `${data.percentile}%`;
  const under = best ? 'ответ дня' : data.percentile === null ? 'от правильного ответа' : 'игроков';
  return [
    open(),
    header(`На глазок #${data.number}`),
    text(`x="72" y="196" font-size="34" fill="${C.ink}" fill-opacity="0.6"`, kicker, 'black'),
    text(`x="64" y="370" font-size="${best ? 128 : 190}" letter-spacing="-6" fill="${best ? C.green : C.ink}"`, big, 'black'),
    text(`x="72" y="440" font-size="44" fill="${C.ink}" fill-opacity="0.7"`, under, 'bold'),
    text(`x="660" y="196" font-size="34" fill="${C.red}"`, `промах ${formatMultiplierLabel(data.multiplier)}`, 'black'),
    missScale(data.multiplier),
    footer('Угадаешь точнее?'),
    '</svg>',
  ].join('');
}

/** Полоса молотка во всю ширину: зоны +5…+25 и маркер в красном центре. */
function lane(x: number, y: number, width: number): string {
  const h = 78;
  const zones: [number, number, string][] = [
    [0, 1, '#f3e2b9'], [0.22, 0.56, '#f3c46a'], [0.34, 0.32, '#ec9a2c'], [0.47, 0.06, C.red],
  ];
  const labels: [string, number][] = [['+5', 0.11], ['+12', 0.28], ['+18', 0.405], ['+25', 0.5], ['+18', 0.595], ['+12', 0.72], ['+5', 0.89]];
  return [
    `<clipPath id="lane"><rect x="${x}" y="${y}" width="${width}" height="${h}" rx="22"/></clipPath>`,
    `<g clip-path="url(#lane)">${zones.map(([left, w, fill]) => `<rect x="${x + left * width}" y="${y}" width="${w * width}" height="${h}" fill="${fill}"/>`).join('')}</g>`,
    `<rect x="${x + width / 2 - 11}" y="${y - 14}" width="22" height="${h + 28}" rx="10" fill="${C.ink}" stroke="#ffffff" stroke-width="5"/>`,
    ...labels.map(([label, at]) => text(
      `x="${x + at * width}" y="${y - 22}" font-size="24" fill="${C.ink}" fill-opacity="${label === '+25' ? 1 : 0.5}" text-anchor="middle"`,
      label,
      'black',
    )),
  ].join('');
}

export function buildBrandCardSvg(): string {
  return [
    open(),
    header('Викторина на каждый день'),
    text(`x="72" y="236" font-size="80" letter-spacing="-3" fill="${C.ink}"`, 'Ответь верно.', 'black'),
    text(`x="72" y="326" font-size="80" letter-spacing="-3" fill="${C.red}"`, 'Попади в центр.', 'black'),
    text(`x="1128" y="236" font-size="30" fill="${C.ink}" fill-opacity="0.6" text-anchor="end"`, 'Точнее удар —', 'bold'),
    text(`x="1128" y="276" font-size="30" fill="${C.ink}" fill-opacity="0.6" text-anchor="end"`, 'быстрее до 100%', 'bold'),
    lane(72, 404, 1056),
    footer('Одни вопросы для всех'),
    '</svg>',
  ].join('');
}
