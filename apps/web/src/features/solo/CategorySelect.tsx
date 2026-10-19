import { isCategoryOpen } from '@clutch/shared';
import { ScreenHeader } from '../../ui/ScreenHeader';

interface CategorySelectProps {
  onSelect: (categoryId: string) => void;
  onBack: () => void;
}

const CATEGORIES = [
  { id: 'general', name: 'Общие знания', icon: '💡', available: true, blurb: 'наука, кино, музыка, спорт, история — 16 тем' },
  { id: 'geography', name: 'География', icon: '🌍', available: true, blurb: '195 стран · флаги и столицы' },
  { id: 'history', name: 'Другие флаги', icon: '🏴', available: true, blurb: '44 флага · империи, города, забытые государства' },
  { id: 'languages', name: 'Языки', icon: '🗣️', available: true, blurb: '37 языков · угадаешь по письму?' },
  // Открывается сама, когда одобренных вопросов наберётся KZ_MIN_LIVE; до того — «Скоро».
  { id: 'kz_history', name: 'История Казахстана', icon: '🇰🇿', available: isCategoryOpen('kz_history'), blurb: 'по программе ЕНТ · от саков до независимости' },
];

export function CategorySelect({ onSelect, onBack }: CategorySelectProps) {
  return (
    <section className="category-select">
      <ScreenHeader onBack={onBack} title={<>Выбери<br />категорию</>} />
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
