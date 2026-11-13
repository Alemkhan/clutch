// Publishes the manually masked «Другие флаги» images as runtime assets.
//
//   npm run content:other-flags:publish
//
// Reads content/other-flags/assets/{original,blurred}/ (ignored working copies, see
// prepare-other-flags-assets.mjs), shrinks every blurred file to WebP in
// apps/web/public/flags-other/ and writes content/other-flags/published.json.
// File names are hashes of the inventory id, so the URL does not spell the answer.
// `masked: true` means the blurred copy differs from the original: the answer screen
// then reveals the original Commons image.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INVENTORY_PATH = path.join(ROOT, 'content', 'other-flags', 'pending.json');
const ASSETS_DIR = path.join(ROOT, 'content', 'other-flags', 'assets');
const OUT_DIR = path.join(ROOT, 'apps', 'web', 'public', 'flags-other');
const MANIFEST_PATH = path.join(ROOT, 'content', 'other-flags', 'published.json');
const MAX_SIDE = 480;

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Нужен пакет sharp: npm install --no-save sharp');
  process.exit(1);
}

function activeItems(inventory) {
  return inventory.items
    .filter((item) => item.group !== 'organisation' && item.assetLicenseStatus === 'free' && item.reviewStatus !== 'blocked' && !item.trademarkReview)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Same naming as prepare-other-flags-assets.mjs: the working copies are keyed by it.
function localName(item) {
  const ext = new URL(item.asset.url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? 'png';
  return `${item.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.${ext}`;
}

async function readOrNull(file) {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

const inventory = JSON.parse(await fs.readFile(INVENTORY_PATH, 'utf8'));
await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

const manifest = {};
const missing = [];
for (const item of activeItems(inventory)) {
  const name = localName(item);
  const blurred = await readOrNull(path.join(ASSETS_DIR, 'blurred', name));
  const original = await readOrNull(path.join(ASSETS_DIR, 'original', name));
  if (!blurred) {
    missing.push(item.id);
    continue;
  }
  const file = `${crypto.createHash('sha256').update(item.id).digest('hex').slice(0, 16)}.webp`;
  // GIF frames and transparency are kept as a still WebP; flags never need animation.
  await sharp(blurred, { animated: false })
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(path.join(OUT_DIR, file));
  manifest[item.id] = { file, masked: !original || !original.equals(blurred) };
}

await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
const masked = Object.values(manifest).filter((entry) => entry.masked).length;
console.log(`Опубликовано: ${Object.keys(manifest).length} (с блюром: ${masked}) → ${path.relative(ROOT, OUT_DIR)}`);
if (missing.length) console.log(`Без обработанной копии (останется картинка Commons): ${missing.join(', ')}`);
