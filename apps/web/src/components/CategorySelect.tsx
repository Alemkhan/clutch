import { playSound } from '../lib/sounds';

interface CategorySelectProps {
  onSelect: () => void;
  onBack: () => void;
}

const CATEGORIES = [
  { id: 'geography', name: 'Geography', icon: '/sprites/globe.png', available: true, blurb: '48 countries · flags, capitals & outlines' },
  { id: 'sports', name: 'Sports', icon: '⚽', available: false },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬', available: false },
  { id: 'history', name: 'History', icon: '🏛️', available: false },
  { id: 'science', name: 'Science', icon: '🧪', available: false },
];

export function CategorySelect({ onSelect, onBack }: CategorySelectProps) {
  return (
    <section className="category-select">
      <button className="back-btn" onClick={() => { playSound('click'); onBack(); }}>← Back</button>
      <h1 className="screen-title">Choose a<br />Category</h1>
      <p className="screen-subtitle">Pick what you know. Prove it with skill.</p>
      <div className="category-list">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`category-card ${cat.available ? '' : 'locked'}`}
            disabled={!cat.available}
            onClick={() => { if (cat.available) { playSound('click'); onSelect(); } }}
          >
            <span className="category-icon">
              {cat.icon.startsWith('/') ? <img src={cat.icon} alt="" /> : cat.icon}
            </span>
            <span className="category-info">
              <span className="category-name">{cat.name}</span>
              <span className="category-meta">{cat.available ? cat.blurb : 'Coming soon'}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
