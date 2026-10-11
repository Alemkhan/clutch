import { useEffect, useState } from 'react';
import { fetchLastStandLeaderboard } from '../lib/api';
import { buildLastStandHook, type LastStandHook } from '../lib/lastStandHook';
import { getStats, winRatePercent } from '../lib/localStats';
import { playSound } from '../lib/sounds';

interface HomeDashboardProps {
  onProfile: () => void;
  onTraining: () => void;
  onLastStand: () => void;
  onSolo: () => void;
  onMyRuns: () => void;
}

export function HomeDashboard({ onProfile, onTraining, onLastStand, onSolo, onMyRuns }: HomeDashboardProps) {
  const [lastStandHook, setLastStandHook] = useState<LastStandHook | null>(null);

  // Fire-and-forget: the home screen never waits for this. Any failure just means no hook.
  useEffect(() => {
    const controller = new AbortController();
    fetchLastStandLeaderboard(undefined, controller.signal)
      .then((raw) => { if (!controller.signal.aborted) setLastStandHook(buildLastStandHook(raw)); })
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
        <div className="home-chips">
          <span className="chip streak-chip">🔥 {stats.currentStreak}</span>
          <button className="home-avatar-btn" aria-label="Открыть профиль" onClick={() => { onProfile(); }}>
            Я
          </button>
        </div>
      </header>

      <section className="home-hero-card">
        <span className="home-kicker">География · флаги · языки</span>
        <h1 className="home-title">Ответь верно.<br /><em>Дойди до 100%.</em></h1>
        <p className="home-lede">Верный ответ даёт попытку в мини-игре, а удар двигает тебя вперёд.</p>
        <div className="home-hero-meter" aria-hidden="true">
          <span className="home-meter-player" />
          <span className="home-meter-center">VS</span>
          <span className="home-meter-opponent" />
        </div>
        <button className="cta-btn" onClick={() => { onSolo(); }}>
          Играть <span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="ls-home-card" aria-labelledby="ls-home-title">
        <span className="ls-home-kicker">Новый режим · до 12 кругов</span>
        <h2 className="ls-home-title" id="ls-home-title">Last Stand</h2>
        <p className="ls-home-lede">Называй страны из объявленной категории и не совпадай с соперником.</p>
        {lastStandHook && (
          <div className={`ls-home-hook ls-home-hook-${lastStandHook.kind}`}>
            <span className="ls-home-hook-head">{lastStandHook.headline}</span>
            <span className="ls-home-hook-detail">{lastStandHook.detail}</span>
          </div>
        )}
        <button
          type="button"
          className="ls-home-cta"
          aria-label="Last Stand: начать забег по категориям стран"
          onClick={() => { onLastStand(); }}
        >
          Начать забег <span aria-hidden="true">→</span>
        </button>
      </section>

      <button type="button" className="training-entry" onClick={() => { onMyRuns(); }}>
        <span className="training-entry-title">Мои партии</span>
        <span className="training-entry-meta">Результаты и вызовы на реванш</span>
      </button>

      <button type="button" className="training-entry" onClick={() => { onTraining(); }}>
        <span className="training-entry-title">Тренировка</span>
        <span className="training-entry-meta">Боты и отработка ошибок</span>
      </button>

      <div className="home-stats-card">
        <div className="mini-stat">
          <span className="mini-stat-value">{stats.wins}</span>
          <span className="mini-stat-label">Побед</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{winRatePercent(stats)}%</span>
          <span className="mini-stat-label">Винрейт</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{stats.bestStreak}</span>
          <span className="mini-stat-label">Лучшая серия</span>
        </div>
      </div>
    </section>
  );
}
