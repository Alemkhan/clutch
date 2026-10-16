// Просмотр репортов о вопросах и активности игроков в локальной dev-D1.
//
// Дев-инструмент владельца: быстро увидеть, на какие вопросы жаловались
// (question_reports, миграция 0002), кто и сколько играл (match_runs +
// analytics_events), и всё об одном игроке. player_id печатается целиком —
// его копируют из вывода и передают в `player` для детализации:
//   npm run reports -- --question gp: --limit 5   (в конце — удары по мини-играм)
//   npm run activity -- --days 30
//   npm run player -- guest:xxxx
//
// Ничего не меняет: только читает (readOnly). Продуктовых решений не принимает.
//
// Запуск: node scripts/telemetry-view.mjs <reports|activity|player> [флаги]
// Флаги принимаются как `--flag value`, так и `--flag=value`.
// База ищется как в calibrate-pricing.mjs; явный путь — флагом --db.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d1Directory = join(repositoryRoot, 'apps', 'api', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

const REPORT_KINDS = new Set(['wrong_answer', 'answer_not_accepted', 'other']);
const REPORT_MODES = new Set(['solo', 'training']);

const USAGE = `Использование:
  node scripts/telemetry-view.mjs reports  [--question <id>] [--player <id>]
    [--kind wrong_answer|answer_not_accepted|other] [--mode solo|training] [--limit N]
  node scripts/telemetry-view.mjs activity [--days N] [--limit N]
  node scripts/telemetry-view.mjs player <playerId> [--limit N]
Общее: --db <файл.sqlite> — явный путь к базе (по умолчанию локальная D1 из apps/api/.wrangler).`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function findDatabase(explicit) {
  if (explicit) return resolve(explicit);
  let entries;
  try {
    entries = readdirSync(d1Directory);
  } catch {
    return null;
  }
  const file = entries.find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  return file ? join(d1Directory, file) : null;
}

/** Значение для колонки: null/пустое — «—», пробелы схлопнуты, длиннее max — с «…». */
function cell(value, max) {
  if (value === null || value === undefined) return '—';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function time(ms) {
  return ms === null || ms === undefined ? '—' : new Date(ms).toLocaleString('ru-RU');
}

/** Таблица с выравниванием: ширина колонки — по самой широкой ячейке, но не выше cap. */
function printTable(headers, rows, caps) {
  const widths = headers.map((header, index) => {
    const widest = rows.reduce((max, row) => Math.max(max, row[index].length), header.length);
    return Math.min(caps[index], widest);
  });
  const line = (cells) => cells.map((text, index) => (index === cells.length - 1 ? text : text.padEnd(widths[index]))).join('  ');
  console.log(line(headers));
  for (const row of rows) console.log(line(row));
}

function printReportsTable(rows) {
  if (rows.length === 0) {
    console.log('  нет данных');
    return;
  }
  printTable(
    ['время', 'question_id', 'kind', 'mode', 'вердикт', 'ответ игрока', 'комментарий', 'player_id'],
    rows.map((row) => [
      time(row.created_at),
      cell(row.question_id, 44),
      cell(row.kind, 20),
      cell(row.mode, 8),
      row.verdict === 1 ? 'верн' : 'неверн',
      cell(row.player_answer, 40),
      cell(row.comment, 60),
      String(row.player_id),
    ]),
    [20, 44, 20, 8, 7, 40, 60, Infinity],
  );
}

function queryReports(db, filters) {
  const conditions = [];
  const params = [];
  if (filters.question) {
    // Точное совпадение ИЛИ префикс: короткий id можно копировать из вывода целиком.
    conditions.push("(question_id = ? OR question_id LIKE ? || '%')");
    params.push(filters.question, filters.question);
  }
  if (filters.player) {
    conditions.push('player_id = ?');
    params.push(filters.player);
  }
  if (filters.kind) {
    conditions.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.mode) {
    conditions.push('mode = ?');
    params.push(filters.mode);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT created_at, question_id, kind, mode, verdict, player_answer, comment, player_id
    FROM question_reports${where}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(filters.limit);
  return db.prepare(sql).all(...params);
}

function describeReportFilters(filters) {
  const parts = [`лимит ${filters.limit}`];
  if (filters.question) parts.push(`вопрос ${filters.question}*`);
  if (filters.player) parts.push(`игрок ${filters.player}`);
  if (filters.kind) parts.push(`тип ${filters.kind}`);
  if (filters.mode) parts.push(`режим ${filters.mode}`);
  return parts.join(', ');
}

// --- reports ------------------------------------------------------------------

function runReports(db, filters) {
  let rows;
  try {
    rows = queryReports(db, filters);
  } catch (error) {
    console.error(`Не прочитать репорты: ${error.message}`);
    process.exit(2);
  }
  console.log(`Репорты о вопросах (${describeReportFilters(filters)}):`);
  printReportsTable(rows);
  runMiniGameSplit(db);
}

// Распределение уровней ударов по мини-играм: зачётные забеги (solo-to-100-v2), завершённые.
// Нужно, чтобы сравнить игры между собой (математика у них одна, различаться может только поведение игроков).
const SKILL_LEVELS = ['perfect', 'great', 'good', 'weak', 'miss'];

function runMiniGameSplit(db) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT COALESCE(r.mini_game_id, '?') AS game, s.skill_result AS level, COUNT(*) AS total
      FROM solo_run_rounds s
      JOIN match_runs r ON r.id = s.run_id
      WHERE r.rules_version = 'solo-to-100-v2' AND r.status = 'completed' AND s.skill_result IS NOT NULL
      GROUP BY game, level
    `).all();
  } catch (error) {
    console.error(`Не прочитать удары по мини-играм: ${error.message}`);
    return;
  }
  console.log('\nУдары по мини-играм (зачётные завершённые забеги):');
  if (rows.length === 0) {
    console.log('Ударов пока нет.');
    return;
  }
  const games = [...new Set(rows.map((row) => row.game))].sort();
  const table = games.map((game) => {
    const counts = Object.fromEntries(SKILL_LEVELS.map((level) => [level, 0]));
    for (const row of rows) if (row.game === game) counts[row.level] = row.total;
    const total = SKILL_LEVELS.reduce((sum, level) => sum + counts[level], 0);
    const cells = SKILL_LEVELS.map((level) => `${counts[level]} (${total ? Math.round((counts[level] / total) * 100) : 0}%)`);
    return [game, String(total), ...cells];
  });
  printTable(['игра', 'ударов', ...SKILL_LEVELS], table, [14, 8, 12, 12, 12, 12, 12]);
}

// --- activity -----------------------------------------------------------------

function runActivity(db, days, limit) {
  const since = Date.now() - days * 86_400_000;
  let runs;
  let reports;
  let events;
  try {
    // Забеги — только зачётное соло и его производные (training/friend отличаются rules_version).
    runs = db.prepare(`
      SELECT player_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN reached_target = 1 AND status = 'completed' THEN 1 ELSE 0 END) AS finishes,
             MAX(created_at) AS last_at
      FROM match_runs
      WHERE rules_version LIKE 'solo-%' AND created_at >= ?
      GROUP BY player_id
    `).all(since);
    reports = db.prepare(`
      SELECT player_id, COUNT(*) AS total, MAX(created_at) AS last_at
      FROM question_reports WHERE created_at >= ? GROUP BY player_id
    `).all(since);
    events = db.prepare(`
      SELECT player_id, COUNT(*) AS total, MAX(created_at) AS last_at
      FROM analytics_events WHERE created_at >= ? GROUP BY player_id
    `).all(since);
  } catch (error) {
    console.error(`Не прочитать активность: ${error.message}`);
    process.exit(2);
  }

  const players = new Map();
  const bucket = (playerId) => {
    let item = players.get(playerId);
    if (!item) {
      item = { runs: 0, completed: 0, finishes: 0, reports: 0, events: 0, lastAt: null };
      players.set(playerId, item);
    }
    return item;
  };
  for (const row of runs) {
    const item = bucket(row.player_id);
    item.runs = row.total;
    item.completed = row.completed;
    item.finishes = row.finishes;
    item.lastAt = row.last_at;
  }
  for (const row of reports) {
    const item = bucket(row.player_id);
    item.reports = row.total;
    item.lastAt = Math.max(item.lastAt ?? 0, row.last_at);
  }
  for (const row of events) {
    const item = bucket(row.player_id);
    item.events = row.total;
    item.lastAt = Math.max(item.lastAt ?? 0, row.last_at);
  }

  const rows = [...players.entries()]
    .map(([playerId, item]) => ({ playerId, ...item }))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit);

  console.log(`Активность игроков за ${days} дн., не больше ${limit} (по последнему действию):`);
  if (rows.length === 0) {
    console.log('  нет данных');
    return;
  }
  printTable(
    ['player_id', 'забеги (всего/заверш.)', 'финишей', 'репортов', 'событий', 'последнее действие'],
    rows.map((row) => [
      row.playerId,
      `${row.runs}/${row.completed}`,
      String(row.finishes),
      String(row.reports),
      String(row.events),
      time(row.lastAt),
    ]),
    [Infinity, 22, 7, 8, 7, 20],
  );
}

// --- player -------------------------------------------------------------------

function runPlayer(db, playerId, limit) {
  let displayNameRow;
  let runs;
  let events;
  let reports;
  try {
    displayNameRow = db.prepare(`
      SELECT display_name FROM match_runs WHERE player_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(playerId);
    runs = db.prepare(`
      SELECT created_at, category, status, json_array_length(rounds_json) AS rounds, progress, reached_target
      FROM match_runs WHERE player_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(playerId);
    events = db.prepare(`
      SELECT created_at, event, payload_json FROM analytics_events
      WHERE player_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(playerId, limit);
    reports = queryReports(db, { question: null, player: playerId, kind: null, mode: null, limit });
  } catch (error) {
    console.error(`Не прочитать игрока: ${error.message}`);
    process.exit(2);
  }

  console.log(`Игрок: ${playerId} (имя: ${displayNameRow ? displayNameRow.display_name : '—'})`);

  console.log('\nЗабеги (последние 10):');
  if (runs.length === 0) {
    console.log('  нет данных');
  } else {
    printTable(
      ['создан', 'category', 'status', 'круги', 'progress', 'цель'],
      runs.map((row) => [
        time(row.created_at),
        cell(row.category, 10),
        cell(row.status, 10),
        row.rounds === null || row.rounds === undefined ? '—' : String(row.rounds),
        String(row.progress),
        row.reached_target === 1 ? 'да' : row.reached_target === 0 ? 'нет' : '—',
      ]),
      [20, 10, 10, 5, 8, 5],
    );
  }

  console.log(`\nСобытия (последние ${limit}):`);
  if (events.length === 0) {
    console.log('  нет данных');
  } else {
    printTable(
      ['время', 'event', 'payload_json'],
      events.map((row) => [time(row.created_at), cell(row.event, 40), cell(row.payload_json, 160)]),
      [20, 40, 160],
    );
  }

  console.log(`\nРепорты (последние ${limit}):`);
  printReportsTable(reports);
}

// --- аргументы ----------------------------------------------------------------

function parsePositive(name, value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) fail(`--${name} должно быть целым числом ≥ 1, получено: ${value}`);
  return parsed;
}

function parseArgs(argv, allowed) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    let value = equals === -1 ? argv[i + 1] : token.slice(equals + 1);
    if (equals === -1) i += 1;
    if (!allowed.has(name)) fail(`Неизвестный флаг: --${name}\n${USAGE}`);
    if (value === undefined || value === '') fail(`У флага --${name} нет значения`);
    flags[name] = value;
  }
  return { flags, positional };
}

const command = process.argv[2];
if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(command ? 0 : 2);
}

let runner;
let databaseFlag;
if (command === 'reports') {
  const { flags, positional } = parseArgs(process.argv.slice(3), new Set(['db', 'question', 'player', 'kind', 'mode', 'limit']));
  if (positional.length > 0) fail(`Лишний аргумент: ${positional[0]}\n${USAGE}`);
  if (flags.kind && !REPORT_KINDS.has(flags.kind)) fail(`--kind: ожидается ${[...REPORT_KINDS].join('|')}, получено: ${flags.kind}`);
  if (flags.mode && !REPORT_MODES.has(flags.mode)) fail(`--mode: ожидается ${[...REPORT_MODES].join('|')}, получено: ${flags.mode}`);
  const filters = {
    question: flags.question,
    player: flags.player,
    kind: flags.kind,
    mode: flags.mode,
    limit: parsePositive('limit', flags.limit, 20),
  };
  databaseFlag = flags.db;
  runner = (db) => runReports(db, filters);
} else if (command === 'activity') {
  const { flags, positional } = parseArgs(process.argv.slice(3), new Set(['db', 'days', 'limit']));
  if (positional.length > 0) fail(`Лишний аргумент: ${positional[0]}\n${USAGE}`);
  const days = parsePositive('days', flags.days, 7);
  const limit = parsePositive('limit', flags.limit, 20);
  databaseFlag = flags.db;
  runner = (db) => runActivity(db, days, limit);
} else if (command === 'player') {
  const { flags, positional } = parseArgs(process.argv.slice(3), new Set(['db', 'limit']));
  if (positional.length !== 1) fail(`Команда player требует один player_id позиционно.\n${USAGE}`);
  const limit = parsePositive('limit', flags.limit, 20);
  databaseFlag = flags.db;
  runner = (db) => runPlayer(db, positional[0], limit);
} else {
  fail(`Неизвестная команда: ${command}\n${USAGE}`);
}

const path = findDatabase(databaseFlag);
if (!path) {
  console.error('Локальная база D1 не найдена. Передай путь: node scripts/telemetry-view.mjs <команда> --db <файл.sqlite>');
  process.exit(2);
}

const db = new DatabaseSync(path, { readOnly: true });
try {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const table of ['match_runs', 'question_reports', 'analytics_events']) {
    if (!tables.has(table)) {
      console.error(`В базе нет таблицы ${table}.`);
      console.error('Примени миграцию: npx wrangler d1 migrations apply DB --local (из apps/api)');
      process.exit(2);
    }
  }
} catch (error) {
  console.error(`Не прочитать схему базы: ${error.message}`);
  process.exit(2);
}

console.log(`База: ${path}`);
runner(db);
db.close();
