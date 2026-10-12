// Снимки экранов приложения на телефонном вьюпорте.
// Нужен запущенный `npm run dev`. Запуск из корня репозитория:
//   node scripts/screens.mjs            — все экраны в 390x844
//   node scripts/screens.mjs 360        — другая ширина
//   CLUTCH_REDUCED_MOTION=1 node scripts/screens.mjs — с prefers-reduced-motion
// Файлы кладутся в screenshots/ (каталог в .gitignore).
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.CLUTCH_URL || 'http://127.0.0.1:5173';
const WIDTH = Number(process.argv[2]) || 390;
const OUT = 'screenshots';

/** Экран: имя файла и клики, которые до него доводят. */
const SCREENS = [
  { name: 'home', steps: [] },
  { name: 'categories', steps: ['Играть'] },
  { name: 'solo-ready', steps: ['Играть', 'География'] },
  { name: 'my-runs', steps: ['Партии'] },
  { name: 'profile', steps: ['Профиль'] },
  { name: 'training', steps: ['Тренировка'] },
  { name: 'training-bots', steps: ['Тренировка', 'Игра против ботов'] },
  { name: 'training-bot-ready', steps: ['Тренировка', 'Игра против ботов', 'Опытный', 'География'] },
  { name: 'training-mistakes', steps: ['Тренировка', 'Отработка ошибок'] },
  { name: 'laststand', steps: ['Last Stand'] },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['Pixel 7'],
  viewport: { width: WIDTH, height: 844 },
  locale: 'ru-RU',
  reducedMotion: process.env.CLUTCH_REDUCED_MOTION ? 'reduce' : 'no-preference',
});

for (const screen of SCREENS) {
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    for (const step of screen.steps) {
      // Кнопки подписаны по-разному: часть текстом, часть только aria-label.
      const target = page.getByRole('button', { name: step }).first();
      await target.waitFor({ state: 'visible', timeout: 10000 });
      await target.click();
    }
    await page.waitForTimeout(900);
    const file = `${OUT}/${screen.name}-${WIDTH}.png`;
    await page.screenshot({ path: file });
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    console.log(
      `${screen.name.padEnd(12)} ${file}` + (overflow > 0 ? `  горизонтальная прокрутка: ${overflow}px` : ''),
    );
  } catch (error) {
    console.log(`${screen.name.padEnd(12)} НЕ СНЯТ: ${error.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

await browser.close();
