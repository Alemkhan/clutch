import { describe, expect, it } from 'vitest';
import {
  FRIEND_RULES_VERSION,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  dailyQuestionSet,
  type MyRunSummary,
  type Opponent,
  type StartSoloRunResponse,
} from '@clutch/shared';
import { normalizeSoloRun } from './clientMatchRules';
import { FRIEND_DUEL_CHIP, buildFriendDuelSummary } from './friendDuelResult';
import { friendDuelNote, runStatus, runSummary } from './myRunsView';
import { applySoloSessionRound, createSoloRunSession } from './soloRunSession';

const questions = dailyQuestionSet('geography', Date.UTC(2026, 9, 11), 0).questions;
const author: Opponent = {
  id: 'ann-run',
  displayName: 'Анна',
  rounds: [25, 25, 25, 25].map((progressAwarded, index) => (
    { questionId: questions[index].id, correct: true, responseTimeMs: 2000, skillScore: 1, progressAwarded }
  )),
};
const played = [25, 25, 25, 25].reduce(applySoloSessionRound, createSoloRunSession(questions, author));

describe('friend duel on the client', () => {
  it('accepts the friend rules version and marks the run, without loosening anything else', () => {
    const response: StartSoloRunResponse = {
      runId: 'r', questions, pace: author, target: SOLO_TARGET_PROGRESS, roundCap: SOLO_ROUND_CAP,
      rulesVersion: FRIEND_RULES_VERSION, bankExhausted: false,
    };
    expect(normalizeSoloRun(response).friendDuel).toBe(true);
    expect(normalizeSoloRun({ ...response, rulesVersion: 'solo-to-100-v2' }).friendDuel).toBe(false);
    expect(() => normalizeSoloRun(response, true)).toThrow();
    expect(() => normalizeSoloRun({ ...response, rulesVersion: 'solo-other-v1' })).toThrow();
  });

  it('announces the server outcome and says it is not counted', () => {
    expect(FRIEND_DUEL_CHIP).toBe('Дружеская игра · не в зачёт');
    expect(buildFriendDuelSummary(played, { outcome: 'player' }).headline).toBe('Ты обошёл друга');
    expect(buildFriendDuelSummary(played, { outcome: 'opponent' }).headline).toBe('Друг оказался сильнее');
    expect(buildFriendDuelSummary(played, { outcome: 'tie' }).headline).toBe('Ничья с другом');
    const pending = buildFriendDuelSummary(played, null);
    expect(pending.outcome).toBeNull();
    expect(pending.headline).toBe('Дуэль сыграна');
    expect(pending.line).toBe('Ты — 100% за 4 круга. Анна — 100% за 4 круга.');
  });

  it('labels the friend duel in My runs for both sides', () => {
    const base: MyRunSummary = {
      runId: 'r', category: 'geography', mode: 'solo', roundsPlayed: 4, progress: 100, correctCount: 4,
      reachedTarget: true, setPar: 4, soloScore: 1, startedAt: 1, completedAt: 2,
      opponent: { kind: 'player', displayName: 'Боб' }, outcome: 'opponent',
    };
    expect(friendDuelNote(base)).toBeNull();
    expect(friendDuelNote({ ...base, friendDuel: 'played' })).toBe('Дружеская игра · не в зачёт');
    expect(friendDuelNote({ ...base, friendDuel: 'hosted' })).toBe('Друг сыграл вашу запись · не в зачёт');
    expect(runSummary({ ...base, friendDuel: 'hosted' })).toBe('Боб: 100% за 4 круга');
    expect(runStatus({ ...base, friendDuel: 'hosted' })).toEqual({ kind: 'loss', text: 'Поражение' });
  });
});
