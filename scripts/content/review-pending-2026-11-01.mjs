// Editorial decisions made on 2026-11-01. This script is intentionally explicit:
// it only touches the reviewed IDs and can be re-run without changing other content.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const REVIEWED = 'Проверено 2026-11-01: факт и единственность правильного варианта сверены по указанному источнику.';
const BLOCKED = new Map([
  ['au-body-1d86x18', 'Заблокировано 2026-11-01: вопрос смешивает орган и ткань; правильнее спрашивать о сетчатке, а не о «глазах».'],
  ['au-history-15crjqv', 'Заблокировано 2026-11-01: «недалеко» — субъективная формулировка, не годится для единственного ответа.'],
  ['au-history-k0jh6g', 'Заблокировано 2026-11-01: формулировка о политическом управлении Тибетом требует нейтральной исторической даты и точного источника.'],
  ['au-language-153sbpg', 'Заблокировано 2026-11-01: вопрос неоднозначен — заглавная лямбда Λ также имеет треугольную форму.'],
  ['au-language-rsxwyi', 'Заблокировано 2026-11-01: у Чада два официальных языка; один правильный ответ не задан.'],
  ['au-nature-10ffykx', 'Заблокировано 2026-11-01: орангутаны также живут в Малайзии; вопрос допускает несколько правильных ответов.'],
  ['au-science-pqhu3t', 'Заблокировано 2026-11-01: цианид-ион содержит и углерод, и азот; единственного ответа нет.'],
  ['au-science-1xkm3ep', 'Заблокировано 2026-11-01: цианид-ион содержит и азот, и углерод; единственного ответа нет.'],
  ['au-sport-p4kqt2', 'Заблокировано 2026-11-01: источник подтверждает популярность спорта, но не официальный статус «национального».'],
  ['au-sport-scp7uv', 'Заблокировано 2026-11-01: «больше всего олимпийских медалей» зависит от метода подсчёта и обновляемой статистики.'],
  ['au-world-1p6s818', 'Заблокировано 2026-11-01: «чаще всего говорят» требует статистической метрики; источник её не задаёт.'],
]);
const APPROVED = new Set([
  'au-space-sc1q4o',
  'au-world-1hw79pa',
  'au-world-pjdn2o',
]);

function hash(text) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.codePointAt(0), 16777619) >>> 0;
  return value;
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

function safeDistractors(id, answer, pool) {
  const candidates = [...new Set(pool.map(String))].filter((value) => value !== String(answer)).sort();
  const out = [];
  let value = hash(id);
  while (out.length < 3 && candidates.length) {
    const candidate = candidates.splice(value % candidates.length, 1)[0];
    if ([String(answer), ...out].every((item) => levenshtein(item.toLowerCase(), candidate.toLowerCase()) > 1)) out.push(candidate);
    value = hash(`${value}`);
  }
  if (out.length < 3) throw new Error(`${id}: не удалось подобрать три нечитаемо разные дистрактора.`);
  return out;
}

const questionsDirectory = path.join(ROOT, 'content', 'questions');
const science = JSON.parse(fs.readFileSync(path.join(questionsDirectory, 'science.json'), 'utf8'));
const numberPool = science.filter((record) => record.id.startsWith('wd-element-number-')).map((record) => String(record.answerRu));
const symbolPool = science.filter((record) => record.id.startsWith('wd-element-name-symbol-')).map((record) => String(record.answerRu));

let changed = 0;
for (const file of fs.readdirSync(questionsDirectory).filter((name) => name.endsWith('.json'))) {
  const fullPath = path.join(questionsDirectory, file);
  const records = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  let dirty = false;
  for (const record of records) {
    if (record.id.startsWith('wd-element-number-') || record.id.startsWith('wd-element-name-symbol-') || record.id.startsWith('wd-book-work-') || record.id.startsWith('wd-painting-work-')) {
      if (record.editorialStatus !== 'approved' || record.reviewNote !== REVIEWED) {
        record.editorialStatus = 'approved';
        record.reviewNote = REVIEWED;
        dirty = true;
        changed += 1;
      }
      if (record.id.startsWith('wd-element-number-')) {
        const distractorsRu = safeDistractors(record.id, record.answerRu, numberPool);
        if (JSON.stringify(record.distractorsRu) !== JSON.stringify(distractorsRu)) {
          record.distractorsRu = distractorsRu;
          dirty = true;
          changed += 1;
        }
      }
      if (record.id.startsWith('wd-element-name-symbol-')) {
        const distractorsRu = safeDistractors(record.id, record.answerRu, symbolPool);
        if (JSON.stringify(record.distractorsRu) !== JSON.stringify(distractorsRu)) {
          record.distractorsRu = distractorsRu;
          dirty = true;
          changed += 1;
        }
      }
      continue;
    }
    const reason = BLOCKED.get(record.id);
    if (reason && (record.editorialStatus !== 'blocked' || record.reviewNote !== reason)) {
      record.editorialStatus = 'blocked';
      record.reviewNote = reason;
      dirty = true;
      changed += 1;
      continue;
    }
    if (APPROVED.has(record.id) && (record.editorialStatus !== 'approved' || record.reviewNote !== REVIEWED)) {
      record.editorialStatus = 'approved';
      record.reviewNote = REVIEWED;
      dirty = true;
      changed += 1;
    }
  }
  if (dirty) fs.writeFileSync(fullPath, `${JSON.stringify(records, null, 2)}\n`);
}
console.log(`Редактура 2026-11-01: обновлено ${changed} записей.`);
