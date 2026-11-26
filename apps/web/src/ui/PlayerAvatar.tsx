import { Creature } from './Creature';

/**
 * Аватар игрока: эмодзи его клана, а у игрока без клана - зверёк из имени. Эмодзи рисуется в SVG
 * с той же сеткой 64×64, что и зверёк, поэтому подходит к любому размеру контейнера.
 */
export function PlayerAvatar({ seed, emoji, className = '' }: { seed: string; emoji?: string | null; className?: string }) {
  if (!emoji) return <Creature seed={seed} className={className} />;
  return (
    <svg className={`creature emoji-avatar ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill="#efe8ff" />
      <text x="32" y="35" fontSize="38" textAnchor="middle" dominantBaseline="central">{emoji}</text>
    </svg>
  );
}
