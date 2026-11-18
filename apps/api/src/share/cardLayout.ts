import { DEFAULT_LOCALE, type Locale } from '@clutch/shared';
import { CARD_HEIGHT, CARD_WIDTH, CYRILLIC_FAMILY, PALETTE, escapeXml, fitSize, footer, header, open, surface, text } from './cardKit';
import { shareText } from './shareText';

export { CARD_HEIGHT, CARD_WIDTH, CYRILLIC_FAMILY, escapeXml };

export type ShareOutcome = 'win' | 'loss' | 'tie';

export interface ShareCardData {
  outcome: ShareOutcome;
  p: number;
  q: number;
  name: string | null;
  /** Язык текста на карточке; без него — русский. */
  locale?: Locale;
}

const MAX_DRAWN_NAME = 14;

/** Убирает то, чего нет в шрифте (эмодзи, CJK и т.п.), чтобы не рисовать «квадраты». */
function sanitizeName(name: string): string {
  return name
    .replace(/\p{Extended_Pictographic}|[‍️]/gu, '')
    .replace(/[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Common}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Имя для рисования: обрезается по символам, чтобы длинное имя не ломало вёрстку. */
export function displayName(name: string | null, locale: Locale = DEFAULT_LOCALE): string {
  const chars = Array.from(sanitizeName(name ?? ''));
  if (chars.length === 0) return shareText(locale).opponentFallback;
  if (chars.length <= MAX_DRAWN_NAME) return chars.join('');
  return `${chars.slice(0, MAX_DRAWN_NAME - 1).join('').trimEnd()}…`;
}

const HEADLINE_FILL: Record<ShareOutcome, string> = {
  win: PALETTE.gold,
  loss: PALETTE.text,
  tie: PALETTE.text,
};

const SCORE_FILL: Record<ShareOutcome, string> = {
  win: PALETTE.success,
  loss: PALETTE.error,
  tie: PALETTE.text,
};

/** Карточка матча 1200x630: исход, мой процент против процента соперника, кнопка в игру. */
export function buildShareCardSvg({ outcome, p, q, name, locale = DEFAULT_LOCALE }: ShareCardData): string {
  const t = shareText(locale);
  const headline = t.outcome.headline[outcome];
  const label = displayName(name, locale);
  return [
    open(),
    header(null),
    text(`x="72" y="250" font-size="${fitSize(headline, 1056, 88, 'black')}" letter-spacing="-2" fill="${HEADLINE_FILL[outcome]}"`, headline, 'black'),
    surface(72, 292, 1056, 186),
    `<rect x="599" y="320" width="2" height="130" fill="#ffffff" fill-opacity="0.12"/>`,
    text(`x="112" y="344" font-size="28" fill="${PALETTE.dim}"`, t.outcome.me, 'bold'),
    text(`x="112" y="446" font-size="104" letter-spacing="-3" fill="${SCORE_FILL[outcome]}"`, `${p}%`, 'black'),
    text(`x="640" y="344" font-size="28" fill="${PALETTE.dim}"`, label, 'bold'),
    text(`x="640" y="446" font-size="104" letter-spacing="-3" fill="${PALETTE.text}" fill-opacity="0.85"`, `${q}%`, 'black'),
    footer(t.outcome.call, t.playInTelegram),
    '</svg>',
  ].join('');
}
