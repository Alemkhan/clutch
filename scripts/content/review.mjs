// Лист проверки: записи темы, которые ждут решения (pending), в читаемом виде.
// Запуск: npm run content:review -- kazakhstan → docs/content/review-kazakhstan.md
// Одобрить после проверки: npm run content:approve -- kazakhstan [--block id,id]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TOPICS, readTopic } from './lib.mjs';

const topic = process.argv[2];
if (!topic || !TOPICS.includes(topic)) {
  console.error(`Укажи тему: npm run content:review -- <тема>\nТемы: ${TOPICS.join(', ')}`);
  process.exit(1);
}

const pending = readTopic('single', topic).filter((r) => r.editorialStatus === 'pending');
const cell = (text) => String(text ?? '').replace(/\|/g, '\|').replace(/\n/g, ' ');
const lines = [
  `# Проверка: ${topic}`,
  '',
  `Ждут решения: ${pending.length}. Сверь вопрос, ответ и пояснение; неверные варианты не должны быть правильными.`,
  '«Ввод» — вопрос может прийти с открытым вводом; «СНГ» — идёт и в общие знания.',
  '',
  'Одобрить всё: `npm run content:approve -- ' + topic + '`',
  'Не пускать отдельные: `npm run content:approve -- ' + topic + ' --block id1,id2`',
  '',
  '| # | id | Сложн. | Вопрос | Ответ | Неверные | Ввод | СНГ | Пояснение | Где проверить |',
  '| ---: | --- | --- | --- | --- | --- | :---: | :---: | --- | --- |',
  ...pending.map((r, i) => `| ${i + 1} | \`${r.id}\` | ${r.difficulty} | ${cell(r.promptRu)} | **${cell(r.answerRu)}** | ${cell(r.distractorsRu.join(' · '))} | ${r.openAnswer ? 'да' : ''} | ${r.generalPool ? 'да' : ''} | ${cell(r.explanationRu)}${r.reviewNote ? ` _Заметка: ${cell(r.reviewNote)}_` : ''} | ${cell(r.sourceUrl ?? r.sourceHint)} |`),
  '',
];
const out = path.join(ROOT, 'docs', 'content', `review-${topic}.md`);
fs.writeFileSync(out, lines.join('\n'));
console.log(`${pending.length} записей → ${path.relative(ROOT, out)}`);
