/**
 * Общие детали карточек 1200x630 в оформлении игры (тёмно-фиолетовая викторина): палитра,
 * фон, шапка с логотипом, нижняя плашка с объёмной жёлтой кнопкой и текст с разбивкой
 * кириллицы по своему семейству. SVG собирается вручную и растеризуется resvg (renderCard.ts),
 * поэтому ширина текста заранее не измеряется: длинные строки ужимаются по оценке ширины.
 */

/** Семейство кириллических подмножеств Inter после переименования в renderCard.ts. */
export const CYRILLIC_FAMILY = 'InteC';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export const PALETTE = {
  bgTop: '#2b2270',
  bgMid: '#1f1850',
  bgBottom: '#160f3e',
  bandTop: '#6c45e8',
  bandBottom: '#4f2fc4',
  surface: '#2a2266',
  text: '#ffffff',
  dim: '#b4aedb',
  primary: '#ffc94d',
  primaryText: '#2a1b5c',
  primaryEdge: '#e39a26',
  secondary: '#8b6cf6',
  secondaryEdge: '#6145d8',
  success: '#2fd283',
  error: '#ff5c7a',
  gold: '#ffc94d',
  logo: '#5f33dd',
} as const;

/** Зоны мини-игры: цвет квадрата круга по точности удара. */
export const ZONE = {
  perfect: '#ffc94d',
  great: '#3ccf8e',
  good: '#7a5cf0',
  weak: '#43378f',
} as const;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type Weight = 'bold' | 'black';

const CYRILLIC_RUN = /([Ѐ-ԯ]+)/u;
const CYRILLIC_CHAR = /[Ѐ-ԯ]/u;

/**
 * Текст с кириллицей и латиницей по своим семействам (см. CYRILLIC_FAMILY в renderCard.ts).
 * Диапазон Ѐ–ԯ включает казахские ә ғ қ ң ө ұ ү һ і (подмножество cyrillic-ext).
 */
export function text(attrs: string, value: string, weight: Weight): string {
  const base = weight === 'black' ? 'Inter Black' : 'Inter';
  const cyrillic = weight === 'black' ? `${CYRILLIC_FAMILY} Black` : CYRILLIC_FAMILY;
  const spans = value
    .split(CYRILLIC_RUN)
    .filter(Boolean)
    .map((part) => `<tspan font-family="${CYRILLIC_CHAR.test(part) ? cyrillic : base}">${escapeXml(part)}</tspan>`)
    .join('');
  return `<text ${attrs} font-family="${base}" font-weight="${weight === 'black' ? 900 : 700}">${spans}</text>`;
}

const NARROW = new Set(Array.from(' .,:;!|\'’iljrtfIі1()-\u2014\u2013«»"'));
const WIDE = new Set(Array.from('MWmwШЩЖМЮЫФшщжмюыфӘә%@'));

/** Грубая оценка ширины строки Inter (в долях кегля), чтобы ужать кегль под место. */
export function estimateWidth(value: string, size: number, weight: Weight): number {
  const factor = weight === 'black' ? 1.04 : 1;
  let units = 0;
  for (const char of Array.from(value)) {
    if (NARROW.has(char)) units += 0.32;
    else if (WIDE.has(char)) units += 0.86;
    else if (/\d/u.test(char)) units += 0.64;
    else if (char !== char.toLowerCase()) units += 0.7;
    else units += 0.58;
  }
  return units * size * factor;
}

/** Кегль, при котором строка укладывается в ширину: не больше заданного и не меньше min. */
export function fitSize(value: string, maxWidth: number, size: number, weight: Weight, min = Math.round(size * 0.6)): number {
  const width = estimateWidth(value, size, weight);
  if (width <= maxWidth) return size;
  return Math.max(min, Math.floor((size * maxWidth) / width));
}

/** Фон: вертикальный градиент и мягкое свечение справа сверху. */
export function open(width = CARD_WIDTH, height = CARD_HEIGHT): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PALETTE.bgTop}"/><stop offset="0.55" stop-color="${PALETTE.bgMid}"/><stop offset="1" stop-color="${PALETTE.bgBottom}"/></linearGradient>`,
    `<linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PALETTE.bandTop}"/><stop offset="1" stop-color="${PALETTE.bandBottom}"/></linearGradient>`,
    `<radialGradient id="glow" cx="1" cy="0.2" r="0.8"><stop offset="0" stop-color="${PALETTE.secondary}" stop-opacity="0.22"/><stop offset="1" stop-color="${PALETTE.secondary}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    `<rect width="${width}" height="${height}" fill="url(#glow)"/>`,
  ].join('');
}

export const BAND_HEIGHT = 128;

/** Логотип: белый скруглённый квадрат с фиолетовой «C» и надпись CLUTCH. */
export function logo(x: number, y: number, size = 60): string {
  return [
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.27)}" fill="#ffffff"/>`,
    text(`x="${x + size / 2}" y="${y + size * 0.75}" font-size="${Math.round(size * 0.7)}" fill="${PALETTE.logo}" text-anchor="middle"`, 'C', 'black'),
    text(`x="${x + size + 18}" y="${y + size * 0.73}" font-size="${Math.round(size * 0.62)}" letter-spacing="6" fill="#ffffff"`, 'CLUTCH', 'black'),
  ].join('');
}

/** Фиолетовая шапка: логотип слева, справа до двух строк подписи (крупная и приглушённая). */
export function header(caption: string | null, sub: string | null = null): string {
  const parts = [
    `<rect width="${CARD_WIDTH}" height="${BAND_HEIGHT}" fill="url(#band)"/>`,
    `<rect y="${BAND_HEIGHT - 6}" width="${CARD_WIDTH}" height="6" fill="#000000" fill-opacity="0.18"/>`,
    logo(72, 32),
  ];
  const right = 1128;
  const maxWidth = 640;
  if (caption) {
    const y = sub ? 66 : 80;
    parts.push(text(`x="${right}" y="${y}" font-size="${fitSize(caption, maxWidth, 32, 'black')}" fill="#ffffff" text-anchor="end"`, caption, 'black'));
  }
  if (sub) {
    parts.push(text(`x="${right}" y="${caption ? 102 : 80}" font-size="${fitSize(sub, maxWidth, 24, 'bold')}" fill="#ffffff" fill-opacity="0.72" text-anchor="end"`, sub, 'bold'));
  }
  return parts.join('');
}

/** Объёмная кнопка: тёмная полоса снизу и сама кнопка над ней. */
export function button3d(x: number, y: number, width: number, height: number, label: string, kind: 'primary' | 'secondary' = 'primary'): string {
  const fill = kind === 'primary' ? PALETTE.primary : PALETTE.secondary;
  const edge = kind === 'primary' ? PALETTE.primaryEdge : PALETTE.secondaryEdge;
  const ink = kind === 'primary' ? PALETTE.primaryText : '#ffffff';
  const radius = Math.round(height / 2.6);
  const size = fitSize(label, width - 48, 30, 'black', 20);
  return [
    `<rect x="${x}" y="${y + 8}" width="${width}" height="${height}" rx="${radius}" fill="${edge}"/>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`,
    `<rect x="${x + 14}" y="${y + 7}" width="${width - 28}" height="${Math.round(height * 0.32)}" rx="${Math.round(height * 0.16)}" fill="#ffffff" fill-opacity="0.18"/>`,
    text(`x="${x + width / 2}" y="${y + height / 2 + size * 0.36}" font-size="${size}" fill="${ink}" text-anchor="middle"`, label, 'black'),
  ].join('');
}

export const FOOTER_TOP = 512;

/** Нижняя плашка: вопрос-вызов слева и жёлтая кнопка справа. */
export function footer(call: string, action: string): string {
  const buttonWidth = 360;
  const buttonX = 1128 - buttonWidth;
  return [
    `<rect y="${FOOTER_TOP}" width="${CARD_WIDTH}" height="${CARD_HEIGHT - FOOTER_TOP}" fill="#0d0830" fill-opacity="0.45"/>`,
    `<rect y="${FOOTER_TOP}" width="${CARD_WIDTH}" height="2" fill="#ffffff" fill-opacity="0.08"/>`,
    text(`x="72" y="585" font-size="${fitSize(call, buttonX - 72 - 32, 44, 'black', 28)}" fill="#ffffff"`, call, 'black'),
    button3d(buttonX, 532, buttonWidth, 70, action),
  ].join('');
}

/** Карточка-подложка (#2a2266 с тонкой светлой рамкой). */
export function surface(x: number, y: number, width: number, height: number, radius = 28): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${PALETTE.surface}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>`;
}
