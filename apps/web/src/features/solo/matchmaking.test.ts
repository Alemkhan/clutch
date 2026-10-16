import { describe, expect, it } from 'vitest';
import { MatchRequestCoordinator } from './matchmaking';

describe('match request coordinator', () => {
  it('keeps a delayed response current until it settles', () => {
    const coordinator = new MatchRequestCoordinator();
    const request = coordinator.begin('geography');
    expect(request).not.toBeNull();
    expect(coordinator.isCurrent(request!.token)).toBe(true);
    expect(coordinator.settle(request!.token)).toBe(true);
    expect(coordinator.isCurrent(request!.token)).toBe(false);
  });

  it('deduplicates a double request for the same category', () => {
    const coordinator = new MatchRequestCoordinator();
    expect(coordinator.begin('geography')).not.toBeNull();
    expect(coordinator.begin('geography')).toBeNull();
  });

  it('aborts on back and rejects a stale success after a new request', () => {
    const coordinator = new MatchRequestCoordinator();
    const first = coordinator.begin('geography')!;
    coordinator.cancel();
    expect(first.signal.aborted).toBe(true);
    const second = coordinator.begin('history')!;
    expect(coordinator.isCurrent(first.token)).toBe(false);
    expect(coordinator.settle(first.token)).toBe(false);
    expect(coordinator.isCurrent(second.token)).toBe(true);
  });
});
