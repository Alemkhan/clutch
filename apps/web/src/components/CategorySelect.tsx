import { playSound } from '../lib/sounds';

interface CategorySelectProps {
  onSelect: (categoryId: string) => void;
  onBack: () => void;
}

const CATEGORIES = [
  { id: 'geography', name: 'География', icon: '🌍', available: true, blurb: '195 стран · флаги, столицы, контуры' },
  { id: 'history', name: 'Исторические флаги', icon: '🏴', available: true, blurb: '44 флага · империи, султанаты, города' },
  { id: 'languages', name: 'Языки', icon: '🗣️', available: true, blurb: '37 языков · угадаешь по письму?' },
  { id: 'sports', name: 'Спорт', icon: '⚽', available: false },
  { id: 'science', name: 'Наука', icon: '🧪', available: false },
];

export function CategorySelect({ onSelect, onBack }: CategorySelectProps) {
  return (
    <section className="category-select">
      <button className="back-btn" onClick={() => { onBack(); }}>← Назад</button>
      <h1 className="screen-title">Выбери<br />категорию</h1>
      <p className="screen-subtitle">Покажи, что знаешь. Докажи умением.</p>
      <div className="category-list">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`category-card ${cat.available ? '' : 'locked'}`}
            disabled={!cat.available}
            onClick={() => { if (cat.available) { onSelect(cat.id); } }}
          >
            <span className="category-icon">
              {cat.icon.startsWith('/') ? <img src={cat.icon} alt="" /> : cat.icon}
            </span>
            <span className="category-info">
              <span className="category-name">{cat.name}</span>
              <span className="category-meta">{cat.available ? cat.blurb : 'Скоро'}</span>
            </span>
            <span className="category-arrow" aria-hidden="true">{cat.available ? '→' : '·'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
