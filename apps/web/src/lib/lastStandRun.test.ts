import { describe, expect, it } from 'vitest';
import {
  LastStandSubmitGate,
  advanceFromReveal,
  applyLastStandAnswer,
  buildRevealRows,
  eliminationText,
  lastStandAbsoluteDeadline,
  lastStandStarted,
  parseAnswerResponse,
  parseStartResponse,
  rankLeaderboard,
  recordSentAnswer,
  survivedText,
  outcomeTitle,
  type LastStandAnswerResponse,
  type LastStandRoundInfo,
} from './lastStandRun';

const round0: LastStandRoundInfo = { index: 0, scale: 'wide', titleRu: 'Любая страна', timeMs: 15000 };
const round1: LastStandRoundInfo = { index: 1, scale: 'narrow', titleRu: 'Две Кореи', timeMs: 7000 };
const start = parseStartResponse({
  runId: 'r1',
  dateKey: '2026-10-08',
  opponents: [{ displayName: 'Dana', source: 'bot' }, { displayName: 'Рахат', source: 'player' }],
  round: round0,
});
const answer = (patch: Partial<LastStandAnswerResponse>): LastStandAnswerResponse => ({
  status: 'accepted', reason: null, deadlineMs: 15000, reveal: [], survived: 1, round: round1, ...patch,
});
const reveal = [{ displayName: 'Dana', answerRu: 'Япония', atMs: 3200 }];

describe('parsing', () => {
  it('requires an honest opponent source', () => {
    expect(() => parseStartResponse({ ...start, opponents: [{ displayName: 'X' }] })).toThrow();
    expect(start.opponents.map((o) => o.source)).toEqual(['bot', 'player']);
  });
  it('rejects malformed answers', () => {
    expect(() => parseAnswerResponse({ status: 'maybe' })).toThrow();
    expect(() => parseAnswerResponse({ ...answer({ status: 'eliminated', round: null }), reason: null })).toThrow();
    expect(() => parseAnswerResponse({ ...answer({ status: 'cleared' }) })).toThrow();
    expect(parseAnswerResponse(answer({ status: 'occupied' })).status).toBe('occupied');
  });
});

describe('five statuses', () => {
  const base = lastStandStarted(start, 1000);

  it('occupied keeps the round and extends the deadline from deadlineMs only', () => {
    const next = applyLastStandAnswer(base, answer({ status: 'occupied', deadlineMs: 22000, round: round0 }), 5000);
    expect(next.stage).toBe('round');
    expect(next.notice).toBe('occupied');
    expect(lastStandAbsoluteDeadline(next)).toBe(1000 + 22000);
    expect(next.round).toBe(base.round);
  });

  it('invalid is not an elimination and leaves the deadline alone', () => {
    const next = applyLastStandAnswer(base, answer({ status: 'invalid', deadlineMs: 99999, round: round0 }), 5000);
    expect(next.stage).toBe('round');
    expect(next.notice).toBe('invalid');
    expect(next.deadlineMs).toBe(15000);
  });

  it('accepted shows the reveal, then the next round restarts the clock', () => {
    const sent = recordSentAnswer(base, 'Китай', 2400);
    const next = applyLastStandAnswer(sent, answer({ reveal }), 4000);
    expect(next.stage).toBe('reveal');
    expect(next.survived).toBe(1);
    expect(next.reveal?.player).toEqual({ answer: 'Китай', atMs: 2400 });
    expect(next.reveal?.entries[0].source).toBe('bot');
    const nextRound = advanceFromReveal(next, 9000);
    expect(nextRound.stage).toBe('round');
    expect(nextRound.round).toEqual(round1);
    expect(lastStandAbsoluteDeadline(nextRound)).toBe(9000 + 7000);
  });

  it('eliminated reveals then ends with the reason and no player row', () => {
    const sent = recordSentAnswer(base, '', 15000);
    const next = applyLastStandAnswer(sent, answer({ status: 'eliminated', reason: 'timeout', round: null, reveal }), 20000);
    expect(next.stage).toBe('reveal');
    expect(next.reveal?.player).toBeNull();
    const done = advanceFromReveal(next, 21000);
    expect(done.stage).toBe('final');
    expect(done.outcome).toBe('eliminated');
    expect(done.reason).toBe('timeout');
  });

  it('cleared ends the run; no reveal goes straight to final', () => {
    const next = applyLastStandAnswer(base, answer({ status: 'cleared', round: null, survived: 12, reveal: [] }), 20000);
    expect(next.stage).toBe('final');
    expect(next.outcome).toBe('cleared');
    expect(next.survived).toBe(12);
  });

  it('ignores answers outside a round', () => {
    const done = applyLastStandAnswer(base, answer({ status: 'cleared', round: null }), 1);
    expect(applyLastStandAnswer(done, answer({}), 2)).toBe(done);
  });
});

describe('LastStandSubmitGate', () => {
  const timing = { startedAtMs: 1000, deadlineAtMs: 16000 };

  it('allows one request in flight and ignores empty answers', () => {
    const gate = new LastStandSubmitGate();
    expect(gate.begin('  ', 2000, timing)).toBeNull();
    expect(gate.begin(' Япония ', 3400, timing)).toEqual({ answer: 'Япония', atMs: 2400, expired: false });
    expect(gate.begin('Китай', 3500, timing)).toBeNull();
    gate.release();
    expect(gate.begin('Китай', 3600, timing)?.answer).toBe('Китай');
  });

  it('sends only one expired submission with atMs not below the deadline', () => {
    const gate = new LastStandSubmitGate();
    const late = gate.begin('', 16500, timing);
    expect(late).toEqual({ answer: '', atMs: 15500, expired: true });
    expect(gate.begin('x', 16600, timing)).toBeNull();
    gate.release();
    expect(gate.begin('x', 16700, timing)?.expired).toBe(true);
  });

  it('clamps an early-clock expiry up to the deadline', () => {
    const gate = new LastStandSubmitGate();
    expect(gate.begin('', 16000, timing)?.atMs).toBe(15000);
  });
});

describe('presentation', () => {
  it('orders reveal by time and flags the fastest', () => {
    const rows = buildRevealRows({
      entries: [{ displayName: 'Dana', answerRu: 'Япония', atMs: 3200, source: 'bot' }],
      player: { answer: 'Китай', atMs: 2400 },
    });
    expect(rows.map((r) => r.displayName)).toEqual(['Ты', 'Dana']);
    expect(rows[0].fastest).toBe(true);
    expect(rows[1].sourceLabel).toBe('Бот');
  });
  it('ranks ties together', () => {
    const ranked = rankLeaderboard([
      { displayName: 'a', survived: 3, completedAt: 1 },
      { displayName: 'b', survived: 5, completedAt: 2 },
      { displayName: 'c', survived: 3, completedAt: 3 },
    ]);
    expect(ranked.map((r) => [r.displayName, r.place])).toEqual([['b', 1], ['a', 2], ['c', 2]]);
  });
  it('formats text', () => {
    expect(survivedText(1)).toBe('1 круг из 12');
    expect(survivedText(3)).toBe('3 круга из 12');
    expect(survivedText(12)).toBe('12 кругов из 12');
    expect(eliminationText('timeout')).toContain('Время');
    expect(eliminationText('exhausted')).toContain('соперники');
    // На мине строка объясняет правило: сам ответ экран показывает отдельно и крупно.
    expect(eliminationText('mined', 'США')).toContain('загадала заранее');
    expect(eliminationText('mined', 'США')).toContain('Любой другой верный ответ прошёл бы');
    expect(eliminationText('mined', null)).toContain('загаданный системой');
    expect(outcomeTitle('eliminated', 'mined')).toBe('Ты назвал загаданное');
    expect(outcomeTitle('eliminated', 'timeout')).toBe('Ты выбыл');
    expect(outcomeTitle('cleared', null)).toBe('Забег пройден!');
    expect(parseAnswerResponse({ ...answer({ status: 'eliminated', round: null }), reason: 'mined', mineRu: 'США' }))
      .toMatchObject({ reason: 'mined', mineRu: 'США' });
  });
});
