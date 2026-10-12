// Adds questions and sets from a JSON file (for example NotebookLM output) to content/.
// Run: npm run content:import -- path/to/file.json [--approve]
// New records are «pending» and stay out of the game until approved (or pass --approve).

import fs from 'node:fs';
import { appendRecords, hash, withVariants } from './lib.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const approve = args.includes('--approve');
if (!file) {
  console.error('Укажи файл: npm run content:import -- путь/к/файлу.json [--approve]');
  process.exit(1);
}

// NotebookLM often wraps JSON in ```json fences or adds a line of text around it.
const raw = fs.readFileSync(file, 'utf8');
const start = raw.search(/[[{]/);
const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
let data;
try {
  data = JSON.parse(raw.slice(start, end + 1));
} catch (error) {
  console.error(`Не получилось прочитать JSON в ${file}: ${error.message}`);
  process.exit(1);
}
const items = Array.isArray(data) ? data : [data];

const status = approve ? 'approved' : 'pending';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || hash(String(s));
const errors = [];

const records = items.map((item, i) => {
  const where = `#${i + 1}`;
  const base = {
    editorialStatus: status,
    topic: item.topic,
    origin: item.origin ?? 'notebooklm',
    license: item.license ?? 'original',
    sourceUrl: item.sourceUrl,
    sourceTitle: item.sourceTitle,
    sourceHint: item.sourceHint,
    reviewNote: item.reviewNote,
  };
  if (item.kind === 'set') {
    if (!item.titleRu) errors.push(`${where}: нет titleRu`);
    return {
      ...base,
      kind: 'set',
      id: item.id ?? `set-${item.topic}-${hash(item.titleRu ?? where)}`,
      titleRu: item.titleRu,
      mcPromptRu: item.mcPromptRu,
      members: (item.members ?? []).map((m, j) => ({
        id: m.id ?? slug(m.answerRu ?? j),
        answerRu: m.answerRu,
        acceptedRu: withVariants([m.answerRu, ...(m.acceptedRu ?? [])]),
      })),
      nonMembersRu: item.nonMembersRu ?? [],
    };
  }
  if (!item.promptRu) errors.push(`${where}: нет promptRu`);
  return {
    ...base,
    kind: 'single',
    id: item.id ?? `q-${item.topic}-${hash(item.promptRu ?? where)}`,
    difficulty: item.difficulty,
    promptRu: item.promptRu,
    answerRu: item.answerRu,
    acceptedRu: withVariants([item.answerRu, ...(item.acceptedRu ?? [])]),
    acceptedEn: item.acceptedEn,
    distractorsRu: item.distractorsRu ?? [],
    openAnswer: item.openAnswer !== false,
    explanationRu: item.explanationRu,
  };
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

let result;
try {
  result = appendRecords(records);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`Добавлено: ${result.added.length} (статус ${status}).`);
if (result.skipped.length) console.log(`Пропущено как дубли: ${result.skipped.length}\n  ${result.skipped.join('\n  ')}`);
console.log('Дальше: npm run content:check');
