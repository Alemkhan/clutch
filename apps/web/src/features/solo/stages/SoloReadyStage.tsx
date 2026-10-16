import { SOLO_ROUND_CAP } from "@clutch/shared";
import type { PracticeLevel } from "@clutch/shared";
import { TiebreakerReminder } from "../../tiebreaker/TiebreakerCard";
import { FRIEND_DUEL_CHIP } from "../friendDuelResult";
import { practiceBotLabel } from "../practiceResult";
import { soloPaceOf, type SoloFlowState } from "../soloRunFlow";
import type { SoloRunScreenProps } from "../soloScreenTypes";
import { MatchmakingFrame } from "./MatchmakingFrame";

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

function resumeNote(view: ReadyView): string {
  return `Уже сыграно кругов: ${view.roundsPlayed}, прогресс ${view.progress}% из ${view.target}%.`;
}

/** «Начать»/«Продолжить» и, для продолженного забега, «Начать заново». */
function StartButtons({ resumed, onStart, onRestart }: {
  resumed: boolean;
  onStart: () => void;
  onRestart: () => void;
}) {
  return (
    <>
      <button type="button" className="cta-btn" onClick={onStart}>
        {resumed ? "Продолжить" : "Начать"}
      </button>
      {resumed && (
        <button type="button" className="ghost-btn" onClick={onRestart}>
          Начать заново
        </button>
      )}
    </>
  );
}

export function PracticeReadyStage({ props, state, view, practice }: ReadyStageProps & { practice: PracticeLevel }) {
  const pace = soloPaceOf(state);
  return (
    <MatchmakingFrame onBack={props.onExit ?? props.onBackToCategories}>
      <span className="matchmaking-eyebrow">
        Тренировка · {practice.name}
      </span>
      <h1 className="screen-title">
        {state.resumed ? "Продолжаем тренировку" : "Всё готово"}
      </h1>
      <div className="matchmaking-card">
        <p className="matchmaking-status">
          Против: {pace ? practiceBotLabel(pace.displayName) : "бот"}. Не
          засчитывается.
        </p>
        {state.resumed && <p className="matchmaking-status">{resumeNote(view)}</p>}
        {/* Полоса соперника исчезла не сама: пока игрока не было, запись ушла к другому. */}
        {state.paceReleased && (
          <p className="matchmaking-status" role="status">
            Соперник отпущен: тебя долго не было, и его запись забрал другой игрок.
            Забег продолжается один и сам станет записью для следующего.
          </p>
        )}
      </div>
      <StartButtons resumed={state.resumed} onStart={props.onStart} onRestart={props.onBackToCategories} />
    </MatchmakingFrame>
  );
}

export function SoloReadyStage({ props, state, view }: ReadyStageProps) {
  return (
    <MatchmakingFrame onBack={props.onExit ?? props.onBackToCategories}>
      <span className="matchmaking-eyebrow">
        {state.friendDuel ? "Вызов друга" : "Соло-забег"}
      </span>
      <h1 className="screen-title">
        {state.resumed ? "Продолжаем забег" : "Забег готов"}
      </h1>
      {state.friendDuel && <span className="chip">{FRIEND_DUEL_CHIP}</span>}
      {state.bankExhausted && (
        <span className="match-source source-player abandoned-note">
          Все наборы дня в этой категории пройдены — выдан тот, что ты играл
          давнее всех
        </span>
      )}
      <div className="matchmaking-card">
        <p className="matchmaking-status">
          Дойди до {view.target}%, но не больше чем за {SOLO_ROUND_CAP}{" "}
          кругов. Верный ответ даёт попытку в мини-игре, удар двигает
          прогресс.
        </p>
        {state.resumed && <p className="matchmaking-status">{resumeNote(view)}</p>}
      </div>
      {props.onOpenTiebreaker && <TiebreakerReminder onOpen={props.onOpenTiebreaker} />}
      <StartButtons resumed={state.resumed} onStart={props.onStart} onRestart={props.onBackToCategories} />
      {!state.resumed && !state.friendDuel && props.onExit && (
        <button type="button" className="ghost-btn" onClick={props.onBackToCategories}>
          Другие категории
        </button>
      )}
    </MatchmakingFrame>
  );
}
