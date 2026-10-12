import { useState, useCallback, useEffect, useRef } from 'react';
import { analytics } from './analytics';
import type {
  SkillResult,
  Question,
  Opponent,
  CategoryId,
} from '@clutch/shared';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
} from '@clutch/shared';
import { startAsyncMatch } from './api';
import { completionQueue, type CompletionQueueEvent } from './completionQueue';
import {
  normalizeOnlineMatch,
  normalizeScriptedOpponent,
  validateMiniGameConfig,
} from './clientMatchRules';
import {
  completeSkillDistance,
  continueAfterAnswerResolution,
  createInitialGameState,
  createMatchLobbyState,
  createPreparedMatchState,
  recordAnswer,
} from './gameSession';
import {
  MatchRequestCoordinator,
  matchmakingErrorMessage,
  type MatchmakingViewState,
} from './matchmaking';

export type ResultSaveStatus = 'practice' | 'pending' | 'saved' | 'error';

export function useGameState() {
  const [state, setState] = useState(createInitialGameState);
  const [matchmaking, setMatchmaking] = useState<MatchmakingViewState>({ status: 'loading' });
  const [resultSave, setResultSave] = useState<{
    status: ResultSaveStatus;
    error?: string;
    canRetry: boolean;
  }>({
    status: 'practice',
    canRetry: false,
  });
  const activeMatchIdRef = useRef<string>();
  const reportedCompletionRef = useRef<string>();
  const reportedSavePendingRef = useRef<string>();
  const requestCoordinatorRef = useRef(new MatchRequestCoordinator());
  const startingPreparedRef = useRef(false);
  activeMatchIdRef.current = state.activeMatchId;

  // Remembered so that Retry repeats the same rematch; any ordinary request clears it.
  const rematchInviteRef = useRef<string>();

  const requestOnlineMatch = useCallback((category: CategoryId, rematchInviteId?: string) => {
    rematchInviteRef.current = rematchInviteId;
    const request = requestCoordinatorRef.current.begin(rematchInviteId ?? category);
    if (!request) return;
    startingPreparedRef.current = false;
    setMatchmaking({ status: 'loading' });
    setState({ ...createInitialGameState(), category, phase: 'matchmaking' });

    void startAsyncMatch(category, request.signal, rematchInviteId).then((rawMatch) => {
      if (!requestCoordinatorRef.current.isCurrent(request.token)) return;
      let match;
      try {
        match = normalizeOnlineMatch(rawMatch);
      } catch (error) {
        console.error('Invalid async match response:', error);
        if (!requestCoordinatorRef.current.settle(request.token)) return;
        setMatchmaking({ status: 'error', error: 'Сервер вернул некорректный матч. Попробуй ещё раз.' });
        return;
      }
      if (!requestCoordinatorRef.current.settle(request.token)) return;
      setState(createMatchLobbyState({
        category,
        opponent: match.opponent,
        questions: match.questions,
        activeMatchId: match.matchId,
        miniGameConfig: match.config,
        matchSource: match.opponentSource,
      }));
      setMatchmaking({ status: 'ready' });
    }).catch((error: unknown) => {
      if (!requestCoordinatorRef.current.settle(request.token)) return;
      setMatchmaking({ status: 'error', error: matchmakingErrorMessage(error) });
    });
  }, []);

  const start = useCallback(() => {
    if (startingPreparedRef.current || matchmaking.status !== 'ready') return;
    startingPreparedRef.current = true;
    setState((previous) => {
      if (previous.phase !== 'matchmaking' || previous.questions.length === 0) {
        startingPreparedRef.current = false;
        return previous;
      }
      analytics.startMatch();
      analytics.track('match_started', { source: previous.matchSource });
      return { ...previous, phase: 'question' };
    });
  }, [matchmaking.status]);

  useEffect(() => () => requestCoordinatorRef.current.cancel(), []);

  useEffect(() => {
    if (state.phase !== 'result' || state.questions.length === 0) return;
    const completionId = state.activeMatchId ?? analytics.matchId;
    if (!completionId || reportedCompletionRef.current === completionId) return;
    reportedCompletionRef.current = completionId;
    analytics.track('match_completed', {
      playerProgress: state.rulesState.playerProgress,
      opponentProgress: state.rulesState.opponentProgress,
    });
  }, [
    state.phase,
    state.questions.length,
    state.activeMatchId,
    state.rulesState.playerProgress,
    state.rulesState.opponentProgress,
  ]);

  useEffect(() => {
    const handleQueueEvent = (event: CompletionQueueEvent) => {
      if (event.entry.matchId !== activeMatchIdRef.current) return;
      if (event.type === 'confirmed') {
        setResultSave({ status: 'saved', canRetry: false });
        setState((previous) => previous.activeMatchId === event.entry.matchId
          ? {
              ...previous,
              correctCount: event.response.correctCount,
              rulesState: {
                ...previous.rulesState,
                roundsPlayed: event.response.rounds.length,
                playerProgress: event.response.playerProgress,
                outcome: event.response.playerProgress === previous.rulesState.opponentProgress
                  ? 'tie'
                  : event.response.playerProgress > previous.rulesState.opponentProgress
                    ? 'player'
                    : 'opponent',
              },
            }
          : previous);
        return;
      }
      if (event.entry.status === 'error') {
        setResultSave({
          status: 'error',
          error: 'Не удалось подтвердить результат.',
          canRetry: event.entry.canRetry,
        });
      } else {
        setResultSave({ status: 'pending', canRetry: false });
      }
    };
    return completionQueue.subscribe(handleQueueEvent);
  }, []);

  useEffect(() => {
    if (state.phase !== 'result' || !state.activeMatchId) {
      setResultSave({ status: 'practice', canRetry: false });
      return;
    }
    try {
      const entry = completionQueue.enqueue(
        state.activeMatchId,
        { rounds: state.roundInputs },
        state.rulesState.opponentProgress,
      );
      setResultSave(entry.status === 'error'
        ? {
            status: 'error',
            error: 'Не удалось подтвердить результат.',
            canRetry: entry.canRetry,
          }
        : { status: 'pending', canRetry: false });
      if (reportedSavePendingRef.current !== state.activeMatchId) {
        reportedSavePendingRef.current = state.activeMatchId;
        analytics.track('match_save_pending', { matchId: state.activeMatchId });
      }
      void completionQueue.flush();
    } catch {
      setResultSave({
        status: 'error',
        error: 'Очередь сохранения заполнена. Попробуйте позже.',
        canRetry: false,
      });
      if (reportedSavePendingRef.current !== state.activeMatchId) {
        reportedSavePendingRef.current = state.activeMatchId;
        analytics.track('match_save_failed', { matchId: state.activeMatchId });
      }
    }
  }, [state.phase, state.activeMatchId, state.roundInputs, state.rulesState.opponentProgress]);

  const retryResultSave = useCallback(() => {
    if (state.activeMatchId) completionQueue.retry(state.activeMatchId);
  }, [state.activeMatchId]);

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
    requestCoordinatorRef.current.cancel();
    setState(createInitialGameState());
  }, []);

  const goToCategories = useCallback(() => {
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState({ ...createInitialGameState(), phase: 'categories' });
  }, []);

  const goToMatchmaking = useCallback((category?: string) => {
    requestOnlineMatch((category === 'history' || category === 'languages' ? category : 'geography') as CategoryId);
  }, [requestOnlineMatch]);

  const retryMatchmaking = useCallback(() => {
    requestOnlineMatch(state.category, rematchInviteRef.current);
  }, [requestOnlineMatch, state.category]);

  const startRematch = useCallback((inviteId: string, category: CategoryId) => {
    requestOnlineMatch(category, inviteId);
  }, [requestOnlineMatch]);

  const replay = useCallback(() => {
    if (state.matchSource === 'player' || state.matchSource === 'bot') {
      requestOnlineMatch(state.category);
      return;
    }
    // Вопросов без сервера больше нет: оффлайн-партию не из чего собрать, возвращаемся к выбору категории.
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState({ ...createInitialGameState(), phase: 'categories' });
  }, [requestOnlineMatch, state.category, state.matchSource]);

  const goToTraining = useCallback(() => {
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState({ ...createInitialGameState(), phase: 'training' });
  }, []);

  const goToLastStand = useCallback(() => {
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState({ ...createInitialGameState(), phase: 'lastStand' });
  }, []);

  const goToSolo = useCallback(() => {
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState({ ...createInitialGameState(), phase: 'solo' });
  }, []);

  const goToMyRuns = useCallback(() => {
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState({ ...createInitialGameState(), phase: 'myRuns' });
  }, []);

  const goToProfile = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'profile' }));
  }, []);

  const goHome = useCallback(() => {
    requestCoordinatorRef.current.cancel();
    startingPreparedRef.current = false;
    setState(createInitialGameState());
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
    miniGameConfig: state.miniGameConfig,
    matchSource: state.matchSource,
    matchmakingStatus: matchmaking.status,
    matchmakingError: matchmaking.error,
    resultSaveStatus: resultSave.status,
    resultSaveError: resultSave.error,
    canRetryResultSave: resultSave.canRetry,
    retryResultSave,
    retryMatchmaking,
    startRematch,
    start,
    replay,
    answer,
    continueAfterResolution,
    completeHammer,
    reset,
    goToCategories,
    goToMatchmaking,
    goToProfile,
    goToTraining,
    goToLastStand,
    goToSolo,
    goToMyRuns,
    goHome,
  };
}
