import { describe, expect, it, vi } from 'vitest';
vi.mock('./apiClient', () => ({ apiFetch: vi.fn().mockResolvedValue({}), getPlayerName: () => 'Guest' }));
vi.mock('./telegram', () => ({ getTelegramIdentity: () => null }));
import { apiFetch } from './apiClient';
import { createGroupChallenge, fetchGroupChallenge, startSoloRun } from './soloApi';
describe('group challenge API', () => {
  it('creates and fetches through dedicated endpoints', async () => {
    await createGroupChallenge('run/id');
    expect(apiFetch).toHaveBeenLastCalledWith('/api/solo-runs/run%2Fid/group-challenge', { method: 'POST', body: '{}' });
    await fetchGroupChallenge('gc_id');
    expect(apiFetch).toHaveBeenLastCalledWith('/api/group-challenges/gc_id', { method: 'GET' }, undefined);
  });
  it('starts with a group id and without the default daily mode', async () => {
    await startSoloRun('general', undefined, undefined, undefined, 'daily', 'gc_id');
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ displayName: 'Guest', category: 'general', groupChallengeId: 'gc_id' });
  });
});
