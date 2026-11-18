import { useEffect, useReducer, useRef, useState } from "react";
import type { TiebreakerQuestionView } from "@clutch/shared";
import { formatQuantity } from "./tiebreakerView";
import { parseTiebreakerInput, tiebreakerInputHint } from "./tiebreakerInput";
import { useMessages } from "../../i18n/messages";
import { m } from "./messages";
import { calculatorReducer, calculatorValue, initialCalculatorState, type CalculatorOperator } from "./tiebreakerCalculator";
export type TiebreakerSubmitStatus =
  "idle" | "sending" | "network" | "rejected" | "stale";

// ---- Ответ ----

interface AnswerFormProps {
  question: TiebreakerQuestionView;
  /** Браузерный гость: в развязке ничьих его ответ не учитывается. */
  guest: boolean;
  status: TiebreakerSubmitStatus;
  onSubmit: (guess: number) => void;
  /** Для тестов: начальный ввод и шаг подтверждения. */
  initialText?: string;
  initialConfirm?: boolean;
}

function TiebreakerCalculator({ onInsert }: { onInsert: (value: number) => void }) {
  const [state, dispatch] = useReducer(calculatorReducer, initialCalculatorState);
  const value = calculatorValue(state);
  const t = useMessages(m);
  const keys: Array<{ label: string; action: { type: "digit"; value: string } | { type: "decimal" } | { type: "operator"; value: CalculatorOperator } | { type: "equals" } | { type: "clear" } | { type: "backspace" }; className?: string; ariaLabel?: string }> = [
    { label: "7", action: { type: "digit", value: "7" } },
    { label: "8", action: { type: "digit", value: "8" } },
    { label: "9", action: { type: "digit", value: "9" } },
    { label: "÷", action: { type: "operator", value: "÷" }, className: "operator" },
    { label: "4", action: { type: "digit", value: "4" } },
    { label: "5", action: { type: "digit", value: "5" } },
    { label: "6", action: { type: "digit", value: "6" } },
    { label: "×", action: { type: "operator", value: "×" }, className: "operator" },
    { label: "1", action: { type: "digit", value: "1" } },
    { label: "2", action: { type: "digit", value: "2" } },
    { label: "3", action: { type: "digit", value: "3" } },
    { label: "−", action: { type: "operator", value: "−" }, className: "operator" },
    { label: "0", action: { type: "digit", value: "0" } },
    { label: ",", action: { type: "decimal" }, ariaLabel: t.decimalComma },
    { label: "=", action: { type: "equals" }, className: "operator", ariaLabel: t.evaluate },
    { label: "+", action: { type: "operator", value: "+" }, className: "operator" },
  ];

  return (
    <details className="tb-calculator">
      <summary>{t.calculator}</summary>
      <div className="tb-calculator-body">
        <div className="tb-calculator-display" aria-label={t.currentNumber} aria-live="polite">
          {state.display}
        </div>
        <div className="tb-calculator-utility">
          <button type="button" onClick={() => dispatch({ type: "clear" })}>{t.clear}</button>
          <button type="button" aria-label={t.backspace} onClick={() => dispatch({ type: "backspace" })}>⌫</button>
        </div>
        <div className="tb-calculator-keys" role="group" aria-label={t.calculatorKeys}>
          {keys.map((key, index) => (
            <button
              key={`${key.label}-${index}`}
              type="button"
              className={key.className ?? ""}
              aria-label={key.ariaLabel}
              onClick={() => dispatch(key.action)}
            >
              {key.label}
            </button>
          ))}
        </div>
        {state.error && <p className="tb-calculator-error" role="alert">{state.error}</p>}
        {state.operator === null && state.replaceDisplay && value !== null && (
          <button type="button" className="tb-calculator-insert" onClick={() => onInsert(value)}>
            {t.insertIntoAnswer}
          </button>
        )}
      </div>
    </details>
  );
}

export function TiebreakerAnswerForm({
  question,
  guest,
  status,
  onSubmit,
  initialText = "",
  initialConfirm = false,
}: AnswerFormProps) {
  const t = useMessages(m);
  const [text, setText] = useState(initialText);
  const [confirming, setConfirming] = useState(initialConfirm);
  const [touched, setTouched] = useState(initialText !== "");
  const formRef = useRef<HTMLDivElement>(null);
  const parsed = parseTiebreakerInput(text);
  const hint = touched && !parsed.ok ? tiebreakerInputHint(parsed.error) : null;
  const sending = status === "sending";

  // Экранная клавиатура сжимает viewport: подтягиваем форму (поле и кнопку) в видимую часть, как в OpenAnswerInput.
  useEffect(() => {
    let frameId: number | null = null;
    const reveal = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        formRef.current?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      });
    };
    window.visualViewport?.addEventListener("resize", reveal);
    return () => {
      window.visualViewport?.removeEventListener("resize", reveal);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, []);

  const proceed = () => {
    setTouched(true);
    if (parsed.ok && !sending) setConfirming(true);
  };

  return (
    <div className="tb-form" ref={formRef}>
      <label className="tb-label" htmlFor="tb-guess">
        {t.yourGuess}{question.unit ? `, ${question.unit}` : ""}
      </label>
      <input
        id="tb-guess"
        className="open-answer-input tb-input"
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={t.placeholder}
        value={text}
        disabled={sending || confirming}
        aria-invalid={hint ? true : undefined}
        aria-describedby={hint ? "tb-hint tb-note" : "tb-note"}
        onChange={(event) => {
          setText(event.target.value);
          setConfirming(false);
        }}
        onBlur={() => setTouched(true)}
        onFocus={(event) =>
          event.currentTarget.scrollIntoView({
            block: "nearest",
            inline: "nearest",
          })
        }
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (!confirming) proceed();
        }}
      />
      {hint && (
        <p id="tb-hint" className="tb-hint" role="alert">
          {hint}
        </p>
      )}
      <TiebreakerCalculator
        onInsert={(value) => {
          setText(String(value).replace(".", ","));
          setTouched(true);
          setConfirming(false);
        }}
      />
      {guest && (
        <p className="tb-guest" role="note">
          {t.guestNote}
        </p>
      )}

      {confirming && parsed.ok ? (
        <div
          className="tb-confirm"
          role="group"
          aria-label={t.confirmLabel}
        >
          <p className="tb-confirm-text">
            {t.confirmSend}{" "}
            <strong>{formatQuantity(parsed.value, question.unit)}</strong>?{" "}
            {t.confirmFinal}
          </p>
          <button
            type="button"
            className="cta-btn"
            disabled={sending}
            onClick={() => {
              onSubmit(parsed.value);
            }}
          >
            {sending ? t.sending : t.sendAnswer}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={sending}
            onClick={() => setConfirming(false)}
          >
            {t.fix}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="cta-btn"
          disabled={!parsed.ok}
          onClick={proceed}
        >
          {t.answer}
        </button>
      )}

      {status === "network" && (
        <p className="tb-hint" role="alert">
          {t.errorNetwork}
        </p>
      )}
      {status === "rejected" && (
        <p className="tb-hint" role="alert">
          {t.errorRejected}
        </p>
      )}
      {status === "stale" && (
        <p className="tb-hint" role="status">
          {t.staleQuestion}
        </p>
      )}
    </div>
  );
}
