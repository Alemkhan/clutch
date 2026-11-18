// Пересборка статичных карточек шаринга и аватарки бота из HTML-исходников рядом.
// Запуск из корня репозитория:
//   node scripts/share-cards/render.mjs
// Результат пишется в apps/web/public/share/: win.png, win.en.png, win.kk.png, … и bot-avatar.png.
//
// Рендерит установленный локально Chrome или Edge (headless), без сети: шрифт Inter берётся
// из apps/api/src/share/interFonts.ts (тот же, что у карточек Worker) и кладётся рядом
// с копией шаблонов во временную папку вместе с fonts.css.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const outDir = path.join(root, 'apps', 'web', 'public', 'share');

const LOCALES = ['ru', 'en', 'kk'];
/** Русская картинка — исходное имя (её же берут старые ссылки), остальные — с суффиксом языка. */
const localized = (name, locale) => (locale === 'ru' ? name : name.replace(/\.png$/u, `.${locale}.png`));

const CARDS = [
  ...['win', 'loss', 'tie'].flatMap((outcome) => LOCALES.map((locale) => ({
    source: `${outcome}.html`, query: `?l=${locale}`, out: localized(`${outcome}.png`, locale), width: 1200, height: 630,
  }))),
  { source: 'avatar.html', query: '', out: 'bot-avatar.png', width: 512, height: 512 },
];

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('Не найден Chrome или Edge. Добавьте путь в CHROME_CANDIDATES.');
  process.exit(1);
}

/** Подмножество Inter по OS/2 usLastCharIndex (как в renderCard.ts) и вес по usWeightClass. */
function describeFont(font) {
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) !== 'OS/2') continue;
    const os2 = font.readUInt32BE(record + 8);
    const last = font.readUInt16BE(os2 + 66);
    const subset = { 0x2116: 'cyrillic', 0xa69f: 'cyrillic-ext', 0xa7ff: 'latin-ext' }[last] ?? 'latin';
    return { subset, weight: font.readUInt16BE(os2 + 4) };
  }
  throw new Error('В шрифте нет таблицы OS/2');
}

/** Шрифты API → файлы и fonts.css: у каждого подмножества своё семейство, порядок — в --font. */
function stageFonts(dir) {
  const source = readFileSync(path.join(root, 'apps', 'api', 'src', 'share', 'interFonts.ts'), 'utf8');
  const fonts = [...source.matchAll(/'([A-Za-z0-9+/=]{100,})'/gu)].map((match) => Buffer.from(match[1], 'base64'));
  if (fonts.length === 0) throw new Error('Не нашёл шрифты в interFonts.ts');
  const order = ['latin', 'cyrillic', 'cyrillic-ext', 'latin-ext'];
  const faces = fonts.map((font, index) => {
    const { subset, weight } = describeFont(font);
    const file = `inter-${subset}-${weight}-${index}.ttf`;
    writeFileSync(path.join(dir, file), font);
    return `@font-face{font-family:'Clutch Inter ${subset}';src:url('${file}') format('truetype');font-weight:${weight};font-style:normal}`;
  });
  const families = order.map((subset) => `'Clutch Inter ${subset}'`).join(',');
  writeFileSync(path.join(dir, 'fonts.css'), `${faces.join('\n')}\n:root{--font:${families},system-ui,sans-serif}\n`);
}

const stage = mkdtempSync(path.join(os.tmpdir(), 'clutch-share-cards-'));
try {
  for (const file of ['win.html', 'loss.html', 'tie.html', 'avatar.html', 'card.css', 'card.js']) {
    copyFileSync(path.join(here, file), path.join(stage, file));
  }
  stageFonts(stage);
  mkdirSync(outDir, { recursive: true });

  for (const card of CARDS) {
    const target = path.join(outDir, card.out);
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${path.join(stage, 'profile')}`,
      '--force-device-scale-factor=1',
      '--virtual-time-budget=3000',
      `--window-size=${card.width},${card.height}`,
      `--screenshot=${target}`,
      `${pathToFileURL(path.join(stage, card.source)).href}${card.query}`,
    ], { stdio: 'ignore' });
    console.log(`${card.out} — ${card.width}x${card.height}`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
