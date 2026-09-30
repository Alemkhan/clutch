import { useState, useCallback, useEffect, useRef } from 'react';
import { analytics } from './analytics';
import type {
  SkillResult,
  Question,
  Opponent,
  Tournament,
  CategoryId,
} from '@clutch/shared';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
} from '@clutch/shared';
import { createQuestions, createSampleOpponent } from './sampleData';
import { completeAsyncMatch, startAsyncMatch } from './api';
import {
  normalizeOnlineMatch,
  normalizeScriptedOpponent,
  validateMiniGameConfig,
} from './clientMatchRules';
import {
  completeSkillDistance,
  continueAfterAnswerResolution,
  createChallengeLobbyState,
  createChallengeReplayState,
  createInitialGameState,
  createPreparedMatchState,
  recordAnswer,
} from './gameSession';

export function useGameState() {
  const [state, setState] = useState(createInitialGameState);
  const submittedMatchesRef = useRef(new Set<string>());

  const start = useCallback(async () => {
    analytics.startMatch();
    if (state.fixedQuestions) {
      analytics.track('match_started', { source: 'challenge' });
      setState(createChallengeReplayState);
      return;
    }

    let rawMatch;
    try {
      rawMatch = await startAsyncMatch(state.category);
    } catch {
      const questions = createQuestions(state.category);
      const opponent = createSampleOpponent(questions);
      analytics.track('match_started', { source: 'local_fallback' });
      setState((prev) => createPreparedMatchState({ category: prev.category, opponent, questions }));
      return;
    }

    try {
      const match = normalizeOnlineMatch(rawMatch);
      analytics.track('match_started', { source: match.opponentSource });
      setState((prev) => createPreparedMatchState({
        category: prev.category,
        opponent: match.opponent,
        questions: match.questions,
        activeMatchId: match.matchId,
        miniGameConfig: match.config,
      }));
    } catch (error) {
      console.error('Invalid async match response:', error);
      setState((prev) => ({ ...createInitialGameState(), category: prev.category, phase: 'categories' }));
    }
  }, [state.category, state.fixedQuestions]);

  const startChallenge = useCallback((tournament: Tournament, opponent: Opponent, fixedQuestions?: Question[]) => {
    if (!fixedQuestions) throw new Error('Challenge questions are required.');
    if (tournament.miniGame.id !== CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id) {
      throw new Error('Challenge mini-game is not supported.');
    }
    const normalizedOpponent = normalizeScriptedOpponent(opponent, fixedQuestions);
    const config = validateMiniGameConfig(tournament.miniGame.config);
    setState(createChallengeLobbyState({
      questions: fixedQuestions,
      opponent: normalizedOpponent,
      activeVideo: tournament.video,
      miniGameConfig: config,
    }));
  }, []);

  useEffect(() => {
    if (state.phase === 'result' && state.questions.length > 0) {
      analytics.track('match_completed', {
        playerProgress: state.rulesState.playerProgress,
        opponentProgress: state.rulesState.opponentProgress,
      });
    }
  }, [state.phase, state.questions.length, state.rulesState]);

  useEffect(() => {
    if (
      state.phase !== 'result'
      || !state.activeMatchId
      || submittedMatchesRef.current.has(state.activeMatchId)
    ) return;

    submittedMatchesRef.current.add(state.activeMatchId);
    void completeAsyncMatch(state.activeMatchId, { rounds: state.roundInputs }).catch(() => {
      submittedMatchesRef.current.delete(state.activeMatchId!);
    });
  }, [state.phase, state.activeMatchId, state.roundInputs]);

  const answer = useCallback((optionId: string, _timeMs: number) => {
    setState((prev) => {
      const question = prev.questions[prev.questionIndex];
      const next = recordAnswer(prev, optionId, _timeMs);
      analytics.track('answer_submitted', {
        questionId: question?.id,
        questionIndex: prev.questionIndex,
        category: question?.category,
        difficulty: question?.difficulty,
        answerType: question?.answerType,
        selectedOption: optionId,
        correctness: next.lastCorrect,
        responseTimeMs: _timeMs,
      });
      return next;
    });
  }, []);

  const continueAfterResolution = useCallback(() => {
    setState(continueAfterAnswerResolution);
  }, []);

  const completeHammer = useCallback((_result: SkillResult, _progress: number, distance: number) => {
    setState((prev) => completeSkillDistance(prev, distance));
  }, []);

  const reset = useCallback(() => {
    setState(createInitialGameState());
  }, []);

  const goToCategories = useCallback(() => {
    setState({ ...createInitialGameState(), phase: 'categories' });
  }, []);

  const goToMatchmaking = useCallback((category?: string) => {
    setState((prev) => ({
      ...prev,
      category: (category === 'history' || category === 'languages' ? category : 'geography') as CategoryId,
      phase: 'matchmaking',
    }));
  }, []);

  const goToProfile = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'profile' }));
  }, []);

  const goHome = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'home' }));
  }, []);

  return {
    phase: state.phase,
    questionIndex: state.questionIndex,
    playerProgress: state.rulesState.playerProgress,
    opponentProgress: state.rulesState.opponentProgress,
    lastCorrect: state.lastCorrect,
    lastSkill: state.lastSkill,
    bestSkill: state.bestSkill,
    correctCount: state.correctCount,
    selectedOption: state.selectedOption,
    responseTimes: state.responseTimes,
    skillResults: state.skillResults,
    perfectHits: state.skillResults.filter((r) => r === 'perfect').length,
    avgResponseMs: state.responseTimes.length
      ? Math.round(state.responseTimes.reduce((a, b) => a + b, 0) / state.responseTimes.length)
      : 0,
    totalQuestions: state.questions.length,
    questionsPlayed: state.rulesState.roundsPlayed,
    currentQuestion: state.questions[state.questionIndex],
    opponent: state.opponent,
    activeVideo: state.activeVideo,
    miniGameConfig: state.miniGameConfig,
    start,
    startChallenge,
    answer,
    continueAfterResolution,
    completeHammer,
    reset,
    goToCategories,
    goToMatchmaking,
    goToProfile,
    goHome,
  };
}
