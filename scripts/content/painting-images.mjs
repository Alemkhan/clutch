// Картины к вопросам «Кто написал картину «…»?»: изображение (P18) из Wikidata, файл на Wikimedia
// Commons. На Commons лежат только свободные файлы и общественное достояние, поэтому картины под
// авторским правом (Пикассо, Дали) сюда не попадают сами. Запуск: npm run content:paintings
// Вопрос без Q-id в id ищется по названию картины среди элементов «картина» (Q3305213).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'content/questions/art.json');
const API = 'https://www.wikidata.org/w/api.php';
const HEADERS = { 'User-Agent': 'ClutchContentBuilder/0.1' };
const PAINTING = 'Q3305213';
const WIDTH = 640;

/**
 * Без картинки сознательно: обнажённая натура (игру открывают школьники, готовящиеся к ЕНТ)
 * и работы, на которые ещё действуют авторские права.
 */
const SKIP = new Set([
  'wd-painting-Q152867', // Маха обнажённая
  'wd-painting-Q737062', // Олимпия
  'wd-painting-Q727875', // Венера Урбинская
  'wd-painting-Q151047', // Рождение Венеры
  'wd-painting-Q152509', // Завтрак на траве
  'wd-painting-Q175036', // Герника (Пикассо)
  'wd-painting-Q25729', // Постоянство памяти (Дали)
  'wd-painting-Q321303', // Сад земных наслаждений: много обнажённых фигур
]);

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`Wikidata ${response.status}`);
  return response.json();
}

const titleOf = (prompt) => /«(.+)»\?$/u.exec(prompt)?.[1] ?? null;

/** Q-id из id записи либо первая «картина» с таким русским названием. */
async function qidFor(record) {
  const own = /-(Q\d+)$/u.exec(record.id)?.[1];
  if (own) return own;
  const title = titleOf(record.promptRu);
  if (!title) return null;
  const found = await api({ action: 'wbsearchentities', search: title, language: 'ru', uselang: 'ru', type: 'item', limit: '7' });
  const ids = (found.search ?? []).map((hit) => hit.id);
  if (ids.length === 0) return null;
  const entities = (await api({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims' })).entities;
  return ids.find((id) => (entities[id]?.claims?.P31 ?? []).some((c) => c.mainsnak?.datavalue?.value?.id === PAINTING)) ?? null;
}

const records = JSON.parse(fs.readFileSync(file, 'utf8'));
const targets = records.filter((r) => r.kind === 'single' && /^Кто написал картину/u.test(r.promptRu) && !SKIP.has(r.id));
const qids = new Map();
for (const record of targets) qids.set(record.id, await qidFor(record));

const wanted = [...new Set([...qids.values()].filter(Boolean))];
const images = new Map();
for (let i = 0; i < wanted.length; i += 40) {
  const { entities } = await api({ action: 'wbgetentities', ids: wanted.slice(i, i + 40).join('|'), props: 'claims' });
  for (const [id, entity] of Object.entries(entities)) {
    const fileName = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (fileName) images.set(id, fileName.replace(/ /gu, '_'));
  }
}

let added = 0;
const missing = [];
for (const record of records) {
  if (SKIP.has(record.id) && record.image) delete record.image;
  if (!targets.includes(record)) continue;
  const fileName = images.get(qids.get(record.id));
  if (!fileName) {
    missing.push(`${record.id} ${record.promptRu}`);
    continue;
  }
  const encoded = encodeURIComponent(fileName);
  record.image = {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${WIDTH}`,
    pageUrl: `https://commons.wikimedia.org/wiki/File:${encoded}`,
  };
  added += 1;
}
fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
console.log(`картины: ${added} из ${targets.length}; без картинки по решению: ${SKIP.size}`);
if (missing.length) console.log(`не нашлось:\n  ${missing.join('\n  ')}`);
