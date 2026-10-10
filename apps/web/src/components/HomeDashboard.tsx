import { useEffect, useState } from 'react';
import { fetchLastStandLeaderboard } from '../lib/api';
import { buildLastStandHook, type LastStandHook } from '../lib/lastStandHook';
import { getStats, winRatePercent } from '../lib/localStats';
import { mistakeCount } from '../lib/mistakeLog';
import { playSound } from '../lib/sounds';
import { challenges } from '../lib/tournaments';

interface HomeDashboardProps {
  onFindMatch: () => void;
  onProfile: () => void;
  onTraining: () => void;
  onLastStand: () => void;
  onChallenge: (tournamentId: string) => void;
}

export function HomeDashboard({ onFindMatch, onProfile, onTraining, onLastStand, onChallenge }: HomeDashboardProps) {
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
  const mistakes = mistakeCount();

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
        <span className="home-kicker">10 вопросов · один соперник</span>
        <h1 className="home-title">Знание даёт шанс.<br /><em>Точность решает.</em></h1>
        <p className="home-lede">Ответь правильно, забери попытку и дожми соперника в мини-игре.</p>
        <div className="home-hero-meter" aria-hidden="true">
          <span className="home-meter-player" />
          <span className="home-meter-center">VS</span>
          <span className="home-meter-opponent" />
        </div>
        <button className="cta-btn" onClick={() => { onFindMatch(); }}>
          Найти соперника <span aria-hidden="true">→</span>
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

      <button type="button" className="training-entry" onClick={() => { onTraining(); }}>
        <span className="training-entry-title">Тренировка по ошибкам</span>
        <span className="training-entry-meta">
          {mistakes > 0 ? `Ошибок накоплено: ${mistakes}` : 'Пока нет ошибок'}
        </span>
      </button>

      {challenges.map(({ tournament, badge }) => (
        <div className="challenge-card" key={tournament.id}>
          <span className="challenge-badge">{badge}</span>
          <h3 className="challenge-title">{tournament.title}</h3>
          <p className="challenge-desc">{tournament.description}</p>
          <div className="challenge-actions">
            <a
              className="challenge-watch"
              href={tournament.video?.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Смотреть клип ↗
            </a>
            <button className="challenge-play" onClick={() => { onChallenge(tournament.id); }}>
              Играть
            </button>
          </div>
        </div>
      ))}

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
