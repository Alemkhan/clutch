import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GroupChallengePreviewResponse } from '@clutch/shared';
import { GroupChallengeEntryView } from './GroupChallengeEntry';
const preview: GroupChallengePreviewResponse = { challengeId: 'gc_id', creator: { playerId: 'author', runId: 'run', displayName: 'Автор' }, category: 'general', miniGameId: 'hammer_nail', expiresAt: 1900000000000, expired: false, participantCount: 2, maxPlayers: 20, viewerEntry: null, board: [{ rank: 1, playerId: 'author', runId: 'run', displayName: 'Автор', score: 0.8, roundsPlayed: 8, isCreator: true }] };
function render(value: GroupChallengePreviewResponse | null = preview, error = '') {
  return renderToStaticMarkup(<GroupChallengeEntryView preview={value} error={error} challengeId="gc_id" onStart={() => {}} onClose={() => {}} onRetry={() => {}} />);
}
describe('group challenge entry', () => {
  it('shows author, category, free places, table and start', () => {
    const html = render();
    for (const text of ['Вызов от Автор', 'Общие знания', '18', 'Таблица вызова', 'Играть']) expect(html).toContain(text);
  });
  it('shows completed table without a repeat attempt, and resumes existing runs', () => {
    expect(render({ ...preview, viewerEntry: { runId: 'mine', status: 'completed' } })).not.toContain('>Играть<');
    expect(render({ ...preview, expired: true, viewerEntry: { runId: 'mine', status: 'in_progress' } })).toContain('Продолжить');
  });
  it('blocks full and expired entries and names unavailable state', () => {
    expect(render({ ...preview, participantCount: 20 })).not.toContain('>Играть<');
    expect(render({ ...preview, expired: true })).toContain('Срок вызова вышел');
    expect(render(null, 'Вызов больше недоступен.')).toContain('role="alert"');
  });
});
