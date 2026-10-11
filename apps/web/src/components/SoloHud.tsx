import { motion, useReducedMotion } from 'framer-motion';
import { SoundToggle } from './SoundToggle';

interface SoloHudProps {
  progress: number;
  target: number;
  /** Прогресс темпа соперника на той же полосе. null — темпа нет, ничего не рисуем. */
  paceProgress: number | null;
  paceName: string | null;
  round: number;
  /** Сколько кругов осталось: до потолка или до конца набора, что ближе. */
  roundsLeft: number;
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/**
 * HUD соло-забега: личность, процент и одна полоса. Темп соперника — метка на этой же полосе;
 * он только подсказывает, забег завершает один игрок: дойдя до цели или упёршись в потолок.
 */
export function SoloHud({ progress, target, paceProgress, paceName, round, roundsLeft }: SoloHudProps) {
  const reduceMotion = useReducedMotion();
  const own = clamp(progress, target);
  const pace = paceProgress === null ? null : clamp(paceProgress, target);
  const transition = { duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <section className="match-hud solo-hud" aria-label="Прогресс забега">
      <div className="solo-hud-top">
        <div className="match-hud-identity">
          <span className="match-hud-avatar" aria-hidden="true">ТЫ</span>
          <span className="match-hud-name">Ты</span>
          <strong className="match-hud-value">{own}%</strong>
        </div>
        <div className="solo-hud-rounds" aria-label={`Круг ${round}, осталось кругов: ${roundsLeft}`}>
          <strong>Круг {round}</strong>
          <span>осталось {roundsLeft}</span>
        </div>
        <SoundToggle variant="hud" />
      </div>
      <div className="solo-hud-bar">
        <div
          className="match-hud-track"
          role="progressbar"
          aria-label="Твой прогресс"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={own}
          aria-valuetext={`${own}% из ${target}%`}
        >
          <motion.span
            className="match-hud-fill"
            aria-hidden="true"
            initial={false}
            animate={{ width: `${(own / target) * 100}%` }}
            transition={transition}
          />
        </div>
        {pace !== null && (
          <motion.span
            className="solo-hud-pace-mark"
            aria-hidden="true"
            initial={false}
            animate={{ left: `${(pace / target) * 100}%` }}
            transition={transition}
          />
        )}
      </div>
      {pace !== null && paceName && (
        <p className="solo-hud-pace">
          Темп: <strong>{paceName}</strong> · {pace}%
          <span> · забег не завершает</span>
        </p>
      )}
    </section>
  );
}
