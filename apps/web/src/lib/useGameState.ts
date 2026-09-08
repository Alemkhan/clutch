import { useState, useCallback, useEffect } from 'react';
import { analytics } from './analytics';
import type { SkillResult, Question, Opponent, Tournament } from '@clutch/shared';
import { SKILL_REWARDS, isAnswerCorrect } from '@clutch/shared';
import { createQuestions, sampleOpponent, miniGameConfig } from './sampleData';

export type Phase = 'home' | 'categories' | 'matchmaking' | 'question' | 'resolution' | 'hammer' | 'result' | 'profile';

interface MatchState {
  phase: Phase;
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
}

const initialState: MatchState = {
  phase: 'home',
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
};

function isFinished(player: number, opponent: number, qIndex: number, total: number): boolean {
  return player >= 100 || opponent >= 100 || qIndex >= total - 1;
}

export function useGameState() {
  const [state, setState] = useState<MatchState>(initialState);

  const start = useCallback(() => {
    analytics.startMatch();
    analytics.track('match_started');
    setState((prev) => ({
      ...initialState,
      opponent: prev.opponent,
      activeVideo: prev.activeVideo,
      fixedQuestions: prev.fixedQuestions,
      questions: prev.fixedQuestions ?? createQuestions(),
      phase: 'question',
    }));
  }, []);

  const startChallenge = useCallback((tournament: Tournament, opponent: Opponent, fixedQuestions?: Question[]) => {
    analytics.track('match_started', { source: tournament.id });
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

      if (isFinished(prev.playerProgress, newOpp, prev.questionIndex, prev.questions.length)) {
        return { ...prev, opponentProgress: newOpp, phase: 'result' };
      }

      return {
        ...prev,
        opponentProgress: newOpp,
        questionIndex: prev.questionIndex + 1,
        phase: 'question',
      };
    });
  }, []);

  const completeHammer = useCallback((result: SkillResult, progress: number) => {
    setState((prev) => {
      const newPlayer = Math.min(100, prev.playerProgress + progress);
      const newBest = !prev.bestSkill || SKILL_REWARDS[result] > SKILL_REWARDS[prev.bestSkill] ? result : prev.bestSkill;

      const oppGain = prev.opponent.rounds[prev.questionIndex]?.progressAwarded ?? 0;
      const newOpp = Math.min(100, prev.opponentProgress + oppGain);

      const skillResults = [...prev.skillResults, result];

      if (isFinished(newPlayer, newOpp, prev.questionIndex, prev.questions.length)) {
        return {
          ...prev,
          playerProgress: newPlayer,
          opponentProgress: newOpp,
          lastSkill: result,
          bestSkill: newBest,
          skillResults,
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

  const goToMatchmaking = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'matchmaking' }));
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
