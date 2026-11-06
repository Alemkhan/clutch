import { DUEL_RULES_VERSION, FREE_RULES_VERSION, type CreateGroupChallengeResponse, type GroupChallengePreviewResponse } from '@clutch/shared';
import type { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate } from '../solo/soloShared';
import { findRecordRun } from '../solo/repository';
import { miniAppLink, newInviteId } from '../notifications/outbid';
import { GROUP_CHALLENGE_ID } from '../solo/validation';
import { challengeBoard, findChallenge, findEntry, participantCount, type ChallengeRow } from './repository';
export function registerGroupChallengeRoutes(app: Hono<{Bindings: Env}>): void {
  app.post('/api/solo-runs/:id/group-challenge', async c => {
    const identity=await authenticate(c,'group-create'); if(identity instanceof Response) return identity;
    const runId=c.req.param('id');
    const owner=await c.env.DB.prepare('SELECT player_id FROM match_runs WHERE id = ?1').bind(runId).first<{player_id:string}>();
    if(!owner || owner.player_id!==identity.playerId) return c.json({error:'Run not found.'},404);
    const record=await findRecordRun(c.env.DB,runId,[DUEL_RULES_VERSION,FREE_RULES_VERSION]);
    if(!record) return c.json({error:'Only a completed free or duel run that reached the target can be shared.',reason:'not_eligible'},409);
    const id=newInviteId().replace(/^rm_/,'gc_');
    const url=miniAppLink(c.env.TELEGRAM_MINI_APP_LINK,id);
    if(!url) return c.json({error:'Mini app link is not configured.'},503);
    const now=Date.now();
    const category=(await c.env.DB.prepare('SELECT category FROM match_runs WHERE id = ?1').bind(runId).first<{category:string}>())!.category;
    await c.env.DB.prepare(`INSERT OR IGNORE INTO group_challenges(id,creator_run_id,creator_player_id,category,created_at,expires_at,max_players)
      VALUES(?1,?2,?3,?4,?5,?6,20)`).bind(id,runId,identity.playerId,category,now,now+86400000).run();
    const challenge=(await c.env.DB.prepare('SELECT * FROM group_challenges WHERE creator_run_id = ?1').bind(runId).first<ChallengeRow>())!;
    await c.env.DB.prepare('INSERT OR IGNORE INTO group_challenge_entries(challenge_id,player_id,run_id,joined_at) VALUES(?1,?2,?3,?4)').bind(challenge.id,identity.playerId,runId,challenge.created_at).run();
    const challengeUrl=new URL(url);
    challengeUrl.searchParams.set('startapp',challenge.id);
    const response:CreateGroupChallengeResponse={challengeId:challenge.id,url:challengeUrl.toString(),expiresAt:challenge.expires_at,maxPlayers:challenge.max_players};
    return c.json(response,201);
  });
  app.get('/api/group-challenges/:id',async c=>{
    const identity=await authenticate(c,'group-preview'); if(identity instanceof Response) return identity;
    const id=c.req.param('id'); if(!GROUP_CHALLENGE_ID.test(id)) return c.json({error:'Invalid challenge id.'},400);
    const challenge=await findChallenge(c.env.DB,id); if(!challenge) return c.json({error:'Challenge not found.'},404);
    const record=await findRecordRun(c.env.DB,challenge.creator_run_id,[DUEL_RULES_VERSION,FREE_RULES_VERSION]);
    if(!record) return c.json({error:'Source record is unavailable.',reason:'source_unavailable'},410);
    const entry=await findEntry(c.env.DB,id,identity.playerId);
    const response:GroupChallengePreviewResponse={challengeId:id,creator:{playerId:challenge.creator_player_id,displayName:record.row.display_name,runId:challenge.creator_run_id},
      category:challenge.category as GroupChallengePreviewResponse['category'],miniGameId:record.row.mini_game_id as GroupChallengePreviewResponse['miniGameId'],
      expiresAt:challenge.expires_at,expired:challenge.expires_at<=Date.now(),participantCount:await participantCount(c.env.DB,id),maxPlayers:challenge.max_players,
      viewerEntry:entry?{runId:entry.run_id,status:entry.status}:null,board:await challengeBoard(c.env.DB,challenge)};
    return c.json(response);
  });
}
