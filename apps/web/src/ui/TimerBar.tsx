import { useState, useEffect, useRef } from 'react';
import { playSound } from '../platform/sounds';
import { nextCountdownTick, remainingQuestionMs } from '../features/round/questionTiming';

interface TimerBarProps {
  durationMs: number;
  deadlineMs: number;
  onExpire: () => void;
  paused: boolean;
}

export function TimerBar({ durationMs, deadlineMs, onExpire, paused }: TimerBarProps) {
  const [remainingMs, setRemainingMs] = useState(() => remainingQuestionMs(deadlineMs, Date.now()));
  const timerStateRef = useRef({
    deadlineMs,
    expired: false,
    playedTicks: new Set<number>(),
  });
  const onExpireRef = useRef(onExpire);

  if (timerStateRef.current.deadlineMs !== deadlineMs) {
    timerStateRef.current = {
      deadlineMs,
      expired: false,
      playedTicks: new Set<number>(),
    };
  }

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    setRemainingMs(remainingQuestionMs(deadlineMs, Date.now()));
  }, [deadlineMs]);

  useEffect(() => {
    if (paused) {
      setRemainingMs(remainingQuestionMs(deadlineMs, Date.now()));
      return;
    }

    const syncWithClock = () => {
      const nextRemainingMs = remainingQuestionMs(deadlineMs, Date.now());
      setRemainingMs(nextRemainingMs);

      const timerState = timerStateRef.current;
      const tick = nextCountdownTick(nextRemainingMs, timerState.playedTicks);
      if (tick !== null) {
        timerState.playedTicks.add(tick);
        playSound('tick', 0.6);
      }

      if (nextRemainingMs === 0 && !timerState.expired) {
        timerState.expired = true;
        onExpireRef.current();
      }
    };

    syncWithClock();
    const interval = window.setInterval(syncWithClock, 100);
    document.addEventListener('visibilitychange', syncWithClock);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', syncWithClock);
    };
  }, [deadlineMs, paused]);

  const isDanger = remainingMs <= 5_000;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - remainingMs / durationMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      className={`timer-ring ${isDanger ? 'danger' : ''}`}
      role="timer"
      aria-label={`Осталось ${remainingSeconds} сек.`}
      aria-live="off"
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="timer-ring-bg" cx="50" cy="50" r={radius} />
        <circle
          className="timer-ring-fill"
          cx="50"
          cy="50"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
        />
      </svg>
      <span className="timer-ring-text" aria-hidden="true">{remainingSeconds}</span>
    </div>
  );
}
