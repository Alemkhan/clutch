import { useState, useEffect, useRef } from 'react';
import { playSound } from '../lib/sounds';

interface TimerBarProps {
  duration: number;
  onExpire: () => void;
  paused: boolean;
}

export function TimerBar({ duration, onExpire, paused }: TimerBarProps) {
  const [remaining, setRemaining] = useState(duration);
  const expiredRef = useRef(false);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    setRemaining(duration);
    expiredRef.current = false;
    lastTickRef.current = null;
  }, [duration]);

  useEffect(() => {
    if (paused) return;

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 0.1) {
          clearInterval(interval);
          return 0;
        }
        const next = Math.round((prev - 0.1) * 10) / 10;
        const nextSecond = Math.ceil(next);
        if (nextSecond <= 3 && nextSecond >= 1 && nextSecond !== lastTickRef.current && Number.isInteger(next)) {
          lastTickRef.current = nextSecond;
          playSound('tick', 0.6);
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [paused]);

  useEffect(() => {
    if (remaining <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      playSound('timeout');
      onExpire();
    }
  }, [remaining, onExpire]);

  const isDanger = remaining <= 5;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - remaining / duration);

  return (
    <div className={`timer-ring ${isDanger ? 'danger' : ''}`}>
      <svg viewBox="0 0 100 100">
        <circle className="timer-ring-bg" cx="50" cy="50" r={radius} />
        <circle
          className="timer-ring-fill"
          cx="50"
          cy="50"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
        />
      </svg>
      <span className="timer-ring-text">{Math.ceil(remaining)}</span>
    </div>
  );
}
