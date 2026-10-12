export interface RunRow {
  id: string;
  player_id: string;
  display_name: string;
  questions_json: string;
  rounds_json: string | null;
  progress: number;
  correct_count: number;
  status: 'in_progress' | 'completed';
  rules_version: string | null;
  mini_game_id: string | null;
  mini_game_config_json: string | null;
  opponent_json: string | null;
  ghost_eligible: number;
  opponent_run_id?: string | null;
  created_at: number;
  question_set_id?: string | null;
  /** 1 — соперник отпущен: претендент замолчал и запись ушла обратно в подбор. */
  pace_released?: number | null;
}
