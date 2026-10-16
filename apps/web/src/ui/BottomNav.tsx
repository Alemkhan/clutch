import type { Phase } from '../app/gameSession';

export type NavTab = 'home' | 'myRuns' | 'training' | 'profile';

interface BottomNavProps {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
}

const TABS: ReadonlyArray<{ id: NavTab; label: string }> = [
  { id: 'home', label: 'Главная' },
  { id: 'myRuns', label: 'Партии' },
  { id: 'training', label: 'Тренировка' },
  { id: 'profile', label: 'Профиль' },
];

/** Экраны верхнего уровня, на которых панель видна. Во время игры её нет. */
export function navTabForPhase(phase: Phase): NavTab | null {
  if (phase === 'home' || phase === 'myRuns' || phase === 'training' || phase === 'profile') return phase;
  return null;
}

function TabIcon({ id }: { id: NavTab }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'home':
      return <svg {...common} aria-hidden="true"><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></svg>;
    case 'myRuns':
      return <svg {...common} aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg>;
    case 'training':
      return <svg {...common} aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></svg>;
    case 'profile':
      return <svg {...common} aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></svg>;
  }
}

export function BottomNav({ active, onSelect }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === active ? 'bottom-nav-item active' : 'bottom-nav-item'}
          aria-current={tab.id === active ? 'page' : undefined}
          onClick={() => { if (tab.id !== active) onSelect(tab.id); }}
        >
          <TabIcon id={tab.id} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
