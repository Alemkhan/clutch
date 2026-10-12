// Writes content/review/general-pack.csv for manual review (Excel / Google Sheets, «;» separated, UTF-8 BOM).
// Run: node --experimental-strip-types scripts/content/export-pack-review.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pack = path.join(root, 'packages/shared/src/generalPack');
const { authoredQuestions } = await import(pathToFileURL(path.join(pack, 'authored.ts')).href);
const { authoredSets } = await import(pathToFileURL(path.join(pack, 'sets.ts')).href);
const { wikidataQuestions, wikidataSets } = await import(pathToFileURL(path.join(pack, 'wikidata.generated.ts')).href);

const LEVEL_RU = { Easy: 'Лёгкий', Medium: 'Средний', Hard: 'Сложный', Expert: 'Эксперт' };
const ORIGIN_RU = { authored: 'написан для Clutch', wikidata: 'Wikidata (CC0)' };

const header = [
  'id', 'Тип', 'Тема', 'Сложность', 'Происхождение', 'Статус', 'Вопрос / категория', 'Ответ', 'Засчитывается при вводе',
  'Неверные варианты', 'Можно вводом', 'Источник', 'Где проверить', 'Заметка', 'Решение (approved / blocked)', 'Комментарий проверяющего',
];

const rows = [];
for (const q of [...authoredQuestions, ...wikidataQuestions]) {
  rows.push([
    q.id, 'вопрос', q.topic, LEVEL_RU[q.difficulty], ORIGIN_RU[q.origin], q.editorialStatus, q.promptRu, q.answerRu,
    [...q.acceptedRu, ...(q.acceptedEn ?? [])].join(' | '), q.distractorsRu.join(' | '), q.openAnswer ? 'да' : 'нет, только выбор',
    q.sourceUrl ?? '', q.sourceHint ?? '', q.reviewNote ?? '', '', '',
  ]);
}
for (const s of [...authoredSets, ...wikidataSets]) {
  rows.push([
    s.id, `набор (${s.members.length})`, s.topic, '', ORIGIN_RU[s.origin], s.editorialStatus, `${s.titleRu} / ${s.mcPromptRu}`,
    s.members.map((x) => x.answerRu).join(', '), s.members.map((x) => x.acceptedRu.join('/')).join(' | '),
    s.nonMembersRu.join(' | '), 'да', s.sourceUrl ?? '', s.sourceHint ?? '', s.reviewNote ?? '', '', '',
  ]);
}

const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
const out = path.join(root, 'content/review/general-pack.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, csv);
console.log(`${rows.length} rows → ${path.relative(root, out)}`);
