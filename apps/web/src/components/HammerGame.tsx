import { useState, useEffect, useRef, useCallback } from 'react';
import type { SkillResult } from '@clutch/shared';
import { SKILL_REWARDS, resultFromDistance } from '@clutch/shared';
import { analytics } from '../lib/analytics';
import { playSound, strikeSoundFor } from '../lib/sounds';

interface HammerGameProps {
  config: { markerSpeed: number; targetWidth: number; perfectWidth: number };
  onComplete: (result: SkillResult, progressAwarded: number) => void;
}

const SINK_PX: Record<SkillResult, number> = {
  perfect: 108,
  great: 82,
  good: 56,
  weak: 30,
  miss: 10,
};

export function HammerGame({ config, onComplete }: HammerGameProps) {
  const [markerPos, setMarkerPos] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [struck, setStruck] = useState(false);
  const [result, setResult] = useState<SkillResult | null>(null);
  const posRef = useRef(0);
  const dirRef = useRef(1);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number>(0);

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
    setStopped(true);
    setStruck(true);
    cancelAnimationFrame(rafRef.current);
    playSound('hammerTap');

    const distance = Math.abs(posRef.current - 0.5) * 2;
    const skillResult = resultFromDistance(distance);
    const progress = SKILL_REWARDS[skillResult];

    setResult(skillResult);
    setTimeout(() => playSound(strikeSoundFor[skillResult]), 150);

    analytics.track('skill_attempt_completed', {
      skillResult,
      progressAwarded: progress,
    });

    setTimeout(() => {
      onComplete(skillResult, progress);
    }, 900);
  }, [onComplete]);

  const targetLeft = `${(1 - config.targetWidth) * 50}%`;
  const targetWidth = `${config.targetWidth * 100}%`;
  const perfectLeft = `${(1 - config.perfectWidth) * 50}%`;
  const perfectWidth = `${config.perfectWidth * 100}%`;

  return (
    <div className="hammer-game" onClick={handleTap}>
      {!result && <h2 className="stump-headline">Hit the Stump!</h2>}

      <div className={`stump-scene ${struck ? 'shake' : ''}`} aria-hidden="true">
        <img className="stump-img" src="/sprites/stump.png" alt="" />
        <div className="nail-slot">
          <img
            src="/sprites/nail.png"
            alt=""
            style={{ transform: `translateY(${result ? SINK_PX[result] : 0}px)` }}
          />
        </div>
        <img className={`hammer-tool ${struck ? 'struck' : ''}`} src="/sprites/hammer-tool.png" alt="" />
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
          <span className="strike-label">{result.toUpperCase()}</span>
          <span className="strike-progress">+{SKILL_REWARDS[result]}%</span>
        </div>
      ) : (
        <p className="strike-instruction">Tap when the marker hits the center</p>
      )}
    </div>
  );
}
