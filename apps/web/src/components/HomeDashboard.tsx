import { getStats, winRatePercent } from '../lib/localStats';
import { mistakeCount } from '../lib/mistakeLog';
import { playSound } from '../lib/sounds';
import { challenges } from '../lib/tournaments';

interface HomeDashboardProps {
  onFindMatch: () => void;
  onProfile: () => void;
  onTraining: () => void;
  onChallenge: (tournamentId: string) => void;
}

export function HomeDashboard({ onFindMatch, onProfile, onTraining, onChallenge }: HomeDashboardProps) {
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
          <button className="home-avatar-btn" aria-label="Открыть профиль" onClick={() => { playSound('click'); onProfile(); }}>
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
        <button className="cta-btn" onClick={() => { playSound('click'); onFindMatch(); }}>
          Найти соперника <span aria-hidden="true">→</span>
        </button>
      </section>

      <button type="button" className="training-entry" onClick={() => { playSound('click'); onTraining(); }}>
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
              onClick={() => playSound('click')}
            >
              Смотреть клип ↗
            </a>
            <button className="challenge-play" onClick={() => { playSound('click'); onChallenge(tournament.id); }}>
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
