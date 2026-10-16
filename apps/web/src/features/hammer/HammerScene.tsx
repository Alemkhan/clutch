import { motion, useReducedMotion } from 'framer-motion';
import type { SkillResult } from '@clutch/shared';

const SINK_PX: Record<SkillResult, number> = {
  perfect: 108,
  great: 82,
  good: 56,
  weak: 30,
  miss: 10,
};

const HAMMER_IDLE = { rotate: -22, x: 0, y: 0 };
const HAMMER_STRUCK = { rotate: 24, x: 14, y: 10 };

/** Пень, гвоздь и молоток. onNailSettled — когда гвоздь дошёл до конца анимации погружения. */
export function HammerScene({ struck, result, onNailSettled }: {
  struck: boolean;
  result: SkillResult | null;
  onNailSettled: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className={`stump-scene ${struck ? 'shake' : ''}`} aria-hidden="true">
      <img className="stump-img" src="/sprites/stump.png" alt="" />
      <div className="nail-slot">
        <motion.img
          src="/sprites/nail.png"
          alt=""
          animate={{ y: result ? SINK_PX[result] : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={onNailSettled}
        />
      </div>
      <motion.img
        className="hammer-tool"
        src="/sprites/hammer-tool.png"
        alt=""
        animate={struck ? HAMMER_STRUCK : HAMMER_IDLE}
        transition={{ duration: reduceMotion ? 0 : struck ? 0.11 : 0.14, ease: struck ? 'easeOut' : 'easeIn' }}
      />
      {result && (
        <img
          className="strike-burst"
          src={result === 'perfect' ? '/sprites/burst-perfect.png' : '/sprites/burst-hit.png'}
          alt=""
        />
      )}
    </div>
  );
}
