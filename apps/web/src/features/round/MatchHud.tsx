import { motion, useReducedMotion } from 'framer-motion';
import { SoundToggle } from '../../ui/SoundToggle';

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

export interface CompetitorProps {
  name: string;
  value: number;
  side: 'player' | 'opponent';
  /** Прирост от последнего удара: value уже включает его, полоса рисует его отдельным сегментом. */
  gain?: number;
}

export function Competitor({ name, value, side, gain = 0 }: CompetitorProps) {
  const reduceMotion = useReducedMotion();
  const progress = Math.min(100, Math.max(0, value));
  const gainShown = Math.min(progress, Math.max(0, gain));
  const baseProgress = progress - gainShown;

  return (
    <div className={`match-hud-competitor ${side}`}>
      <div className="match-hud-identity">
        <span className="match-hud-avatar" aria-hidden="true">
          {side === 'player' ? 'ТЫ' : initials(name)}
        </span>
        <span className="match-hud-name" title={name}>{name}</span>
        {gainShown > 0 && <span className="match-hud-gain-chip">+{gainShown}</span>}
        <strong className="match-hud-value">{value}%</strong>
      </div>
      <div
        className="match-hud-track"
        role="progressbar"
        aria-label={`Прогресс: ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${progress}%`}
      >
        <motion.span
          className="match-hud-fill"
          aria-hidden="true"
          initial={false}
          animate={{ width: `${baseProgress}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
        {gainShown > 0 && (
          <span className="match-hud-gain" aria-hidden="true" style={{ width: `${gainShown}%` }} />
        )}
      </div>
    </div>
  );
}

export function MatchHud({ player, opponent, opponentName, round, totalRounds }: MatchHudProps) {
  return (
    <section className="match-hud" aria-label="Прогресс матча">
      <div className="match-hud-grid">
        <Competitor name="Ты" value={player} side="player" />
        <div className="match-hud-center">
          <div className="match-hud-round" aria-label={`Раунд ${round} из ${totalRounds}`}>
            <span>Раунд</span>
            <strong>{round}<i>/</i>{totalRounds}</strong>
          </div>
          <SoundToggle variant="hud" />
        </div>
        <Competitor name={opponentName} value={opponent} side="opponent" />
      </div>
    </section>
  );
}
