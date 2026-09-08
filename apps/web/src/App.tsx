import { useGameState } from './lib/useGameState';
import { ProgressBars } from './components/ProgressBars';
import { HomeDashboard } from './components/HomeDashboard';
import { CategorySelect } from './components/CategorySelect';
import { Matchmaking } from './components/Matchmaking';
import { Profile } from './components/Profile';
import { QuestionScreen } from './components/QuestionScreen';
import { ResolutionScreen } from './components/ResolutionScreen';
import { HammerGame } from './components/HammerGame';
import { ResultScreen } from './components/ResultScreen';
import { findChallenge } from './lib/tournaments';

function handleChallenge(tournamentId: string, startChallenge: ReturnType<typeof useGameState>['startChallenge']) {
  const challenge = findChallenge(tournamentId);
  if (!challenge) return;
  startChallenge(challenge.tournament, challenge.opponent, challenge.questions);
}

export default function App() {
  const game = useGameState();
  const showProgress = ['question', 'resolution', 'hammer'].includes(game.phase);

  return (
    <main>
      {showProgress && (
        <ProgressBars
          player={game.playerProgress}
          opponent={game.opponentProgress}
          opponentName={game.opponent.displayName}
        />
      )}

      {game.phase === 'home' && (
        <HomeDashboard
          onFindMatch={game.goToCategories}
          onProfile={game.goToProfile}
          onChallenge={(tournamentId) => handleChallenge(tournamentId, game.startChallenge)}
        />
      )}

      {game.phase === 'profile' && <Profile onBack={game.goHome} />}

      {game.phase === 'categories' && (
        <CategorySelect onSelect={game.goToMatchmaking} onBack={game.goHome} />
      )}

      {game.phase === 'matchmaking' && (
        <Matchmaking opponent={game.opponent} video={game.activeVideo} onDone={game.start} />
      )}

      {game.phase === 'question' && game.currentQuestion && (
        <QuestionScreen
          key={game.questionIndex}
          question={game.currentQuestion}
          questionNumber={game.questionIndex + 1}
          totalQuestions={game.totalQuestions}
          onAnswer={game.answer}
        />
      )}

      {game.phase === 'resolution' && game.currentQuestion && (
        <ResolutionScreen
          question={game.currentQuestion}
          correct={game.lastCorrect}
          selectedOptionId={game.selectedOption}
          onContinue={game.continueAfterResolution}
        />
      )}

      {game.phase === 'hammer' && (
        <HammerGame
          key={game.questionIndex}
          config={game.miniGameConfig}
          onComplete={game.completeHammer}
        />
      )}

      {game.phase === 'result' && (
        <ResultScreen
          playerProgress={game.playerProgress}
          opponentProgress={game.opponentProgress}
          opponentName={game.opponent.displayName}
          bestSkill={game.bestSkill}
          correctCount={game.correctCount}
          totalQuestions={game.totalQuestions}
          perfectHits={game.perfectHits}
          avgResponseMs={game.avgResponseMs}
          onReplay={game.start}
          onHome={game.goHome}
        />
      )}
    </main>
  );
}
