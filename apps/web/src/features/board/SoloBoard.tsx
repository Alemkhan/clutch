import { useEffect, useState } from 'react';
import type { CategoryId, SoloMode } from '@clutch/shared';
import { fetchDuelBoard, fetchSoloLeaderboard, fetchWikiPathBoard } from '../../platform/api';
import { resetLabel } from '../tiebreaker/tiebreakerClock';
import { useDayCountdown } from '../tiebreaker/useDayCountdown';
import { BoardKindSwitch, type BoardKind } from './BoardKindSwitch';
import { SoloBoardView, type SoloBoardState } from './DailyBoardView';
import { DuelBoardView, type DuelBoardState } from './DuelBoardView';
import { WikiPathBoardView, type WikiPathBoardState } from './WikiPathBoardView';
export { SoloBoardView, standingHint, type SoloBoardState } from './DailyBoardView';
export { BoardKindSwitch, type BoardKind } from './BoardKindSwitch';
export { DuelBoardView, duelRecord, type DuelBoardState } from './DuelBoardView';
export { WikiPathBoardView, wikiPathClicksText, type WikiPathBoardState } from './WikiPathBoardView';
interface SoloBoardProps {
  onBack: () => void;
  onPlay: (category: CategoryId, mode: SoloMode) => void;
  onWikiPath: () => void;
  initialKind?: BoardKind;
}

export function SoloBoard({ onBack, onPlay, onWikiPath, initialKind = 'daily' }: SoloBoardProps) {
  const [kind, setKind] = useState<BoardKind>(initialKind);
  const [category, setCategory] = useState<CategoryId>('general');
  const [state, setState] = useState<SoloBoardState>({ status: 'loading' });
  const [duels, setDuels] = useState<DuelBoardState>({ status: 'loading' });
  const [wikiPath, setWikiPath] = useState<WikiPathBoardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const msLeft = useDayCountdown();

  useEffect(() => {
    const controller = new AbortController();
    if (kind === 'daily') {
      setState({ status: 'loading' });
      fetchSoloLeaderboard(category, controller.signal)
        .then((board) => { if (!controller.signal.aborted) setState({ status: 'ready', board }); })
        .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    } else if (kind === 'duels') {
      setDuels({ status: 'loading' });
      fetchDuelBoard(controller.signal)
        .then((board) => { if (!controller.signal.aborted) setDuels({ status: 'ready', board }); })
        .catch(() => { if (!controller.signal.aborted) setDuels({ status: 'error' }); });
    } else {
      setWikiPath({ status: 'loading' });
      fetchWikiPathBoard(controller.signal)
        .then((board) => { if (!controller.signal.aborted) setWikiPath({ status: 'ready', board }); })
        .catch(() => { if (!controller.signal.aborted) setWikiPath({ status: 'error' }); });
    }
    return () => controller.abort();
  }, [kind, category, attempt]);

  const kindSwitch = <BoardKindSwitch kind={kind} onKind={setKind} />;
  const retry = () => setAttempt((value) => value + 1);
  if (kind === 'duels') {
    return (
      <DuelBoardView
        state={duels}
        msLeft={msLeft}
        onBack={onBack}
        onRetry={retry}
        onDuel={() => onPlay('general', 'duel')}
        kindSwitch={kindSwitch}
      />
    );
  }
  if (kind === 'wikiPath') {
    return (
      <WikiPathBoardView
        state={wikiPath}
        msLeft={msLeft}
        onBack={onBack}
        onRetry={retry}
        onPlay={onWikiPath}
        kindSwitch={kindSwitch}
      />
    );
  }
  return (
    <SoloBoardView
      state={state}
      msLeft={msLeft}
      category={category}
      onCategory={setCategory}
      onBack={onBack}
      onRetry={retry}
      onPlay={onPlay}
      kindSwitch={kindSwitch}
    />
  );
}
