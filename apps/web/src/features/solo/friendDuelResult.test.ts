import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SoloResult } from './SoloResult';
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
import { friendDuelNote, runStatus, runSummary } from '../myRuns/myRunsView';
import { applySoloSessionRound, createSoloRunSession, soloRunView } from './soloRunSession';

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
      runId: 'r', questions, pace: author, target: SOLO_TARGET_PROGRESS, roundCap: 4,
      rulesVersion: FRIEND_RULES_VERSION, miniGameId: 'hammer_nail', bankExhausted: false,
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

  it('says the tiebreaker decided a tie, with comma multipliers, only when the server reports it', () => {
    const summary = buildFriendDuelSummary(played, { outcome: 'player', tiebreak: { ownMultiplier: 1.4, opponentMultiplier: 2.8 } });
    expect(summary.tiebreakLine).toBe('Ничья по забегу — решила «На глазок»: ×1,4 против ×2,8.');
    expect(buildFriendDuelSummary(played, { outcome: 'player' }).tiebreakLine).toBe('');
    expect(buildFriendDuelSummary(played, null).tiebreakLine).toBe('');
    // Множитель друга не показываем тому, кто сам не отвечал.
    expect(buildFriendDuelSummary(played, { outcome: 'opponent', tiebreak: { ownMultiplier: null, opponentMultiplier: 1.2 } }).tiebreakLine)
      .toBe('Ничья по забегу — решила «На глазок»: друг ответил, а ты нет.');
    expect(buildFriendDuelSummary(played, { outcome: 'player', tiebreak: { ownMultiplier: 1.2, opponentMultiplier: null } }).tiebreakLine)
      .toBe('Ничья по забегу — решила «На глазок»: ты ответил, а друг нет.');
  });

  it('renders the tiebreak line on the duel result and nowhere in a ranked result', () => {
    const view = soloRunView(played);
    const props = {
      view, saveStatus: 'saved' as const, response: null, canRetrySave: false,
      onRetrySave: () => undefined, onReplay: () => undefined, onMyRuns: () => undefined,
    };
    const duel = buildFriendDuelSummary(played, { outcome: 'player', tiebreak: { ownMultiplier: 1.4, opponentMultiplier: 2.8 } });
    expect(renderToStaticMarkup(createElement(SoloResult, { ...props, friendDuel: duel }))).toContain('×1,4 против ×2,8');
    expect(renderToStaticMarkup(createElement(SoloResult, props))).not.toContain('На глазок');
  });

  it('labels the friend duel in My runs for both sides', () => {
    const base: MyRunSummary = {
      runId: 'r', category: 'geography', roundsPlayed: 4, progress: 100, correctCount: 4,
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
