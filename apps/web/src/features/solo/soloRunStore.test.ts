import { afterEach, describe, expect, it } from 'vitest';
import { activeRunMatchesSelection, clearActiveSoloRun, loadActiveSoloRun, saveActiveSoloRun } from './soloRunStore';

const storage = new Map<string, string>();
const local = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });

afterEach(() => {
  clearActiveSoloRun();
  storage.clear();
});

describe('active solo run category', () => {
  it('persists the category and ignores another category after an explicit selection', () => {
    saveActiveSoloRun({ runId: 'old-run', practice: false, mode: 'duel', category: 'geography' });
    const stored = loadActiveSoloRun()!;
    expect(stored.category).toBe('geography');
    expect(activeRunMatchesSelection(stored, 'kz_history')).toBe(false);
    expect(activeRunMatchesSelection(stored, 'geography')).toBe(true);
  });

  it('does not let a legacy run without a category intercept an explicit category', () => {
    storage.set('clutch_solo_active_v1', JSON.stringify({ runId: 'legacy-run', practice: false, mode: 'daily' }));
    const stored = loadActiveSoloRun()!;
    expect(stored.category).toBeUndefined();
    expect(activeRunMatchesSelection(stored, 'kz_history')).toBe(false);
    expect(activeRunMatchesSelection(stored)).toBe(true);
  });
});
