import type { Locale } from '@clutch/shared';
import { PALETTE } from './cardKit';
import { shareText } from './shareText';

/**
 * Страница-превью ссылки шаринга: og-теги с картинкой и сразу переход в Mini App. Её видят
 * только на мгновение (или без JavaScript), но оформлена так же, как игра: тёмно-фиолетовый
 * фон, логотип и объёмная жёлтая кнопка. Стили только инлайновые: внешних файлов нет.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SharePage {
  locale: Locale;
  title: string;
  description: string;
  /** Абсолютный адрес картинки 1200x630 (og:image и картинка на странице). */
  image: string;
  /** Куда уводит страница: только ссылка из конфигурации. */
  target: string;
}

const BODY_STYLE = [
  'margin:0',
  'min-height:100vh',
  'padding:24px 16px 40px',
  'box-sizing:border-box',
  'font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
  'text-align:center',
  `background:linear-gradient(180deg,${PALETTE.bgTop} 0%,${PALETTE.bgMid} 55%,${PALETTE.bgBottom} 100%) fixed`,
  `background-color:${PALETTE.bgMid}`,
  `color:${PALETTE.text}`,
].join(';');

const LOGO = `<div style="display:inline-flex;align-items:center;gap:10px;margin:0 0 20px">`
  + `<span style="display:inline-block;width:36px;height:36px;line-height:36px;border-radius:10px;background:#fff;color:${PALETTE.logo};font-weight:900;font-size:24px">C</span>`
  + `<span style="font-weight:900;font-size:22px;letter-spacing:4px;color:#fff">CLUTCH</span></div>`;

const IMAGE_STYLE = `display:block;width:100%;max-width:600px;height:auto;margin:0 auto;border-radius:20px;border:1px solid rgba(255,255,255,0.08);background:${PALETTE.surface}`;

const BUTTON_STYLE = [
  'display:inline-block',
  'padding:16px 32px',
  'border-radius:18px',
  `background:${PALETTE.primary}`,
  `color:${PALETTE.primaryText}`,
  `box-shadow:0 6px 0 ${PALETTE.primaryEdge}`,
  'font-weight:800',
  'font-size:18px',
  'text-decoration:none',
].join(';');

const OG_LOCALE: Record<Locale, string> = { ru: 'ru_RU', en: 'en_US', kk: 'kk_KZ' };

export function renderSharePage({ locale, title, description, image, target }: SharePage): string {
  const t = shareText(locale);
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const href = escapeHtml(target);
  const scriptTarget = JSON.stringify(target).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${PALETTE.bgTop}">
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Clutch">
<meta property="og:locale" content="${OG_LOCALE[locale]}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
<meta property="og:image" content="${safeImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
</head>
<body style="${BODY_STYLE}">
${LOGO}
<img src="${safeImage}" alt="" width="600" height="315" style="${IMAGE_STYLE}">
<h1 style="font-size:24px;line-height:1.25;font-weight:800;margin:24px auto 8px;max-width:600px">${safeTitle}</h1>
<p style="font-size:16px;line-height:1.45;color:${PALETTE.dim};margin:0 auto 28px;max-width:600px">${safeDescription}</p>
<p style="margin:0"><a href="${href}" style="${BUTTON_STYLE}">${escapeHtml(t.openInTelegram)}</a></p>
<script>window.location.replace(${scriptTarget});</script>
</body>
</html>`;
}
