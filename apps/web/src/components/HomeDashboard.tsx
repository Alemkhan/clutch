import { getStats, winRatePercent } from '../lib/localStats';
import { playSound } from '../lib/sounds';
import { challenges } from '../lib/tournaments';

interface HomeDashboardProps {
  onFindMatch: () => void;
  onProfile: () => void;
  onChallenge: (tournamentId: string) => void;
}

export function HomeDashboard({ onFindMatch, onProfile, onChallenge }: HomeDashboardProps) {
  const stats = getStats();

  return (
    <section className="home-dashboard">
      <header className="home-header">
        <button className="home-avatar-btn" onClick={() => { playSound('click'); onProfile(); }}>
          <img src="/sprites/avatar-player.png" alt="Your profile" />
        </button>
        <div className="home-chips">
          <span className="chip streak-chip">🔥 {stats.currentStreak}</span>
        </div>
      </header>

      <h1 className="home-title">Ready to<br />Clutch?</h1>

      <div className="hero-wrap" aria-hidden="true">
        <img className="hero-trail" src="/sprites/trail.png" alt="" />
        <img className="hero-art" src="/sprites/hero.png" alt="" />
      </div>

      <button className="cta-btn" onClick={() => { playSound('click'); onFindMatch(); }}>
        Find Match
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
              Watch clip ↗
            </a>
            <button className="challenge-play" onClick={() => { playSound('click'); onChallenge(tournament.id); }}>
              Play
            </button>
          </div>
        </div>
      ))}

      <div className="home-stats-card">
        <div className="mini-stat">
          <span className="mini-stat-value">{stats.wins}</span>
          <span className="mini-stat-label">Wins</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{winRatePercent(stats)}%</span>
          <span className="mini-stat-label">Win Rate</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{stats.bestStreak}</span>
          <span className="mini-stat-label">Best Streak</span>
        </div>
      </div>
    </section>
  );
}
