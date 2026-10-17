// Records a real solo run for the promo: right answers, centred hammer strikes, timestamps.
// Needs `npm run dev`. Run from the repo root: npx vite-node promo/capture.ts
// Output: promo/public/run.mp4 (780x1688, 30 fps, from a Chrome screencast at device pixels) and
// promo/capture/events.json (seconds into that video). Playwright's recordVideo records CSS pixels
// only, so a 390-wide page came out soft and padded; the screencast keeps the 2x resolution.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { dailyQuestionBank } from '../packages/shared/src/dailyQuestionSet';
import type { Question } from '../packages/shared/src/index';

// CLUTCH_TAKE names the take (promo/public/<take>.mp4); CLUTCH_STRIKES lists strikes in order,
// e.g. "miss,perfect" — anything after the list is perfect.
const TAKE = process.env.CLUTCH_TAKE ?? 'run';
const STRIKES = (process.env.CLUTCH_STRIKES ?? '').split(',').filter(Boolean);
const OUT = path.resolve('promo/capture', TAKE);
const BASE = process.env.CLUTCH_URL ?? 'http://localhost:5173';
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

const bank: Question[] = (['general', 'geography', 'history', 'languages'] as const)
  .flatMap((c) => dailyQuestionBank(c).flatMap((set) => set.questions));

/** The day's set is deterministic, so the shown prompt and options identify the question. */
function answerFor(prompt: string, options: string[], media: string | null): { text: string; open: boolean } | null {
  const p = norm(prompt);
  const opts = options.map(norm).sort().join('|');
  const hit = bank.find((q) => {
    if (norm(q.prompt) !== p) return false;
    if (q.answerType === 'open_answer') return !q.mediaUrl || !media || media.includes(q.mediaUrl.split('/').pop() ?? '#');
    return q.options.map((o) => norm(o.text)).sort().join('|') === opts;
  });
  if (!hit) return null;
  if (hit.answerType === 'open_answer') return { text: hit.correctAnswers?.[0] ?? '', open: true };
  return { text: hit.options.find((o) => o.id === hit.correctOptionId)?.text ?? '', open: false };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
});
await context.addInitScript(() => {
  localStorage.setItem('clutch_hammer_intro_seen_v1', '1');
  localStorage.setItem('clutch_tower_intro_seen_v1', '1');
});
const page: Page = await context.newPage();
const FRAMES = path.join(OUT, 'frames');
fs.mkdirSync(FRAMES, { recursive: true });
const frames: { file: string; at: number }[] = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async (frame: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
  const file = path.join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(frame.data, 'base64'));
  frames.push({ file, at: frame.metadata.timestamp * 1000 });
  await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
const t0 = Date.now();
const events: { t: number; name: string; detail?: string }[] = [];
const mark = (name: string, detail?: string) => { events.push({ t: Date.now() - t0, name, detail }); console.log(Date.now() - t0, name, detail ?? ''); };
const wait = (ms: number) => page.waitForTimeout(ms);
const visible = (sel: string) => page.locator(sel).first().isVisible().catch(() => false);

await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(1200);
mark('home');

await page.getByRole('button', { name: /^Играть/ }).first().click();
await page.getByText('Мини-игра этой партии').waitFor({ timeout: 10000 });
mark('ready');
await wait(1500);
await page.getByRole('button', { name: /^Начать/ }).click();

let strikeIndex = 0;
for (let step = 0; step < 60; step++) {
  if (await visible('.solo-result')) { await wait(400); mark('result'); await wait(3500); break; }
  if (process.env.CLUTCH_MAX_STRIKES && strikeIndex >= Number(process.env.CLUTCH_MAX_STRIKES)) { await wait(2500); break; }

  if (await visible('.question-screen')) {
    await wait(300);
    mark('question');
    await wait(1100); // let the viewer read
    const prompt = (await page.locator('.question-prompt').first().innerText({ timeout: 2000 }).catch(() => '')).trim();
    const options = await page.locator('.options .option-text').allInnerTexts().catch(() => [] as string[]);
    const media = (await page.locator('.question-screen img').count()) > 0
      ? await page.locator('.question-screen img').first().getAttribute('src', { timeout: 1000 }).catch(() => null)
      : null;
    const answer = answerFor(prompt, options, media);
    if (await visible('.open-answer-input')) {
      await page.click('.open-answer-input');
      await page.keyboard.type(answer?.text ?? 'не знаю', { delay: 70 });
      await wait(300);
      mark('answer', answer?.text);
      await page.click('.open-answer-submit');
    } else {
      const index = answer ? options.findIndex((o) => norm(o) === norm(answer.text)) : 0;
      console.log('options', options, 'answer', answer?.text, 'index', index, 'buttons', await page.locator('.option-btn').count());
      await page.locator('.option-btn').nth(Math.max(0, index)).click({ timeout: 5000 }).catch(async (e) => { await page.screenshot({ path: path.join(OUT, 'fail.png') }); throw e; });
      mark('answer', answer?.text ?? 'unknown');
      if (await page.getByRole('button', { name: /^Ответить$/ }).isVisible().catch(() => false)) {
        await page.getByRole('button', { name: /^Ответить$/ }).click();
      }
    }
    await page.locator('.resolution-screen').waitFor({ timeout: 8000 }).catch(() => {});
    continue;
  }

  if (await visible('.resolution-screen')) {
    await wait(300);
    const right = /Верно/.test(await page.locator('.resolution-screen').innerText({ timeout: 1000 }).catch(() => ''));
    mark(right ? 'correct' : 'wrong');
    await wait(1600);
    await page.locator('.resolution-footer button, .resolution-action').last().click().catch(() => {});
    await wait(500);
    continue;
  }

  if ((await visible('.hammer-game')) || (await visible('.tower-game'))) {
    const tower = await visible('.tower-game');
    await page.locator(tower ? '.tower-moving' : '.hammer-track .marker').first().waitFor();
    mark(tower ? 'tower' : 'hammer');
    await wait(1400); // a moment of the marker running
    // Strike inside the page on the frame the marker is about to cross the centre of «perfect».
    const aimMiss = STRIKES[strikeIndex++] === 'miss';
    const pos = await page.evaluate(([isTower, miss]) => new Promise<number>((resolve) => {
      const game = document.querySelector<HTMLElement>(isTower ? '.tower-game' : '.hammer-game')!;
      const marker = document.querySelector<HTMLElement>(isTower ? '.tower-moving' : '.hammer-track .marker')!;
      let centre: number;
      if (isTower) {
        centre = parseFloat(document.querySelector<HTMLElement>('.tower-guide')!.style.left);
      } else {
        const zone = document.querySelector<HTMLElement>('.hammer-zone-perfect')!;
        centre = parseFloat(zone.style.left) + parseFloat(zone.style.width) / 2;
      }
      let prev: number | null = null;
      const tick = () => {
        const now = parseFloat(marker.style.left);
        if (prev !== null && miss) {
          // A clear miss: strike near the far end of the lane, moving away from the target.
          if (Math.abs(now - centre) > 45 && Math.abs(now - centre) > Math.abs(prev - centre)) { game.click(); resolve(now); return; }
        } else if (prev !== null) {
          const step = now - prev;
          const ahead = (centre - now) * Math.sign(step);
          if (step !== 0 && ahead >= 0 && ahead <= Math.abs(step) * 0.6) { game.click(); resolve(now); return; }
        }
        prev = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), [tower, aimMiss] as const);
    mark('strike', String(pos));
    await wait(700);
    const label = await page.locator('main').first().innerText({ timeout: 1000 }).catch(() => '');
    mark('strike-result', (/(ИДЕАЛЬНО|ОТЛИЧНО|ХОРОШО|СЛАБО|МИМО)/i.exec(label) ?? [''])[0]);
    await wait(2200);
    continue;
  }

  await wait(400);
}

await cdp.send('Page.stopScreencast').catch(() => {});
await context.close();
await browser.close();

// Frames arrive only when the screen changes: hold each one until the next to get real time.
const start = frames[0].at;
const slash = (file: string) => file.split(path.sep).join('/');
const list = frames.map((f, i) => {
  const next = frames[i + 1]?.at ?? f.at + 1000;
  return `file '${slash(f.file)}'\nduration ${((next - f.at) / 1000).toFixed(4)}`;
});
list.push(`file '${slash(frames[frames.length - 1].file)}'`);
const concat = path.join(OUT, 'frames.txt');
fs.writeFileSync(concat, list.join('\n'));
const mp4 = path.resolve(`promo/public/${TAKE}.mp4`);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
  '-vf', 'scale=780:1688:force_original_aspect_ratio=decrease,pad=780:1688,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', mp4]);
const offset = start - t0;
fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events.map((e) => ({ ...e, video: +((e.t - offset) / 1000).toFixed(2) })), null, 2));
console.log('frames', frames.length, 'saved', mp4);
