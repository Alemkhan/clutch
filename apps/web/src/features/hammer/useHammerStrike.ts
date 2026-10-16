import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import type { HammerAttemptRules, MiniGameConfig, SkillResult } from '@clutch/shared';
import { SKILL_REWARDS, scoreHammerTap } from '@clutch/shared';
import { analytics } from '../../platform/analytics';
import { playSound, strikeSoundFor } from '../../platform/sounds';
import { cappedFrameDeltaMs, markerPositionAtElapsed } from './hammerMotion';

export interface MarkerClock {
  markerPos: number;
  /** Маркер остановлен ударом. */
  stoppedRef: MutableRefObject<boolean>;
  /** Активное время бега маркера, мс: то, что уходит на сервер как момент удара. */
  elapsedRef: MutableRefObject<number>;
  rafRef: MutableRefObject<number>;
}

/**
 * Бег маркера по rAF. Пока открыто intro, попытка не стартует: ни маркера, ни часов кадра, ни аналитики.
 * Маркер движется всегда, в том числе при prefers-reduced-motion: это сама механика, а не украшение.
 * Раньше он там замирал на цели, и каждый удар выходил идеальным — то есть включённое «уменьшение
 * движения» давало гарантированные 25 очков. Под reduce motion гасится декор: замах, тряска пня, вспышки.
 */
export function useMarkerClock(attempt: HammerAttemptRules, introOpen: boolean): MarkerClock {
  const [markerPos, setMarkerPos] = useState(0);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (introOpen) return undefined;
    elapsedRef.current = 0;
    lastFrameRef.current = null;
    stoppedRef.current = false;

    const animate = (timestamp: number) => {
      if (stoppedRef.current) return;
      elapsedRef.current += cappedFrameDeltaMs(lastFrameRef.current, timestamp);
      lastFrameRef.current = timestamp;
      setMarkerPos(markerPositionAtElapsed(elapsedRef.current, attempt.markerSpeed));
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
    resume();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [attempt.targetCenter, attempt.markerSpeed, introOpen]);

  return { markerPos, stoppedRef, elapsedRef, rafRef };
}

interface StrikeInput {
  attempt: HammerAttemptRules;
  config: MiniGameConfig;
  questionId: string;
  previousSkillResults: readonly SkillResult[];
  introOpen: boolean;
  clock: MarkerClock;
  onComplete: (result: SkillResult, progressAwarded: number, activeElapsedMs: number) => void;
  onStrike?: (result: SkillResult, progressAwarded: number) => void;
}

/** Удар: остановка маркера, предпросмотр результата, звук; onComplete — когда гвоздь осел. */
export function useHammerStrike(input: StrikeInput) {
  const { attempt, config, questionId, previousSkillResults, introOpen, clock, onComplete, onStrike } = input;
  const { stoppedRef, elapsedRef, rafRef } = clock;
  const [struck, setStruck] = useState(false);
  const [result, setResult] = useState<SkillResult | null>(null);
  const tapElapsedRef = useRef(0);
  const completedRef = useRef(false);
  const soundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (introOpen) return undefined;
    completedRef.current = false;
    return () => {
      if (soundTimeoutRef.current !== null) clearTimeout(soundTimeoutRef.current);
    };
  }, [attempt.targetCenter, attempt.markerSpeed, introOpen]);

  const handleTap = useCallback(() => {
    if (introOpen || stoppedRef.current) return;
    stoppedRef.current = true;
    setStruck(true);
    cancelAnimationFrame(rafRef.current);
    playSound('hammerTap');

    // Момент удара — это то, что уйдёт на сервер; он же даёт предпросмотр через ту самую
    // функцию, которой сервер посчитает награду, поэтому разойтись в оценке они не могут.
    const activeElapsedMs = elapsedRef.current;
    tapElapsedRef.current = activeElapsedMs;
    const { result: skillResult, progressAwarded: progress } = scoreHammerTap(
      questionId,
      previousSkillResults,
      config,
      activeElapsedMs,
    );

    setResult(skillResult);
    onStrike?.(skillResult, progress);
    soundTimeoutRef.current = setTimeout(() => playSound(strikeSoundFor[skillResult]), 150);

    analytics.track('skill_attempt_completed', {
      skillResult,
      progressAwarded: progress,
    });
  }, [attempt.stage, attempt.targetCenter, config, introOpen, onStrike, previousSkillResults, questionId]);

  // onComplete вызывается, когда игрок реально увидел осевший гвоздь, а не по таймеру,
  // который пришлось бы вручную согласовывать с длительностью анимации.
  const onNailSettled = () => {
    if (result && !completedRef.current) {
      completedRef.current = true;
      onComplete(result, SKILL_REWARDS[result], tapElapsedRef.current);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleTap();
    }
  };

  return { struck, result, handleTap, onNailSettled, onKeyDown };
}
