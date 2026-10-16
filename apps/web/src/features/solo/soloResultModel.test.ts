import { describe, expect, it } from 'vitest';
import type { CompleteSoloRunResponse } from '@clutch/shared';
import { buildSoloResult, parseSoloCompletion, soloEnd } from './soloResultModel';
import type { SoloRunView } from './soloRunSession';

function view(overrides: Partial<SoloRunView> = {}): SoloRunView {
  return {
    progress: 100, target: 100, round: 9, roundsPlayed: 9, roundsToCap: 11, questionsLeft: 15,
    completed: true, reachedTarget: true, paceProgress: null, ...overrides,
  };
}

function response(overrides: Partial<CompleteSoloRunResponse> = {}): CompleteSoloRunResponse {
  return {
    runId: 'run-1', rounds: [], progress: 100, correctCount: 8, roundsPlayed: 9, reachedTarget: true,
    par: 10, score: 0.9, outcome: 'player', ...overrides,
  };
}

describe('solo result: reached the target', () => {
  it('confirms the saved result without par, score or outcome', () => {
    const result = buildSoloResult({ view: view(), save: 'saved', response: response() });
    expect(result).toMatchObject({ end: 'target', reachedTarget: true, headline: 'Дошёл до 100%' });
    expect(result.summary).toBe('');
    expect(JSON.stringify(result)).not.toMatch(/эталон|par|score|ничья|побед/i);
  });

  it('does not claim the result is recorded before the server confirms it', () => {
    for (const save of ['saving', 'error'] as const) {
      const result = buildSoloResult({ view: view(), save, response: null });
      expect(result.reachedTarget).toBe(true);
      expect(result.summary).toBe('');
    }
  });

  it('says the same whatever the rival did', () => {
    const texts = [null, 'player', 'opponent', 'tie'].map((outcome) => buildSoloResult({
      view: view(), save: 'saved', response: response({ outcome: outcome as CompleteSoloRunResponse['outcome'] }),
    }).summary);
    expect(new Set(texts).size).toBe(1);
  });
});

describe('solo result: did not reach the target', () => {
  it('says so honestly at the round cap and shows the progress', () => {
    const capped = view({ progress: 64, roundsPlayed: 20, reachedTarget: false, roundsToCap: 0 });
    const result = buildSoloResult({ view: capped, save: 'saving', response: null });
    expect(result).toMatchObject({ end: 'cap', reachedTarget: false, headline: 'До 100% не дошёл', progress: 64 });
    expect(result.summary).toBe('Лимит забега — 20 кругов, и он закончился. Ты набрал 64% из 100%.');
    expect(result.headline).not.toMatch(/клатч|побед|дошёл до 100%/i);
    expect(result.summary).not.toContain('зафиксирован');
  });

  it('tells apart the end of the question set from the cap', () => {
    const exhausted = view({ progress: 30, roundsPlayed: 12, reachedTarget: false, questionsLeft: 0 });
    expect(soloEnd(exhausted)).toBe('exhausted');
    const result = buildSoloResult({ view: exhausted, save: 'saving', response: null });
    expect(result.summary).toBe('Вопросы этого набора закончились. Ты набрал 30% из 100%.');
  });

  it('takes the numbers from the server answer once saved', () => {
    const capped = view({ progress: 60, roundsPlayed: 20, reachedTarget: false });
    const saved = response({ progress: 62, roundsPlayed: 20, reachedTarget: false, outcome: 'opponent' });
    const result = buildSoloResult({ view: capped, save: 'saved', response: saved });
    expect(result.progress).toBe(62);
    expect(result.summary).not.toMatch(/лучше/);
  });
});

describe('solo completion answer', () => {
  it('accepts a coherent answer and rejects a foreign or broken one', () => {
    expect(parseSoloCompletion(response(), 'run-1')).not.toBeNull();
    expect(parseSoloCompletion(response({ outcome: null }), 'run-1')).not.toBeNull();
    expect(parseSoloCompletion(response(), 'run-2')).toBeNull();
    expect(parseSoloCompletion(response({ progress: 140 }), 'run-1')).toBeNull();
    expect(parseSoloCompletion(response({ par: 0 }), 'run-1')).toBeNull();
    expect(parseSoloCompletion({ ...response(), outcome: undefined }, 'run-1')).toBeNull();
    expect(parseSoloCompletion(null, 'run-1')).toBeNull();
  });
});
