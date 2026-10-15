/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTiebreakerExplanation } from '@clutch/shared';
// @ts-expect-error — .mjs без деклараций типов
import { buildSql, parseExplanation, sqlString } from '../scripts/tiebreaker-load.mjs';
import { createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

const sample = JSON.parse(readFileSync('scripts/fixtures/tiebreaker-sample.json', 'utf8'));

function question(overrides: Record<string, unknown> = {}) {
  return { ...sample[0], ...overrides };
}

describe('tiebreaker-load', () => {
  it('turns the sample file into SQL that the real schema accepts', () => {
    const db = createTestD1();
    databases.push(db);
    const sql = buildSql(sample, 1234) as string;
    expect(sql).toMatch(/^INSERT INTO tiebreaker_questions /);
    db.sqlite.exec(sql);
    const row = db.sqlite.prepare('SELECT * FROM tiebreaker_questions').get() as Record<string, unknown>;
    expect(row).toMatchObject({ id: 'sample-test-1', answer: 24, active_date: '2099-01-01', created_at: 1234 });
    expect(parseTiebreakerExplanation(JSON.parse(row.explanation_json as string))).toEqual(sample[0].explanation);
  });

  it('escapes quotes, apostrophes, semicolons and newlines so the text round-trips', () => {
    const nasty = `О'Брайен "сказал"; DROP TABLE tiebreaker_questions; --\nвторая строка ''`;
    const db = createTestD1();
    databases.push(db);
    const q = question({
      prompt: nasty,
      explanation: { ...sample[0].explanation, summary: nasty, steps: [{ ...sample[0].explanation.steps[0], label: nasty }] },
    });
    db.sqlite.exec(buildSql([q]) as string);
    const row = db.sqlite.prepare('SELECT prompt, explanation_json FROM tiebreaker_questions').get() as Record<string, string>;
    expect(row.prompt).toBe(nasty);
    const explanation = JSON.parse(row.explanation_json);
    expect(explanation.summary).toBe(nasty);
    expect(explanation.steps[0].label).toBe(nasty);
    expect(sqlString("a'b")).toBe("'a''b'");
    expect(() => sqlString('a\0b')).toThrow(RangeError);
  });

  it('refuses invalid records and duplicates, naming the record', () => {
    expect(() => buildSql([])).toThrow(RangeError);
    expect(() => buildSql([question({ answer: 0 })])).toThrow(/#1.*answer/);
    expect(() => buildSql([question({ sourceUrl: 'javascript:alert(1)' })])).toThrow(/sourceUrl/);
    expect(() => buildSql([question({ activeDate: '15.10.2026' })])).toThrow(/activeDate/);
    expect(() => buildSql([question({ explanation: { steps: [], summary: 'x' } })])).toThrow(/steps/);
    expect(() => buildSql([question(), question()])).toThrow(/#2.*duplicate id/);
    expect(() => buildSql([question(), question({ id: 'other' })])).toThrow(/duplicate activeDate/);
  });

  it('applies the same explanation rules as the shared validator', () => {
    const step = sample[0].explanation.steps[0];
    const cases: unknown[] = [
      sample[0].explanation,
      { steps: [], summary: 'x' },
      { steps: [step], summary: '' },
      { steps: [step], summary: 'я'.repeat(401) },
      { steps: [step], summary: 'я'.repeat(400) },
      { steps: [step], summary: 'x', extra: 1 },
      { steps: [{ ...step, extra: 1 }], summary: 'x' },
      { steps: [{ ...step, value: Number.NaN }], summary: 'x' },
      { steps: [{ ...step, value: '5' }], summary: 'x' },
      { steps: [{ ...step, sourceUrl: 'ftp://example.org' }], summary: 'x' },
      { steps: [{ ...step, sourceUrl: 'http://example.org' }], summary: 'x' },
      { steps: [{ ...step, label: 'я'.repeat(201) }], summary: 'x' },
      { steps: [{ ...step, unit: '' }], summary: 'x' },
      { steps: [{ ...step, asOf: 5 }], summary: 'x' },
      { steps: Array.from({ length: 8 }, () => step), summary: 'x' },
      { steps: Array.from({ length: 9 }, () => step), summary: 'x' },
      null,
      [],
    ];
    for (const input of cases) {
      const shared = (() => { try { return parseTiebreakerExplanation(input); } catch { return 'error'; } })();
      const script = (() => { try { return parseExplanation(input); } catch { return 'error'; } })();
      expect(script).toEqual(shared);
    }
  });
});
