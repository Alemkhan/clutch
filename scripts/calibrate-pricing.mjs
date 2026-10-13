// Пересчёт калибровки цены вопроса по сыгранным кругам.
//
// `packages/shared/src/questionPricing.ts` считает пар набора из двух замеров:
//   CORRECT_RATE  — доля верных ответов по формату вопроса (выбор/ввод, текст/флаг/контур);
//   SKILL_SHARE   — распределение удара при верном ответе, отсюда средняя награда за ответ.
// Оба взяты из docs/PLAYTEST_01.md. SKILL_SHARE при этом замерен на **старом** молотке: до R5d
// зона идеального была 0.15, сейчас 0.06, то есть заложенная средняя награда завышена и пар
// занижен. Этот скрипт говорит, что показывают настоящие круги, и хватает ли их, чтобы верить.
//
// Он ничего не меняет: только печатает. Решение о правке константы — за владельцем.
//
// Запуск: node scripts/calibrate-pricing.mjs [путь-к-базе.sqlite]
// По умолчанию берётся локальная D1 из apps/api/.wrangler.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d1Directory = join(repositoryRoot, 'apps', 'api', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

/** Наименьшее число наблюдений, при котором доля вообще о чём-то говорит. */
const MIN_TAPS = 30;
const MIN_ANSWERS_PER_FORMAT = 20;

/** Заложено в questionPricing.ts — для сравнения. */
const CURRENT_CORRECT_RATE = {
  choice_text: 105 / 158,
  choice_flag: 77 / 135,
  choice_outline: 16 / 37,
  open_flag: 13 / 24,
  open_text: 9 / 19,
  open_outline: 0.5 / 17,
};
const CURRENT_SKILL_SHARE = { perfect: 0.6, great: 0.33, good: 0.04, weak: 0.01, miss: 0.02 };
const SKILL_REWARDS = { perfect: 25, great: 18, good: 12, weak: 5, miss: 0 };

function findDatabase() {
  const explicit = process.argv[2];
  if (explicit) return resolve(explicit);
  let entries;
  try {
    entries = readdirSync(d1Directory);
  } catch {
    return null;
  }
  const file = entries.find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  return file ? join(d1Directory, file) : null;
}

/** Та же классификация, что в questionFormat() из shared: источник правды там, здесь копия на две строки. */
function questionFormat(question) {
  const kind = question.answerType === 'open_answer' ? 'open' : 'choice';
  const media = question.mediaType === 'flag' || question.mediaType === 'outline' ? question.mediaType : 'text';
  return `${kind}_${media}`;
}

function parseQuestions(json) {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function meanReward(share) {
  return Object.entries(SKILL_REWARDS).reduce((sum, [tier, reward]) => sum + (share[tier] ?? 0) * reward, 0);
}

const path = findDatabase();
if (!path) {
  console.error('Локальная база D1 не найдена. Передай путь: node scripts/calibrate-pricing.mjs <файл.sqlite>');
  process.exit(2);
}

const db = new DatabaseSync(path, { readOnly: true });
let rounds;
try {
  rounds = db.prepare(`
    SELECT r.question_id, r.correct, r.skill_result, r.active_elapsed_ms, m.questions_json
    FROM solo_run_rounds r
    JOIN match_runs m ON m.id = r.run_id
    WHERE m.rules_version LIKE 'solo-%'
  `).all();
} catch (error) {
  console.error(`Не прочитать круги: ${error.message}`);
  process.exit(2);
}
db.close();

console.log(`База: ${path}`);
console.log(`Кругов соло в базе: ${rounds.length}\n`);

// --- Доля верных ответов по формату вопроса ---------------------------------

const byFormat = new Map();
for (const round of rounds) {
  const question = parseQuestions(round.questions_json).find((item) => item.id === round.question_id);
  if (!question) continue;
  const format = questionFormat(question);
  const bucket = byFormat.get(format) ?? { answers: 0, correct: 0 };
  bucket.answers += 1;
  if (round.correct === 1) bucket.correct += 1;
  byFormat.set(format, bucket);
}

console.log('Доля верных ответов по формату (CORRECT_RATE):');
if (byFormat.size === 0) {
  console.log('  нет данных');
} else {
  for (const [format, bucket] of [...byFormat.entries()].sort()) {
    const measured = bucket.correct / bucket.answers;
    const current = CURRENT_CORRECT_RATE[format];
    const enough = bucket.answers >= MIN_ANSWERS_PER_FORMAT;
    console.log(
      `  ${format.padEnd(14)} замер ${percent(measured).padStart(6)} (${bucket.correct}/${bucket.answers})`
      + `  заложено ${current === undefined ? '—' : percent(current).padStart(6)}`
      + `  ${enough ? '' : `← мало данных, нужно ${MIN_ANSWERS_PER_FORMAT}`}`,
    );
  }
}

// --- Распределение удара ----------------------------------------------------

// Только настоящие удары: у брошенного без удара круга момента нет, и промах ему поставил сервер.
const taps = rounds.filter((round) => round.correct === 1 && round.skill_result && round.active_elapsed_ms !== null);
const tiers = { perfect: 0, great: 0, good: 0, weak: 0, miss: 0 };
for (const tap of taps) tiers[tap.skill_result] = (tiers[tap.skill_result] ?? 0) + 1;

console.log('\nРаспределение удара при верном ответе (SKILL_SHARE):');
if (taps.length === 0) {
  console.log('  нет ни одного удара с записанным моментом: у кругов до миграции 0016 его нет,');
  console.log('  так что это распределение начинает набираться только с забегов после неё.');
} else {
  const measured = {};
  for (const tier of Object.keys(tiers)) {
    measured[tier] = tiers[tier] / taps.length;
    console.log(
      `  ${tier.padEnd(8)} замер ${percent(measured[tier]).padStart(6)} (${tiers[tier]}/${taps.length})`
      + `  заложено ${percent(CURRENT_SKILL_SHARE[tier]).padStart(6)}`,
    );
  }
  const measuredMean = meanReward(measured);
  const currentMean = meanReward(CURRENT_SKILL_SHARE);
  console.log(`\n  Средняя награда за верный ответ: замер ${measuredMean.toFixed(2)}, заложено ${currentMean.toFixed(2)}`);
  const drift = (measuredMean - currentMean) / currentMean;
  console.log(`  Расхождение: ${(drift * 100).toFixed(0)}% — настолько пар набора сейчас ${drift < 0 ? 'занижен' : 'завышен'}.`);
}

// --- Вердикт ----------------------------------------------------------------

const thinFormats = [...byFormat.entries()].filter(([, bucket]) => bucket.answers < MIN_ANSWERS_PER_FORMAT);
const ready = taps.length >= MIN_TAPS && byFormat.size > 0 && thinFormats.length === 0;
console.log('');
if (ready) {
  console.log('Данных достаточно: можно переносить замеренные значения в questionPricing.ts.');
} else {
  console.log('Данных НЕ достаточно, чтобы менять константы. Нужно больше живых забегов:');
  if (taps.length < MIN_TAPS) console.log(`  ударов ${taps.length}, нужно хотя бы ${MIN_TAPS};`);
  for (const [format, bucket] of thinFormats) {
    console.log(`  формат ${format}: ответов ${bucket.answers}, нужно хотя бы ${MIN_ANSWERS_PER_FORMAT};`);
  }
  console.log('До тех пор пар остаётся моделью, а не замером: это записано в CONTEXT и AUDIT.');
}
