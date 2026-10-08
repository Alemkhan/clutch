import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { MiniGameConfig, SkillResult } from '@clutch/shared';
import {
  SKILL_REWARDS,
  hammerAttemptRules,
  normalizedHammerDistance,
  scoreHammerDistance,
} from '@clutch/shared';
import { analytics } from '../lib/analytics';
import {
  cappedFrameDeltaMs,
  hammerTierZones,
  markerPositionAtElapsed,
  reducedMotionMarkerPosition,
} from '../lib/hammerMotion';
import { playSound, strikeSoundFor } from '../lib/sounds';
import { preloadImages } from '../lib/preloadImages';
import { hasSeenHammerIntro, markHammerIntroSeen } from '../lib/hammerIntro';

interface HammerGameProps {
  config: MiniGameConfig;
  questionId: string;
  previousSkillResults: readonly SkillResult[];
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

export function hammerActionSemantics(struck: boolean, result: SkillResult | null) {
  return {
    tabIndex: struck ? -1 : 0,
    'aria-disabled': struck,
    'aria-label': result ? 'Удар завершён' : 'Нажмите, чтобы ударить по пню',
  } as const;
}

export function HammerResult({ result }: { result: SkillResult }) {
  return (
    <div className={`strike-result ${result}`} aria-hidden="true">
      <span className="strike-label">
        {{ perfect: 'ИДЕАЛЬНО', great: 'ОТЛИЧНО', good: 'ХОРОШО', weak: 'СЛАБО', miss: 'МИМО' }[result]}
      </span>
      <span className="strike-progress">+{SKILL_REWARDS[result]}%</span>
    </div>
  );
}

export function HammerResultStatus({ result }: { result: SkillResult }) {
  const label = {
    perfect: 'Идеально', great: 'Отлично', good: 'Хорошо', weak: 'Слабо', miss: 'Мимо',
  }[result];
  return (
    <span className="visually-hidden" role="status">
      Результат удара: {label}, +{SKILL_REWARDS[result]}% прогресса.
    </span>
  );
}

export function HammerIntro({ onConfirm }: { onConfirm: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <section className="hammer-intro" role="region" aria-labelledby="hammer-intro-title">
      <h2 id="hammer-intro-title" className="hammer-intro-title">Как забить гвоздь</h2>
      <ul className="hammer-intro-list">
        <li>Маркер бежит по полосе туда и обратно.</li>
        <li>Тапни, чтобы остановить его в целевой зоне.</li>
        <li>Чем ближе к центру, тем больше прогресса за удар.</li>
        <li>Промах не даёт прогресса, но попытку не отнимает.</li>
      </ul>
      <p className="hammer-intro-note">С каждым удачным ударом зоны становятся уже.</p>
      <button type="button" className="hammer-intro-btn" ref={buttonRef} onClick={onConfirm}>
        Понятно, бью
      </button>
    </section>
  );
}

export function HammerGame({ config, questionId, previousSkillResults, onComplete }: HammerGameProps) {
  const reduceMotion = useReducedMotion();
  const attempt = useMemo(
    () => hammerAttemptRules(questionId, previousSkillResults, config),
    [config, previousSkillResults, questionId],
  );
  const tierZones = useMemo(() => hammerTierZones(attempt), [attempt]);
  const [markerPos, setMarkerPos] = useState(0);
  const [struck, setStruck] = useState(false);
  const [result, setResult] = useState<SkillResult | null>(null);
  // The explanation is a step BEFORE the attempt: while open, the attempt effect
  // below does not start the marker, the frame clock or analytics.
  const [introOpen, setIntroOpen] = useState(() => !hasSeenHammerIntro());
  const posRef = useRef(0);
  const activeElapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const distanceRef = useRef(1);
  const completedRef = useRef(false);
  const soundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The burst sprites are multi-megabyte and otherwise first requested at the
  // moment of the strike. Warm the cache on mount; failures are ignored.
  useEffect(() => {
    preloadImages(['/sprites/burst-hit.png', '/sprites/burst-perfect.png']);
  }, []);

  useEffect(() => {
    if (introOpen) return undefined;
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
      const staticPosition = reducedMotionMarkerPosition(attempt);
      posRef.current = staticPosition;
      setMarkerPos(staticPosition);
    } else {
      resume();
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (soundTimeoutRef.current !== null) clearTimeout(soundTimeoutRef.current);
    };
  }, [attempt.targetCenter, config.markerSpeed, reduceMotion, introOpen]);

  const handleTap = useCallback(() => {
    if (introOpen || stoppedRef.current) return;
    stoppedRef.current = true;
    setStruck(true);
    cancelAnimationFrame(rafRef.current);
    playSound('hammerTap');

    const distance = normalizedHammerDistance(posRef.current, attempt.targetCenter);
    distanceRef.current = distance;
    const { result: skillResult, progressAwarded: progress } = scoreHammerDistance(
      distance,
      attempt.stage,
      config,
    );

    setResult(skillResult);
    soundTimeoutRef.current = setTimeout(() => playSound(strikeSoundFor[skillResult]), 150);

    analytics.track('skill_attempt_completed', {
      skillResult,
      progressAwarded: progress,
    });
    // onComplete fires from the nail-sink animation's onAnimationComplete below,
    // once the player has actually seen it settle — not on a fixed timer that has
    // to be kept in sync with the animation's own duration by hand.
  }, [attempt.stage, attempt.targetCenter, config, introOpen]);

  const confirmIntro = () => {
    markHammerIntroSeen();
    setIntroOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleTap();
    }
  };

  return (
    <>
      {introOpen && <HammerIntro onConfirm={confirmIntro} />}
      <div
        className="hammer-game"
        role="button"
        {...hammerActionSemantics(struck || introOpen, result)}
        aria-hidden={introOpen || undefined}
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

      <div className="hammer-track" aria-hidden="true">
        {tierZones.map((zone) => (
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
        <HammerResult result={result} />
      ) : (
        <p className="strike-instruction">Тапни, когда маркер в центре</p>
      )}

      </div>
      {result && <HammerResultStatus result={result} />}
    </>
  );
}
