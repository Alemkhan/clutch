/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  PRACTICE_RULES_VERSION,
  dailyQuestionSet,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const databases: TestD1[] = [];
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function guest(label: string): { authorization: string; playerId: string } {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(NOW / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return {
    authorization: `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`,
    playerId: `guest:${subject}`,
  };
}

function call(db: TestD1, label: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: guest(label).authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

const startRun = (db: TestD1, label: string, extra: Record<string, unknown> = {}) =>
  call(db, label, 'POST', '/api/solo-runs', { displayName: label, category: 'geography', mode: 'duel', ...extra });

/** Игрок проходит забег через API до цели (четыре точных удара). */
async function finishedRun(db: TestD1, label: string): Promise<string> {
  const response = await startRun(db, label);
  expect(response.status).toBe(201);
  const run = await response.json() as StartSoloRunResponse;
  const done = await playRounds((path, body) => call(db, label, 'POST', path, body), run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
  expect(done.status).toBe(200);
  return run.runId;
}

/** Забег на наборе дня с заданной версией правил и целью (без прохождения через API). */
function insertRun(
  db: TestD1,
  id: string,
  playerId: string,
  rulesVersion: string,
  reachedTarget: number | null,
  status = 'completed',
) {
  const set = dailyQuestionSet('geography', NOW, 0);
  let progress = 0;
  const rounds: AsyncMatchRound[] = [25, 25, 25, 25].map((progressAwarded, index) => {
    progress += progressAwarded;
    return { questionId: set.questions[index].id, correct: true, responseTimeMs: 1000, progressAwarded, playerProgressAfter: progress };
  });
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, playerId, id, JSON.stringify(set.questions), status === 'completed' ? JSON.stringify(rounds) : null,
    status, NOW - 2000, status === 'completed' ? NOW - 1000 : null, rulesVersion,
    CURRENT_HAMMER_MINI_GAME.id, configJson, set.questionSetId, reachedTarget,
  );
}



const createGroup = (db: TestD1, label: string, id: string) => call(db,label,'POST',`/api/solo-runs/${id}/group-challenge`,{});
async function group(db: TestD1) {
  const id=await finishedRun(db,'owner');
  return {id, challenge:await (await createGroup(db,'owner',id)).json() as {challengeId:string;expiresAt:number}};
}
describe('group challenge',()=>{
  it('authorizes creation, validates eligibility and reuses the source link',async()=>{
    const db=database(); const {id,challenge}=await group(db);
    expect((await createGroup(db,'other',id)).status).toBe(404);
    expect(await (await createGroup(db,'owner',id)).json()).toMatchObject(challenge);
    insertRun(db,'practice',guest('owner').playerId,PRACTICE_RULES_VERSION,1);
    expect((await createGroup(db,'owner','practice')).status).toBe(409);
    insertRun(db,'unfinished',guest('owner').playerId,SOLO,0);
    expect((await createGroup(db,'owner','unfinished')).status).toBe(409);
  });
  it('allows different players, resumes the same player, rejects creator and completed replay',async()=>{
    const db=database(); const {challenge}=await group(db);
    const extra={groupChallengeId:challenge.challengeId};
    expect((await startRun(db,'owner',extra)).status).toBe(403);
    const a=await (await startRun(db,'a',extra)).json() as StartSoloRunResponse;
    const b=await (await startRun(db,'b',extra)).json() as StartSoloRunResponse;
    expect(a.runId).not.toBe(b.runId); expect(a.rulesVersion).toBe('solo-group-challenge-v1'); expect(a.groupChallenge).toBe(true);
    expect(await (await startRun(db,'a',extra)).json()).toMatchObject({runId:a.runId,resumed:true,groupChallenge:true});
    await playRounds((path,body)=>call(db,'a','POST',path,body),a.runId,roundInputs(fullQuestions(db,a.runId),4,true));
    expect((await startRun(db,'a',extra)).status).toBe(409);
    expect((await createGroup(db,'a',a.runId)).status).toBe(409);
    expect((await call(db,'a','POST',`/api/solo-runs/${a.runId}/invite`,{})).status).toBe(409);
    expect(db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id=?').get(a.runId)).toEqual({ghost_eligible:0});
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM rematch_invites').get()).toEqual({n:0});
  });
  it('enforces capacity and expiry but permits an existing run to resume',async()=>{
    const db=database();const {challenge}=await group(db);const extra={groupChallengeId:challenge.challengeId};
    db.sqlite.prepare('UPDATE group_challenges SET max_players=2').run();
    await startRun(db,'a',extra);await startRun(db,'b',extra);
    expect((await startRun(db,'c',extra)).status).toBe(409);
    db.sqlite.prepare('UPDATE group_challenges SET expires_at=?').run(NOW-1);
    expect((await startRun(db,'d',extra)).status).toBe(410);
    expect((await (await startRun(db,'a',extra)).json() as {resumed:boolean}).resumed).toBe(true);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM match_runs WHERE rules_version='solo-group-challenge-v1'").get()).toEqual({n:2});
  });
  it('ranks only finished reached entries by score and rounds with shared ties and no answer leak',async()=>{
    const db=database();const {id,challenge}=await group(db);const extra={groupChallengeId:challenge.challengeId};
    for(const label of ['a','b']) {
      const run=await (await startRun(db,label,extra)).json() as StartSoloRunResponse;
      await playRounds((path,body)=>call(db,label,'POST',path,body),run.runId,roundInputs(fullQuestions(db,run.runId),4,true));
    }
    await startRun(db,'pending',extra);
    const response=await call(db,'a','GET',`/api/group-challenges/${challenge.challengeId}`);
    const raw=await response.text();const preview=JSON.parse(raw);
    expect(preview.participantCount).toBe(3); expect(preview.board).toHaveLength(3);
    expect(preview.board.map((r:{rank:number})=>r.rank)).toEqual([1,1,1]);
    expect(preview.board.find((entry: { isCreator: boolean }) => entry.isCreator)).toMatchObject({runId:id,isCreator:true});
    expect(raw).not.toMatch(/correctOptionId|correctAnswers|questions_json|explanation/);
    expect(preview.viewerEntry.status).toBe('completed');
  });
  it('guards concurrent entry insertion and capacity without orphan runs',async()=>{
    const db=database();const {challenge}=await group(db);const extra={groupChallengeId:challenge.challengeId};
    const duplicate=await Promise.all([startRun(db,'same',extra),startRun(db,'same',extra)]);
    const bodies=await Promise.all(duplicate.map(r=>r.json() as Promise<StartSoloRunResponse>));
    expect(bodies[0].runId).toBe(bodies[1].runId);
    db.sqlite.prepare('UPDATE group_challenges SET max_players=2').run();
    const contenders=await Promise.all([startRun(db,'one',extra),startRun(db,'two',extra)]);
    expect(contenders.map(r=>r.status).sort()).toEqual([201,409]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM match_runs WHERE rules_version='solo-group-challenge-v1'").get()).toEqual({n:2});
  });
  it('uses score then rounds only and leaves global source outcome untouched',async()=>{
    const db=database();const {id,challenge}=await group(db);const extra={groupChallengeId:challenge.challengeId};
    const runs=[];
    for(const label of ['a','b','c']) {
      const run=await (await startRun(db,label,extra)).json() as StartSoloRunResponse; runs.push(run.runId);
      await playRounds((path,body)=>call(db,label,'POST',path,body),run.runId,roundInputs(fullQuestions(db,run.runId),4,true));
    }
    db.sqlite.prepare('UPDATE match_runs SET solo_score=2 WHERE id=?').run(id);
    for(const runId of runs) db.sqlite.prepare('UPDATE match_runs SET solo_score=1 WHERE id=?').run(runId);
    const rounds=JSON.parse(db.sqlite.prepare('SELECT rounds_json FROM match_runs WHERE id=?').get(runs[2])!.rounds_json as string);
    rounds.push(rounds[0]);db.sqlite.prepare('UPDATE match_runs SET rounds_json=? WHERE id=?').run(JSON.stringify(rounds),runs[2]);
    const preview=await (await call(db,'a','GET',`/api/group-challenges/${challenge.challengeId}`)).json() as {board:{runId:string;rank:number}[]};
    expect(preview.board.map(r=>r.rank)).toEqual([1,1,3,4]);
    expect(preview.board[2].runId).toBe(runs[2]);expect(preview.board[3].runId).toBe(id);
    expect(db.sqlite.prepare('SELECT solo_outcome FROM match_runs WHERE id=?').get(id)).toEqual({solo_outcome:null});
  });
  it('requires authentication and validates challenge identifiers',async()=>{
    const db=database();const {id}=await group(db);
    expect((await app.request(`/api/solo-runs/${id}/group-challenge`,{method:'POST'},{DB:db.binding})).status).toBe(401);
    expect((await startRun(db,'a',{groupChallengeId:'bad'})).status).toBe(400);
    expect((await call(db,'a','GET','/api/group-challenges/bad')).status).toBe(400);
  });

});
