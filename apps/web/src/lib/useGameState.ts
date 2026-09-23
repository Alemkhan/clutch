import { useState, useCallback, useEffect, useRef } from 'react';
import { analytics } from './analytics';
import type {
  AsyncMatchRoundInput,
  SkillResult,
  Question,
  Opponent,
  Tournament,
  CategoryId,
} from '@clutch/shared';
import { SKILL_REWARDS, isAnswerCorrect } from '@clutch/shared';
import { createQuestions, sampleOpponent, miniGameConfig } from './sampleData';
import { completeAsyncMatch, startAsyncMatch } from './api';

export type Phase = 'home' | 'categories' | 'matchmaking' | 'question' | 'resolution' | 'hammer' | 'result' | 'profile';

interface MatchState {
  phase: Phase;
  category: CategoryId;
  questions: Question[];
  questionIndex: number;
  playerProgress: number;
  opponentProgress: number;
  lastCorrect: boolean;
  lastSkill: SkillResult | null;
  bestSkill: SkillResult | null;
  correctCount: number;
  selectedOption: string;
  responseTimes: number[];
  skillResults: SkillResult[];
  opponent: Opponent;
  activeVideo: Tournament['video'];
  fixedQuestions?: Question[];
  activeMatchId?: string;
  roundInputs: AsyncMatchRoundInput[];
}

const initialState: MatchState = {
  phase: 'home',
  category: 'geography',
  questions: [],
  questionIndex: 0,
  playerProgress: 0,
  opponentProgress: 0,
  lastCorrect: false,
  lastSkill: null,
  bestSkill: null,
  correctCount: 0,
  selectedOption: '',
  responseTimes: [],
  skillResults: [],
  opponent: sampleOpponent,
  activeVideo: undefined,
  fixedQuestions: undefined,
  activeMatchId: undefined,
  roundInputs: [],
};

function isFinished(player: number, opponent: number, qIndex: number, total: number): boolean {
  return player >= 100 || opponent >= 100 || qIndex >= total - 1;
}

export function useGameState() {
  const [state, setState] = useState<MatchState>(initialState);
  const submittedMatchesRef = useRef(new Set<string>());

  const start = useCallback(async () => {
    analytics.startMatch();
    if (state.fixedQuestions) {
      analytics.track('match_started', { source: 'challenge' });
      setState((prev) => ({
        ...initialState,
        category: prev.category,
        opponent: prev.opponent,
        activeVideo: prev.activeVideo,
        fixedQuestions: prev.fixedQuestions,
        questions: prev.fixedQuestions ?? [],
        phase: 'question',
      }));
      return;
    }

    try {
      const match = await startAsyncMatch(state.category);
      analytics.track('match_started', { source: match.opponentSource });
      setState((prev) => ({
        ...initialState,
        category: prev.category,
        opponent: match.opponent,
        questions: match.questions,
        activeMatchId: match.matchId,
        phase: 'question',
      }));
    } catch {
      analytics.track('match_started', { source: 'local_fallback' });
      setState((prev) => ({
        ...initialState,
        category: prev.category,
        opponent: sampleOpponent,
        questions: createQuestions(prev.category),
        phase: 'question',
      }));
    }
  }, [state.category, state.fixedQuestions]);

  const startChallenge = useCallback((tournament: Tournament, opponent: Opponent, fixedQuestions?: Question[]) => {
    setState({
      ...initialState,
      opponent,
      activeVideo: tournament.video,
      fixedQuestions,
      phase: 'matchmaking',
    });
  }, []);

  useEffect(() => {
    if (state.phase === 'result' && state.questions.length > 0) {
      analytics.track('match_completed', {
        playerProgress: state.playerProgress,
        opponentProgress: state.opponentProgress,
      });
    }
  }, [state.phase, state.questions.length]);

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
      let correct = false;
      if (question?.answerType === 'open_answer') {
        const result = isAnswerCorrect(optionId, question.correctAnswers ?? []);
        correct = result.correct;
      } else {
        correct = question && optionId === question.correctOptionId;
      }
      analytics.track('answer_submitted', {
        questionId: question?.id,
        questionIndex: prev.questionIndex,
        category: question?.category,
        difficulty: question?.difficulty,
        answerType: question?.answerType,
        selectedOption: optionId,
        correctness: correct,
        responseTimeMs: _timeMs,
      });
      return {
        ...prev,
        selectedOption: optionId,
        lastCorrect: correct,
        correctCount: correct ? prev.correctCount + 1 : prev.correctCount,
        responseTimes: [...prev.responseTimes, _timeMs],
        phase: 'resolution',
      };
    });
  }, []);

  const continueAfterResolution = useCallback(() => {
    setState((prev) => {
      if (prev.lastCorrect) {
        return { ...prev, phase: 'hammer' };
      }

      const oppGain = prev.opponent.rounds[prev.questionIndex]?.progressAwarded ?? 0;
      const newOpp = Math.min(100, prev.opponentProgress + oppGain);
      const roundInputs = [
        ...prev.roundInputs,
        {
          questionId: prev.questions[prev.questionIndex].id,
          selectedAnswer: prev.selectedOption,
          responseTimeMs: prev.responseTimes[prev.responseTimes.length - 1] ?? 0,
        },
      ];

      if (isFinished(prev.playerProgress, newOpp, prev.questionIndex, prev.questions.length)) {
        return { ...prev, opponentProgress: newOpp, roundInputs, phase: 'result' };
      }

      return {
        ...prev,
        opponentProgress: newOpp,
        roundInputs,
        questionIndex: prev.questionIndex + 1,
        phase: 'question',
      };
    });
  }, []);

  const completeHammer = useCallback((result: SkillResult, progress: number, distance: number) => {
    setState((prev) => {
      const newPlayer = Math.min(100, prev.playerProgress + progress);
      const newBest = !prev.bestSkill || SKILL_REWARDS[result] > SKILL_REWARDS[prev.bestSkill] ? result : prev.bestSkill;

      const oppGain = prev.opponent.rounds[prev.questionIndex]?.progressAwarded ?? 0;
      const newOpp = Math.min(100, prev.opponentProgress + oppGain);

      const skillResults = [...prev.skillResults, result];
      const roundInputs = [
        ...prev.roundInputs,
        {
          questionId: prev.questions[prev.questionIndex].id,
          selectedAnswer: prev.selectedOption,
          responseTimeMs: prev.responseTimes[prev.responseTimes.length - 1] ?? 0,
          skillDistance: distance,
        },
      ];

      if (isFinished(newPlayer, newOpp, prev.questionIndex, prev.questions.length)) {
        return {
          ...prev,
          playerProgress: newPlayer,
          opponentProgress: newOpp,
          lastSkill: result,
          bestSkill: newBest,
          skillResults,
          roundInputs,
          phase: 'result',
        };
      }

      return {
        ...prev,
        playerProgress: newPlayer,
        opponentProgress: newOpp,
        lastSkill: result,
        bestSkill: newBest,
        skillResults,
        roundInputs,
        questionIndex: prev.questionIndex + 1,
        phase: 'question',
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const goToCategories = useCallback(() => {
    setState({ ...initialState, phase: 'categories' });
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
    playerProgress: state.playerProgress,
    opponentProgress: state.opponentProgress,
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
    currentQuestion: state.questions[state.questionIndex],
    opponent: state.opponent,
    activeVideo: state.activeVideo,
    miniGameConfig,
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
