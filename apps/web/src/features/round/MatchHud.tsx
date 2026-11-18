import { m } from './messages';
import { useMessages } from '../../i18n/messages';
import { motion, useReducedMotion } from 'framer-motion';
import { SoundToggle } from '../../ui/SoundToggle';
import { Creature } from '../../ui/Creature';
import { PlayerAvatar } from '../../ui/PlayerAvatar';
import { myClanEmoji } from '../clans/clanStore';
import { getPlayerName } from '../../platform/apiClient';
import { displayPlayerName } from '../../i18n/playerName';

interface MatchHudProps {
  player: number;
  opponent: number;
  opponentName: string;
  round: number;
  totalRounds: number;
}

export interface CompetitorProps {
  name: string;
  value: number;
  side: 'player' | 'opponent';
  /** Прирост от последнего удара: value уже включает его, полоса рисует его отдельным сегментом. */
  gain?: number;
}

export function Competitor({ name, value, side, gain = 0 }: CompetitorProps) {
  const t = useMessages(m);
  const reduceMotion = useReducedMotion();
  const progress = Math.min(100, Math.max(0, value));
  const gainShown = Math.min(progress, Math.max(0, gain));
  const baseProgress = progress - gainShown;

  return (
    <div className={`match-hud-competitor ${side}`}>
      <div className="match-hud-identity">
        <span className="match-hud-avatar" aria-hidden="true">
          {side === 'player' ? <PlayerAvatar seed={getPlayerName()} emoji={myClanEmoji()} /> : <Creature seed={name} />}
        </span>
        <span className="match-hud-name" title={displayPlayerName(name)}>{displayPlayerName(name)}</span>
        {gainShown > 0 && <span className="match-hud-gain-chip">+{gainShown}</span>}
        <strong className="match-hud-value">{value}%</strong>
      </div>
      <div
        className="match-hud-track"
        role="progressbar"
        aria-label={t.progressOf(name)}
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
  const t = useMessages(m);
  return (
    <section className="match-hud" aria-label={t.matchProgress}>
      <div className="match-hud-grid">
        <Competitor name={t.you} value={player} side="player" />
        <div className="match-hud-center">
          <div className="match-hud-round" aria-label={t.roundOf(round, totalRounds)}>
            <span>{t.round}</span>
            <strong>{round}<i>/</i>{totalRounds}</strong>
          </div>
          <SoundToggle variant="hud" />
        </div>
        <Competitor name={opponentName} value={opponent} side="opponent" />
      </div>
    </section>
  );
}
