import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateMatch,
  isAnswerCorrect,
  resultFromDistance,
  type CategoryId,
} from './index';

describe('resultFromDistance', () => {
  it.each([
    [0, 'perfect'],
    [0.06, 'perfect'],
    [0.07, 'great'],
    [0.28, 'great'],
    [0.29, 'good'],
    [0.65, 'good'],
    [0.66, 'weak'],
    [0.85, 'weak'],
    [0.86, 'miss'],
    [1, 'miss'],
  ] as const)('maps %s to %s', (distance, expected) => {
    expect(resultFromDistance(distance)).toBe(expected);
  });
});

describe('isAnswerCorrect', () => {
  it('accepts normalized Russian and English answers with a small typo', () => {
    expect(isAnswerCorrect('  Астана! ', ['Астана', 'Astana']).correct).toBe(true);
    expect(isAnswerCorrect('Astna', ['Астана', 'Astana']).correct).toBe(true);
  });

  it('rejects an unrelated answer', () => {
    expect(isAnswerCorrect('Алматы', ['Астана', 'Astana']).correct).toBe(false);
  });
});

describe('generateMatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the standard default at ten questions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(generateMatch()).toHaveLength(10);
  });

  it.each(['geography', 'history', 'languages'] as CategoryId[])(
    'creates a complete unique %s match even when random always returns zero',
    (category) => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const questions = generateMatch(10, 0.3, category);
      expect(questions).toHaveLength(10);
      expect(new Set(questions.map((question) => question.id)).size).toBe(10);
      const entityIds = questions.map((question) =>
        question.id.replace(/^(?:hist_flag_|lang_)/, '').split('_').at(-1),
      );
      expect(new Set(entityIds).size).toBe(10);

      for (const question of questions) {
        if (question.answerType === 'multiple_choice') {
          expect(question.options).toHaveLength(4);
          expect(question.options.some((option) => option.id === question.correctOptionId)).toBe(true);
        } else {
          expect(question.correctAnswers?.length).toBeGreaterThan(0);
        }
      }
    },
  );

  it('creates the exact rounded geography open-answer count', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const questions = generateMatch(11, 0.3, 'geography');

    expect(questions.filter((question) => question.answerType === 'open_answer')).toHaveLength(3);
    expect(new Set(questions.map((question) => question.id.split('_').at(-1))).size).toBe(11);
  });

  it('keeps selected geography entities unique through the capital template path', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const questions = generateMatch(10, 0, 'geography');

    expect(questions.some((question) => question.id.startsWith('capital_'))).toBe(true);
    expect(new Set(questions.map((question) => question.id.split('_').at(-1))).size).toBe(10);
  });

  it.each([
    ['geography', 197],
    ['history', 44],
    ['languages', 37],
  ] as const)('supports the full %s capacity and rejects one more', (category, capacity) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(generateMatch(capacity, 0.3, category)).toHaveLength(capacity);
    random.mockClear();
    expect(() => generateMatch(capacity + 1, 0.3, category)).toThrow(
      new RangeError(`Cannot generate ${capacity + 1} unique ${category} questions: category capacity is ${capacity}.`),
    );
    expect(random).not.toHaveBeenCalled();
  });

  it('returns an empty match for a zero request', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(generateMatch(0, 0.3, 'geography')).toEqual([]);
    expect(generateMatch(0, 0.3, 'history')).toEqual([]);
    expect(generateMatch(0, 0.3, 'languages')).toEqual([]);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid numQuestions %s before generating',
    (numQuestions) => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(() => generateMatch(numQuestions)).toThrow(
        new RangeError('numQuestions must be a nonnegative integer.'),
      );
      expect(random).not.toHaveBeenCalled();
    },
  );

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid openRatio %s before generating',
    (openRatio) => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(() => generateMatch(10, openRatio)).toThrow(
        new RangeError('openRatio must be a finite number between 0 and 1.'),
      );
      expect(random).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown runtime category before generating', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(() => generateMatch(10, 0.3, 'unknown' as CategoryId)).toThrow(
      new RangeError('Unknown category: unknown.'),
    );
    expect(random).not.toHaveBeenCalled();
  });
});
