import { getStats, winRatePercent } from '../lib/localStats';
import { playSound } from '../lib/sounds';

interface ProfileProps {
  onBack: () => void;
}

export function Profile({ onBack }: ProfileProps) {
  const stats = getStats();

  const badges = [
    { id: 'hammer', name: 'First Strike', icon: '/sprites/badge-hammer.png', earned: stats.matchesPlayed > 0 },
    { id: 'streak', name: 'On Fire', icon: '/sprites/badge-streak.png', earned: stats.bestStreak >= 3 },
    { id: 'star', name: 'Champion', icon: '/sprites/badge-star.png', earned: stats.wins >= 5 },
  ];

  return (
    <section className="profile-screen">
      <button className="back-btn" onClick={() => { playSound('click'); onBack(); }}>← Back</button>

      <div className="profile-head">
        <img className="profile-avatar" src="/sprites/avatar-player.png" alt="" />
        <h1 className="profile-name">Player</h1>
        <p className="profile-tag">Pilot build — stats saved on this device</p>
      </div>

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

      <h2 className="section-heading">Badges</h2>
      <div className="badge-grid">
        {badges.map((b) => (
          <div key={b.id} className={`badge-item ${b.earned ? '' : 'locked'}`}>
            <img src={b.icon} alt="" />
            <span>{b.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
