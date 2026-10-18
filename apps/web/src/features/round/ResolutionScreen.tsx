import { useEffect, useRef, useState } from "react";
import type { QuestionReportKind } from "@clutch/shared";
import { playSound } from "../../platform/sounds";
import { shouldActivateAction } from "../../platform/accessibility";
import {
  canSendReport,
  editReportComment,
  openReportPanel,
  selectReportKind,
  CLOSED_REPORT_PANEL,
  type ReportPanelState,
  type ResolutionReportStatus,
} from "./reportPanel";

/** Репорт о проблеме: сеть и статус живут снаружи (SoloRun/Training), экран только рисует. */
export interface ResolutionReport {
  onSend: (kind: QuestionReportKind, comment: string) => void;
  state: ResolutionReportStatus;
}

/** Что показывается рядом с каждым kind репорта; порядок фиксирует UI. */
const REPORT_KINDS: readonly { kind: QuestionReportKind; label: string }[] = [
  { kind: "wrong_answer", label: "Неверный правильный ответ" },
  { kind: "answer_not_accepted", label: "Мой ответ не засчитали" },
  { kind: "other", label: "Другое" },
];

/**
 * Клик и клавиша внутри области репорта не должны продолжать разбор всем экраном:
 * корень ResolutionScreen — role="button", где любой тап означает «дальше».
 */
export function stopReportAreaEvent(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

interface ResolutionScreenProps {
  /** Эти данные приходят только после серверного вердикта. */
  correctAnswer: string;
  /** Показывается отдельно только для ошибочного ответа с вариантами. */
  selectedAnswer?: string;
  /** Вторичное пояснение к уже явно названному правильному ответу. */
  explanation: string;
  correct: boolean;
  /** Время вышло: ответа игрока нет, строка «Твой ответ» не нужна. */
  timedOut?: boolean;
  onContinue: () => void;
  /** Последний вопрос: дальше не следующий вопрос, а итог (если не ведёт к мини-игре). */
  final?: boolean;
  /** Training has no attempt or mini-game: it is plain question practice. */
  variant?: "match" | "training";
  /** Кнопка «Сообщить о проблеме» есть только там, где репорт подключён (соло и отработка). */
  report?: ResolutionReport;
}

export function ResolutionScreen({
  correctAnswer,
  selectedAnswer,
  explanation,
  correct,
  timedOut = false,
  onContinue,
  final = false,
  variant = "match",
  report,
}: ResolutionScreenProps) {
  const continuedRef = useRef(false);
  // Панель открыта с самого старта, если статус уже не idle (например, повтор после ошибки).
  const [panel, setPanel] = useState<ReportPanelState>(() =>
    report && report.state !== "idle"
      ? { ...CLOSED_REPORT_PANEL, open: true }
      : CLOSED_REPORT_PANEL,
  );

  useEffect(() => {
    playSound(correct ? "correct" : "incorrect");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueOnce = () => {
    if (!shouldActivateAction(continuedRef.current)) return;
    continuedRef.current = true;
    onContinue();
  };

  const training = variant === "training";
  // «Следующий вопрос» там, где мини-игры нет: тренировка, отработка и любой неверный ответ.
  const toHammer = !training && correct;
  const actionLabel = toHammer ? "К мини-игре" : final ? "К итогу" : "Следующий вопрос";
  const subtitle = timedOut
    ? "Время вышло"
    : correct
      ? training
        ? "Верный ответ"
        : "Попытка заработана"
      : selectedAnswer === "" ? "Пропущено" : "Неверный ответ";
  const showMine = !correct && !timedOut && Boolean(selectedAnswer);

  const sendReport = () => {
    if (!report || !canSendReport(panel, report.state) || !panel.kind) return;
    report.onSend(panel.kind, panel.comment.trim());
  };

  return (
    <div className="resolution-screen" onClick={continueOnce}>
      <div className="resolution-head">
        <div className={`resolution-status ${correct ? "correct" : "incorrect"}`}>
          {correct ? "Верно!" : "Мимо"}
        </div>
        <p className="resolution-message">{subtitle}</p>
      </div>
      <div className="resolution-answers">
        {showMine && (
          <p className="resolution-answer selected">
            <span>Твой ответ</span>
            <strong>{selectedAnswer}</strong>
          </p>
        )}
        <p className="resolution-answer correct">
          <span>Правильный</span>
          <strong>{correctAnswer}</strong>
        </p>
      </div>
      <p className="resolution-explanation">{explanation}</p>
      {report && (
        <div
          className="resolution-report"
          onClick={stopReportAreaEvent}
          onKeyDown={stopReportAreaEvent}
        >
          {report.state === "sent" ? (
            <p className="resolution-report-status" role="status">
              Отправлено, спасибо
            </p>
          ) : !panel.open ? (
            <button
              type="button"
              className="resolution-report-toggle"
              onClick={() => setPanel(openReportPanel)}
            >
              Сообщить о проблеме
            </button>
          ) : (
            <div className="resolution-report-panel">
              <div className="resolution-report-options" role="group" aria-label="Что не так?">
                {REPORT_KINDS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    className="resolution-report-option"
                    aria-pressed={panel.kind === kind}
                    onClick={() => setPanel((state) => selectReportKind(state, kind))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                className="resolution-report-comment"
                aria-label="Комментарий (необязательно)"
                placeholder="Комментарий (необязательно)"
                maxLength={500}
                value={panel.comment}
                onChange={(event) =>
                  setPanel((state) => editReportComment(state, event.target.value))
                }
              />
              {report.state === "sending" && (
                <p className="resolution-report-status" role="status">
                  Отправляем…
                </p>
              )}
              {report.state === "error" && (
                <p className="resolution-report-error" role="alert">
                  Не удалось отправить. Попробуй ещё раз.
                </p>
              )}
              <button
                type="button"
                className="resolution-report-send"
                disabled={!canSendReport(panel, report.state)}
                onClick={sendReport}
              >
                {report.state === "error" ? "Повторить" : "Отправить"}
              </button>
            </div>
          )}
        </div>
      )}
      {/* Подпись прокручивается с разбором: закреплена только кнопка, иначе подпись висит поверх текста. */}
      {!toHammer && !training && (
        <p className="resolution-footnote">В этом раунде без мини-игры</p>
      )}
      <div className="resolution-footer">
        <button
          type="button"
          className={`resolution-action${toHammer ? " to-hammer" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            continueOnce();
          }}
        >
          {actionLabel} <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
