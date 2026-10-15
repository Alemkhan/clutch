// Готовит SQL для заливки вопросов «На глазок» (R24d). Сам НИЧЕГО не выполняет в D1: печатает
// INSERT в stdout или пишет в файл, а применяет владелец:
//   npm run tiebreaker:load -- scripts/fixtures/tiebreaker-sample.json questions.sql
//   cd apps/api && npx wrangler d1 execute <DB> --local --file ../../questions.sql
// Вход: JSON-массив { id, prompt, cardPrompt?, unit, answer, sourceUrl, asOfDate, activeDate, explanation }.
// cardPrompt — короткая формулировка для карточки на главной (не длиннее CARD_PROMPT_MAX, как
// TIEBREAKER_CARD_PROMPT_MAX в shared); не задана — карточка покажет полный prompt.
// Колонка card_prompt появилась в миграции 0004: без неё заливка не применится.
//
// Проверка разбора продублирована из packages/shared/src/tiebreaker.ts (parseTiebreakerExplanation):
// shared — TypeScript, а .mjs без сборки его не импортирует. Совпадение правил держит
// tests/tiebreakerLoad.test.ts, который прогоняет оба валидатора на одних и тех же случаях.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_STEPS = 8;
const LIMITS = { label: 200, unit: 40, sourceUrl: 500, sourceTitle: 200, asOf: 40, summary: 400 };
const CARD_PROMPT_MAX = 90;
const STEP_KEYS = ['label', 'value', 'unit', 'sourceUrl', 'sourceTitle', 'asOf'];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function isHttpUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function text(source, key, max, where, allowEmpty = false) {
  const value = source[key];
  if (typeof value !== 'string') throw new RangeError(`${where}.${key} must be a string`);
  if (!allowEmpty && value.trim().length === 0) throw new RangeError(`${where}.${key} must not be empty`);
  if (value.length > max) throw new RangeError(`${where}.${key} is longer than ${max}`);
  return value;
}

/** Та же проверка, что parseTiebreakerExplanation в shared: чистая копия или RangeError. */
export function parseExplanation(input) {
  if (!isObject(input)) throw new RangeError('explanation must be an object');
  const extra = Object.keys(input).find((key) => key !== 'steps' && key !== 'summary');
  if (extra) throw new RangeError(`explanation has unknown field: ${extra}`);
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS) {
    throw new RangeError(`explanation.steps must have 1..${MAX_STEPS} items`);
  }
  const steps = input.steps.map((raw, index) => {
    const where = `steps[${index}]`;
    if (!isObject(raw)) throw new RangeError(`${where} must be an object`);
    const unknown = Object.keys(raw).find((key) => !STEP_KEYS.includes(key));
    if (unknown) throw new RangeError(`${where} has unknown field: ${unknown}`);
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      throw new RangeError(`${where}.value must be a finite number`);
    }
    const sourceUrl = text(raw, 'sourceUrl', LIMITS.sourceUrl, where);
    if (!isHttpUrl(sourceUrl)) throw new RangeError(`${where}.sourceUrl must be an http(s) URL`);
    const step = {
      label: text(raw, 'label', LIMITS.label, where),
      value: raw.value,
      unit: text(raw, 'unit', LIMITS.unit, where, true),
      sourceUrl,
      sourceTitle: text(raw, 'sourceTitle', LIMITS.sourceTitle, where),
    };
    if (raw.asOf !== undefined) step.asOf = text(raw, 'asOf', LIMITS.asOf, where);
    return step;
  });
  return { steps, summary: text(input, 'summary', LIMITS.summary, 'explanation') };
}

/** Вопрос целиком; бросает RangeError с указанием поля. */
export function parseQuestion(raw) {
  if (!isObject(raw)) throw new RangeError('question must be an object');
  const id = text(raw, 'id', 128, 'question');
  const prompt = text(raw, 'prompt', 1000, 'question');
  const cardPrompt = raw.cardPrompt === undefined || raw.cardPrompt === null
    ? null
    : text(raw, 'cardPrompt', CARD_PROMPT_MAX, 'question');
  const unit = text(raw, 'unit', LIMITS.unit, 'question', true);
  if (typeof raw.answer !== 'number' || !Number.isFinite(raw.answer) || raw.answer <= 0) {
    throw new RangeError('question.answer must be a finite number > 0');
  }
  const sourceUrl = text(raw, 'sourceUrl', LIMITS.sourceUrl, 'question');
  if (!isHttpUrl(sourceUrl)) throw new RangeError('question.sourceUrl must be an http(s) URL');
  const asOfDate = text(raw, 'asOfDate', LIMITS.asOf, 'question');
  const activeDate = text(raw, 'activeDate', 10, 'question');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activeDate)) throw new RangeError('question.activeDate must be YYYY-MM-DD');
  return { id, prompt, cardPrompt, unit, answer: raw.answer, sourceUrl, asOfDate, activeDate, explanation: parseExplanation(raw.explanation) };
}

/** SQL-литерал строки: апострофы удваиваются; NUL в SQL-тексте недопустим. */
export function sqlString(value) {
  if (value.includes('\0')) throw new RangeError('string contains a NUL character');
  return `'${value.replaceAll("'", "''")}'`;
}

/** Весь SQL для массива вопросов. Дубли id и activeDate внутри файла — ошибка. */
export function buildSql(questions, now = Date.now()) {
  if (!Array.isArray(questions) || questions.length === 0) throw new RangeError('input must be a non-empty array');
  const ids = new Set();
  const dates = new Set();
  const lines = questions.map((raw, index) => {
    let q;
    try {
      q = parseQuestion(raw);
    } catch (error) {
      throw new RangeError(`#${index + 1}: ${error.message}`);
    }
    if (ids.has(q.id)) throw new RangeError(`#${index + 1}: duplicate id ${q.id}`);
    if (dates.has(q.activeDate)) throw new RangeError(`#${index + 1}: duplicate activeDate ${q.activeDate}`);
    ids.add(q.id);
    dates.add(q.activeDate);
    const values = [
      sqlString(q.id), sqlString(q.prompt), q.cardPrompt === null ? 'NULL' : sqlString(q.cardPrompt), sqlString(q.unit), String(q.answer), sqlString(q.sourceUrl),
      sqlString(q.asOfDate), sqlString(q.activeDate), sqlString(JSON.stringify(q.explanation)), String(now),
    ];
    return 'INSERT INTO tiebreaker_questions '
      + '(id, prompt, card_prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at) '
      + `VALUES (${values.join(', ')});`;
  });
  return `${lines.join('\n')}\n`;
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('Укажи файл: npm run tiebreaker:load -- вопросы.json [результат.sql]');
    process.exit(1);
  }
  let sql;
  try {
    sql = buildSql(JSON.parse(fs.readFileSync(input, 'utf8')));
  } catch (error) {
    console.error(`Не удалось подготовить SQL: ${error.message}`);
    process.exit(1);
  }
  if (output) {
    fs.writeFileSync(output, sql, 'utf8');
    console.error(`SQL записан в ${output}. В базу ничего не залито: примени файл через wrangler d1 execute.`);
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
