/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it } from 'vitest';
import { createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

function setup(): TestD1 {
  const db = createTestD1();
  databases.push(db);
  return db;
}

type Row = Record<string, string | number>;

function addQuestion(db: TestD1, overrides: Row = {}) {
  const row = {
    id: 'q1', prompt: 'Сколько?', unit: '', answer: 100, source_url: 'https://example.org',
    as_of_date: '2026-01-01', active_date: '2026-10-15', explanation_json: '{"steps":[{"label":"шаг","value":1,"unit":"","sourceUrl":"https://example.org","sourceTitle":"Пример"}],"summary":"итог"}', created_at: 1, ...overrides,
  };
  db.sqlite.prepare(
    'INSERT INTO tiebreaker_questions (id, prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id as string, row.prompt as string, row.unit as string, row.answer as number, row.source_url as string,
    row.as_of_date as string, row.active_date as string, row.explanation_json as string, row.created_at as number);
}

function addAnswer(db: TestD1, overrides: Row = {}) {
  const row = { player_id: 'p1', question_id: 'q1', date_key: '2026-10-15', guess: 50, multiplier: 2, created_at: 1, ...overrides };
  db.sqlite.prepare(
    'INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(row.player_id as string, row.question_id as string, row.date_key as string, row.guess as number,
    row.multiplier as number, row.created_at as number);
}

describe('0003_tiebreaker schema', () => {
  it('is applied and accepts valid rows, including an empty unit', () => {
    const db = setup();
    addQuestion(db);
    addAnswer(db);
    expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tiebreaker_answers').get() as { c: number }).c).toBe(1);
  });

  it('one answer per player per question; another player may answer', () => {
    const db = setup();
    addQuestion(db);
    addAnswer(db);
    expect(() => addAnswer(db, { guess: 60 })).toThrow(/UNIQUE|PRIMARY KEY/i);
    addAnswer(db, { player_id: 'p2' });
  });

  it('one question per day', () => {
    const db = setup();
    addQuestion(db);
    expect(() => addQuestion(db, { id: 'q2' })).toThrow(/UNIQUE/i);
    addQuestion(db, { id: 'q2', active_date: '2026-10-16' });
  });

  it('CHECK constraints reject bad numbers and an empty source', () => {
    const db = setup();
    expect(() => addQuestion(db, { answer: 0 })).toThrow(/CHECK/i);
    expect(() => addQuestion(db, { answer: -3 })).toThrow(/CHECK/i);
    expect(() => addQuestion(db, { source_url: '' })).toThrow(/CHECK/i);
    expect(() => addQuestion(db, { explanation_json: '{битый' })).toThrow(/CHECK/i);
    expect(() => addQuestion(db, { explanation_json: null as unknown as string })).toThrow(/NOT NULL/i);
    addQuestion(db);
    expect(() => addAnswer(db, { guess: 0 })).toThrow(/CHECK/i);
    expect(() => addAnswer(db, { multiplier: 0.99 })).toThrow(/CHECK/i);
  });
});
