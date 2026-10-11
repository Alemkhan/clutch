import { describe, expect, it } from 'vitest';
import type { CompleteSoloRunResponse } from '@clutch/shared';
import { buildSoloResult, parseSoloCompletion, soloEnd } from './soloResult';
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
  it('explains rounds, par and score in plain words', () => {
    const result = buildSoloResult({ view: view(), save: 'saved', response: response(), paceName: 'Alex' });
    expect(result).toMatchObject({ end: 'target', reachedTarget: true, headline: 'Дошёл до 100%', score: '0,90', par: '10' });
    expect(result.summary).toContain('9 кругов');
    expect(result.scoreLine).toContain('Эталон для этого набора — 10 кругов');
    expect(result.scoreLine).toContain('быстрее эталонного игрока');
    expect(result.scoreLine).toContain('Чем меньше число, тем лучше');
    expect(result.scoreLine).toContain('1,00 — как эталонный игрок');
  });

  it('says "как эталонный игрок" at 1.0 and "медленнее" above it', () => {
    const same = buildSoloResult({ view: view({ roundsPlayed: 10 }), save: 'saved', response: response({ roundsPlayed: 10, score: 1 }), paceName: null });
    expect(same.scoreLine).toContain('это как эталонный игрок');
    const slow = buildSoloResult({ view: view({ roundsPlayed: 13 }), save: 'saved', response: response({ roundsPlayed: 13, score: 1.3 }), paceName: null });
    expect(slow.scoreLine).toContain('медленнее эталонного игрока');
  });

  it('shows no score before the server has counted it', () => {
    for (const save of ['saving', 'error'] as const) {
      const result = buildSoloResult({ view: view(), save, response: null, paceName: null });
      expect(result).toMatchObject({ reachedTarget: true, score: null, scoreLine: null, outcome: null });
    }
  });
});

describe('solo result: did not reach the target', () => {
  it('says so honestly at the round cap and shows the progress', () => {
    const capped = view({ progress: 64, roundsPlayed: 20, reachedTarget: false, roundsToCap: 0 });
    const result = buildSoloResult({ view: capped, save: 'saving', response: null, paceName: null });
    expect(result).toMatchObject({ end: 'cap', reachedTarget: false, headline: 'До 100% не дошёл', progress: 64 });
    expect(result.summary).toContain('Лимит забега — 20 кругов');
    expect(result.summary).toContain('64% из 100%');
    expect(result.headline).not.toMatch(/клатч|побед|дошёл до 100%/i);
    expect(result.score).toBeNull();
    expect(result.scoreLine).toBeNull();
  });

  it('tells apart the end of the question set from the cap', () => {
    const exhausted = view({ progress: 30, roundsPlayed: 12, reachedTarget: false, questionsLeft: 0 });
    expect(soloEnd(exhausted)).toBe('exhausted');
    const result = buildSoloResult({ view: exhausted, save: 'saving', response: null, paceName: null });
    expect(result.summary).toContain('Вопросы этого набора закончились');
  });

  it('takes the numbers from the server answer once saved', () => {
    const capped = view({ progress: 60, roundsPlayed: 20, reachedTarget: false });
    const saved = response({ progress: 62, roundsPlayed: 20, reachedTarget: false, outcome: 'opponent' });
    const result = buildSoloResult({ view: capped, save: 'saved', response: saved, paceName: 'Alex' });
    expect(result.progress).toBe(62);
    expect(result.outcome).toMatchObject({ kind: 'loss' });
  });
});

describe('solo result: outcome', () => {
  const outcomeOf = (outcome: CompleteSoloRunResponse['outcome']) =>
    buildSoloResult({ view: view(), save: 'saved', response: response({ outcome }), paceName: 'Alex' }).outcome!;

  it('null means waiting for the rival, and it is not a tie', () => {
    const waiting = outcomeOf(null);
    expect(waiting.kind).toBe('waiting');
    expect(waiting.text).toContain('Ждём результата соперника');
    expect(waiting.text).not.toMatch(/ничья с/i);
  });

  it("'tie' is a tie, and it is not waiting", () => {
    const tie = outcomeOf('tie');
    expect(tie.kind).toBe('tie');
    expect(tie.text).toContain('Ничья с Alex');
    expect(tie.text).not.toContain('Ждём');
  });

  it('names win and loss from the player point of view', () => {
    expect(outcomeOf('player')).toMatchObject({ kind: 'win', text: 'Ты прошёл набор лучше, чем Alex.' });
    expect(outcomeOf('opponent')).toMatchObject({ kind: 'loss', text: 'Alex прошёл этот набор лучше тебя.' });
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
