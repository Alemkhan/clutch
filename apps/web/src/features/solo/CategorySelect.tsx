import { useMessages } from '../../i18n/messages';
import { m } from './messages';
import { CATEGORY_POOL_SIZES, isCategoryOpen } from '@clutch/shared';
import { ScreenHeader } from '../../ui/ScreenHeader';

interface CategorySelectProps {
  onSelect: (categoryId: string) => void;
  onBack: () => void;
}

type Texts = (typeof m)['ru'];

const { generalTopics, countries, otherFlags, languages } = CATEGORY_POOL_SIZES;

/** «132 символа», «37 языков»: числа из CATEGORY_POOL_SIZES, их сверка с данными — в shared. */
const categories = (t: Texts) => [
  { id: 'general', name: t.catGeneral, icon: '💡', available: true, blurb: t.blurbGeneral(generalTopics) },
  { id: 'geography', name: t.catGeography, icon: '🌍', available: true, blurb: t.blurbGeography(countries) },
  { id: 'history', name: t.catOtherFlags, icon: '🏴', available: true, blurb: t.blurbOtherFlags(otherFlags) },
  { id: 'languages', name: t.catLanguages, icon: '🗣️', available: true, blurb: t.blurbLanguages(languages) },
  // Открывается сама, когда одобренных вопросов наберётся KZ_MIN_LIVE; до того — «Скоро».
  { id: 'kz_history', name: t.catKzHistory, icon: '🇰🇿', available: isCategoryOpen('kz_history'), blurb: t.blurbKzHistory },
];

type Category = ReturnType<typeof categories>[number];

function CategoryCard({ cat, onSelect }: { cat: Category; onSelect: (categoryId: string) => void }) {
  const t = useMessages(m);
  return (
    <button
      className={`category-card ${cat.available ? '' : 'locked'}`}
      disabled={!cat.available}
      onClick={() => { if (cat.available) { onSelect(cat.id); } }}
    >
      <span className="category-icon">
        {cat.icon.startsWith('/') ? <img src={cat.icon} alt="" /> : cat.icon}
      </span>
      <span className="category-info">
        <span className="category-name">{cat.name}</span>
        <span className="category-meta">{cat.available ? cat.blurb : t.soon}</span>
      </span>
      <span className="category-arrow" aria-hidden="true">{cat.available ? '→' : '·'}</span>
    </button>
  );
}

/**
 * «Общие знания» — 98% забегов, поэтому они одни на виду. Узкие категории не удалены, а свёрнуты:
 * их вопросы и так попадают в набор «Общих знаний», а отдельно в них играют единицы.
 */
export function CategorySelect({ onSelect, onBack }: CategorySelectProps) {
  const t = useMessages(m);
  const [main, ...more] = categories(t);
  return (
    <section className="category-select">
      <ScreenHeader onBack={onBack} title={<>{t.chooseLine1}<br />{t.chooseLine2}</>} />
      <p className="screen-subtitle">{t.categorySubtitle}</p>
      <div className="category-list">
        <CategoryCard cat={main} onSelect={onSelect} />
        <details className="category-more">
          <summary>{t.moreCategories}</summary>
          <div className="category-list">
            {more.map((cat) => <CategoryCard key={cat.id} cat={cat} onSelect={onSelect} />)}
          </div>
        </details>
      </div>
    </section>
  );
}
