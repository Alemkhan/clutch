import { describe, expect, it } from 'vitest';
import {
  generateMatch,
  isAnswerCorrect,
  resultFromDistance,
  type CategoryId,
} from './index';

describe('resultFromDistance', () => {
  it.each([
    [0, 'perfect'],
    [0.15, 'perfect'],
    [0.16, 'great'],
    [0.35, 'great'],
    [0.36, 'good'],
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
  it.each(['geography', 'history', 'languages'] as CategoryId[])(
    'creates a complete unique %s match',
    (category) => {
      const questions = generateMatch(10, 0.3, category);
      expect(questions).toHaveLength(10);
      expect(new Set(questions.map((question) => question.id)).size).toBe(10);

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
});
