import { useEffect, useState } from "react";
import type { CategoryId, PracticeLevel, SoloMode } from "@clutch/shared";
import { CategorySelect } from "./CategorySelect";
import { TiebreakerScreen } from "../tiebreaker/Tiebreaker";
import {
  currentSoloQuestion,
  soloFlowView,
  type SoloStage,
} from "./soloRunFlow";
import { useSoloRun } from "./useSoloRun";
import { useQuestionReport } from "./useQuestionReport";
import { useStrikePreview } from "./useStrikePreview";
import type { SoloRunScreenProps } from "./soloScreenTypes";
import { SoloErrorStage, SoloLoadingStage } from "./stages/SoloLoadStages";
import { PracticeReadyStage, SoloReadyStage } from "./stages/SoloReadyStage";
import { SoloResultStage } from "./stages/SoloResultStage";
import { SoloRoundStage } from "./stages/SoloRoundStage";

export type { PendingStrike } from "./soloScreenTypes";

export function toSoloCategory(id: string): CategoryId {
  return id === "geography" || id === "history" || id === "languages"
    ? id
    : "general";
}

/** Экран соло-забега по шагам. Соперник только рисуется на полосе: завершает забег сам игрок. */
export function SoloRunScreen(props: SoloRunScreenProps) {
  const { state } = props;
  const view = soloFlowView(state);
  const eyebrow = props.practice ? "Тренировка" : "Соло-забег";
  const onBack = props.onExit ?? props.onBackToCategories;

  if (state.stage === "categories") {
    return (
      <CategorySelect
        onSelect={(id) => props.onSelectCategory(toSoloCategory(id))}
        onBack={props.onHome}
      />
    );
  }
  if (state.stage === "loading") return <SoloLoadingStage eyebrow={eyebrow} onBack={onBack} />;
  if (state.stage === "error") {
    return <SoloErrorStage eyebrow={eyebrow} onBack={onBack} error={state.error} onRetry={props.onRetryStart} />;
  }
  if (!view) return null;
  if (state.stage === "ready" && props.practice) {
    return <PracticeReadyStage props={props} state={state} view={view} practice={props.practice} />;
  }
  if (state.stage === "ready") return <SoloReadyStage props={props} state={state} view={view} />;
  if (state.stage === "result") return <SoloResultStage props={props} state={state} view={view} />;

  const question = currentSoloQuestion(state);
  if (!question) return null;
  return <SoloRoundStage props={props} state={state} view={view} question={question} />;
}

export interface SoloRematch {
  inviteId: string;
  category: CategoryId;
}

interface SoloRunProps {
  onHome: () => void;
  onMyRuns: () => void;
  /** Реванш из приглашения: забег стартует сразу, без выбора категории. */
  rematch?: SoloRematch | null;
  /** Категория по умолчанию: без сохранённого забега «Играть» стартует в ней сразу. */
  defaultCategory?: CategoryId;
  /** Тренировка против бота выбранного уровня; без неё — обычный забег. */
  practice?: PracticeLevel;
  /** Нужен приложению: системная «Назад» скрыта во время игры, а молоток получает свой фон. */
  onStageChange: (stage: SoloStage) => void;
  /** Режим забега: забег дня, свободная игра или дуэль; по умолчанию — забег дня. */
  mode?: SoloMode;
  /** Сыграть в другом режиме с экрана результата. */
  onPlayMode?: (mode: SoloMode, category: CategoryId) => void;
}

export function SoloRun({
  onHome,
  onMyRuns,
  rematch,
  defaultCategory,
  practice,
  onStageChange,
  mode = "daily",
  onPlayMode,
}: SoloRunProps) {
  const run = useSoloRun(practice?.id, mode);
  const { stage } = run.state;
  const { begin, resume } = run;
  const { submitReport, reportState } = useQuestionReport(run.state);
  // «На глазок» открывается поверх экрана готовности и не трогает забег: назад — в тот же забег.
  const [tiebreakerOpen, setTiebreakerOpen] = useState(false);
  const { strike, onStrike } = useStrikePreview(run.state);

  useEffect(() => {
    if (rematch) begin(rematch.category, rematch.inviteId);
    else resume(defaultCategory);
  }, [rematch, defaultCategory, begin, resume]);

  useEffect(() => {
    onStageChange(stage);
  }, [stage, onStageChange]);
  useEffect(() => () => onStageChange("categories"), [onStageChange]);

  if (tiebreakerOpen) return <TiebreakerScreen onBack={() => setTiebreakerOpen(false)} />;

  const exitToHome = () => {
    run.backToCategories();
    onHome();
  };
  return (
    <SoloRunScreen
      onOpenTiebreaker={() => setTiebreakerOpen(true)}
      state={run.state}
      save={run.save}
      onSelectCategory={run.begin}
      onRetryStart={run.retryStart}
      onBackToCategories={run.backToCategories}
      onExit={defaultCategory && !rematch && !practice ? exitToHome : undefined}
      onStart={run.start}
      onAnswer={run.answer}
      onContinue={run.continueAfterResolution}
      strike={strike}
      onStrike={onStrike}
      onHammerComplete={run.completeHammer}
      syncError={run.syncError}
      canRetrySync={run.canRetrySync}
      onRetrySync={run.retrySync}
      onHome={onHome}
      onMyRuns={onMyRuns}
      practice={practice}
      onReport={submitReport}
      reportState={reportState}
      onPlayMode={onPlayMode}
    />
  );
}
