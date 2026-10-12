// Shared by the content scripts: read and append records in content/questions|sets/<topic>.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const TOPICS = [
  'science', 'space', 'nature', 'body', 'history', 'literature', 'art', 'music',
  'film', 'popculture', 'sport', 'food', 'math', 'language', 'tech', 'world',
];

const QUESTION_KEYS = ['id', 'editorialStatus', 'kind', 'topic', 'difficulty', 'promptRu', 'answerRu', 'acceptedRu', 'acceptedEn', 'distractorsRu', 'openAnswer', 'explanationRu', 'sourceUrl', 'sourceTitle', 'sourceHint', 'reviewNote', 'origin', 'license'];
const SET_KEYS = ['id', 'editorialStatus', 'kind', 'topic', 'titleRu', 'mcPromptRu', 'members', 'nonMembersRu', 'sourceUrl', 'sourceTitle', 'sourceHint', 'reviewNote', 'origin', 'license'];

export function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
}

/** Case, spaces, punctuation and «ё» folded: two prompts equal here are the same question. */
export function sameText(text) {
  return String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Canonical first, then aliases; every «ё» answer also accepted with «е». No duplicates. */
export function withVariants(answers) {
  const out = [];
  for (const a of answers) {
    const t = String(a).trim();
    for (const v of [t, t.replace(/ё/g, 'е').replace(/Ё/g, 'Е')]) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function fileOf(kind, topic) {
  if (!TOPICS.includes(topic)) throw new Error(`unknown topic «${topic}». Allowed: ${TOPICS.join(', ')}`);
  return path.join(ROOT, 'content', kind === 'set' ? 'sets' : 'questions', `${topic}.json`);
}

export function readTopic(kind, topic) {
  const file = fileOf(kind, topic);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

/** Drops empty optional fields and fixes the field order, so files stay uniform and diffs stay small. */
export function tidy(record) {
  const keys = record.kind === 'set' ? SET_KEYS : QUESTION_KEYS;
  const out = {};
  for (const k of keys) {
    const v = record[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && k === 'acceptedEn')) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Appends records to their topic files. Skips a record whose id or text (prompt / category title)
 * already exists. Never rewrites an existing record. Returns { added, skipped }.
 */
export function appendRecords(records) {
  const byFile = new Map();
  const added = [];
  const skipped = [];
  for (const record of records) {
    const key = `${record.kind}:${record.topic}`;
    if (!byFile.has(key)) byFile.set(key, readTopic(record.kind, record.topic));
    const list = byFile.get(key);
    const textOf = (r) => sameText(r.kind === 'set' ? r.titleRu : r.promptRu);
    const clash = list.find((r) => r.id === record.id || textOf(r) === textOf(record));
    if (clash) {
      skipped.push(`${record.id} — уже есть как ${clash.id}`);
      continue;
    }
    list.push(tidy(record));
    added.push(record.id);
  }
  for (const [key, list] of byFile) {
    const [kind, topic] = key.split(':');
    fs.writeFileSync(fileOf(kind, topic), JSON.stringify(list, null, 2) + '\n');
  }
  return { added, skipped };
}
