import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { MiniGameConfig, SkillResult } from '@clutch/shared';
import { SKILL_REWARDS, resultFromDistance } from '@clutch/shared';
import { analytics } from '../lib/analytics';
import {
  cappedFrameDeltaMs,
  HAMMER_TIER_ZONES,
  markerPositionAtElapsed,
  REDUCED_MOTION_MARKER_POSITION,
} from '../lib/hammerMotion';
import { playSound, strikeSoundFor } from '../lib/sounds';

interface HammerGameProps {
  config: MiniGameConfig;
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
  const activeElapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const distanceRef = useRef(1);
  const completedRef = useRef(false);
  const soundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    posRef.current = 0;
    activeElapsedRef.current = 0;
    lastFrameRef.current = null;
    stoppedRef.current = false;
    completedRef.current = false;

    const animate = (timestamp: number) => {
      if (stoppedRef.current) return;

      activeElapsedRef.current += cappedFrameDeltaMs(lastFrameRef.current, timestamp);
      lastFrameRef.current = timestamp;
      const next = markerPositionAtElapsed(activeElapsedRef.current, config.markerSpeed);
      posRef.current = next;
      setMarkerPos(next);

      rafRef.current = requestAnimationFrame(animate);
    };

    const resume = () => {
      if (!stoppedRef.current && !document.hidden) {
        lastFrameRef.current = null;
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    const onVisibilityChange = () => {
      cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = null;
      if (!document.hidden) resume();
    };

    analytics.track('skill_attempt_started');
    if (reduceMotion) {
      posRef.current = REDUCED_MOTION_MARKER_POSITION;
      setMarkerPos(REDUCED_MOTION_MARKER_POSITION);
    } else {
      resume();
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (soundTimeoutRef.current !== null) clearTimeout(soundTimeoutRef.current);
    };
  }, [config.markerSpeed, reduceMotion]);

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
    soundTimeoutRef.current = setTimeout(() => playSound(strikeSoundFor[skillResult]), 150);

    analytics.track('skill_attempt_completed', {
      skillResult,
      progressAwarded: progress,
    });
    // onComplete fires from the nail-sink animation's onAnimationComplete below,
    // once the player has actually seen it settle — not on a fixed timer that has
    // to be kept in sync with the animation's own duration by hand.
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleTap();
    }
  };

  return (
    <div
      className="hammer-game"
      role="button"
      tabIndex={0}
      aria-label={result ? 'Удар завершён' : 'Нажмите, чтобы ударить по пню'}
      onClick={handleTap}
      onKeyDown={onKeyDown}
    >
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
        {HAMMER_TIER_ZONES.map((zone) => (
          <div
            key={zone.result}
            className={`hammer-zone hammer-zone-${zone.result}`}
            style={{ left: `${zone.leftPercent}%`, width: `${zone.widthPercent}%` }}
          />
        ))}
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
