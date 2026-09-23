import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { SkillResult } from '@clutch/shared';
import { SKILL_REWARDS, resultFromDistance } from '@clutch/shared';
import { analytics } from '../lib/analytics';
import { playSound, strikeSoundFor } from '../lib/sounds';

interface HammerGameProps {
  config: { markerSpeed: number; targetWidth: number; perfectWidth: number };
  onComplete: (result: SkillResult, progressAwarded: number, distance: number) => void;
}

const SINK_PX: Record<SkillResult, number> = {
  perfect: 108,
  great: 82,
  good: 56,
  weak: 30,
  miss: 10,
};

const HAMMER_IDLE = { rotate: -22, x: 0, y: 0 };
const HAMMER_STRUCK = { rotate: 24, x: 14, y: 10 };

export function HammerGame({ config, onComplete }: HammerGameProps) {
  const reduceMotion = useReducedMotion();
  const [markerPos, setMarkerPos] = useState(0);
  const [struck, setStruck] = useState(false);
  const [result, setResult] = useState<SkillResult | null>(null);
  const posRef = useRef(0);
  const dirRef = useRef(1);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const distanceRef = useRef(1);
  const completedRef = useRef(false);

  useEffect(() => {
    posRef.current = 0;
    dirRef.current = 1;
    stoppedRef.current = false;

    const animate = () => {
      if (stoppedRef.current) return;

      let next = posRef.current + dirRef.current * config.markerSpeed * 0.016;
      if (next >= 1) {
        next = 1;
        dirRef.current = -1;
      }
      if (next <= 0) {
        next = 0;
        dirRef.current = 1;
      }
      posRef.current = next;
      setMarkerPos(next);

      rafRef.current = requestAnimationFrame(animate);
    };

    analytics.track('skill_attempt_started');
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [config.markerSpeed]);

  const handleTap = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    setStruck(true);
    cancelAnimationFrame(rafRef.current);
    playSound('hammerTap');

    const distance = Math.abs(posRef.current - 0.5) * 2;
    distanceRef.current = distance;
    const skillResult = resultFromDistance(distance);
    const progress = SKILL_REWARDS[skillResult];

    setResult(skillResult);
    setTimeout(() => playSound(strikeSoundFor[skillResult]), 150);

    analytics.track('skill_attempt_completed', {
      skillResult,
      progressAwarded: progress,
    });
    // onComplete fires from the nail-sink animation's onAnimationComplete below,
    // once the player has actually seen it settle — not on a fixed timer that has
    // to be kept in sync with the animation's own duration by hand.
  }, []);

  const targetLeft = `${(1 - config.targetWidth) * 50}%`;
  const targetWidth = `${config.targetWidth * 100}%`;
  const perfectLeft = `${(1 - config.perfectWidth) * 50}%`;
  const perfectWidth = `${config.perfectWidth * 100}%`;

  return (
    <div className="hammer-game" onClick={handleTap}>
      {!result && <h2 className="stump-headline">Бей по пню!</h2>}

      <div className={`stump-scene ${struck ? 'shake' : ''}`} aria-hidden="true">
        <img className="stump-img" src="/sprites/stump.png" alt="" />
        <div className="nail-slot">
          <motion.img
            src="/sprites/nail.png"
            alt=""
            animate={{ y: result ? SINK_PX[result] : 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => {
              if (result && !completedRef.current) {
                completedRef.current = true;
                onComplete(result, SKILL_REWARDS[result], distanceRef.current);
              }
            }}
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

      <div className="hammer-track">
        <div className="target-zone" style={{ left: targetLeft, width: targetWidth }} />
        <div className="perfect-zone" style={{ left: perfectLeft, width: perfectWidth }} />
        <div
          className="marker"
          style={{ left: `${markerPos * 100}%` }}
        />
      </div>

      {result ? (
        <div className={`strike-result ${result}`}>
          <span className="strike-label">
            {{ perfect: 'ИДЕАЛЬНО', great: 'ОТЛИЧНО', good: 'ХОРОШО', weak: 'СЛАБО', miss: 'МИМО' }[result]}
          </span>
          <span className="strike-progress">+{SKILL_REWARDS[result]}%</span>
        </div>
      ) : (
        <p className="strike-instruction">Тапни, когда маркер в центре</p>
      )}
    </div>
  );
}
