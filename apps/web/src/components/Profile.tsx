import { getStats, winRatePercent } from '../lib/localStats';
import { playSound } from '../lib/sounds';
import { getTelegramIdentity } from '../lib/telegram';
import { SoundToggle } from './SoundToggle';

interface ProfileProps {
  onBack: () => void;
}

export function Profile({ onBack }: ProfileProps) {
  const stats = getStats();
  const playerName = getTelegramIdentity()?.displayName || 'Игрок';

  const badges = [
    { id: 'hammer', name: 'Первый удар', icon: '◆', earned: stats.matchesPlayed > 0 },
    { id: 'streak', name: 'На огне', icon: '↗', earned: stats.bestStreak >= 3 },
    { id: 'star', name: 'Чемпион', icon: '★', earned: stats.wins >= 5 },
  ];

  return (
    <section className="profile-screen">
      <button className="back-btn" onClick={() => { playSound('click'); onBack(); }}>← Назад</button>

      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true">{playerName.slice(0, 2).toUpperCase()}</span>
        <h1 className="profile-name">{playerName}</h1>
        <p className="profile-tag">Пилотная сборка — статистика хранится на этом устройстве</p>
      </div>

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

      <h2 className="section-heading">Настройки</h2>
      <SoundToggle variant="profile" />

      <h2 className="section-heading">Достижения</h2>
      <div className="badge-grid">
        {badges.map((b) => (
          <div key={b.id} className={`badge-item ${b.earned ? '' : 'locked'}`}>
            <span className="badge-symbol" aria-hidden="true">{b.icon}</span>
            <span>{b.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
