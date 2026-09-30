export interface QuestionTiming {
  startedAtMs: number;
  deadlineMs: number;
}

export type QuestionReadinessStatus = 'pending' | 'error' | 'ready';

export interface QuestionReadiness {
  status: QuestionReadinessStatus;
  requestKey: number;
  timing: QuestionTiming | null;
}

export type QuestionDecision =
  | { kind: 'answer'; answer: string; elapsedMs: number }
  | { kind: 'timeout'; answer: '__timeout__'; elapsedMs: number };

export function createQuestionTiming(startedAtMs: number, durationMs: number): QuestionTiming {
  return {
    startedAtMs,
    deadlineMs: startedAtMs + durationMs,
  };
}

export function createQuestionReadiness(
  hasMedia: boolean,
  nowMs: number,
  durationMs: number,
): QuestionReadiness {
  return {
    status: hasMedia ? 'pending' : 'ready',
    requestKey: 0,
    timing: hasMedia ? null : createQuestionTiming(nowMs, durationMs),
  };
}

export function markQuestionMediaReady(
  readiness: QuestionReadiness,
  requestKey: number,
  nowMs: number,
  durationMs: number,
): QuestionReadiness {
  if (readiness.status !== 'pending' || readiness.requestKey !== requestKey || readiness.timing) {
    return readiness;
  }
  return {
    ...readiness,
    status: 'ready',
    timing: createQuestionTiming(nowMs, durationMs),
  };
}

export function markQuestionMediaError(
  readiness: QuestionReadiness,
  requestKey: number,
): QuestionReadiness {
  if (readiness.status !== 'pending' || readiness.requestKey !== requestKey || readiness.timing) {
    return readiness;
  }
  return { ...readiness, status: 'error' };
}

export function retryQuestionMedia(readiness: QuestionReadiness): QuestionReadiness {
  if (readiness.status !== 'error' || readiness.timing) return readiness;
  return {
    ...readiness,
    status: 'pending',
    requestKey: readiness.requestKey + 1,
  };
}

export function remainingQuestionMs(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs);
}

export function displayedQuestionSecond(remainingMs: number): number {
  return Math.ceil(remainingMs / 1000);
}

export function nextCountdownTick(
  remainingMs: number,
  playedSeconds: ReadonlySet<number>,
): number | null {
  const second = displayedQuestionSecond(remainingMs);
  return second >= 1 && second <= 3 && !playedSeconds.has(second) ? second : null;
}

export class QuestionSubmissionGate {
  private decided = false;

  constructor(private readonly timing: QuestionTiming) {}

  answer(answer: string, nowMs: number): QuestionDecision | null {
    if (this.decided) return null;
    this.decided = true;

    if (nowMs >= this.timing.deadlineMs) {
      return this.timeoutDecision();
    }

    return {
      kind: 'answer',
      answer,
      elapsedMs: Math.max(0, nowMs - this.timing.startedAtMs),
    };
  }

  expire(nowMs: number): QuestionDecision | null {
    if (this.decided || nowMs < this.timing.deadlineMs) return null;
    this.decided = true;
    return this.timeoutDecision();
  }

  private timeoutDecision(): QuestionDecision {
    return {
      kind: 'timeout',
      answer: '__timeout__',
      elapsedMs: this.timing.deadlineMs - this.timing.startedAtMs,
    };
  }
}
