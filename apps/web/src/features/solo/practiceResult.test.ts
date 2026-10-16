import { describe, expect, it } from 'vitest';
import { dailyQuestionSet, type Opponent } from '@clutch/shared';
import { buildPracticeSummary } from './practiceResult';
import { applySoloSessionRound, createSoloRunSession, type SoloRunSession } from './soloRunSession';

const questions = dailyQuestionSet('geography', Date.UTC(2026, 9, 11), 0).questions;

function bot(awards: number[]): Opponent {
  return {
    id: 'clutch_bot',
    displayName: 'Max',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: questions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 2000,
      skillScore: progressAwarded / 25,
      progressAwarded,
    })),
  };
}

function play(pace: Opponent | null, awards: number[]): SoloRunSession {
  return awards.reduce(applySoloSessionRound, createSoloRunSession(questions, pace));
}

describe('practice summary', () => {
  it('has nothing to compare without a bot', () => {
    expect(buildPracticeSummary(play(null, [25, 25, 25, 25]))).toBeNull();
  });

  it('is a win for the player who finishes in fewer rounds than the bot', () => {
    const summary = buildPracticeSummary(play(bot([25, 25, 25, 12, 25]), [25, 25, 25, 25]))!;
    expect(summary.outcome).toBe('player');
    expect(summary.headline).toBe('Ты обошёл бота');
    expect(summary.line).toBe('Ты — 100% за 4 круга. Бот Max — 100% за 5 кругов.');
  });

  it('is a loss when the bot finishes first', () => {
    const summary = buildPracticeSummary(play(bot([25, 25, 25, 25]), [25, 25, 0, 25, 25]))!;
    expect(summary.outcome).toBe('opponent');
    expect(summary.headline).toBe('Бот оказался сильнее');
  });

  it('is a tie on equal rounds, and the headline never claims a saved result', () => {
    const summary = buildPracticeSummary(play(bot([25, 25, 25, 25]), [25, 25, 25, 25]))!;
    expect(summary.outcome).toBe('tie');
    expect(`${summary.headline} ${summary.line}`).not.toMatch(/сохран|зафиксир|рекорд|темп/i);
  });
});
