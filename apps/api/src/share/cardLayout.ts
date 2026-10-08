export type ShareOutcome = 'win' | 'loss' | 'tie';

export interface ShareCardData {
  outcome: ShareOutcome;
  p: number;
  q: number;
  name: string | null;
}

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const HEADLINES: Record<ShareOutcome, string> = {
  win: 'Я вытащил клатч!',
  loss: 'Почти получилось!',
  tie: 'Ничья',
};

const ACCENTS: Record<ShareOutcome, string> = {
  win: '#ee3a30',
  loss: '#7a7266',
  tie: '#2f6fed',
};

const MAX_DRAWN_NAME = 14;
const FALLBACK_NAME = 'Соперник';

/** Убирает то, чего нет в шрифте (эмодзи, CJK и т.п.), чтобы не рисовать «квадраты». */
function sanitizeName(name: string): string {
  return name
    .replace(/\p{Extended_Pictographic}|[‍️]/gu, '')
    .replace(/[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Common}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Имя для рисования: обрезается по символам, чтобы длинное имя не ломало вёрстку. */
export function displayName(name: string | null): string {
  const chars = Array.from(sanitizeName(name ?? ''));
  if (chars.length === 0) return FALLBACK_NAME;
  if (chars.length <= MAX_DRAWN_NAME) return chars.join('');
  return `${chars.slice(0, MAX_DRAWN_NAME - 1).join('').trimEnd()}…`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// В Inter Black (fontsource) семейство называется «Inter Black», а не «Inter» с весом 900.
const FONT = 'font-family="Inter"';

/** SVG карточки 1200x630 с явными координатами (satori не нужен: тексты короткие). */
export function buildShareCardSvg({ outcome, p, q, name }: ShareCardData): string {
  const label = escapeXml(displayName(name));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + CARD_WIDTH + '" height="' + CARD_HEIGHT + '" viewBox="0 0 ' + CARD_WIDTH + ' ' + CARD_HEIGHT + '">',
    '<rect width="' + CARD_WIDTH + '" height="' + CARD_HEIGHT + '" fill="#171410"/>',
    '<g fill="#f7f1e4" ' + FONT + '>',
    '<text x="80" y="112" font-size="32" font-family="Inter Black" font-weight="900" letter-spacing="5.76" fill-opacity="0.65">CLUTCH</text>',
    '<text x="80" y="256" font-size="98" font-family="Inter Black" font-weight="900" letter-spacing="-3.4">' + escapeXml(HEADLINES[outcome]) + '</text>',
    '<text x="80" y="326" font-size="30" font-weight="700" fill-opacity="0.55">Я</text>',
    '<text x="80" y="446" font-size="132" font-family="Inter Black" font-weight="900" letter-spacing="-4">' + p + '%</text>',
    '<text x="545" y="446" font-size="132" font-family="Inter Black" font-weight="900" text-anchor="middle" fill-opacity="0.45">·</text>',
    '<text x="640" y="326" font-size="30" font-weight="700" fill-opacity="0.55">' + label + '</text>',
    '<text x="640" y="446" font-size="132" font-family="Inter Black" font-weight="900" letter-spacing="-4">' + q + '%</text>',
    '</g>',
    '<rect x="80" y="516" width="200" height="34" rx="17" fill="' + ACCENTS[outcome] + '"/>',
    '</svg>',
  ].join('');
}
