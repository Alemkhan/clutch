// Просмотр репортов о вопросах и активности игроков в локальной dev-D1.
//
// Дев-инструмент владельца: быстро увидеть, на какие вопросы жаловались
// (question_reports, миграция 0002), кто и сколько играл (match_runs +
// analytics_events), и всё об одном игроке. player_id печатается целиком —
// его копируют из вывода и передают в `player` для детализации:
//   npm run reports -- --question gp: --limit 5   (в конце — удары по мини-играм)
//   npm run activity -- --days 30
//   npm run player -- guest:xxxx
//   npm run funnel -- --days 14     (воронка по дням + приглашения)
//   npm run retention               (когорты первого забега, D1 / D7)
//   npm run errors -- --days 7      (топ client_error)
// Prod: npm run reports:pull, затем любая команда с --db .prod-data/<файл>.sqlite
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
  node scripts/telemetry-view.mjs funnel   [--days N]
  node scripts/telemetry-view.mjs retention
  node scripts/telemetry-view.mjs errors   [--days N] [--limit N]
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

// --- funnel / retention / errors ----------------------------------------------

// Сутки игры сдвинуты на +5 ч к UTC (DAY_BOUNDARY_OFFSET_MINUTES в packages/shared/src/dailyQuestionSet.ts).
const DAY_OFFSET_SECONDS = 5 * 3600;
const gameDaySql = (column) => `strftime('%Y-%m-%d', ${column} / 1000 + ${DAY_OFFSET_SECONDS}, 'unixepoch')`;
const gameDayOf = (ms) => new Date(ms + DAY_OFFSET_SECONDS * 1000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function runFunnel(db, days) {
  const since = Date.now() - days * 86_400_000;
  let events;
  let reached;
  let invites;
  try {
    events = db.prepare(`
      SELECT ${gameDaySql('created_at')} AS day, event, COUNT(DISTINCT player_id) AS players
      FROM analytics_events
      WHERE created_at >= ? AND event IN ('app_opened', 'solo_run_started', 'solo_run_completed', 'result_shared', 'friend_invite_shared')
      GROUP BY day, event
    `).all(since);
    reached = db.prepare(`
      SELECT ${gameDaySql('created_at')} AS day, COUNT(DISTINCT player_id) AS players
      FROM match_runs
      WHERE created_at >= ? AND rules_version = 'solo-to-100-v2' AND status = 'completed' AND reached_target = 1
      GROUP BY day
    `).all(since);
    invites = db.prepare(`
      SELECT ${gameDaySql('created_at')} AS day, COUNT(*) AS created,
             SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS accepted
      FROM rematch_invites WHERE created_at >= ? GROUP BY day
    `).all(since);
  } catch (error) {
    console.error(`Не прочитать воронку: ${error.message}`);
    process.exit(2);
  }
  const table = new Map();
  const row = (day) => {
    if (!table.has(day)) {
      table.set(day, { app_opened: 0, solo_run_started: 0, solo_run_completed: 0, reached: 0, result_shared: 0, friend_invite_shared: 0, created: 0, accepted: 0 });
    }
    return table.get(day);
  };
  for (const e of events) row(e.day)[e.event] = e.players;
  for (const r of reached) row(r.day).reached = r.players;
  for (const i of invites) {
    row(i.day).created = i.created;
    row(i.day).accepted = i.accepted;
  }
  console.log(`Воронка за ${days} дн. (уникальные игроки по игровым суткам, граница +5 ч к UTC):`);
  const dayKeys = [...table.keys()].sort();
  if (dayKeys.length === 0) {
    console.log('  нет данных');
    return;
  }
  printTable(
    ['день', 'открыли', 'начали', 'закончили', 'дошли до 100%', 'поделились', 'позвали друга', 'приглаш. создано', 'принято'],
    dayKeys.map((day) => {
      const r = table.get(day);
      return [day, String(r.app_opened), String(r.solo_run_started), String(r.solo_run_completed), String(r.reached), String(r.result_shared), String(r.friend_invite_shared), String(r.created), String(r.accepted)];
    }),
    [10, 8, 7, 9, 13, 10, 13, 16, 7],
  );
  console.log('«открыли» считается только с релиза с событием app_opened; раньше — 0.');
}

function runRetention(db) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT player_id, ${gameDaySql('created_at')} AS day
      FROM match_runs WHERE rules_version LIKE 'solo-%'
      GROUP BY player_id, day
    `).all();
  } catch (error) {
    console.error(`Не прочитать когорты: ${error.message}`);
    process.exit(2);
  }
  const daysByPlayer = new Map();
  for (const r of rows) {
    if (!daysByPlayer.has(r.player_id)) daysByPlayer.set(r.player_id, new Set());
    daysByPlayer.get(r.player_id).add(r.day);
  }
  // TELEMETRY_NOW (ISO) — только для тестов: фиксирует «сейчас».
  const today = gameDayOf(process.env.TELEMETRY_NOW ? Date.parse(process.env.TELEMETRY_NOW) : Date.now());
  const cohorts = new Map();
  for (const set of daysByPlayer.values()) {
    const first = [...set].sort()[0];
    if (!cohorts.has(first)) cohorts.set(first, []);
    cohorts.get(first).push(set);
  }
  const returned = (members, first, n) => {
    const target = addDays(first, n);
    if (target > today) return '—';
    const back = members.filter((set) => set.has(target)).length;
    const share = `${back} (${Math.round((back / members.length) * 100)}%)`;
    // Игровой день ещё идёт: пока это не итог.
    if (target === today) return back === 0 ? 'идёт' : `идёт, ${share}`;
    return share;
  };
  console.log('Возвраты по когортам: день первого забега (сутки +5 ч), вернулись на D1 / D7 (день с забегом):');
  if (cohorts.size === 0) {
    console.log('  нет данных');
    return;
  }
  printTable(
    ['когорта', 'игроков', 'D1', 'D7'],
    [...cohorts.keys()].sort().map((first) => {
      const members = cohorts.get(first);
      return [first, String(members.length), returned(members, first, 1), returned(members, first, 7)];
    }),
    [10, 8, 16, 16],
  );
  console.log('«идёт» — игровой день ещё не закончился, значение может вырасти; «—» — срок ещё не наступил.');
}

function runErrors(db, days, limit) {
  const since = Date.now() - days * 86_400_000;
  let rows;
  try {
    rows = db.prepare(`
      SELECT json_extract(payload_json, '$.message') AS message,
             json_extract(payload_json, '$.screen') AS screen,
             json_extract(payload_json, '$.kind') AS kind,
             COUNT(*) AS total, COUNT(DISTINCT player_id) AS players, MAX(created_at) AS last_at
      FROM analytics_events
      WHERE event = 'client_error' AND created_at >= ?
      GROUP BY message, screen, kind
      ORDER BY players DESC, total DESC
      LIMIT ?
    `).all(since, limit);
  } catch (error) {
    console.error(`Не прочитать ошибки: ${error.message}`);
    process.exit(2);
  }
  console.log(`Ошибки клиента за ${days} дн., топ ${limit} (по числу игроков):`);
  if (rows.length === 0) {
    console.log('  нет данных');
    return;
  }
  printTable(
    ['игроков', 'раз', 'kind', 'screen', 'message', 'последняя'],
    rows.map((r) => [String(r.players), String(r.total), cell(r.kind, 10), cell(r.screen, 20), cell(r.message, 64), time(r.last_at)]),
    [8, 5, 10, 20, 64, 20],
  );
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
} else if (command === 'funnel') {
  const { flags, positional } = parseArgs(process.argv.slice(3), new Set(['db', 'days']));
  if (positional.length > 0) fail(`Лишний аргумент: ${positional[0]}\n${USAGE}`);
  const days = parsePositive('days', flags.days, 14);
  databaseFlag = flags.db;
  runner = (db) => runFunnel(db, days);
} else if (command === 'retention') {
  const { flags, positional } = parseArgs(process.argv.slice(3), new Set(['db']));
  if (positional.length > 0) fail(`Лишний аргумент: ${positional[0]}\n${USAGE}`);
  databaseFlag = flags.db;
  runner = (db) => runRetention(db);
} else if (command === 'errors') {
  const { flags, positional } = parseArgs(process.argv.slice(3), new Set(['db', 'days', 'limit']));
  if (positional.length > 0) fail(`Лишний аргумент: ${positional[0]}\n${USAGE}`);
  const days = parsePositive('days', flags.days, 7);
  const limit = parsePositive('limit', flags.limit, 20);
  databaseFlag = flags.db;
  runner = (db) => runErrors(db, days, limit);
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
  for (const table of ['match_runs', 'question_reports', 'analytics_events', 'rematch_invites']) {
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
