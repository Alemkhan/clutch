import { describe, expect, it } from 'vitest';
import {
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  generateMatch,
  type StartSoloRunResponse,
} from '@clutch/shared';
import { normalizeSoloRun } from './clientMatchRules';

const questions = generateMatch(12, 0, 'geography');

function response(overrides: Partial<StartSoloRunResponse> = {}): StartSoloRunResponse {
  return {
    runId: 'run-1', questions, pace: null, target: SOLO_TARGET_PROGRESS, roundCap: SOLO_ROUND_CAP,
    rulesVersion: 'solo-to-100-v1', bankExhausted: false, ...overrides,
  };
}

const paceRound = (index: number, progressAwarded = 12) => (
  { questionId: questions[index].id, correct: true, responseTimeMs: 2000, skillScore: 0.5, progressAwarded }
);

describe('normalizeSoloRun in practice', () => {
  const bot = { id: 'clutch_bot_medium', displayName: 'Max', rounds: [paceRound(0, 25)] };

  it('accepts only the practice rules, and only for a practice run', () => {
    const practice = response({ rulesVersion: 'solo-practice-v1', pace: bot });
    expect(normalizeSoloRun(practice, true).pace).toEqual(bot);
    expect(() => normalizeSoloRun(practice)).toThrow();
    expect(() => normalizeSoloRun(response({ pace: bot }), true)).toThrow();
  });

  it('does not run a practice without a usable bot', () => {
    expect(() => normalizeSoloRun(response({ rulesVersion: 'solo-practice-v1', pace: null }), true)).toThrow();
  });
});

describe('normalizeSoloRun', () => {
  it('accepts a run without a pace and does not invent one', () => {
    expect(normalizeSoloRun(response())).toMatchObject({ runId: 'run-1', pace: null, bankExhausted: false });
  });

  it('keeps a valid pace, even one that already reached 100', () => {
    const pace = { id: 'p', displayName: 'Alex', rounds: [paceRound(0, 25), paceRound(1, 25), paceRound(2, 25), paceRound(3, 25)] };
    expect(normalizeSoloRun(response({ pace })).pace).toEqual(pace);
  });

  it('drops a pace that does not match the set instead of failing the run', () => {
    const wrong = { id: 'p', displayName: 'Alex', rounds: [{ ...paceRound(0), questionId: 'other' }] };
    expect(normalizeSoloRun(response({ pace: wrong })).pace).toBeNull();
    const invalid = { id: 'p', displayName: 'Alex', rounds: [paceRound(0, 7)] };
    expect(normalizeSoloRun(response({ pace: invalid })).pace).toBeNull();
  });

  it('rejects rules this client does not know', () => {
    expect(() => normalizeSoloRun(response({ rulesVersion: 'solo-to-100-v2' }))).toThrow();
    expect(() => normalizeSoloRun(response({ target: 150 }))).toThrow();
    expect(() => normalizeSoloRun(response({ roundCap: 30 }))).toThrow();
    expect(() => normalizeSoloRun(response({ runId: '' }))).toThrow();
    expect(() => normalizeSoloRun(response({ questions: [] }))).toThrow();
  });
});
