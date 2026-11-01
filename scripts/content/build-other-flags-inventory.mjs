// Builds a review-only inventory for «Другие флаги» from Wikidata + Wikimedia Commons.
// It never changes the live historicFlags list. Run: npm run content:other-flags -- --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, 'content', 'other-flags', 'pending.json');
const WIKIDATA = 'https://query.wikidata.org/sparql';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

const ORGANISATIONS = ['Q1065', 'Q7184', 'Q458', 'Q8908', 'Q7809', 'Q7779', 'Q485207', 'Q47543', 'Q7785'];
const QUERIES = [
  ['us_state', `SELECT ?item ?itemLabel ?asset WHERE {
    ?item wdt:P31 wd:Q35657; wdt:P41 ?asset.
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
  }`],
  ['kazakhstan_city', `SELECT ?item ?itemLabel ?asset ?assetKind WHERE {
    ?item wdt:P17 wd:Q232; wdt:P31/wdt:P279* wd:Q515.
    { ?item wdt:P41 ?asset. BIND("flag" AS ?assetKind) }
    UNION { ?item wdt:P94 ?asset. BIND("coat_of_arms" AS ?assetKind) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
  }`],
  ['organisation', `SELECT ?item ?itemLabel ?asset WHERE {
    VALUES ?item { ${ORGANISATIONS.map((id) => `wd:${id}`).join(' ')} }
    ?item wdt:P41 ?asset.
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
  }`],
];

const ALLOWED_LICENSE = /^(?:CC0|PD(?:\b|[- ])|Public domain|CC BY(?:-SA)?)/i;
const MANUAL_LICENSE = /^Copyrighted free use$/i;

function itemId(value) {
  return String(value).replace(/^.*\//, '');
}

function fileName(asset) {
  const last = decodeURIComponent(String(asset).split('/').at(-1) ?? '');
  if (!last || /[^\p{L}\p{N} ._()'’,-]/u.test(last)) throw new Error(`Неподдерживаемое имя Commons-файла: ${asset}`);
  return last.replace(/ /g, '_');
}

export function displayLabel(labelRu, adoptedYear) {
  return adoptedYear ? `${labelRu} · ${adoptedYear}` : labelRu;
}

export function validateInventoryRecord(record) {
  const requiredText = ['id', 'group', 'labelRu', 'wikidataUrl', 'sourceTitle', 'sourceCheckedAt'];
  for (const key of requiredText) if (typeof record?.[key] !== 'string' || !record[key].trim()) throw new Error(`Нет поля ${key}.`);
  if (!['us_state', 'kazakhstan_city', 'organisation'].includes(record.group)) throw new Error('Неизвестная группа.');
  if (record.assetKind !== 'flag' && record.assetKind !== 'coat_of_arms') throw new Error('Неизвестный тип изображения.');
  if (record.adoptedYear !== null && (!Number.isInteger(record.adoptedYear) || record.adoptedYear < 1000 || record.adoptedYear > 2100)) {
    throw new Error('Год принятия должен быть числом или null.');
  }
  if (!['pending', 'approved_ready', 'blocked'].includes(record.reviewStatus)) throw new Error('Некорректный редакторский статус.');
  if (typeof record.reviewNote !== 'string' || !record.reviewNote.trim()) throw new Error('Нужна редакторская заметка.');
  if (record.adoptedYear === null && !record.reviewNote.includes('Год принятия не подтверждён первичным источником.')) {
    throw new Error('Для незаданного года нужна заметка о первичном источнике.');
  }
  const asset = record.asset;
  for (const key of ['fileName', 'url', 'pageUrl', 'license']) if (typeof asset?.[key] !== 'string' || !asset[key].trim()) throw new Error(`Нет asset.${key}.`);
  if (asset.author !== null && (typeof asset.author !== 'string' || !asset.author.trim())) throw new Error('Некорректен asset.author.');
  if (asset.author === null && asset.authorNote !== 'not stated on the Commons file page') throw new Error('Нужна пометка об отсутствующем авторе.');
  if (!asset.pageUrl.startsWith('https://commons.wikimedia.org/wiki/File:')) throw new Error('Нужна страница файла Wikimedia Commons.');
  const freelyReusable = ALLOWED_LICENSE.test(asset.license);
  if (!freelyReusable && !MANUAL_LICENSE.test(asset.license)) throw new Error(`Неподходящая лицензия: ${asset.license}`);
  if (freelyReusable !== (record.assetLicenseStatus === 'free')) throw new Error('Статус лицензии не совпадает с лицензией файла.');
  if (!freelyReusable && (record.reviewStatus !== 'blocked' || record.rightsNote !== 'Нужна отдельная проверка условий правообладателя.')) {
    throw new Error('Файл с copyrighted free use должен быть заблокирован до отдельной проверки.');
  }
  if (record.group === 'organisation' && record.trademarkReview !== 'required') throw new Error('Для организации нужна проверка товарного знака.');
  return true;
}

async function sparql(query) {
  const response = await fetch(`${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'ClutchContentBuilder/0.1' },
  });
  if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}`);
  return (await response.json()).results.bindings;
}

async function commonsAssets(names) {
  const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'imageinfo', titles: names.map((name) => `File:${name}`).join('|'), iiprop: 'url|extmetadata', iiurlwidth: '640' });
  const response = await fetch(`${COMMONS}?${params}`);
  if (!response.ok) throw new Error(`Commons: HTTP ${response.status}`);
  const results = new Map();
  for (const page of Object.values((await response.json()).query?.pages ?? {})) {
    const info = page?.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? meta.UsageTerms?.value ?? '';
    const author = String(meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim() || null;
    const name = String(page?.title ?? '').replace(/^File:/, '').replace(/ /g, '_');
    if (!info?.url || !license || (!ALLOWED_LICENSE.test(license) && !MANUAL_LICENSE.test(license)) || !name) continue;
    results.set(name, {
      fileName: name,
      url: info.thumburl ?? info.url,
      pageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name).replace(/%20/g, '_')}`,
      license,
      author,
      ...(author === null ? { authorNote: 'not stated on the Commons file page' } : {}),
    });
  }
  return results;
}

function recordFrom(group, row, asset) {
  const qid = itemId(row.item.value);
  const labelRu = row.itemLabel?.value?.trim();
  if (!labelRu) throw new Error(`${qid}: нет русской/английской подписи.`);
  const name = fileName(row.asset.value);
  const free = ALLOWED_LICENSE.test(asset.license);
  const yearNote = 'Год принятия не подтверждён первичным источником.';
  const review = group === 'organisation'
    ? { reviewStatus: 'blocked', reviewNote: `Нужны официальный источник флага и проверка товарного знака. ${yearNote}` }
    : free
      ? { reviewStatus: 'pending', reviewNote: `Media provenance проверен по Commons; нужен официальный источник символа и года. ${yearNote}` }
      : { reviewStatus: 'blocked', reviewNote: `Нужна отдельная проверка условий правообладателя. ${yearNote}` };
  return {
    id: `${group}:${qid}:${asset.fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    group,
    labelRu,
    adoptedYear: null,
    assetKind: row.assetKind?.value === 'coat_of_arms' ? 'coat_of_arms' : 'flag',
    wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
    sourceTitle: `Wikidata: ${labelRu}`,
    sourceCheckedAt: new Date().toISOString().slice(0, 10),
    asset,
    assetLicenseStatus: free ? 'free' : 'manual_review',
    ...(group === 'organisation' ? { trademarkReview: 'required' } : {}),
    ...(free ? {} : { rightsNote: 'Нужна отдельная проверка условий правообладателя.' }),
    ...review,
  };
}

export async function collectInventory() {
  const sourceRows = [];
  for (const [group, query] of QUERIES) {
    for (const row of await sparql(query)) sourceRows.push({ group, row });
  }
  const names = [...new Set(sourceRows.map(({ row }) => fileName(row.asset.value)))];
  const assets = new Map();
  for (let start = 0; start < names.length; start += 50) {
    const batch = await commonsAssets(names.slice(start, start + 50));
    for (const [name, asset] of batch) assets.set(name, asset);
    if (start + 50 < names.length) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const out = [];
  for (const { group, row } of sourceRows) {
    const asset = assets.get(fileName(row.asset.value));
    if (!asset) continue;
    try {
      const record = recordFrom(group, row, asset);
      validateInventoryRecord(record);
      out.push(record);
    } catch (error) {
      console.warn(`${group}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const unique = [...new Map(out.map((record) => [record.id, record])).values()];
  // More than one visual version of the same city emblem would create duplicate answer labels.
  // Keep all files for audit, but none of the competing versions can reach a future quiz until
  // an official municipal source identifies the current one.
  for (const entries of Object.values(Object.groupBy(unique, (record) => `${record.group}:${record.labelRu}:${record.assetKind}`))) {
    if (entries.length < 2) continue;
    for (const record of entries) {
      record.reviewStatus = 'blocked';
      record.reviewNote = `Есть несколько версий этого символа; текущая не подтверждена официальным источником. Год принятия не подтверждён первичным источником.`;
    }
  }
  unique.sort((a, b) => a.group.localeCompare(b.group) || a.labelRu.localeCompare(b.labelRu, 'ru'));
  return { version: 1, generatedAt: new Date().toISOString(), items: unique };
}

async function main() {
  const inventory = await collectInventory();
  const counts = Object.fromEntries(['us_state', 'kazakhstan_city', 'organisation'].map((group) => [group, inventory.items.filter((item) => item.group === group).length]));
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(`Сохранён pending-инвентарь: ${inventory.items.length} записей (${JSON.stringify(counts)}).`);
  } else {
    console.log(`Найдено ${inventory.items.length} pending-записей (${JSON.stringify(counts)}). Добавьте --write, чтобы сохранить.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
