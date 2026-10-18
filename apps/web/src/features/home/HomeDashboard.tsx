import { useState } from "react";
import type { SoloLeaderboardStanding, SoloMode } from "@clutch/shared";
import { homeStandingLines } from "./homeStanding";
import { newSetLabel } from "../tiebreaker/tiebreakerClock";
import { useDayCountdown } from "../tiebreaker/useDayCountdown";
import { useHomeStanding, type DailyAttempt } from "./useHomeStanding";
import { useTiebreakerToday, type TiebreakerTodayState } from "../tiebreaker/useTiebreakerToday";
import { TiebreakerCardView } from "../tiebreaker/TiebreakerCard";

interface HomeDashboardProps {
  /** Забег дня, дуэль или свободная игра в «Общих знаниях». */
  onSolo: (mode: SoloMode) => void;
  onBoard: () => void;
  onTiebreaker: () => void;
}

export interface HomeDashboardViewProps extends HomeDashboardProps {
  tiebreaker: TiebreakerTodayState;
  /** Сколько осталось до конца игровых суток, мс. */
  msLeft: number;
  /** Своё место в таблице дня; null — не играл сегодня до 100% или данных нет. */
  standing: SoloLeaderboardStanding | null;
  /** Попытка забега дня: сыгранный забег дня второй раз не предлагаем. */
  dailyAttempt?: DailyAttempt;
}

/** Петля игры тремя значками: верный ответ, удар в мини-игре, прогресс. Без текста-инструкции. */
function LoopIcon({ kind }: { kind: "answer" | "strike" | "progress" }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "answer") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M7.8 12.4l2.9 2.9 5.6-6" />
      </svg>
    );
  }
  if (kind === "strike") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M4 16h16" strokeOpacity="0.4" />
      <path d="M4 16h10" />
      <path d="M5 7l5 4 3-3 6 5" />
    </svg>
  );
}

const LOOP_STEPS = [
  { kind: "answer", label: "Верный ответ" },
  { kind: "strike", label: "Удар" },
  { kind: "progress", label: "Прогресс" },
] as const;

export function HomeDashboardView({
  tiebreaker,
  msLeft,
  standing,
  dailyAttempt = "none",
  onSolo,
  onBoard,
  onTiebreaker,
}: HomeDashboardViewProps) {
  const lines = standing ? homeStandingLines(standing) : null;
  // Забег дня сыгран (в таблицу идёт первая попытка): главная зовёт в дуэль.
  const dailyDone = dailyAttempt === "completed";
  return (
    <section className="home-dashboard">
      <header className="home-header">
        <div className="home-brand" aria-label="Clutch">
          <span className="home-brand-mark">C</span>
          <span>CLUTCH</span>
        </div>
        <span className="home-new-set">{newSetLabel(msLeft)}</span>
      </header>

      <section className="home-hero-card">
        <div className="home-hero-head">
          <span className="home-kicker">Забег дня · Общие знания</span>
          {dailyDone && !standing ? (
            <h1 className="home-title home-title-done">
              Забег дня сыгран.
              <br />
              <em>Новый набор — завтра.</em>
            </h1>
          ) : standing && lines ? (
            <h1 className="home-title home-title-done">
              {lines.hint ? (
                <>
                  {lines.title}
                  <br />
                  <em>{lines.hint}</em>
                </>
              ) : (
                <em>{lines.title}</em>
              )}
            </h1>
          ) : (
            <h1 className="home-title">
              Ответь верно.
              <br />
              <em>Дойди до 100%.</em>
            </h1>
          )}
        </div>
        {standing && lines ? (
          <dl className="home-stats">
            <div className="home-stat">
              <dt>кругов</dt>
              <dd>{standing.entry.roundsPlayed}</dd>
            </div>
            <div className="home-stat">
              <dt>место</dt>
              <dd>{standing.rank} / {standing.total}</dd>
            </div>
          </dl>
        ) : (
          <ol className="home-loop" aria-label="Как идёт забег">
            {LOOP_STEPS.map((step) => (
              <li key={step.kind} className="home-loop-step">
                <span className="home-loop-icon">
                  <LoopIcon kind={step.kind} />
                </span>
                <span className="home-loop-label">{step.label}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="home-hero-actions">
          <button
            className="cta-btn"
            onClick={() => {
              onSolo(dailyDone ? "duel" : "daily");
            }}
          >
            {dailyDone ? "Дуэль" : dailyAttempt === "in_progress" ? "Продолжить забег дня" : "Забег дня"}{" "}
            <span aria-hidden="true">→</span>
          </button>
          <div className="home-mode-row">
            {!dailyDone && (
              <button type="button" className="home-mode-btn" onClick={() => { onSolo("duel"); }}>
                Дуэль
              </button>
            )}
            <button type="button" className="home-mode-btn" onClick={() => { onSolo("free"); }}>
              Свободная игра
            </button>
          </div>
          {/* Вход в таблицу дня: нижняя панель не меняется, место для него — на главной карточке. */}
          <button type="button" className="home-board-link" onClick={() => { onBoard(); }}>
            Таблица дня
          </button>
        </div>
      </section>

      <TiebreakerCardView state={tiebreaker} msLeft={msLeft} onOpen={onTiebreaker} />
    </section>
  );
}

export function HomeDashboard(props: HomeDashboardProps) {
  const { state, reload } = useTiebreakerToday();
  const [dayEpoch, setDayEpoch] = useState(0);
  // Смена суток: вопрос другой, вчерашнее место не действует — перечитываем и то и другое.
  const msLeft = useDayCountdown(() => {
    reload();
    setDayEpoch((value) => value + 1);
  });
  const { standing, dailyAttempt } = useHomeStanding(dayEpoch);
  return <HomeDashboardView {...props} tiebreaker={state} msLeft={msLeft} standing={standing} dailyAttempt={dailyAttempt} />;
}
