import { useState } from "react";
import { isBestAnswerOfDay, TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE, type TiebreakerAnsweredView, type TiebreakerExplanation, type TiebreakerQuestionView } from "@clutch/shared";
import { openExternalLink } from "../../platform/telegram";
import { formatCountdownClock } from "./tiebreakerClock";
import { answersText, distributionAxisTicks, distributionBars, distributionSummary, formatAsOfDate, formatMultiplier, formatQuantity, formatQuantityBreakable, formatTiebreakerNumber, safeSourceUrl, sourceHost, standingText } from "./tiebreakerView";
// ---- Вскрытие ----

/** Деления шкалы под столбиками; первое и последнее прижаты к краям, чтобы подпись не вылезала за карточку. */
function DistributionAxis() {
  const ticks = distributionAxisTicks();
  return (
    <div className="tb-axis" aria-hidden="true">
      {ticks.map((tick, index) => {
        const edge =
          index === 0 ? "start" : index === ticks.length - 1 ? "end" : "mid";
        return (
          <span
            key={tick.label}
            className={`tb-axis-tick ${edge}${tick.exact ? " exact" : ""}`}
            style={{ left: `${tick.position * 100}%` }}
          >
            {tick.label}
          </span>
        );
      })}
    </div>
  );
}
function DistributionChart({ answered }: { answered: TiebreakerAnsweredView }) {
  const bars = distributionBars(answered);
  return (
    <section className="tb-block" aria-labelledby="tb-dist-title">
      <div className="tb-block-head">
        <h3 id="tb-dist-title" className="tb-block-title">
          Как ответили все
        </h3>
        <span className="tb-block-meta">
          {answersText(answered.totalAnswers)}
        </span>
      </div>
      <figure className="tb-chart">
        <div
          className="tb-bars"
          role="img"
          aria-label={distributionSummary(answered)}
        >
          {bars.map((bar) => (
            <span key={bar.index} className="tb-bar-slot" aria-hidden="true">
              <span
                className={
                  bar.mine ? `tb-bar ${bar.side} mine` : `tb-bar ${bar.side}`
                }
                style={{
                  height: `${Math.max(bar.count > 0 ? 4 : 0, Math.round(bar.height * 100))}%`,
                }}
              />
              {bar.mine && <span className="tb-bar-flag">ты</span>}
            </span>
          ))}
        </div>
        <DistributionAxis />
        <figcaption className="tb-legend" aria-hidden="true">
          <span>
            <i className="tb-swatch under" />
            занизили
          </span>
          <span>
            <i className="tb-swatch over" />
            завысили
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

/** Ссылка-источник: http(s) открывается через openExternalLink, всё остальное — текстом. */
function SourceLink({ url, title }: { url: string; title: string }) {
  const safeUrl = safeSourceUrl(url);
  if (!safeUrl) return <span>{title}</span>;
  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (openExternalLink(safeUrl)) event.preventDefault();
      }}
    >
      {title}
    </a>
  );
}

function stepsText(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14
      ? "шагов"
      : mod10 === 1
        ? "шаг"
        : mod10 >= 2 && mod10 <= 4
          ? "шага"
          : "шагов";
  return `${count} ${word}`;
}

/**
 * «Как прикинуть»: шаги с источниками и формула словами. Свёрнут по умолчанию — вскрытие начинается
 * с промаха, а не с разбора. Раскрывашка — обычная <button>, поэтому работает с клавиатуры.
 */
export function TiebreakerExplanationBlock({
  explanation,
  defaultOpen = false,
}: {
  explanation: TiebreakerExplanation;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={open ? "tb-explain open" : "tb-explain"}>
      <button
        type="button"
        className="tb-explain-toggle"
        aria-expanded={open}
        aria-controls={open ? "tb-explain-body" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tb-explain-head">
          <span className="tb-explain-title">Как прикинуть</span>
          <span className="tb-explain-sub">
            {stepsText(explanation.steps.length)} · {explanation.summary}
          </span>
        </span>
        <svg
          className="tb-explain-chevron"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id="tb-explain-body" className="tb-explain-body">
          <ol className="tb-steps">
            {explanation.steps.map((step, index) => (
              <li key={index} className="tb-step">
                <span className="tb-step-label">{step.label}</span>
                <span className="tb-step-value">
                  {formatQuantity(step.value, step.unit)}
                </span>
                <span className="tb-step-source">
                  <SourceLink url={step.sourceUrl} title={step.sourceTitle} />
                  {step.asOf ? ` · ${formatAsOfDate(step.asOf)}` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="tb-explain-summary">{explanation.summary}</p>
        </div>
      )}
    </section>
  );
}

export type TiebreakerShareStatus = "idle" | "copied" | "failed";

interface RevealProps {
  question: TiebreakerQuestionView;
  answered: TiebreakerAnsweredView;
  /** Сколько осталось до следующего вопроса, мс. */
  msLeft: number;
  shareStatus?: TiebreakerShareStatus;
  onShare?: () => void;
  /** Для тестов: разбор развёрнут сразу. */
  explanationOpen?: boolean;
}

export function TiebreakerReveal({
  question,
  answered,
  msLeft,
  shareStatus = "idle",
  onShare,
  explanationOpen = false,
}: RevealProps) {
  const safeUrl = safeSourceUrl(answered.sourceUrl);
  const standing = standingText(answered.percentile);
  const best = isBestAnswerOfDay(answered.percentile);
  return (
    <div className="tb-reveal">
      <section className="tb-result" aria-label="Твой результат">
        <div className="tb-result-top">
          <div className="tb-result-miss">
            <span className="tb-result-label">Твой промах</span>
            <span className={best ? "tb-miss best" : "tb-miss"}>
              {formatMultiplier(answered.multiplier)}
            </span>
          </div>
          {standing && <p className="tb-result-standing">{standing}</p>}
        </div>
        {answered.percentile === null && (
          <p className="tb-result-note">
            Процент игроков покажем, когда ответят{" "}
            {TIEBREAKER_MIN_ANSWERS_FOR_PERCENTILE}. Пока ответов:{" "}
            {formatTiebreakerNumber(answered.totalAnswers)}.
          </p>
        )}
        <dl className="tb-compare">
          <div className="tb-compare-row">
            <dt>Твой ответ</dt>
            <dd>{formatQuantityBreakable(answered.guess, question.unit)}</dd>
          </div>
          <div className="tb-compare-row">
            <dt>Правильный</dt>
            <dd>{formatQuantityBreakable(answered.answer, question.unit)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="tb-share-btn"
          onClick={() => {
            onShare?.();
          }}
        >
          Поделиться результатом
        </button>
        {shareStatus === "copied" && (
          <p className="tb-share-note" role="status">
            Скопировано
          </p>
        )}
        {shareStatus === "failed" && (
          <p className="tb-share-note" role="alert">
            Не удалось поделиться
          </p>
        )}
      </section>

      <DistributionChart answered={answered} />

      <div className="tb-explain-wrap">
        {answered.explanation && (
          <TiebreakerExplanationBlock
            explanation={answered.explanation}
            defaultOpen={explanationOpen}
          />
        )}
        <p className="tb-source">
          {safeUrl ? (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (openExternalLink(safeUrl)) event.preventDefault();
              }}
            >
              Источник: {sourceHost(safeUrl)}
            </a>
          ) : (
            <span>Источник: {answered.sourceUrl}</span>
          )}
          {" · "}данные на {formatAsOfDate(answered.asOfDate)}
        </p>
      </div>

      <div className="tb-next">
        <span className="tb-next-label">Следующий вопрос</span>
        <span className="tb-next-timer">{formatCountdownClock(msLeft)}</span>
      </div>
    </div>
  );
}
