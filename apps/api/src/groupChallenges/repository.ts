import type { GroupChallengeBoardEntry } from '@clutch/shared';
export interface ChallengeRow {
  id: string; creator_run_id: string; creator_player_id: string; category: string;
  created_at: number; expires_at: number; max_players: number;
}
export const findChallenge = (db: D1Database, id: string) => db.prepare('SELECT * FROM group_challenges WHERE id = ?1').bind(id).first<ChallengeRow>();
export const findEntry = (db: D1Database, id: string, playerId: string) => db.prepare(`
 SELECT e.run_id, r.status FROM group_challenge_entries e JOIN match_runs r ON r.id = e.run_id
 WHERE e.challenge_id = ?1 AND e.player_id = ?2
`).bind(id, playerId).first<{run_id: string; status: 'in_progress' | 'completed'}>();
export async function participantCount(db: D1Database, id: string): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS count FROM group_challenge_entries e JOIN group_challenges c ON c.id = e.challenge_id
    WHERE e.challenge_id = ?1 AND e.player_id != c.creator_player_id`).bind(id).first<{count: number}>())?.count ?? 0;
}
export async function challengeBoard(db: D1Database, challenge: ChallengeRow): Promise<GroupChallengeBoardEntry[]> {
  const rows = await db.prepare(`SELECT r.id, r.player_id, r.display_name, r.solo_score, r.rounds_json
    FROM group_challenge_entries e JOIN match_runs r ON r.id = e.run_id
    WHERE e.challenge_id = ?1 AND r.status = 'completed' AND r.reached_target = 1 AND r.solo_score IS NOT NULL
    ORDER BY e.joined_at, r.id`).bind(challenge.id).all<{id:string;player_id:string;display_name:string;solo_score:number;rounds_json:string}>();
  const board = rows.results.map(r => ({rank: 0, runId:r.id,playerId:r.player_id,displayName:r.display_name,
    score:r.solo_score,roundsPlayed:(JSON.parse(r.rounds_json) as unknown[]).length,isCreator:r.player_id === challenge.creator_player_id}));
  board.sort((a,b) => a.score-b.score || a.roundsPlayed-b.roundsPlayed);
  board.forEach((entry,index) => { const previous=board[index-1]; entry.rank=previous && previous.score===entry.score && previous.roundsPlayed===entry.roundsPlayed ? previous.rank : index+1; });
  return board;
}
