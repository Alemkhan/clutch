// Собирает переводы вопросов и гео-зоны в файлы, которые читает игра:
//   content/i18n/<locale>/pack.json  - { questions: {id: …}, sets: {id: …} }
//   content/i18n/regions.json        - { <recordId>: ["kz","cis","world"] }
//
//   npm run content:i18n            - собрать и проверить
//
// Источники пишут переводчики по темам: content/i18n/<locale>/questions/<topic>[.partN].json и
// content/i18n/<locale>/sets/<topic>.json; зоны - content/i18n/regions/<topic>.json.
// Проверки: перевод есть для каждой записи (иначе предупреждение - игра покажет русский текст),
// число неправильных вариантов совпадает с оригиналом, вариант не равен засчитываемому ответу.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTENT = path.join(ROOT, 'content');
const I18N = path.join(CONTENT, 'i18n');
const LOCALES = ['en', 'kk'];
const ZONES = ['kz', 'cis', 'world'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const listJson = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')) : []);
const topicOf = (name) => name.replace(/(\.part\d+)?\.json$/, '');
const norm = (text) => String(text).trim().toLowerCase().replace(/ё/g, 'е');

const source = { questions: new Map(), sets: new Map() };
for (const kind of ['questions', 'sets']) {
  for (const name of listJson(path.join(CONTENT, kind))) {
    for (const record of readJson(path.join(CONTENT, kind, name))) source[kind].set(record.id, record);
  }
}

const problems = [];
const warnings = [];

for (const locale of LOCALES) {
  const out = { questions: {}, sets: {} };
  for (const kind of ['questions', 'sets']) {
    for (const name of listJson(path.join(I18N, locale, kind))) {
      Object.assign(out[kind], readJson(path.join(I18N, locale, kind, name)));
    }
  }
  for (const [id, record] of source.questions) {
    const t = out.questions[id];
    if (!t) { warnings.push(`${locale}: нет перевода вопроса ${id}`); continue; }
    const distractors = record.distractorsRu ?? [];
    if ((t.distractors ?? []).length !== distractors.length) problems.push(`${locale}: ${id} - число вариантов ${t.distractors?.length} ≠ ${distractors.length}`);
    const accepted = new Set((t.accepted ?? []).map(norm));
    for (const option of t.distractors ?? []) if (accepted.has(norm(option))) problems.push(`${locale}: ${id} - вариант «${option}» совпадает с ответом`);
    if (!t.prompt || !t.answer) problems.push(`${locale}: ${id} - пустой текст вопроса или ответа`);
  }
  for (const [id, record] of source.sets) {
    const t = out.sets[id];
    if (!t) { warnings.push(`${locale}: нет перевода набора ${id}`); continue; }
    for (const member of record.members) if (!t.members?.[member.id]) problems.push(`${locale}: ${id} - нет участника ${member.id}`);
    if ((t.nonMembers ?? []).length !== record.nonMembersRu.length) problems.push(`${locale}: ${id} - число «не участников» не совпадает`);
  }
  // Лишние id (переводчик ошибся) не нужны в бандле.
  for (const kind of ['questions', 'sets']) {
    for (const id of Object.keys(out[kind])) if (!source[kind].has(id)) { delete out[kind][id]; warnings.push(`${locale}: лишний перевод ${id} пропущен`); }
  }
  fs.writeFileSync(path.join(I18N, locale, 'pack.json'), `${JSON.stringify(out)}\n`);
  console.log(`${locale}: вопросов ${Object.keys(out.questions).length}/${source.questions.size}, наборов ${Object.keys(out.sets).length}/${source.sets.size}`);
}

const regions = {};
for (const name of listJson(path.join(I18N, 'regions'))) Object.assign(regions, readJson(path.join(I18N, 'regions', name)));
for (const id of [...source.questions.keys(), ...source.sets.keys()]) {
  const zones = regions[id];
  if (!zones) { warnings.push(`зоны: нет разметки ${id} - считается доступным везде`); continue; }
  if (!Array.isArray(zones) || zones.length === 0 || zones.some((zone) => !ZONES.includes(zone))) problems.push(`зоны: ${id} - некорректно ${JSON.stringify(zones)}`);
}
const compact = Object.fromEntries(Object.entries(regions).filter(([id]) => source.questions.has(id) || source.sets.has(id)));
fs.writeFileSync(path.join(I18N, 'regions.json'), `${JSON.stringify(compact)}\n`);
const everywhere = Object.values(compact).filter((zones) => ZONES.every((zone) => zones.includes(zone))).length;
console.log(`зоны: размечено ${Object.keys(compact).length}, везде ${everywhere}`);

if (warnings.length) console.log(`Предупреждения (${warnings.length}):\n  ${warnings.slice(0, 20).join('\n  ')}${warnings.length > 20 ? '\n  …' : ''}`);
if (problems.length) {
  console.error(`Ошибки (${problems.length}):\n  ${problems.slice(0, 40).join('\n  ')}`);
  process.exitCode = 1;
}
