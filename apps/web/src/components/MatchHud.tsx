import { motion, useReducedMotion } from 'framer-motion';

interface MatchHudProps {
  player: number;
  opponent: number;
  opponentName: string;
  round: number;
  totalRounds: number;
}

function initials(name: string): string {
  const letters = name.trim().split(/\s+/).map((part) => part[0]).filter(Boolean);
  return (letters.slice(0, 2).join('') || '?').toUpperCase();
}

interface CompetitorProps {
  name: string;
  value: number;
  side: 'player' | 'opponent';
}

function Competitor({ name, value, side }: CompetitorProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={`match-hud-competitor ${side}`}>
      <div className="match-hud-identity">
        <span className="match-hud-avatar" aria-hidden="true">
          {side === 'player' ? 'ТЫ' : initials(name)}
        </span>
        <span className="match-hud-name">{name}</span>
        <strong className="match-hud-value">{value}%</strong>
      </div>
      <div className="match-hud-track" aria-label={`${name}: ${value}%`}>
        <motion.span
          className="match-hud-fill"
          initial={false}
          animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

export function MatchHud({ player, opponent, opponentName, round, totalRounds }: MatchHudProps) {
  return (
    <section className="match-hud" aria-label="Прогресс матча">
      <div className="match-hud-grid">
        <Competitor name="Ты" value={player} side="player" />
        <div className="match-hud-round" aria-label={`Раунд ${round} из ${totalRounds}`}>
          <span>Раунд</span>
          <strong>{round}<i>/</i>{totalRounds}</strong>
        </div>
        <Competitor name={opponentName} value={opponent} side="opponent" />
      </div>
    </section>
  );
}
