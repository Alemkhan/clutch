import { SOLO_ROUND_CAP, opponentFinishRound, type SoloMode } from "@clutch/shared";
import type { PracticeLevel } from "@clutch/shared";
import { TiebreakerReminder } from "../../tiebreaker/TiebreakerCard";
import { FRIEND_DUEL_CHIP } from "../friendDuelResult";
import { practiceBotLabel } from "../practiceResult";
import { soloPaceOf, type SoloFlowState } from "../soloRunFlow";
import { circles } from "../soloResultModel";
import type { SoloRunScreenProps } from "../soloScreenTypes";
import { MatchmakingFrame } from "./MatchmakingFrame";
import { MiniGameCard } from "./MiniGameCard";

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
  return `Продолжаем: сыграно ${circles(view.roundsPlayed)}, ${view.progress}% из ${view.target}%.`;
}

/** «Начать»/«Продолжить» и, для продолженного забега, «Начать заново». */
function StartButtons({ resumed, onStart, onRestart, restartLabel = "Начать заново", abandoning = false, abandonError }: {
  resumed: boolean;
  onStart: () => void;
  onRestart: () => void;
  restartLabel?: string;
  abandoning?: boolean;
  abandonError?: string | null;
}) {
  return (
    <>
      <button type="button" className="cta-btn" onClick={onStart}>
        {resumed ? "Продолжить" : "Начать"}
      </button>
      {resumed && (
        <button type="button" className="ghost-btn" disabled={abandoning} onClick={onRestart}>
          {abandoning ? "Закрываем…" : restartLabel}
        </button>
      )}
      {abandonError && <p className="matchmaking-error" role="alert">{abandonError}</p>}
    </>
  );
}

export function PracticeReadyStage({ props, state, view, practice }: ReadyStageProps & { practice: PracticeLevel }) {
  const pace = soloPaceOf(state);
  return (
    <MatchmakingFrame onBack={state.resumed ? props.onBackToCategories : props.onExit ?? props.onBackToCategories}>
      <span className="matchmaking-eyebrow">
        Тренировка · {practice.name}
      </span>
      <h1 className="screen-title">
        {state.resumed ? "Продолжаем тренировку" : "Всё готово"}
      </h1>
      <MiniGameCard miniGameId={state.miniGameId} />
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
      <StartButtons resumed={state.resumed} onStart={props.onStart} onRestart={props.onRestart ?? props.onBackToCategories} abandoning={props.abandoning} abandonError={props.abandonError} />
    </MatchmakingFrame>
  );
}

const MODE_TITLE: Readonly<Record<SoloMode, string>> = {
  daily: "Забег дня",
  free: "Свободная игра",
  duel: "Дуэль",
};

/**
 * Одна короткая строка о забеге: экран готовности должен помещаться целиком вместе с кнопкой
 * «Начать». Как устроен круг, объясняет карточка мини-игры, здесь только то, чем режим отличается.
 */
function readyLine(state: SoloFlowState, target: number): string {
  const cap = state.session?.roundCap ?? SOLO_ROUND_CAP;
  const pace = soloPaceOf(state);
  const finish = opponentFinishRound(pace);
  // Против записи (дуэль, вызов друга): её финиш и есть потолок партии.
  if (pace && finish !== null && (state.friendDuel || state.mode === "duel")) {
    return `${pace.displayName}: ${target}% за ${circles(finish)}. Успей быстрее.`;
  }
  if (state.mode === "daily") return `Общий набор дня, в таблицу — первая попытка. До ${target}% за ${cap} кругов.`;
  if (state.mode === "free") return `Новые вопросы, вне таблицы. До ${target}% за ${cap} кругов.`;
  if (state.mode === "duel") return `Соперника пока нет: твой забег станет вызовом. До ${target}% за ${cap} кругов.`;
  return `До ${target}% за ${cap} кругов.`;
}

export function SoloReadyStage({ props, state, view }: ReadyStageProps) {
  const title = state.friendDuel ? "Вызов друга" : state.mode ? MODE_TITLE[state.mode] : "Забег";
  return (
    <MatchmakingFrame onBack={state.resumed ? props.onBackToCategories : props.onExit ?? props.onBackToCategories}>
      <h1 className="screen-title">{title}</h1>
      {state.friendDuel && <span className="chip">{FRIEND_DUEL_CHIP}</span>}
      <MiniGameCard miniGameId={state.miniGameId} />
      <div className="matchmaking-card">
        <p className="matchmaking-status">{readyLine(state, view.target)}</p>
        {state.resumed && view.roundsPlayed > 0 && <p className="matchmaking-status">{resumeNote(view)}</p>}
      </div>
      {props.onOpenTiebreaker && <TiebreakerReminder onOpen={props.onOpenTiebreaker} />}
      <StartButtons
        resumed={state.resumed}
        onStart={props.onStart}
        onRestart={props.onRestart ?? props.onBackToCategories}
        restartLabel={state.resumed && state.mode === "daily" && !state.friendDuel
          ? "Бросить и выбрать категорию"
          : "Начать заново"}
        abandoning={props.abandoning}
        abandonError={props.abandonError}
      />
      {!state.resumed && !state.friendDuel && props.onExit && (
        <button type="button" className="ghost-btn" onClick={props.onBackToCategories}>
          Другие категории
        </button>
      )}
    </MatchmakingFrame>
  );
}
