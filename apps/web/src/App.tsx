import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { CategoryId, PracticeLevel, SoloMode } from '@clutch/shared';
import { useGameState } from './app/useGameState';
import { HomeDashboard } from './features/home/HomeDashboard';
import { Profile } from './features/profile/Profile';
import { TrainingHub } from './features/training/TrainingHub';
import { RematchEntry } from './features/solo/RematchEntry';
import { readLaunchIntent, type LaunchIntent } from './app/launchIntent';
import { LastStand } from './features/lastStand/LastStand';
import { SoloRun, type SoloRematch } from './features/solo/SoloRun';
import { MyRuns } from './features/myRuns/MyRuns';
import { SoloBoard, type BoardKind } from './features/board/SoloBoard';
import { TiebreakerScreen } from './features/tiebreaker/Tiebreaker';
import { WikiPathScreen } from './features/wikiPath/WikiPathScreen';
import { useWikiPathToday } from './features/wikiPath/useWikiPathToday';
import { BottomNav, navTabForPhase, type NavTab } from './ui/BottomNav';
import { isSoloPlaying, type SoloStage } from './features/solo/soloRunFlow';
import { useTelegramBackButton } from './platform/useTelegramBackButton';
import { setClientErrorScreen } from './platform/clientErrors';

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

function WikiPathEntry({ onBack, onCompleted, onPageLoaded }: { onBack: () => void; onCompleted: () => void; onPageLoaded: () => void }) {
  const today = useWikiPathToday();
  return <WikiPathScreen today={today.state} onRetryToday={today.reload} onBack={onBack} onCompleted={onCompleted} onPageLoaded={onPageLoaded} />;
}

export default function App() {
  const game = useGameState();
  const [launchIntent, setLaunchIntent] = useState<LaunchIntent | null>(readLaunchIntent);
  const launchOverlay = launchIntent?.type === 'rematch'
    || launchIntent?.type === 'unsubscribe'
    || launchIntent?.type === 'daily-unsubscribe';
  const closeLaunchIntent = useCallback(() => setLaunchIntent(null), []);
  const [soloRematch, setSoloRematch] = useState<SoloRematch | null>(null);
  const [boardKind, setBoardKind] = useState<BoardKind>('daily');
  const openBoard = useCallback((kind: BoardKind = 'daily') => {
    setBoardKind(kind);
    game.goToBoard();
  }, [game.goToBoard]);
  // Тренировка против бота: уровень, с которым открыт экран solo. null — обычный забег.
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel | null>(null);
  const startRematch = useCallback((inviteId: string, category: CategoryId) => {
    setLaunchIntent(null);
    setPracticeLevel(null);
    setSoloRematch({ inviteId, category });
    game.goToSolo();
  }, [game.goToSolo]);
  // Приглашение из «Моих партий» открывается тем же экраном, что и ссылка из бота.
  const openInvite = useCallback((inviteId: string) => {
    game.goHome();
    setLaunchIntent({ type: 'rematch', inviteId });
  }, [game.goHome]);
  // Категория забега: таблица дня зовёт играть в ту категорию, на вкладке которой стоит игрок.
  const [soloCategory, setSoloCategory] = useState<CategoryId>('general');
  // Режим забега и ключ экрана: смена режима с экрана результата открывает забег заново.
  const [soloMode, setSoloMode] = useState<SoloMode>('daily');
  const [soloKey, setSoloKey] = useState(0);
  const startSolo = useCallback((category: CategoryId = 'general', mode: SoloMode = 'daily') => {
    setSoloRematch(null);
    setPracticeLevel(null);
    setSoloCategory(category);
    setSoloMode(mode);
    setSoloKey((key) => key + 1);
    game.goToSolo();
  }, [game.goToSolo]);
  const playMode = useCallback((mode: SoloMode, category: CategoryId) => startSolo(category, mode), [startSolo]);
  const startPractice = useCallback((level: PracticeLevel) => {
    setSoloRematch(null);
    setPracticeLevel(level);
    game.goToSolo();
  }, [game.goToSolo]);
  const shellRef = useRef<HTMLElement>(null);
  const scrollShellToTop = useCallback(() => {
    shellRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, []);
  const reduceMotion = useReducedMotion();
  const screenDuration = reduceMotion ? 0 : 0.18;
  const [soloStage, setSoloStage] = useState<SoloStage>('categories');
  const soloPlaying = game.phase === 'solo' && isSoloPlaying(soloStage);
  // Молоток в соло получает собственный фон оболочки.
  const shellPhase = game.phase === 'solo' && soloStage === 'hammer' ? 'hammer' : game.phase;

  // Практика ошибок внутри «Тренировки» — это игра: панель на ней скрыта.
  const [trainingPlaying, setTrainingPlaying] = useState(false);
  // Тренировка открыта с экрана итога: сразу отработка ошибок. Вкладка снизу открывает меню.
  const [trainingMistakes, setTrainingMistakes] = useState(false);

  useEffect(() => {
    if (launchIntent?.type === 'daily-tiebreaker') {
      game.goToTiebreaker();
      setLaunchIntent(null);
    } else if (launchIntent?.type === 'daily-wiki-path') {
      game.goToWikiPath();
      setLaunchIntent(null);
    }
  }, [launchIntent, game.goToTiebreaker, game.goToWikiPath]);
  const goToMistakes = useCallback(() => {
    setTrainingMistakes(true);
    game.goToTraining();
  }, [game.goToTraining]);
  useEffect(() => { setClientErrorScreen(shellPhase); }, [shellPhase]);
  const navTab = navTabForPhase(game.phase);
  const showNav = navTab !== null && !(game.phase === 'home' && launchOverlay) && !(game.phase === 'training' && trainingPlaying);
  const selectNavTab = useCallback((tab: NavTab) => {
    if (tab === 'home') game.goHome();
    else if (tab === 'myRuns') game.goToMyRuns();
    else if (tab === 'training') {
      setTrainingMistakes(false);
      game.goToTraining();
    }
    else game.goToProfile();
  }, [game.goHome, game.goToMyRuns, game.goToTraining, game.goToProfile]);

  useTelegramBackButton(game.phase, {
    // В тренировке системная «Назад» ведёт к её разделу, а не на главную.
    home: game.phase === 'solo' && practiceLevel ? game.goToTraining : game.goHome,
  }, soloPlaying);

  useEffect(() => {
    shellRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [game.phase, soloStage]);

  return (
    <>
    <main ref={shellRef} className={`app-shell phase-${shellPhase}${showNav ? ' has-nav' : ''}`}>
      <AnimatePresence mode="wait">
        {game.phase === 'home' && launchIntent && launchOverlay && (
          <motion.div key="launch" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <RematchEntry intent={launchIntent} onStartRematch={startRematch} onClose={closeLaunchIntent} />
          </motion.div>
        )}

        {game.phase === 'home' && !launchOverlay && (
          <motion.div key="home" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <HomeDashboard
              onSolo={(mode) => startSolo('general', mode)}
              onBoard={() => openBoard('daily')}
              onTiebreaker={game.goToTiebreaker}
              onWikiPath={game.goToWikiPath}
            />
          </motion.div>
        )}

        {game.phase === 'profile' && (
          <motion.div key="profile" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <Profile />
          </motion.div>
        )}

        {game.phase === 'training' && (
          <motion.div key="training" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <TrainingHub
              key={trainingMistakes ? 'mistakes' : 'menu'}
              openMistakes={trainingMistakes}
              onStartBot={startPractice}
              onPlayingChange={setTrainingPlaying}
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
              key={soloKey}
              mode={soloMode}
              onPlayMode={playMode}
              onPracticeMistakes={goToMistakes}
              onHome={practiceLevel ? game.goToTraining : game.goHome}
              practice={practiceLevel ?? undefined}
              onMyRuns={game.goToMyRuns}
              rematch={soloRematch}
              defaultCategory={practiceLevel ? undefined : soloCategory}
              onStageChange={setSoloStage}
            />
          </motion.div>
        )}

        {game.phase === 'board' && (
          <motion.div key="board" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <SoloBoard
              initialKind={boardKind}
              onBack={game.goHome}
              onPlay={(category, mode) => startSolo(category, mode)}
              onWikiPath={game.goToWikiPath}
            />
          </motion.div>
        )}

        {game.phase === 'tiebreaker' && (
          <motion.div key="tiebreaker" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <TiebreakerScreen onBack={game.goHome} />
          </motion.div>
        )}

        {game.phase === 'wikiPath' && (
          <motion.div key="wikiPath" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <WikiPathEntry onBack={game.goHome} onCompleted={() => openBoard('wikiPath')} onPageLoaded={scrollShellToTop} />
          </motion.div>
        )}

        {game.phase === 'myRuns' && (
          <motion.div key="myRuns" {...screenTransition} style={screenWrapperStyle} transition={{ duration: screenDuration }}>
            <MyRuns onOpenInvite={openInvite} onPlay={() => startSolo()} />
          </motion.div>
        )}

      </AnimatePresence>
    </main>
    {showNav && navTab && <BottomNav active={navTab} onSelect={selectNavTab} />}
    </>
  );
}
