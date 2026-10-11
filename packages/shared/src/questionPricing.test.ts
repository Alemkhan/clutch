import { describe, expect, it } from 'vitest';
import type { Question } from './index';
import {
  MEAN_REWARD_PER_CORRECT,
  questionDifficulty,
  questionFormat,
  setPar,
  soloScore,
  type QuestionFormat,
} from './questionPricing';

function make(answerType: Question['answerType'], mediaType: Question['mediaType'], id = 'q'): Question {
  return {
    id,
    type: 'multiple_choice',
    answerType,
    category: 'geography',
    difficulty: 'Easy',
    prompt: 'p',
    options: [],
    correctOptionId: 'a',
    explanation: '',
    mediaType,
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const FORMATS: [QuestionFormat, Question][] = [
  ['choice_text', make('multiple_choice', null)],
  ['choice_flag', make('multiple_choice', 'flag')],
  ['choice_outline', make('multiple_choice', 'outline')],
  ['open_text', make('open_answer', undefined)],
  ['open_flag', make('open_answer', 'flag')],
  ['open_outline', make('open_answer', 'outline')],
];

describe('questionFormat', () => {
  it.each(FORMATS)('detects %s', (format, question) => {
    expect(questionFormat(question)).toBe(format);
  });
});

describe('questionDifficulty', () => {
  it('matches the measured logit for each format', () => {
    const rates: Record<QuestionFormat, number> = {
      choice_text: 105 / 158,
      choice_flag: 77 / 135,
      choice_outline: 16 / 37,
      open_flag: 13 / 24,
      open_text: 9 / 19,
      open_outline: 0.5 / 17,
    };
    for (const [format, question] of FORMATS) {
      expect(questionDifficulty(question)).toBeCloseTo(-Math.log(rates[format] / (1 - rates[format])), 10);
    }
  });

  it('orders formats from easiest to hardest', () => {
    // Порядок взят из замера на малой выборке (24, 19, 37 ответов) и может поменяться после новых данных.
    const d = Object.fromEntries(FORMATS.map(([f, q]) => [f, questionDifficulty(q)])) as Record<QuestionFormat, number>;
    expect(d.choice_text).toBeLessThan(d.choice_flag);
    expect(d.choice_flag).toBeLessThan(d.open_flag);
    expect(d.open_flag).toBeLessThan(d.open_text);
    expect(d.open_text).toBeLessThan(d.choice_outline);
    expect(d.choice_outline).toBeLessThan(d.open_outline);
  });
});

describe('MEAN_REWARD_PER_CORRECT', () => {
  it('is the measured 21.47', () => {
    expect(MEAN_REWARD_PER_CORRECT).toBeCloseTo(21.47, 2);
  });
});

describe('setPar', () => {
  const easy = (n: number) => Array.from({ length: n }, (_, i) => make('multiple_choice', null, `e${i}`));
  const hard = (n: number) => Array.from({ length: n }, (_, i) => make('open_answer', 'outline', `h${i}`));

  it('is monotonic in difficulty', () => {
    expect(setPar(easy(20))).toBeLessThan(setPar(hard(20)));
  });

  it('is longer for harder mixes', () => {
    const mixed = [...easy(10), ...hard(10)];
    expect(setPar(easy(20))).toBeLessThanOrEqual(setPar(mixed));
  });

  it('returns length + 1 when the set cannot close', () => {
    expect(setPar(hard(5))).toBe(6);
    expect(setPar([])).toBe(1);
  });

  it('honours a custom target', () => {
    expect(setPar(easy(20), 50)).toBeLessThan(setPar(easy(20), 100));
  });
});

describe('soloScore', () => {
  it('is 1.0 at par and scales with rounds', () => {
    const par = setPar(Array.from({ length: 20 }, (_, i) => make('multiple_choice', 'flag', `f${i}`)));
    expect(soloScore(par, par)).toBe(1);
    expect(soloScore(par - 1, par)).toBeLessThan(1);
    expect(soloScore(par + 1, par)).toBeGreaterThan(1);
  });

  it('rejects invalid input', () => {
    expect(() => soloScore(5, 0)).toThrow(RangeError);
    expect(() => soloScore(-1, 5)).toThrow(RangeError);
  });
});
