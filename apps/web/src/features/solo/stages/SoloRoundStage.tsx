import { useState } from "react";
import { SOLO_TARGET_PROGRESS } from "@clutch/shared";
import { HammerGame } from "../../hammer/HammerGame";
import { strikeGain } from "../../hammer/hammerStrike";
import { TowerGame } from "../../tower/TowerGame";
import { QuestionScreen } from "../../round/QuestionScreen";
import { ResolutionScreen } from "../../round/ResolutionScreen";
import {
  currentSoloQuestion,
  soloPaceOf,
  soloRoundsLeft,
  type SoloFlowState,
} from "../soloRunFlow";
import type { SoloRunView } from "../soloRunSession";
import type { SoloRunScreenProps } from "../soloScreenTypes";
import { SoloHud } from "../SoloHud";

type Question = NonNullable<ReturnType<typeof currentSoloQuestion>>;

interface RoundStageProps {
  props: SoloRunScreenProps;
  state: SoloFlowState;
  view: SoloRunView;
  question: Question;
}

/** Прирост живёт, пока сервер не засчитал круг: потом roundsPlayed растёт и view.progress уже с ним. */
function pendingStrikeGain({ props, state, view }: Omit<RoundStageProps, "question">) {
  return props.strike && props.strike.roundsPlayed === view.roundsPlayed
    && (state.stage === "hammer" || state.stage === "submitting")
    ? strikeGain(view.progress, props.strike.reward, SOLO_TARGET_PROGRESS)
    : null;
}

function RoundHud({ props, state, view }: Omit<RoundStageProps, "question">) {
  const pending = pendingStrikeGain({ props, state, view });
  const pace = soloPaceOf(state);
  return (
    <SoloHud
      progress={pending ? pending.total : view.progress}
      gain={pending?.gain ?? 0}
      paceProgress={view.paceProgress}
      paceName={pace?.displayName ?? null}
      round={view.round}
      roundsLeft={soloRoundsLeft(view)}
    />
  );
}

/** Круг ждёт сервер: ожидание, а после обрыва связи — «Повторить» или «Выйти». */
function SyncStatus({ props, state }: Pick<RoundStageProps, "props" | "state">) {
  if (!props.syncError) {
    return (
      <div className="matchmaking-loading solo-sync" role="status">
        <span />{" "}
        {state.stage === "checking" ? "Проверяем ответ" : "Засчитываем удар"}
      </div>
    );
  }
  return (
    <div className="solo-sync">
      <p className="matchmaking-error" role="alert">
        {props.syncError}
      </p>
      {props.canRetrySync ? (
        <button type="button" className="cta-btn" onClick={props.onRetrySync}>
          Повторить
        </button>
      ) : (
        <button type="button" className="cta-btn" onClick={props.onHome}>
          Выйти
        </button>
      )}
    </div>
  );
}

function RoundResolution({ props, state, view, question }: RoundStageProps) {
  const selectedAnswer = question.answerType === "multiple_choice"
    ? question.options.find((option) => option.id === state.selectedOption)?.text
    : undefined;
  return (
    <ResolutionScreen
      correctAnswer={state.correctAnswer}
      selectedAnswer={state.lastCorrect ? undefined : selectedAnswer}
      explanation={state.explanation}
      correct={state.lastCorrect}
      timedOut={state.selectedOption === "__timeout__"}
      final={soloRoundsLeft(view) <= 1}
      onContinue={props.onContinue}
      report={
        props.onReport
          ? { onSend: props.onReport, state: props.reportState ?? "idle" }
          : undefined
      }
    />
  );
}

/** Мини-игра забега: её выбрал сервер при старте; контракт пропсов у обеих игр один. */
function MiniGame({ props, state, view, question }: RoundStageProps) {
  const Game = state.miniGameId === "tower_stack" ? TowerGame : HammerGame;
  return (
    <Game
      key={view.roundsPlayed}
      config={state.config}
      questionId={question.id}
      previousSkillResults={state.skillResults}
      progressBefore={view.progress}
      onStrike={props.onStrike}
      onComplete={props.onHammerComplete}
    />
  );
}

export function SoloRoundStage({ props, state, view, question }: RoundStageProps) {
  const [confirmExit, setConfirmExit] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const abandon = async () => {
    if (!props.onAbandon || exitBusy) return;
    setExitBusy(true);
    setExitError(null);
    try {
      if (await props.onAbandon()) props.onHome();
      else setExitError(props.abandonError ?? "Не удалось закрыть забег. Попробуй ещё раз.");
    } finally {
      setExitBusy(false);
    }
  };
  return (
    <div className="solo-play">
      <RoundHud props={props} state={state} view={view} />
      {state.stage === "question" && (
        <QuestionScreen
          key={`${view.roundsPlayed}:${question.id}`}
          question={question}
          onAnswer={props.onAnswer}
        />
      )}
      {(state.stage === "checking" || state.stage === "submitting") && (
        <SyncStatus props={props} state={state} />
      )}
      {state.stage === "resolution" && (
        <RoundResolution props={props} state={state} view={view} question={question} />
      )}
      {state.stage === "hammer" && (
        <MiniGame props={props} state={state} view={view} question={question} />
      )}
      {props.onAbandon && (
        <div className="solo-exit">
          {!confirmExit ? (
            <button type="button" className="ghost-btn solo-exit__trigger" onClick={() => setConfirmExit(true)}>
              Выйти
            </button>
          ) : (
            <div className="solo-exit__confirm" role="group" aria-label="Подтверждение выхода">
              <p>{state.mode === "duel"
                ? "Выйти из дуэли? Это засчитается поражением."
                : "Выйти и закрыть текущий забег?"}</p>
              <button type="button" className="ghost-btn" disabled={exitBusy} onClick={() => setConfirmExit(false)}>
                Продолжить
              </button>
              <button type="button" className="ghost-btn" disabled={exitBusy} onClick={() => void abandon()}>
                {exitBusy ? "Закрываем…" : "Подтвердить выход"}
              </button>
              {(exitError || props.abandonError) && <p className="matchmaking-error" role="alert">{exitError ?? props.abandonError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
