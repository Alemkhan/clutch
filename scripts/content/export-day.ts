// Prints every question of a game day with its answer, to read before filming or a release.
// Run: npm run content:day -- 2026-10-18 [general|geography|history|languages]
// Writes content/review/day-<date>-<category>.md (git-ignored). The day starts at midnight in Almaty.
import fs from 'node:fs';
import path from 'node:path';
import { dailyQuestionBank, dayStartMs } from '../../packages/shared/src/dailyQuestionSet';
import type { CategoryId, Question } from '../../packages/shared/src/index';

const CATEGORIES: CategoryId[] = ['general', 'geography', 'history', 'languages'];
const [dateArg, categoryArg] = process.argv.slice(2);
const date = dateArg ?? new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const category = (categoryArg ?? 'general') as CategoryId;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !CATEGORIES.includes(category)) {
  console.error('Usage: npm run content:day -- YYYY-MM-DD [general|geography|history|languages]');
  process.exit(1);
}

/** `gp:<pack id>:<mode>` → pack record id that takes `editorialStatus: "blocked"`. */
function packId(question: Question): string | null {
  const match = /^gp:([^:]+):/.exec(question.id);
  return match ? match[1] : null;
}

function answerOf(question: Question): string {
  if (question.answerType === 'open_answer') return (question.correctAnswers ?? []).join(' / ');
  return question.options.find((option) => option.id === question.correctOptionId)?.text ?? '?';
}

const bank = dailyQuestionBank(category, dayStartMs(date) + 60_000);
const lines: string[] = [
  `# Вопросы дня ${date} · ${category}`,
  '',
  'Плохой вопрос: найди его `id` в content/questions/*.json (или content/sets/*.json) и поставь',
  '`"editorialStatus": "blocked"`, затем `npm run content:check`. Вопросы без id пакета — из',
  'генераторов (география, флаги, языки): о них напиши, они правятся в данных стран.',
  '',
];
const seen = new Set<string>();
for (const set of bank) {
  lines.push(`## Набор ${set.questionSetId}`, '');
  set.questions.forEach((question, index) => {
    const id = packId(question);
    const repeat = seen.has(question.id) ? ' (повтор)' : '';
    seen.add(question.id);
    const mode = question.answerType === 'open_answer' ? 'ввод' : 'выбор';
    const wrong = question.answerType === 'open_answer'
      ? ''
      : ` · неверные: ${question.options.filter((o) => o.id !== question.correctOptionId).map((o) => o.text).join(', ')}`;
    const media = question.mediaText ? ` «${question.mediaText}»` : question.mediaUrl ? ' [картинка]' : '';
    lines.push(`${index + 1}. ${question.prompt}${media}`);
    lines.push(`   **${answerOf(question)}** · ${mode}${wrong}`);
    lines.push(`   ${question.subcategory ?? question.category} · ${question.difficulty} · ${id ? `id \`${id}\`` : 'генератор'}${repeat}`);
  });
  lines.push('');
}

const out = path.resolve('content/review', `day-${date}-${category}.md`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n'));
console.log(`${bank.length} наборов, ${seen.size} разных вопросов → ${path.relative(process.cwd(), out)}`);
