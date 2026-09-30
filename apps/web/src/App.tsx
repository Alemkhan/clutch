import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameState } from './lib/useGameState';
import { MatchHud } from './components/MatchHud';
import { HomeDashboard } from './components/HomeDashboard';
import { CategorySelect } from './components/CategorySelect';
import { Matchmaking } from './components/Matchmaking';
import { Profile } from './components/Profile';
import { QuestionScreen } from './components/QuestionScreen';
import { ResolutionScreen } from './components/ResolutionScreen';
import { HammerGame } from './components/HammerGame';
import { ResultScreen } from './components/ResultScreen';
import { findChallenge } from './lib/tournaments';
import { completionQueue } from './lib/completionQueue';
import { analytics } from './lib/analytics';

function handleChallenge(tournamentId: string, startChallenge: ReturnType<typeof useGameState>['startChallenge']) {
  const challenge = findChallenge(tournamentId);
  if (!challenge) return;
  startChallenge(challenge.tournament, challenge.opponent, challenge.questions);
}

const screenTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

// main is a flex column; each phase wrapper must pass that layout through to its
// section child (which relies on flex: 1 to fill/center), or content stops centering.
const screenWrapperStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  flex: 1,
  width: '100%',
  minWidth: 0,
};

export default function App() {
  const game = useGameState();
  const shellRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const screenDuration = reduceMotion ? 0 : 0.18;
  const showMatchHud = ['question', 'resolution'].includes(game.phase);

  useEffect(() => {
    shellRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [game.phase, game.questionIndex]);

  useEffect(() => {
    const unsubscribe = completionQueue.subscribe((event) => {
      if (event.type === 'confirmed') {
        analytics.track('match_save_succeeded', { matchId: event.entry.matchId });
      } else if (event.entry.status === 'error') {
        analytics.track('match_save_failed', { matchId: event.entry.matchId });
      }
    });
    void completionQueue.flush();
    const flushPending = () => { void completionQueue.flush(); };
    window.addEventListener('online', flushPending);
    return () => {
      unsubscribe();
      window.removeEventListener('online', flushPending);
    };
  }, []);

  return (
    <main ref={shellRef} className={`app-shell phase-${game.phase}`}>
      {showMatchHud && (
        <MatchHud
          player={game.playerProgress}
          opponent={game.opponentProgress}
          opponentName={game.opponent.displayName}
          round={game.questionIndex + 1}
          totalRounds={game.totalQuestions}
        />
      )}

      <AnimatePresence mode="wait">
        {game.phase === 'home' && (
          <motion.div key="home" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <HomeDashboard
              onFindMatch={game.goToCategories}
              onProfile={game.goToProfile}
              onChallenge={(tournamentId) => handleChallenge(tournamentId, game.startChallenge)}
            />
          </motion.div>
        )}

        {game.phase === 'profile' && (
          <motion.div key="profile" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <Profile onBack={game.goHome} />
          </motion.div>
        )}

        {game.phase === 'categories' && (
          <motion.div key="categories" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <CategorySelect onSelect={game.goToMatchmaking} onBack={game.goHome} />
          </motion.div>
        )}

        {game.phase === 'matchmaking' && (
          <motion.div key="matchmaking" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <Matchmaking
              opponent={game.opponent}
              video={game.activeVideo}
              status={game.matchmakingStatus}
              source={game.matchSource}
              error={game.matchmakingError}
              onStart={game.start}
              onRetry={game.retryMatchmaking}
              onLocalPractice={game.useLocalPractice}
              onBack={game.matchSource === 'challenge' ? game.goHome : game.goToCategories}
            />
          </motion.div>
        )}

        {game.phase === 'question' && game.currentQuestion && (
          <motion.div key="question" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <QuestionScreen
              key={game.questionIndex}
              question={game.currentQuestion}
              onAnswer={game.answer}
            />
          </motion.div>
        )}

        {game.phase === 'resolution' && game.currentQuestion && (
          <motion.div key="resolution" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <ResolutionScreen
              question={game.currentQuestion}
              correct={game.lastCorrect}
              selectedOptionId={game.selectedOption}
              onContinue={game.continueAfterResolution}
            />
          </motion.div>
        )}

        {game.phase === 'hammer' && (
          <motion.div key="hammer" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <HammerGame
              key={game.questionIndex}
              config={game.miniGameConfig}
              onComplete={game.completeHammer}
            />
          </motion.div>
        )}

        {game.phase === 'result' && (
          <motion.div key="result" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <ResultScreen
              playerProgress={game.playerProgress}
              opponentProgress={game.opponentProgress}
              opponentName={game.opponent.displayName}
              matchSource={game.matchSource}
              bestSkill={game.bestSkill}
              correctCount={game.correctCount}
              questionsPlayed={game.questionsPlayed}
              perfectHits={game.perfectHits}
              avgResponseMs={game.avgResponseMs}
              saveStatus={game.resultSaveStatus}
              saveError={game.resultSaveError}
              canRetrySave={game.canRetryResultSave}
              onRetrySave={game.retryResultSave}
              onReplay={game.replay}
              onHome={game.goHome}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
