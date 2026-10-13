/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from 'node:sqlite';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof import('node:sqlite').DatabaseSync;
};

function numberedBindings(values: unknown[]): Record<string, SQLInputValue> {
  return Object.fromEntries(values.map((value, index) => [
    `?${index + 1}`,
    value as SQLInputValue,
  ]));
}

class SQLiteD1Statement {
  constructor(
    private readonly database: SQLiteDatabase,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SQLiteD1Statement(this.database, this.query, values) as unknown as D1PreparedStatement;
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const statement = this.database.prepare(this.query);
    const row = (this.values.length === 0
      ? statement.get()
      : statement.get(numberedBindings(this.values))) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.query);
    const results = (this.values.length === 0
      ? statement.all()
      : statement.all(numberedBindings(this.values))) as T[];
    return { success: true, results, meta: {} } as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.query);
    const result = this.values.length === 0
      ? statement.run()
      : statement.run(numberedBindings(this.values));
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    } as unknown as D1Result<T>;
  }
}

export interface TestD1 {
  binding: D1Database;
  sqlite: SQLiteDatabase;
}

export function applyR1bMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0002_match_conditions.sql', import.meta.url), 'utf8'));
}

export function applyQuestionSetMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0003_question_set_id.sql', import.meta.url), 'utf8'));
}

export function applyLastStandMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0004_last_stand.sql', import.meta.url), 'utf8'));
}

export function applyRematchMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0005_rematch_notifications.sql', import.meta.url), 'utf8'));
}

export function applyRematchReleaseMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0006_rematch_invite_release.sql', import.meta.url), 'utf8'));
}

export function applySoloRunsMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0007_solo_runs.sql', import.meta.url), 'utf8'));
}

export function applySoloOutcomeMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0008_solo_outcome.sql', import.meta.url), 'utf8'));
}

export function applyFriendInvitesMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0009_friend_invites.sql', import.meta.url), 'utf8'));
}

export function applySoloRoundsMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0010_solo_run_rounds.sql', import.meta.url), 'utf8'));
}

export function applyPlayerMistakesMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0011_player_mistakes.sql', import.meta.url), 'utf8'));
}

export function applyGeneralCategoryMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0012_general_category.sql', import.meta.url), 'utf8'));
}

export function applyRecordClaimMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0014_record_claim.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0015_pace_released.sql', import.meta.url), 'utf8'));
}

export function applyLastStandMinedMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0013_last_stand_mined.sql', import.meta.url), 'utf8'));
}

export function applyHammerTapElapsedMigration(sqlite: SQLiteDatabase): void {
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0016_hammer_tap_elapsed.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0017_answer_window.sql', import.meta.url), 'utf8'));
}

export function createTestD1(applyCurrentMigration = true): TestD1 {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../apps/api/migrations/0001_async_matches.sql', import.meta.url), 'utf8'));
  if (applyCurrentMigration) {
    applyR1bMigration(sqlite);
    applyQuestionSetMigration(sqlite);
    applyLastStandMigration(sqlite);
    applyRematchMigration(sqlite);
    applyRematchReleaseMigration(sqlite);
    applySoloRunsMigration(sqlite);
    applySoloOutcomeMigration(sqlite);
    applyFriendInvitesMigration(sqlite);
    applySoloRoundsMigration(sqlite);
    applyPlayerMistakesMigration(sqlite);
    applyGeneralCategoryMigration(sqlite);
    applyLastStandMinedMigration(sqlite);
    applyRecordClaimMigration(sqlite);
    applyHammerTapElapsedMigration(sqlite);
  }
  const binding = {
    prepare(query: string) {
      return new SQLiteD1Statement(sqlite, query) as unknown as D1PreparedStatement;
    },
  } as D1Database;
  return { binding, sqlite };
}
