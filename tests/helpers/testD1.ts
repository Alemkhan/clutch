/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * Схема до снимка условий матча: в `match_runs` нет rules_version, mini_game_id,
 * mini_game_config_json, opponent_json и ghost_eligible. Нужна ровно одному тесту — проверке
 * `/api/ready`, который обязан увидеть устаревшую схему и ответить 503. Это тестовая заготовка,
 * а не миграция: после сжатия истории файла с таким состоянием в репозитории больше нет.
 */
const LEGACY_SCHEMA = `
CREATE TABLE match_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  rounds_json TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  opponent_run_id TEXT REFERENCES match_runs(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
`;

/** Папка миграций API: тесты применяют всё её содержимое по порядку имён, как wrangler в smoke. */
const MIGRATIONS_DIRECTORY = new URL('../../apps/api/migrations/', import.meta.url);

function applyMigrations(sqlite: SQLiteDatabase): void {
  const files = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS_DIRECTORY), 'utf8'));
  }
}

/** `current = false` даёт устаревшую схему: её видит только тест readiness. */
export function createTestD1(current = true): TestD1 {
  const sqlite = new DatabaseSync(':memory:');
  if (current) {
    applyMigrations(sqlite);
  } else {
    sqlite.exec(LEGACY_SCHEMA);
  }
  const binding = {
    prepare(query: string) {
      return new SQLiteD1Statement(sqlite, query) as unknown as D1PreparedStatement;
    },
  } as D1Database;
  return { binding, sqlite };
}
