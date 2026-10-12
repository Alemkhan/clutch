import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { CategoryId, PracticeLevel } from '@clutch/shared';
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
import { TrainingHub } from './components/TrainingHub';
import { RematchEntry } from './components/RematchEntry';
import { readLaunchIntent, type LaunchIntent } from './lib/launchIntent';
import { LastStand } from './components/LastStand';
import { SoloRun, type SoloRematch } from './components/SoloRun';
import { MyRuns } from './components/MyRuns';
import { BottomNav, navTabForPhase, type NavTab } from './components/BottomNav';
import { isSoloPlaying, type SoloStage } from './lib/soloRunFlow';
import { completionQueue } from './lib/completionQueue';
import { analytics } from './lib/analytics';
import { abandonedNote } from './lib/matchmaking';
import { shouldShowMatchHud } from './lib/matchHud';
import { useTelegramBackButton } from './lib/useTelegramBackButton';

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
  const [soloRematch, setSoloRematch] = useState<SoloRematch | null>(null);
  // Тренировка против бота: уровень, с которым открыт экран solo. null — обычный забег.
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel | null>(null);
  // Режим берётся из приглашения: соло-приглашение нельзя запускать гоночным стартом и наоборот.
  const startRematch = useCallback((inviteId: string, category: CategoryId, mode: 'race' | 'solo') => {
    setLaunchIntent(null);
    setPracticeLevel(null);
    if (mode === 'solo') {
      setSoloRematch({ inviteId, category });
      game.goToSolo();
      return;
    }
    game.startRematch(inviteId, category);
  }, [game.startRematch, game.goToSolo]);
  // Приглашение из «Моих партий» открывается тем же экраном, что и ссылка из бота.
  const openInvite = useCallback((inviteId: string) => {
    game.goHome();
    setLaunchIntent({ type: 'rematch', inviteId });
  }, [game.goHome]);
  const startSolo = useCallback(() => {
    setSoloRematch(null);
    setPracticeLevel(null);
    game.goToSolo();
  }, [game.goToSolo]);
  const startPractice = useCallback((level: PracticeLevel) => {
    setSoloRematch(null);
    setPracticeLevel(level);
    game.goToSolo();
  }, [game.goToSolo]);
  const shellRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const screenDuration = reduceMotion ? 0 : 0.18;
  const showMatchHud = shouldShowMatchHud(game.phase);
  const [soloStage, setSoloStage] = useState<SoloStage>('categories');
  const soloPlaying = game.phase === 'solo' && isSoloPlaying(soloStage);
  // Молоток в соло получает тот же фон, что и в гонке.
  const shellPhase = game.phase === 'solo' && soloStage === 'hammer' ? 'hammer' : game.phase;

  // Практика ошибок внутри «Тренировки» — это игра: панель на ней скрыта.
  const [trainingPlaying, setTrainingPlaying] = useState(false);
  const navTab = navTabForPhase(game.phase);
  const showNav = navTab !== null && !(game.phase === 'home' && launchIntent) && !(game.phase === 'training' && trainingPlaying);
  const selectNavTab = useCallback((tab: NavTab) => {
    if (tab === 'home') game.goHome();
    else if (tab === 'myRuns') game.goToMyRuns();
    else if (tab === 'training') game.goToTraining();
    else game.goToProfile();
  }, [game.goHome, game.goToMyRuns, game.goToTraining, game.goToProfile]);

  useTelegramBackButton(game.phase, {
    // В тренировке системная «Назад» ведёт к её разделу, а не на главную.
    home: game.phase === 'solo' && practiceLevel ? game.goToTraining : game.goHome,
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
    <>
    <main ref={shellRef} className={`app-shell phase-${shellPhase}${showNav ? ' has-nav' : ''}`}>
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
              onLastStand={game.goToLastStand}
              onSolo={startSolo}
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
            <TrainingHub
              mistakeIds={game.trainingIds}
              onAnswered={game.recordTrainingAnswer}
              onStartBot={startPractice}
              onPlayingChange={setTrainingPlaying}
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
            <SoloRun
              onHome={practiceLevel ? game.goToTraining : game.goHome}
              practice={practiceLevel ?? undefined}
              onMyRuns={game.goToMyRuns}
              rematch={soloRematch}
              onStageChange={setSoloStage}
            />
          </motion.div>
        )}

        {game.phase === 'myRuns' && (
          <motion.div key="myRuns" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <MyRuns onBack={game.goHome} onOpenInvite={openInvite} onPlay={startSolo} />
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
              status={game.matchmakingStatus}
              source={game.matchSource}
              abandonedNote={abandonedNote(game.matchSource, game.opponent, game.totalQuestions)}
              error={game.matchmakingError}
              onStart={game.start}
              onRetry={game.retryMatchmaking}
              onBack={game.goToCategories}
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
              explanation={game.currentQuestion.explanation}
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
    {showNav && navTab && <BottomNav active={navTab} onSelect={selectNavTab} />}
    </>
  );
}
