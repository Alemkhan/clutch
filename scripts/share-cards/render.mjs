// Пересборка карточек шаринга и аватарки бота из HTML-исходников рядом.
// Запуск из корня репозитория:
//   node scripts/share-cards/render.mjs
// Результат пишется в apps/web/public/share/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', '..', 'apps', 'web', 'public', 'share');

const CARDS = [
  { source: 'win.html', out: 'win.png', width: 1200, height: 630 },
  { source: 'loss.html', out: 'loss.png', width: 1200, height: 630 },
  { source: 'tie.html', out: 'tie.png', width: 1200, height: 630 },
  { source: 'avatar.html', out: 'bot-avatar.png', width: 512, height: 512 },
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

mkdirSync(outDir, { recursive: true });

for (const card of CARDS) {
  const source = path.join(here, card.source);
  const target = path.join(outDir, card.out);
  // Шрифт Inter подгружается с Google Fonts, поэтому нужен интернет и запас времени.
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--virtual-time-budget=6000',
    `--window-size=${card.width},${card.height}`,
    `--screenshot=${target}`,
    `file:///${source.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
  console.log(`${card.out} — ${card.width}x${card.height}`);
}
