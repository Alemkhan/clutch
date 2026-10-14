import { useEffect, useState } from "react";
import type { CategoryId, PracticeLevel, QuestionReportKind } from "@clutch/shared";
import { SOLO_ROUND_CAP } from "@clutch/shared";
import { CategorySelect } from "./CategorySelect";
import { HammerGame } from "./HammerGame";
import { QuestionScreen } from "./QuestionScreen";
import { ResolutionScreen } from "./ResolutionScreen";
import { ScreenHeader } from "./ScreenHeader";
import { SoloHud } from "./SoloHud";
import { SoloResult } from "./SoloResult";
import {
  currentSoloQuestion,
  soloFlowView,
  soloPaceOf,
  soloRoundsLeft,
  type SoloFlowState,
  type SoloStage,
} from "../lib/soloRunFlow";
import type { ResolutionReportStatus } from "../lib/reportPanel";
import { buildPracticeSummary, practiceBotLabel } from "../lib/practiceResult";
import {
  FRIEND_DUEL_CHIP,
  buildFriendDuelSummary,
} from "../lib/friendDuelResult";
import { submitQuestionReport } from "../lib/api";
import { useSoloRun, type SoloSaveState } from "../lib/useSoloRun";

interface SoloRunScreenProps {
  state: SoloFlowState;
  save: SoloSaveState;
  onSelectCategory: (category: CategoryId) => void;
  onRetryStart: () => void;
  onBackToCategories: () => void;
  /** Забег начат с главной без выбора категории: «Назад» ведёт на главную, а не в пустой выбор. */
  onExit?: () => void;
  onStart: () => void;
  onAnswer: (optionId: string, timeMs: number) => void;
  onContinue: () => void;
  onHammerComplete: (
    result: unknown,
    progress: number,
    distance: number,
  ) => void;
  /** Итог приходит вместе с последним кругом, повторять нечего; свойство осталось для экрана результата. */
  onRetrySave?: () => void;
  /** Запрос круга не дошёл после повторов: прогресс на сервере цел, круг можно отправить снова. */
  syncError?: string | null;
  canRetrySync?: boolean;
  onRetrySync?: () => void;
  /** В тренировке «домой» ведёт к выбору уровня. */
  onHome: () => void;
  onMyRuns: () => void;
  /** Тренировка против бота: другой текст и итог, результат не засчитывается. */
  practice?: PracticeLevel;
  /** Репорт о проблеме на разборе: экран только рисует, сеть и статус живут в SoloRun. */
  onReport?: (kind: QuestionReportKind, comment: string) => void;
  reportState?: ResolutionReportStatus;
}

const noop = () => undefined;

export function toSoloCategory(id: string): CategoryId {
  return id === "geography" || id === "history" || id === "languages"
    ? id
    : "general";
}

function resumeNote(view: {
  roundsPlayed: number;
  progress: number;
  target: number;
}): string {
  return `Уже сыграно кругов: ${view.roundsPlayed}, прогресс ${view.progress}% из ${view.target}%.`;
}

/** Экран соло-забега по шагам. Соперник только рисуется на полосе: завершает забег сам игрок. */
export function SoloRunScreen(props: SoloRunScreenProps) {
  const { state, save } = props;
  const view = soloFlowView(state);
  const pace = soloPaceOf(state);
  const question = currentSoloQuestion(state);
  const eyebrow = props.practice ? "Тренировка" : "Соло-забег";

  if (state.stage === "categories") {
    return (
      <CategorySelect
        onSelect={(id) => props.onSelectCategory(toSoloCategory(id))}
        onBack={props.onHome}
      />
    );
  }

  if (state.stage === "loading") {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onExit ?? props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">{eyebrow}</span>
          <h1 className="screen-title">Готовим забег</h1>
          <div className="matchmaking-loading" role="status">
            <span /> Загружаем вопросы
          </div>
        </div>
      </section>
    );
  }

  if (state.stage === "error") {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onExit ?? props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">{eyebrow}</span>
          <h1 className="screen-title">Забег не начался</h1>
          <p className="matchmaking-error" role="alert">
            {state.error}
          </p>
          <div className="matchmaking-actions">
            <button
              type="button"
              className="cta-btn"
              onClick={props.onRetryStart}
            >
              Повторить
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!view) return null;

  if (state.stage === "ready" && props.practice) {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onExit ?? props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">
            Тренировка · {props.practice.name}
          </span>
          <h1 className="screen-title">
            {state.resumed ? "Продолжаем тренировку" : "Всё готово"}
          </h1>
          <div className="matchmaking-card">
            <p className="matchmaking-status">
              Против: {pace ? practiceBotLabel(pace.displayName) : "бот"}. Не
              засчитывается.
            </p>
            {state.resumed && (
              <p className="matchmaking-status">{resumeNote(view)}</p>
            )}
            {/* Полоса соперника исчезла не сама: пока игрока не было, запись ушла к другому. */}
            {state.paceReleased && (
              <p className="matchmaking-status" role="status">
                Соперник отпущен: тебя долго не было, и его запись забрал другой игрок.
                Забег продолжается один и сам станет записью для следующего.
              </p>
            )}
          </div>
          <button type="button" className="cta-btn" onClick={props.onStart}>
            {state.resumed ? "Продолжить" : "Начать"}
          </button>
          {state.resumed && (
            <button
              type="button"
              className="ghost-btn"
              onClick={props.onBackToCategories}
            >
              Начать заново
            </button>
          )}
        </div>
      </section>
    );
  }

  if (state.stage === "ready") {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onExit ?? props.onBackToCategories} />
        <div className="matchmaking-body">
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
            {state.resumed && (
              <p className="matchmaking-status">{resumeNote(view)}</p>
            )}
          </div>
          <button type="button" className="cta-btn" onClick={props.onStart}>
            {state.resumed ? "Продолжить" : "Начать"}
          </button>
          {state.resumed && (
            <button
              type="button"
              className="ghost-btn"
              onClick={props.onBackToCategories}
            >
              Начать заново
            </button>
          )}
          {!state.resumed && !state.friendDuel && props.onExit && (
            <button
              type="button"
              className="ghost-btn"
              onClick={props.onBackToCategories}
            >
              Другие категории
            </button>
          )}
        </div>
      </section>
    );
  }

  if (state.stage === "result") {
    return (
      <SoloResult
        view={view}
        saveStatus={save.status}
        response={save.response}
        saveError={save.error}
        canRetrySave={save.canRetry}
        onRetrySave={props.onRetrySave ?? noop}
        onReplay={props.onBackToCategories}
        onMyRuns={props.onMyRuns}
        practice={
          props.practice && state.session
            ? buildPracticeSummary(state.session)
            : null
        }
        friendDuel={
          state.friendDuel && state.session
            ? buildFriendDuelSummary(state.session, save.response)
            : null
        }
        onExitPractice={props.onHome}
      />
    );
  }

  if (!question) return null;
  const selectedAnswer = question.answerType === "multiple_choice"
    ? question.options.find((option) => option.id === state.selectedOption)?.text
    : undefined;
  const hud = (
    <SoloHud
      progress={view.progress}
      paceProgress={view.paceProgress}
      paceName={pace?.displayName ?? null}
      round={view.round}
      roundsLeft={soloRoundsLeft(view)}
    />
  );

  return (
    <div className="solo-play">
      {hud}
      {state.stage === "question" && (
        <QuestionScreen
          key={`${view.roundsPlayed}:${question.id}`}
          question={question}
          onAnswer={props.onAnswer}
        />
      )}
      {(state.stage === "checking" || state.stage === "submitting") &&
        (props.syncError ? (
          <div className="solo-sync">
            <p className="matchmaking-error" role="alert">
              {props.syncError}
            </p>
            {props.canRetrySync ? (
              <button
                type="button"
                className="cta-btn"
                onClick={props.onRetrySync}
              >
                Повторить
              </button>
            ) : (
              <button type="button" className="cta-btn" onClick={props.onHome}>
                Выйти
              </button>
            )}
          </div>
        ) : (
          <div className="matchmaking-loading solo-sync" role="status">
            <span />{" "}
            {state.stage === "checking"
              ? "Проверяем ответ"
              : "Засчитываем удар"}
          </div>
        ))}
      {state.stage === "resolution" && (
        <ResolutionScreen
          correctAnswer={state.correctAnswer}
          selectedAnswer={state.lastCorrect ? undefined : selectedAnswer}
          explanation={state.explanation}
          correct={state.lastCorrect}
          onContinue={props.onContinue}
          report={
            props.onReport
              ? { onSend: props.onReport, state: props.reportState ?? "idle" }
              : undefined
          }
        />
      )}
      {state.stage === "hammer" && (
        <HammerGame
          key={view.roundsPlayed}
          config={state.config}
          questionId={question.id}
          previousSkillResults={state.skillResults}
          onComplete={props.onHammerComplete}
        />
      )}
    </div>
  );
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
}

export function SoloRun({
  onHome,
  onMyRuns,
  rematch,
  defaultCategory,
  practice,
  onStageChange,
}: SoloRunProps) {
  const run = useSoloRun(practice?.id);
  const { stage } = run.state;
  const { begin, resume } = run;
  // Статус репорта привязан к вопросу: следующий разбор снова начинает с idle.
  const [report, setReport] = useState<{
    questionId: string;
    status: ResolutionReportStatus;
  } | null>(null);
  const reportQuestion = currentSoloQuestion(run.state);

  const submitReport = (kind: QuestionReportKind, comment: string) => {
    const state = run.state;
    const question = currentSoloQuestion(state);
    if (!question) return;
    const playerAnswer =
      question.answerType === "multiple_choice"
        ? question.options.find((option) => option.id === state.selectedOption)
            ?.text
        : state.selectedOption || undefined;
    setReport({ questionId: question.id, status: "sending" });
    void submitQuestionReport({
      questionId: question.id,
      ...(state.runId ? { runId: state.runId } : {}),
      category: state.category,
      mode: "solo",
      kind,
      verdict: state.lastCorrect,
      ...(playerAnswer ? { playerAnswer } : {}),
      ...(comment ? { comment } : {}),
    })
      .then(() => setReport({ questionId: question.id, status: "sent" }))
      .catch(() => setReport({ questionId: question.id, status: "error" }));
  };

  useEffect(() => {
    if (rematch) begin(rematch.category, rematch.inviteId);
    else resume(defaultCategory);
  }, [rematch, defaultCategory, begin, resume]);

  useEffect(() => {
    onStageChange(stage);
  }, [stage, onStageChange]);
  useEffect(() => () => onStageChange("categories"), [onStageChange]);

  return (
    <SoloRunScreen
      state={run.state}
      save={run.save}
      onSelectCategory={run.begin}
      onRetryStart={run.retryStart}
      onBackToCategories={run.backToCategories}
      onExit={
        defaultCategory && !rematch && !practice
          ? () => {
              run.backToCategories();
              onHome();
            }
          : undefined
      }
      onStart={run.start}
      onAnswer={run.answer}
      onContinue={run.continueAfterResolution}
      onHammerComplete={run.completeHammer}
      syncError={run.syncError}
      canRetrySync={run.canRetrySync}
      onRetrySync={run.retrySync}
      onHome={onHome}
      onMyRuns={onMyRuns}
      practice={practice}
      onReport={submitReport}
      reportState={
        report && reportQuestion && report.questionId === reportQuestion.id
          ? report.status
          : "idle"
      }
    />
  );
}
