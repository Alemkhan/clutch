import { describe, expect, it } from 'vitest';
import { SOLO_ROUND_CAP, SOLO_TARGET_PROGRESS, type Opponent, type Question } from '@clutch/shared';
import { applySoloSessionRound, createSoloRunSession, soloRunView } from './soloRunSession';

function questions(count: number): Question[] {
  return Array.from({ length: count }, (_, index) => ({ id: `q-${index + 1}` }) as Question);
}

function paceOf(set: Question[], awards: number[]): Opponent {
  return {
    id: 'pace',
    displayName: 'Темп',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: set[index].id,
      correct: true,
      responseTimeMs: 1000,
      skillScore: 0,
      progressAwarded,
    })),
  };
}

function play(set: Question[], awards: number[], pace: Opponent | null = null) {
  return awards.reduce(applySoloSessionRound, createSoloRunSession(set, pace));
}

describe('solo run session', () => {
  it('starts in progress on round 1 with the full cap left', () => {
    const view = soloRunView(createSoloRunSession(questions(12)));
    expect(view).toMatchObject({
      progress: 0, target: SOLO_TARGET_PROGRESS, round: 1, roundsPlayed: 0,
      roundsToCap: SOLO_ROUND_CAP, questionsLeft: 12, completed: false, reachedTarget: false,
      paceProgress: null,
    });
  });

  it('tracks progress and rounds left, then completes at the target', () => {
    const set = questions(12);
    const mid = soloRunView(play(set, [25, 25]));
    expect(mid).toMatchObject({ progress: 50, round: 3, roundsToCap: SOLO_ROUND_CAP - 2, completed: false });

    const done = soloRunView(play(set, [25, 25, 25, 25]));
    expect(done).toMatchObject({ progress: 100, round: 4, completed: true, reachedTarget: true });
  });

  it('the opponent pace reaching 100 never completes the run', () => {
    const set = questions(12);
    // Темп закрывает цель на третьем круге, игрок на третьем круге ещё в пути.
    const pace = paceOf(set, [40, 40, 40]);
    const session = play(set, [0, 0, 0], pace);
    const view = soloRunView(session);
    expect(view.paceProgress).toBe(SOLO_TARGET_PROGRESS);
    expect(view).toMatchObject({ progress: 0, completed: false, reachedTarget: false, round: 4 });
    // Забег продолжается: следующий круг принимается.
    expect(soloRunView(applySoloSessionRound(session, 10))).toMatchObject({ progress: 10, completed: false });
  });

  it('pace does not change the outcome of the player run', () => {
    const set = questions(12);
    const awards = [25, 10, 25, 25, 25];
    const withPace = soloRunView(play(set, awards, paceOf(set, [100])));
    const withoutPace = soloRunView(play(set, awards, null));
    expect({ ...withPace, paceProgress: null }).toEqual(withoutPace);
  });

  it('works without a pace', () => {
    const view = soloRunView(play(questions(12), [10, 10]));
    expect(view.paceProgress).toBeNull();
    expect(view.progress).toBe(20);
  });

  it('follows pace by the number of rounds the player has played', () => {
    const set = questions(12);
    const pace = paceOf(set, [30, 30]);
    expect(soloRunView(play(set, [0], pace)).paceProgress).toBe(30);
    expect(soloRunView(play(set, [0, 0], pace)).paceProgress).toBe(60);
    // Темп короче партии игрока: он замирает на последнем круге записи.
    expect(soloRunView(play(set, [0, 0, 0], pace)).paceProgress).toBe(60);
  });

  it('stops at the round cap without the target', () => {
    const set = questions(SOLO_ROUND_CAP + 2);
    const view = soloRunView(play(set, new Array(SOLO_ROUND_CAP).fill(1)));
    expect(view).toMatchObject({ completed: true, reachedTarget: false, roundsToCap: 0, roundsPlayed: SOLO_ROUND_CAP });
  });

  it('closes without the target when the question set runs out first', () => {
    const view = soloRunView(play(questions(3), [5, 5, 5]));
    expect(view).toMatchObject({ completed: true, reachedTarget: false, questionsLeft: 0, progress: 15 });
  });

  it('rejects a round after the run has completed and does not mutate the session', () => {
    const done = play(questions(12), [100]);
    expect(() => applySoloSessionRound(done, 5)).toThrow();
    expect(done.rounds).toHaveLength(1);
  });
});
