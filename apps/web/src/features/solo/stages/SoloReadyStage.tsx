import { SOLO_ROUND_CAP, opponentFinishRound, type SoloMode } from "@clutch/shared";
import type { PracticeLevel } from "@clutch/shared";
import { TiebreakerReminder } from "../../tiebreaker/TiebreakerCard";
import { FRIEND_DUEL_CHIP } from "../friendDuelResult";
import { practiceBotLabel } from "../practiceResult";
import { soloPaceOf, type SoloFlowState } from "../soloRunFlow";
import { messagesFor, useMessages } from "../../../i18n/messages";
import type { SoloRunScreenProps } from "../soloScreenTypes";
import { MatchmakingFrame } from "./MatchmakingFrame";
import { MiniGameCard } from "./MiniGameCard";
import { m } from "./messages";

type T = (typeof m)["ru"];

interface ReadyView {
  roundsPlayed: number;
  progress: number;
  target: number;
}

interface ReadyStageProps {
  props: SoloRunScreenProps;
  state: SoloFlowState;
  view: ReadyView;
}

function resumeNote(view: ReadyView, t: T = messagesFor(m)): string {
  return t.resumeNote(view.roundsPlayed, view.progress, view.target);
}

/** «Начать»/«Продолжить» и, для продолженного забега, «Начать заново». */
function StartButtons({ resumed, onStart, onRestart, restartLabel, abandoning = false, abandonError }: {
  resumed: boolean;
  onStart: () => void;
  onRestart: () => void;
  restartLabel?: string;
  abandoning?: boolean;
  abandonError?: string | null;
}) {
  const t = useMessages(m);
  return (
    <>
      <button type="button" className="cta-btn" onClick={onStart}>
        {resumed ? t.resume : t.start}
      </button>
      {resumed && (
        <button type="button" className="ghost-btn" disabled={abandoning} onClick={onRestart}>
          {abandoning ? t.closing : restartLabel ?? t.restart}
        </button>
      )}
      {abandonError && <p className="matchmaking-error" role="alert">{abandonError}</p>}
    </>
  );
}

export function PracticeReadyStage({ props, state, view, practice }: ReadyStageProps & { practice: PracticeLevel }) {
  const t = useMessages(m);
  const pace = soloPaceOf(state);
  return (
    <MatchmakingFrame onBack={state.resumed ? props.onBackToCategories : props.onExit ?? props.onBackToCategories}>
      <span className="matchmaking-eyebrow">
        {t.practiceEyebrow(practice.name)}
      </span>
      <h1 className="screen-title">
        {state.resumed ? t.practiceResumedTitle : t.allReady}
      </h1>
      <MiniGameCard miniGameId={state.miniGameId} />
      <div className="matchmaking-card">
        <p className="matchmaking-status">
          {t.practiceAgainst(pace ? practiceBotLabel(pace.displayName) : t.bot)}
        </p>
        {state.resumed && <p className="matchmaking-status">{resumeNote(view, t)}</p>}
        {/* Полоса соперника исчезла не сама: пока игрока не было, запись ушла к другому. */}
        {state.paceReleased && (
          <p className="matchmaking-status" role="status">
            {t.paceReleased}
          </p>
        )}
      </div>
      <StartButtons resumed={state.resumed} onStart={props.onStart} onRestart={props.onRestart ?? props.onBackToCategories} abandoning={props.abandoning} abandonError={props.abandonError} />
    </MatchmakingFrame>
  );
}

function modeTitle(mode: SoloMode, t: T): string {
  return mode === "daily" ? t.modeDaily : mode === "free" ? t.modeFree : t.modeDuel;
}

/**
 * Одна короткая строка о забеге: экран готовности должен помещаться целиком вместе с кнопкой
 * «Начать». Как устроен круг, объясняет карточка мини-игры, здесь только то, чем режим отличается.
 */
function readyLine(state: SoloFlowState, target: number, t: T = messagesFor(m)): string {
  const cap = state.session?.roundCap ?? SOLO_ROUND_CAP;
  const pace = soloPaceOf(state);
  const finish = opponentFinishRound(pace);
  // Против записи (дуэль, вызов друга): её финиш и есть потолок партии.
  if (pace && finish !== null && (state.friendDuel || state.mode === "duel")) {
    return t.readyVsRecord(pace.displayName, target, finish);
  }
  if (state.mode === "daily") return t.readyDaily(target, cap);
  if (state.mode === "free") return t.readyFree(target, cap);
  if (state.mode === "duel") return t.readyDuel(target, cap);
  return t.readyDefault(target, cap);
}

export function SoloReadyStage({ props, state, view }: ReadyStageProps) {
  const t = useMessages(m);
  const title = state.groupChallenge ? t.groupChallenge : state.friendDuel ? t.friendChallenge : state.mode ? modeTitle(state.mode, t) : t.run;
  return (
    <MatchmakingFrame onBack={state.resumed ? props.onBackToCategories : props.onExit ?? props.onBackToCategories}>
      <h1 className="screen-title">{title}</h1>
      {state.friendDuel && <span className="chip">{FRIEND_DUEL_CHIP}</span>}
      <MiniGameCard miniGameId={state.miniGameId} />
      <div className="matchmaking-card">
        <p className="matchmaking-status">{readyLine(state, view.target, t)}</p>
        {state.resumed && view.roundsPlayed > 0 && <p className="matchmaking-status">{resumeNote(view, t)}</p>}
      </div>
      {props.onOpenTiebreaker && <TiebreakerReminder onOpen={props.onOpenTiebreaker} />}
      <StartButtons
        resumed={state.resumed}
        onStart={props.onStart}
        onRestart={props.onRestart ?? props.onBackToCategories}
        restartLabel={state.resumed && state.mode === "daily" && !state.friendDuel
          ? t.abandonDaily
          : t.restart}
        abandoning={props.abandoning}
        abandonError={props.abandonError}
      />
      {!state.resumed && !state.friendDuel && props.onExit && (
        <button type="button" className="ghost-btn" onClick={props.onBackToCategories}>
          {t.otherCategories}
        </button>
      )}
    </MatchmakingFrame>
  );
}
