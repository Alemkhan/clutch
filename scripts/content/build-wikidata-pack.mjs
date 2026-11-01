// Collects questions from Wikidata (CC0) and appends the new ones to content/questions|sets/<topic>.json.
// Run: npm run content:wikidata [-- --refresh] [-- --approve]
// --refresh re-queries Wikidata instead of using scripts/content/wikidata-snapshot; new records are pending.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendRecords } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cacheDir = path.join(root, 'scripts/content/wikidata-snapshot');
fs.mkdirSync(cacheDir, { recursive: true });

async function sparql(name, query) {
  const cache = path.join(cacheDir, `${name}.json`);
  if (fs.existsSync(cache) && !process.argv.includes('--refresh')) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'ClutchContentBuilder/0.1' } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const rows = (await res.json()).results.bindings.map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value.replace('http://www.wikidata.org/entity/', '')])),
  );
  fs.writeFileSync(cache, JSON.stringify(rows, null, 1));
  return rows;
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

/** Three distinct wrong answers from the pool, deterministic per question id. */
function distractors(id, answer, pool) {
  const surname = (x) => x.trim().split(/s+/).pop().toLowerCase();
  // A wrong option sharing the answer's surname (Иоганн vs Рихард Штраус) would be a trap, not a question.
  const candidates = [...new Set(pool)].filter((p) => p !== answer && surname(p) !== surname(answer)).sort();
  const out = [];
  let h = hash(id);
  while (out.length < 3 && candidates.length) {
    const pick = candidates.splice(h % candidates.length, 1)[0];
    out.push(pick);
    h = hash(`${h}`);
  }
  if (out.length < 3) throw new Error(`not enough distractors for ${id}`);
  return out;
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    for (let j = 0; j < previous.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

/** Avoid one-character traps such as N/Nb and 100/103 in element-choice questions. */
function safeElementDistractors(id, answer, pool) {
  const candidates = [...new Set(pool.map(String))].filter((value) => value !== String(answer)).sort();
  const out = [];
  let h = hash(id);
  while (out.length < 3 && candidates.length) {
    const pick = candidates.splice(h % candidates.length, 1)[0];
    if ([String(answer), ...out].every((value) => levenshtein(value.toLowerCase(), pick.toLowerCase()) > 1)) out.push(pick);
    h = hash(`${h}`);
  }
  if (out.length < 3) throw new Error(`not enough safe element distractors for ${id}`);
  return out;
}

const PARTICLES = new Set(['да', 'де', 'ди', 'ван', 'фон', 'дер', 'ла', 'ле', 'дю', 'дель', 'Ван', 'Да', 'Де']);
/** Full label plus the surname-like tail, so «Толкин» or «Ван Гог» are accepted. */
function personAliases(label) {
  const clean = label.replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ');
  const set = new Set([clean]);
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    set.add(PARTICLES.has(prev) ? `${prev} ${last}` : last);
  }
  return [...set];
}

/** Quarter of the topic's list ordered by Wikipedia language editions: a rough fame proxy, the reviewer adjusts. */
function rankTier(index, total) {
  return ['Easy', 'Medium', 'Hard', 'Expert'][Math.min(3, Math.floor((index / total) * 4))];
}

const wd = (q) => `https://www.wikidata.org/wiki/${q}`;

/** One row per work; works with several credited people are dropped as ambiguous. */
function singleCredit(rows) {
  const byWork = new Map();
  for (const r of rows) {
    const list = byWork.get(r.w) ?? [];
    if (!list.some((x) => x.aRu === r.aRu)) list.push(r);
    byWork.set(r.w, list);
  }
  return [...byWork.values()].filter((l) => l.length === 1).map((l) => l[0]);
}

/** Keeps at most `max` works per credited person, the most linked first, so one author doesn't flood the pack. */
function capPerAnswer(rows, max = 2) {
  const count = new Map();
  return [...rows].sort((a, b) => b.sl - a.sl).filter((r) => {
    const n = (count.get(r.aRu) ?? 0) + 1;
    count.set(r.aRu, n);
    return n <= max;
  });
}

const records = [];

// ---------- Books → author ----------
const EXCLUDED_WORKS = new Set([
  'Q19786', 'Q9184', 'Q107388', 'Q39939', 'Q8258', // scripture, anonymous collections
]);
const books = capPerAnswer(singleCredit(
  await sparql(
    'books',
    `SELECT ?w ?wRu ?a ?aRu ?sl WHERE { ?w wdt:P31 wd:Q7725634; wdt:P50 ?a; wikibase:sitelinks ?sl. ?a wdt:P31 wd:Q5.
     FILTER(?sl > 70) ?w rdfs:label ?wRu FILTER(lang(?wRu)="ru") ?a rdfs:label ?aRu FILTER(lang(?aRu)="ru") }`,
  ),
).filter((r) => !EXCLUDED_WORKS.has(r.w) && !/Евангелие|Книга |[Пп]ослание|Библия|Откровение|Деяния|Моя борьба|Камасутра|Калевала|Песнь о Роланде/.test(r.wRu)));
const authorPool = books.map((r) => r.aRu);
for (const [i, r] of books.entries()) {
  const id = `wd-book-${r.w}`;
  records.push({
    id, topic: 'literature', difficulty: rankTier(i, books.length),
    promptRu: `Кто автор произведения «${r.wRu}»?`, answerRu: r.aRu, acceptedRu: personAliases(r.aRu),
    distractorsRu: distractors(id, r.aRu, authorPool), explanationRu: `«${r.wRu}» написал ${r.aRu}.`,
    sourceUrl: wd(r.w), sourceTitle: `Wikidata: ${r.wRu}`, openAnswer: false,
  });
}

// The reciprocal form gives the same sourced fact a different, unambiguous MC question.
// Distractors are deliberately works by other authors, so only one listed option can be right.
for (const [i, r] of books.entries()) {
  const id = `wd-book-work-${r.w}`;
  records.push({
    id, topic: 'literature', difficulty: rankTier(i, books.length),
    promptRu: `Какое из этих произведений написал ${r.aRu}?`, answerRu: r.wRu, acceptedRu: [r.wRu],
    distractorsRu: distractors(id, r.wRu, books.filter((other) => other.a !== r.a).map((other) => other.wRu)),
    explanationRu: `${r.aRu} — автор произведения «${r.wRu}».`,
    sourceUrl: wd(r.w), sourceTitle: `Wikidata: ${r.wRu}`, openAnswer: false,
  });
}

// ---------- Paintings → painter ----------
const paintings = capPerAnswer(singleCredit(
  await sparql(
    'paintings',
    `SELECT ?w ?wRu ?a ?aRu ?sl WHERE { ?w wdt:P31 wd:Q3305213; wdt:P170 ?a; wikibase:sitelinks ?sl. ?a wdt:P31 wd:Q5.
     FILTER(?sl > 38) ?w rdfs:label ?wRu FILTER(lang(?wRu)="ru") ?a rdfs:label ?aRu FILTER(lang(?aRu)="ru") }`,
  ),
).filter((r) => !/Происхождение мира/.test(r.wRu)));
const painterPool = paintings.map((r) => r.aRu);
for (const [i, r] of paintings.entries()) {
  const id = `wd-painting-${r.w}`;
  records.push({
    id, topic: 'art', difficulty: rankTier(i, paintings.length),
    promptRu: `Кто написал картину «${r.wRu}»?`, answerRu: r.aRu, acceptedRu: personAliases(r.aRu),
    distractorsRu: distractors(id, r.aRu, painterPool), explanationRu: `Автор картины «${r.wRu}» — ${r.aRu}.`,
    sourceUrl: wd(r.w), sourceTitle: `Wikidata: ${r.wRu}`, openAnswer: false,
  });
}

for (const [i, r] of paintings.entries()) {
  const id = `wd-painting-work-${r.w}`;
  records.push({
    id, topic: 'art', difficulty: rankTier(i, paintings.length),
    promptRu: `Какую из этих картин написал ${r.aRu}?`, answerRu: r.wRu, acceptedRu: [r.wRu],
    distractorsRu: distractors(id, r.wRu, paintings.filter((other) => other.a !== r.a).map((other) => other.wRu)),
    explanationRu: `${r.aRu} — автор картины «${r.wRu}».`,
    sourceUrl: wd(r.w), sourceTitle: `Wikidata: ${r.wRu}`, openAnswer: false,
  });
}

// ---------- Films → director ----------
const films = capPerAnswer(singleCredit(
  await sparql(
    'films',
    `SELECT ?w ?wRu ?a ?aRu ?sl WHERE { ?w wdt:P31 wd:Q11424; wdt:P57 ?a; wikibase:sitelinks ?sl.
     FILTER(?sl > 80) ?w rdfs:label ?wRu FILTER(lang(?wRu)="ru") ?a rdfs:label ?aRu FILTER(lang(?aRu)="ru") }`,
  ),
));
const directorPool = films.map((r) => r.aRu);
for (const [i, r] of films.entries()) {
  const id = `wd-film-${r.w}`;
  records.push({
    id, topic: 'film', difficulty: rankTier(i, films.length),
    promptRu: `Кто режиссёр фильма «${r.wRu}»?`, answerRu: r.aRu, acceptedRu: personAliases(r.aRu),
    distractorsRu: distractors(id, r.aRu, directorPool), explanationRu: `Режиссёр фильма «${r.wRu}» — ${r.aRu}.`,
    sourceUrl: wd(r.w), sourceTitle: `Wikidata: ${r.wRu}`, openAnswer: false,
  });
}

// ---------- Classical works → composer (composer born before 1900) ----------
const COMPOSERS = /Моцарт|Бетховен|Бах$|Вивальди|Чайковский|Верди|Пуччини|Вагнер|Бизе|Россини|Григ|Стравинский|Прокофьев|Орф|Шопен|Равель|Глинка|Мусоргский|Римский-Корсаков|Рахманинов|Брамс|Гендель|Гайдн|Дебюсси|Сен-Санс|Дворжак|Мендельсон|Штраус|Леонкавалло|Масканьи|Гершвин|Бородин|Шостакович/;
const FILM_TYPES = new Set(['Q11424', 'Q506240', 'Q24862', 'Q202866', 'Q5398426', 'Q24856']);
const musicRows = await sparql(
    'music',
    `SELECT ?w ?wRu ?a ?aRu ?sl ?type WHERE { ?w wdt:P86 ?a; wikibase:sitelinks ?sl. ?a wdt:P31 wd:Q5; wdt:P569 ?born. OPTIONAL { ?w wdt:P31 ?type }
     FILTER(YEAR(?born) < 1907) FILTER(?sl > 35)
     FILTER NOT EXISTS { ?w wdt:P31 wd:Q23691 } FILTER NOT EXISTS { ?w wdt:P31 wd:Q484692 }
     ?w rdfs:label ?wRu FILTER(lang(?wRu)="ru") ?a rdfs:label ?aRu FILTER(lang(?aRu)="ru") }`,
);
const filmWorks = new Set(musicRows.filter((r) => FILM_TYPES.has(r.type)).map((r) => r.w));
const music = capPerAnswer(
  singleCredit(musicRows.filter((r) => !filmWorks.has(r.w))).filter(
    (r) =>
      COMPOSERS.test(r.aRu) &&
      !/[Гг]имн|Интернационал|Марсельеза|Боже, храни|^Симфония №|^Концерт №|^Соната №|Времена года|[Рр]еквием|^Фантазия|Космическая одиссея/.test(r.wRu),
  ),
  3,
);
const composerPool = music.map((r) => r.aRu);
for (const [i, r] of music.entries()) {
  const id = `wd-music-${r.w}`;
  records.push({
    id, topic: 'music', difficulty: rankTier(i, music.length),
    promptRu: `Кто композитор произведения «${r.wRu}»?`, answerRu: r.aRu, acceptedRu: personAliases(r.aRu),
    distractorsRu: distractors(id, r.aRu, composerPool), explanationRu: `«${r.wRu}» написал ${r.aRu}.`,
    sourceUrl: wd(r.w), sourceTitle: `Wikidata: ${r.wRu}`, openAnswer: false,
  });
}

// ---------- Chemical elements ----------
const elements = await sparql(
  'elements',
  `SELECT ?el ?n ?sym ?ru WHERE { ?el wdt:P31 wd:Q11344; wdt:P1086 ?n; wdt:P246 ?sym.
   ?el rdfs:label ?ru FILTER(lang(?ru)="ru") } ORDER BY ?n`,
);
const ELEMENT_TIERS = {
  Easy: ['H', 'O', 'C', 'Fe', 'Au', 'Ag'],
  Medium: ['N', 'He', 'Na', 'Cu', 'Ca', 'K', 'Cl', 'Al', 'Zn', 'Hg', 'Pb', 'Sn', 'U'],
  Hard: ['Mg', 'Si', 'P', 'S', 'I', 'Ni', 'Ti', 'Ne', 'Ar', 'Pt', 'Li', 'F'],
  Expert: ['Cr', 'Co', 'Mn', 'W', 'Ra', 'Rn', 'Ba', 'Sr', 'Br', 'Kr', 'Xe', 'Pu'],
};
const uniqueElements = [...new Map(elements.filter((e) => +e.n <= 118).map((e) => [e.n, e])).values()];
const bySymbol = new Map(uniqueElements.map((e) => [e.sym, e]));
const elementNames = uniqueElements.filter((e) => +e.n <= 92).map((e) => e.ru);
for (const [difficulty, symbols] of Object.entries(ELEMENT_TIERS)) {
  for (const sym of symbols) {
    const e = bySymbol.get(sym);
    if (!e) throw new Error(`element ${sym} missing`);
    const id = `wd-element-${sym}`;
    const name = e.ru.toLowerCase();
    records.push({
      id, topic: 'science', difficulty,
      promptRu: `Какой химический элемент обозначается символом ${sym}?`, answerRu: name, acceptedRu: [name],
      distractorsRu: distractors(id, e.ru, elementNames).map((d) => d.toLowerCase()),
      explanationRu: `${sym} — ${name}, элемент номер ${e.n} в таблице Менделеева.`,
      sourceUrl: wd(e.el), sourceTitle: `Wikidata: ${e.ru}`,
    });
  }
}

// Symbols and atomic numbers are exact, stable properties of the element. They are choices,
// not short text entry, so a typo or a look-alike Latin letter cannot decide the round.
const elementNumbers = uniqueElements.map((e) => e.n);
const elementSymbols = uniqueElements.map((e) => e.sym);
for (const [i, e] of uniqueElements.entries()) {
  const difficulty = rankTier(i, uniqueElements.length);
  const name = e.ru.toLowerCase();
  const numberId = `wd-element-number-${e.n}`;
  records.push({
    id: numberId, topic: 'science', difficulty,
    promptRu: `Какой атомный номер у элемента «${name}»?`, answerRu: e.n, acceptedRu: [e.n],
    distractorsRu: safeElementDistractors(numberId, e.n, elementNumbers),
    explanationRu: `${name[0].toUpperCase()}${name.slice(1)} — элемент номер ${e.n} в таблице Менделеева.`,
    sourceUrl: wd(e.el), sourceTitle: `Wikidata: ${e.ru}`, openAnswer: false,
  });
  const symbolId = `wd-element-name-symbol-${e.sym}`;
  records.push({
    id: symbolId, topic: 'science', difficulty,
    promptRu: `Какой символ у химического элемента «${name}»?`, answerRu: e.sym, acceptedRu: [e.sym],
    distractorsRu: safeElementDistractors(symbolId, e.sym, elementSymbols),
    explanationRu: `Химический символ элемента «${name}» — ${e.sym}.`,
    sourceUrl: wd(e.el), sourceTitle: `Wikidata: ${e.ru}`, openAnswer: false,
  });
}

// Wide Last Stand set: every named element.
const elementSet = {
  id: 'set-chemical-elements', topic: 'science',
  titleRu: 'Назови химический элемент', mcPromptRu: 'Что из этого — химический элемент?',
  members: uniqueElements.map((e) => ({ id: e.sym, answerRu: e.ru.toLowerCase(), acceptedRu: [e.ru.toLowerCase()] })),
  nonMembersRu: ['стекло', 'бронза', 'сталь', 'вода', 'гранит', 'латунь', 'кварц', 'алмаз'],
  sourceUrl: 'https://www.wikidata.org/wiki/Q11344', sourceTitle: 'Wikidata: химический элемент',
};

// Existing records are never touched: an edited or blocked record stays as the editor left it.
const status = process.argv.includes('--approve') ? 'approved' : 'pending';
const result = appendRecords([
  ...records.map((r) => ({ kind: 'single', origin: 'wikidata', license: 'CC0', openAnswer: true, editorialStatus: status, ...r })),
  { kind: 'set', origin: 'wikidata', license: 'CC0', editorialStatus: status, ...elementSet },
]);
console.log(`Wikidata: найдено ${records.length} вопросов и набор из ${elementSet.members.length} элементов; добавлено новых ${result.added.length} (статус ${status}), уже были ${result.skipped.length}.`);
