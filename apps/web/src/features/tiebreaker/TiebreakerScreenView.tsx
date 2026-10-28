import type { TiebreakerQuestionView } from "@clutch/shared";
import { ScreenHeader } from "../../ui/ScreenHeader";
import { formatDayMonth } from "./tiebreakerView";
import { TiebreakerAnswerForm, type TiebreakerSubmitStatus } from "./TiebreakerAnswerForm";
import { TiebreakerReveal, type TiebreakerShareStatus } from "./TiebreakerReveal";
import type { TiebreakerTodayState } from "./useTiebreakerToday";
interface ScreenViewProps {
  state: TiebreakerTodayState;
  guest: boolean;
  submitStatus: TiebreakerSubmitStatus;
  /** Сколько осталось до конца игровых суток, мс. */
  msLeft?: number;
  shareStatus?: TiebreakerShareStatus;
  onBack: () => void;
  onRetry: () => void;
  onSubmit: (guess: number) => void;
  onShare?: () => void;
  /** Для тестов: разбор развёрнут сразу. */
  explanationOpen?: boolean;
}

export function TiebreakerScreenView({
  state,
  guest,
  submitStatus,
  msLeft = 0,
  shareStatus = "idle",
  onBack,
  onRetry,
  onSubmit,
  onShare,
  explanationOpen = false,
}: ScreenViewProps) {
  const question = state.status === "ready" ? state.today.question : null;
  const answered = state.status === "ready" ? state.today.answered : null;

  return (
    <section className="tb-screen">
      <ScreenHeader onBack={onBack} />

      <div className="tb-head">
        <h1 className="tb-title">
          На глазок
          {question && (
            <>
              {" "}
              <span className="tb-num">#{question.number}</span>
            </>
          )}
        </h1>
        {state.status === "ready" && question && (
          <span className="tb-date">{formatDayMonth(state.today.dateKey)}</span>
        )}
      </div>

      {state.status === "loading" && (
        <div className="matchmaking-loading" role="status">
          <span /> Загружаем вопрос
        </div>
      )}

      {state.status === "error" && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">
            Не удалось загрузить вопрос. Проверь соединение и попробуй ещё раз.
          </p>
          <button type="button" className="cta-btn" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}

      {state.status === "ready" && !question && (
        <div className="my-runs-message">
          <p className="matchmaking-error">
            Сегодня вопроса нет. Загляни завтра.
          </p>
          <button type="button" className="ghost-btn" onClick={onBack}>
            Назад
          </button>
        </div>
      )}

      {question && (
        <>
          <p className="tb-prompt">{question.prompt}</p>
          {answered ? (
            <TiebreakerReveal
              question={question}
              answered={answered}
              msLeft={msLeft}
              shareStatus={shareStatus}
              onShare={onShare}
              explanationOpen={explanationOpen}
            />
          ) : (
            <TiebreakerAnswerForm
              key={question.id}
              question={question}
              guest={guest}
              status={submitStatus}
              onSubmit={onSubmit}
            />
          )}
        </>
      )}
    </section>
  );
}
