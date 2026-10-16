export type MatchSource = 'player' | 'bot' | 'local';

interface ActiveRequest {
  key: string;
  token: number;
  controller: AbortController;
}

export interface MatchRequestHandle {
  token: number;
  signal: AbortSignal;
}

/** Keeps only one request per current selection and rejects late responses. */
export class MatchRequestCoordinator {
  private sequence = 0;
  private active?: ActiveRequest;

  begin(key: string): MatchRequestHandle | null {
    if (this.active?.key === key) return null;
    this.cancel();
    const controller = new AbortController();
    const active = { key, token: ++this.sequence, controller };
    this.active = active;
    return { token: active.token, signal: controller.signal };
  }

  isCurrent(token: number): boolean {
    return this.active?.token === token;
  }

  settle(token: number): boolean {
    if (!this.isCurrent(token)) return false;
    this.active = undefined;
    return true;
  }

  cancel(): void {
    if (this.active) this.active.controller.abort();
    this.active = undefined;
    this.sequence += 1;
  }
}
