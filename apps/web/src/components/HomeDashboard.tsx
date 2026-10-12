import { useEffect, useState } from "react";
import { fetchLastStandLeaderboard } from "../lib/api";
import { buildLastStandHook, type LastStandHook } from "../lib/lastStandHook";
import { getStats } from "../lib/localStats";

interface HomeDashboardProps {
  onLastStand: () => void;
  onSolo: () => void;
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

export function HomeDashboard({ onLastStand, onSolo }: HomeDashboardProps) {
  const [lastStandHook, setLastStandHook] = useState<LastStandHook | null>(
    null,
  );

  // Fire-and-forget: the home screen never waits for this. Any failure just means no hook.
  useEffect(() => {
    const controller = new AbortController();
    fetchLastStandLeaderboard(undefined, controller.signal)
      .then((raw) => {
        if (!controller.signal.aborted)
          setLastStandHook(buildLastStandHook(raw));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const stats = getStats();

  return (
    <section className="home-dashboard">
      <header className="home-header">
        <div className="home-brand" aria-label="Clutch">
          <span className="home-brand-mark">C</span>
          <span>CLUTCH</span>
        </div>
        {/* Ноль в чипе читается как «тут пусто», поэтому серия показывается только когда она есть. */}
        {stats.currentStreak > 0 && (
          <span className="chip streak-chip">🔥 {stats.currentStreak}</span>
        )}
      </header>

      <section className="home-hero-card">
        <span className="home-kicker">Общие знания · 16 тем</span>
        <h1 className="home-title">
          Ответь верно.
          <br />
          <em>Дойди до 100%.</em>
        </h1>
        <p className="home-lede">Верный ответ даёт попытку в мини‑игре.</p>
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
        <button
          className="cta-btn"
          onClick={() => {
            onSolo();
          }}
        >
          Играть <span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="ls-home-card" aria-labelledby="ls-home-title">
        <div className="ls-home-top">
          <h2 className="ls-home-title" id="ls-home-title">
            Last Stand
          </h2>
          <span className="ls-home-kicker">До 12 кругов</span>
        </div>
        <p className="ls-home-lede">
          Называй страны из объявленной категории и не совпадай с соперником.
        </p>
        {lastStandHook && (
          <p className="ls-home-hook">{lastStandHook.headline}</p>
        )}
        <button
          type="button"
          className="ls-home-cta"
          aria-label="Last Stand: начать забег по категориям стран"
          onClick={() => {
            onLastStand();
          }}
        >
          Начать забег <span aria-hidden="true">→</span>
        </button>
      </section>
    </section>
  );
}
