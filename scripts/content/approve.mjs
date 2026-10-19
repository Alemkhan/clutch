// Одобряет записи темы, которые ждут проверки (pending → approved), одной командой.
// Запуск: npm run content:approve -- kazakhstan [--block id1,id2] [--except id3]
//   --block  — эти записи в игру не пускать (blocked): факт неверен или вопрос плохой;
//   --except — оставить pending, вернуться к ним позже.
// Одобренные и заблокированные раньше записи не трогаются. Дальше: npm run content:check
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TOPICS } from './lib.mjs';

const args = process.argv.slice(2);
const topic = args.find((a) => !a.startsWith('--'));
const list = (flag) => {
  const at = args.indexOf(flag);
  return new Set(at >= 0 && args[at + 1] ? args[at + 1].split(',').map((id) => id.trim()).filter(Boolean) : []);
};
const block = list('--block');
const except = list('--except');
if (!topic || !TOPICS.includes(topic)) {
  console.error(`Укажи тему: npm run content:approve -- <тема> [--block id,id] [--except id,id]\nТемы: ${TOPICS.join(', ')}`);
  process.exit(1);
}

const counts = { approved: 0, blocked: 0, kept: 0 };
const known = new Set();
for (const kind of ['questions', 'sets']) {
  const file = path.join(ROOT, 'content', kind, `${topic}.json`);
  if (!fs.existsSync(file)) continue;
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const record of records) {
    known.add(record.id);
    if (record.editorialStatus !== 'pending') continue;
    if (block.has(record.id)) {
      record.editorialStatus = 'blocked';
      counts.blocked += 1;
    } else if (except.has(record.id)) {
      counts.kept += 1;
    } else {
      record.editorialStatus = 'approved';
      counts.approved += 1;
    }
  }
  fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
}

const unknown = [...block, ...except].filter((id) => !known.has(id));
if (unknown.length) console.warn(`Нет таких id в теме ${topic}: ${unknown.join(', ')}`);
console.log(`${topic}: одобрено ${counts.approved}, заблокировано ${counts.blocked}, оставлено на потом ${counts.kept}.`);
console.log('Дальше: npm run content:check');
