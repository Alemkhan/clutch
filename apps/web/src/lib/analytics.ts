export type EventType =
  | 'landing_viewed'
  | 'play_clicked'
  | 'match_started'
  | 'question_viewed'
  | 'answer_submitted'
  | 'answer_resolved'
  | 'skill_attempt_started'
  | 'skill_attempt_completed'
  | 'match_completed'
  | 'match_abandoned'
  | 'replay_clicked'
  | 'result_shared';

export interface AnalyticsEvent {
  type: EventType;
  timestamp: number;
  sessionId: string;
  matchId?: string;
  questionId?: string;
  questionIndex?: number;
  category?: string;
  difficulty?: string;
  answerType?: string;
  selectedOption?: string;
  correctness?: boolean;
  responseTimeMs?: number;
  skillResult?: string;
  progressAwarded?: number;
  playerProgress?: number;
  opponentProgress?: number;
  source?: string;
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2) + Date.now().toString(36);
}

class Analytics {
  private events: AnalyticsEvent[] = [];
  private sessionId: string;
  private _matchId: string | null = null;

  constructor() {
    this.sessionId = generateId();
  }

  startMatch(): string {
    this._matchId = generateId();
    return this._matchId;
  }

  endMatch(): void {
    this._matchId = null;
  }

  get matchId(): string | null {
    return this._matchId;
  }

  track(type: EventType, props: Partial<AnalyticsEvent> = {}): void {
    const event: AnalyticsEvent = {
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      matchId: this._matchId ?? undefined,
      ...props,
    };
    this.events.push(event);

    if (import.meta.env.DEV) {
      console.log('[analytics]', type, props);
    }
  }

  flush(url: string): void {
    if (this.events.length === 0) return;
    const batch = [...this.events];
    this.events = [];

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, JSON.stringify({ events: batch }));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  getAll(): AnalyticsEvent[] {
    return [...this.events];
  }
}

export const analytics = new Analytics();
