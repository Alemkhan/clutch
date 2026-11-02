// Downloads local working copies for manual text masking. They are not runtime assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INVENTORY_PATH = path.join(ROOT, 'content', 'other-flags', 'pending.json');
const ASSETS_DIR = path.join(ROOT, 'content', 'other-flags', 'assets');
const ORIGINAL_DIR = path.join(ASSETS_DIR, 'original');
const BLURRED_DIR = path.join(ASSETS_DIR, 'blurred');
const REVIEW_PATH = path.join(ASSETS_DIR, 'review.html');

function activeItems(inventory) {
  return inventory.items
    .filter((item) => item.group !== 'organisation' && item.assetLicenseStatus === 'free' && item.reviewStatus !== 'blocked' && !item.trademarkReview)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function extension(item) {
  return new URL(item.asset.url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? 'png';
}

function localName(item) {
  return `${item.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.${extension(item)}`;
}

function reviewHtml(items) {
  const cards = items.map((item) => ({
    name: localName(item),
    label: `${item.assetKind === 'coat_of_arms' ? 'Герб' : 'Флаг'} ${item.labelRu}`,
    group: item.group === 'kazakhstan_city' ? 'Города Казахстана' : 'Штаты США',
    source: item.asset.pageUrl,
    license: item.asset.license,
  }));
  const payload = JSON.stringify(cards).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clutch — ручной блюр символов</title>
<style>body{font:16px system-ui;margin:24px;background:#f5f2eb;color:#222}.note{color:#666;max-width:760px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}.card{background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 4px #0002}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.image{aspect-ratio:1.4;display:grid;place-items:center;background:#eee;border:1px solid #ddd;overflow:hidden}.image img{max-width:100%;max-height:100%;object-fit:contain}.missing{color:#777;text-align:center;padding:12px}.meta{font-size:13px;color:#666;margin-top:8px}.meta a{color:inherit}</style>
<h1>Другие флаги: до → после</h1><p class="note">Слева исходник с Commons. Сохрани обработанную копию с тем же именем в <code>blurred/</code>, затем обнови страницу. Не меняй пропорции изображения.</p><div class="grid" id="grid"></div>
<script>const cards=${payload};const grid=document.querySelector('#grid');for(const c of cards){const card=document.createElement('article');card.className='card';card.innerHTML='<strong>'+c.label+'</strong><div class="meta">'+c.group+'</div><div class="pair"><div class="image"><img alt="Исходник" src="original/'+c.name+'"></div><div class="image"><img alt="Обработанная версия" src="blurred/'+c.name+'"><span class="missing">После: положи файл<br><code>'+c.name+'</code></span></div></div><div class="meta"><a target="_blank" rel="noreferrer" href="'+c.source+'">Commons</a> · '+c.license+'</div>';const after=card.querySelectorAll('img')[1],missing=card.querySelector('.missing');after.addEventListener('load',()=>missing.remove());after.addEventListener('error',()=>after.remove());grid.append(card)}</script>`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function download(url, label) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': 'ClutchContentPrep/0.1' } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 429 && response.status < 500) throw new Error(`${label}: HTTP ${response.status}`);
    if (attempt === 3) throw new Error(`${label}: HTTP ${response.status} после повторных попыток`);
    await wait(1_000 * (attempt + 1));
  }
  throw new Error(`${label}: изображение не загружено.`);
}

async function main() {
  const write = process.argv.includes('--write');
  const waitForCommons = process.argv.includes('--wait-for-commons');
  const inventory = JSON.parse(await fs.readFile(INVENTORY_PATH, 'utf8'));
  const items = activeItems(inventory);
  if (!write) return console.log(`Будет подготовлено ${items.length} рабочих изображений. Добавьте --write.`);
  await fs.mkdir(ORIGINAL_DIR, { recursive: true });
  await fs.mkdir(BLURRED_DIR, { recursive: true });
  let downloaded = 0;
  const failures = [];
  for (const item of items) {
    const destination = path.join(ORIGINAL_DIR, localName(item));
    try { await fs.access(destination); continue; } catch {}
    for (;;) {
      try {
        await fs.writeFile(destination, await download(item.asset.url, item.labelRu));
        downloaded += 1;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A 429 applies to the whole thumbnail origin. In interactive mode stop; in the
        // background collector wait a full minute and resume the same file politely.
        if (message.includes('HTTP 429') && waitForCommons) {
          console.warn(`Commons ограничил выдачу на «${item.labelRu}»; пауза 60 секунд…`);
          await wait(60_000);
          continue;
        }
        failures.push(`${item.labelRu}: ${message}`);
        break;
      }
    }
    if (failures.length) break;
    // Commons throttles bursts of thumbnail requests; keep this polite and resumable.
    await wait(1_000);
  }
  await fs.writeFile(REVIEW_PATH, reviewHtml(items));
  console.log(`Готово: ${items.length} карточек, скачано ${downloaded}; открой ${REVIEW_PATH}.`);
  if (failures.length) console.warn(`Commons ограничил выдачу: ${failures.length}. Повторный запуск продолжит с пропущенных.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
