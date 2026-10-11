import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { CategoryId } from '@clutch/shared';
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
import { Training } from './components/Training';
import { RematchEntry } from './components/RematchEntry';
import { readLaunchIntent, type LaunchIntent } from './lib/launchIntent';
import { LastStand } from './components/LastStand';
import { SoloRun } from './components/SoloRun';
import { isSoloPlaying, type SoloStage } from './lib/soloRunFlow';
import { findChallenge } from './lib/tournaments';
import { completionQueue } from './lib/completionQueue';
import { analytics } from './lib/analytics';
import { abandonedNote } from './lib/matchmaking';
import { shouldShowMatchHud } from './lib/matchHud';
import { useTelegramBackButton } from './lib/useTelegramBackButton';

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
  const [launchIntent, setLaunchIntent] = useState<LaunchIntent | null>(readLaunchIntent);
  const closeLaunchIntent = useCallback(() => setLaunchIntent(null), []);
  const startRematch = useCallback((inviteId: string, category: CategoryId) => {
    setLaunchIntent(null);
    game.startRematch(inviteId, category);
  }, [game.startRematch]);
  const shellRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const screenDuration = reduceMotion ? 0 : 0.18;
  const showMatchHud = shouldShowMatchHud(game.phase);
  const [soloStage, setSoloStage] = useState<SoloStage>('categories');
  const soloPlaying = game.phase === 'solo' && isSoloPlaying(soloStage);
  // Молоток в соло получает тот же фон, что и в гонке.
  const shellPhase = game.phase === 'solo' && soloStage === 'hammer' ? 'hammer' : game.phase;

  useTelegramBackButton(game.phase, game.matchSource, {
    home: game.goHome,
    categories: game.goToCategories,
  }, soloPlaying);

  useEffect(() => {
    shellRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [game.phase, game.questionIndex, soloStage]);

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
    <main ref={shellRef} className={`app-shell phase-${shellPhase}`}>
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
        {game.phase === 'home' && launchIntent && (
          <motion.div key="launch" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <RematchEntry intent={launchIntent} onStartRematch={startRematch} onClose={closeLaunchIntent} />
          </motion.div>
        )}

        {game.phase === 'home' && !launchIntent && (
          <motion.div key="home" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <HomeDashboard
              onFindMatch={game.goToCategories}
              onProfile={game.goToProfile}
              onTraining={game.goToTraining}
              onLastStand={game.goToLastStand}
              onSolo={game.goToSolo}
              onChallenge={(tournamentId) => handleChallenge(tournamentId, game.startChallenge)}
            />
          </motion.div>
        )}

        {game.phase === 'profile' && (
          <motion.div key="profile" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <Profile onBack={game.goHome} />
          </motion.div>
        )}

        {game.phase === 'training' && (
          <motion.div key="training" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <Training
              questions={game.trainingQuestions}
              onAnswered={game.recordTrainingAnswer}
              onBack={game.goHome}
            />
          </motion.div>
        )}

        {game.phase === 'lastStand' && (
          <motion.div key="lastStand" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <LastStand onHome={game.goHome} />
          </motion.div>
        )}

        {game.phase === 'solo' && (
          <motion.div key="solo" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <SoloRun onHome={game.goHome} onStageChange={setSoloStage} />
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
              abandonedNote={abandonedNote(game.matchSource, game.opponent, game.totalQuestions)}
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
              key={`${game.questionIndex}:${game.currentQuestion.id}`}
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

        {game.phase === 'hammer' && game.currentQuestion && (
          <motion.div key="hammer" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <HammerGame
              key={game.questionIndex}
              config={game.miniGameConfig}
              questionId={game.currentQuestion.id}
              previousSkillResults={game.skillResults}
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
              abandonedNote={abandonedNote(game.matchSource, game.opponent, game.totalQuestions)}
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
