import { SOLO_TARGET_PROGRESS } from '@clutch/shared';
import { Competitor } from './MatchHud';
import { SoundToggle } from './SoundToggle';

interface SoloHudProps {
  progress: number;
  /** Прогресс записи соперника на её полосе. null — соперника нет, ничего не рисуем. */
  paceProgress: number | null;
  paceName: string | null;
  round: number;
  /** Сколько кругов осталось: до потолка или до конца набора, что ближе. */
  roundsLeft: number;
  /** Прирост от удара, который уже сыгран: progress в HUD берёт его поверх сохранённого. */
  gain?: number;
}

/**
 * HUD соло-забега: аватар, имя, процент и полоса.
 * Соперник только рисуется: забег завершает один игрок, дойдя до цели или упёршись в потолок.
 */
export function SoloHud({ progress, paceProgress, paceName, round, roundsLeft, gain = 0 }: SoloHudProps) {
  const own = Math.min(SOLO_TARGET_PROGRESS, Math.max(0, progress));
  const hasOpponent = paceProgress !== null && Boolean(paceName);

  return (
    <section className={hasOpponent ? 'match-hud solo-hud' : 'match-hud solo-hud solo-hud-alone'} aria-label="Прогресс забега">
      <div className="match-hud-grid">
        <Competitor name="Ты" value={own} side="player" gain={gain} />
        <div className="match-hud-center">
          <div className="solo-hud-rounds" aria-label={`Круг ${round}, осталось кругов: ${roundsLeft}`}>
            <strong>Круг {round}</strong>
            <span>осталось {roundsLeft}</span>
          </div>
          <SoundToggle variant="hud" />
        </div>
        {hasOpponent && <Competitor name={paceName ?? ''} value={paceProgress ?? 0} side="opponent" />}
      </div>
    </section>
  );
}
