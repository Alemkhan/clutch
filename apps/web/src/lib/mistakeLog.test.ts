import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MISTAKES,
  addCorrect,
  addMistake,
  loadMistakes,
  mistakeCount,
  pruneUnknownMistakes,
  recordCorrectAnswer,
  recordMistake,
  selectTrainingIds,
  type MistakeEntry,
} from './mistakeLog';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const entry = (id: string, count: number, lastAt: number): MistakeEntry => ({ id, category: 'geography', count, lastAt });

describe('mistake log (pure)', () => {
  it('adds a new mistake and counts repeats with the latest time', () => {
    let list = addMistake([], 'capital_li', 'geography', 100);
    expect(list).toEqual([entry('capital_li', 1, 100)]);
    list = addMistake(list, 'capital_li', 'geography', 200);
    expect(list).toEqual([entry('capital_li', 2, 200)]);
  });

  it('decreases on a correct answer and removes the entry at zero', () => {
    let list = [entry('a', 2, 1)];
    list = addCorrect(list, 'a');
    expect(list).toEqual([entry('a', 1, 1)]);
    expect(addCorrect(list, 'a')).toEqual([]);
    expect(addCorrect(list, 'other')).toEqual(list);
  });

  it('caps at 200 and evicts the entry with the oldest last mistake', () => {
    let list: MistakeEntry[] = [];
    for (let i = 0; i < MAX_MISTAKES; i++) list = addMistake(list, `capital_${i}`, 'geography', 1000 + i);
    // Make the first one recent: it must survive, the next oldest goes.
    list = addMistake(list, 'capital_0', 'geography', 5000);
    list = addMistake(list, 'new_one', 'geography', 6000);
    expect(list).toHaveLength(MAX_MISTAKES);
    expect(list.some((e) => e.id === 'capital_0')).toBe(true);
    expect(list.some((e) => e.id === 'capital_1')).toBe(false);
    expect(list.some((e) => e.id === 'new_one')).toBe(true);
  });

  it('orders training by count, then by freshness, up to 10', () => {
    const list = [
      entry('old_many', 3, 10),
      entry('fresh_one', 2, 90),
      entry('stale_one', 2, 20),
      entry('fresh_many', 3, 80),
      ...Array.from({ length: 12 }, (_, i) => entry(`x${i}`, 1, i)),
    ];
    const ids = selectTrainingIds(list);
    expect(ids).toHaveLength(10);
    expect(ids.slice(0, 4)).toEqual(['fresh_many', 'old_many', 'fresh_one', 'stale_one']);
  });
});

describe('mistake log (storage)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('persists a mistake and pays it back with a correct answer', () => {
    recordMistake('capital_li', 5);
    recordMistake('capital_li', 6);
    expect(loadMistakes()).toEqual([{ id: 'capital_li', category: 'geography', count: 2, lastAt: 6 }]);
    recordCorrectAnswer('capital_li');
    expect(loadMistakes()[0].count).toBe(1);
    recordCorrectAnswer('capital_li');
    expect(loadMistakes()).toEqual([]);
  });

  it('does not create entries from correct answers and ignores unrebuildable ids', () => {
    recordCorrectAnswer('capital_li');
    recordMistake('garbage');
    expect(loadMistakes()).toEqual([]);
  });

  it('drops stale ids on prune and does not count them', () => {
    localStorage.setItem('clutch_mistakes_v1', JSON.stringify([entry('capital_li', 1, 1), entry('gone_template_xx', 4, 2)]));
    expect(mistakeCount()).toBe(1);
    pruneUnknownMistakes();
    expect(loadMistakes().map((e) => e.id)).toEqual(['capital_li']);
  });

  it('survives corrupt data', () => {
    localStorage.setItem('clutch_mistakes_v1', '{not json');
    expect(loadMistakes()).toEqual([]);
    localStorage.setItem('clutch_mistakes_v1', JSON.stringify([{ id: 1 }, null, entry('capital_li', 0, 1), entry('capital_li', 1, 1)]));
    expect(loadMistakes()).toHaveLength(1);
  });

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    expect(loadMistakes()).toEqual([]);
    expect(mistakeCount()).toBe(0);
    expect(() => recordMistake('capital_li')).not.toThrow();
    expect(() => recordCorrectAnswer('capital_li')).not.toThrow();
    expect(() => pruneUnknownMistakes()).not.toThrow();
  });
});
