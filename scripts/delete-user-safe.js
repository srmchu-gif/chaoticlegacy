#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const USER_KEY_COLUMNS = [
  "owner_key",
  "from_owner_key",
  "to_owner_key",
  "host_key",
  "guest_key",
  "codemaster_key",
  "challenger_key",
  "player_key",
  "user_key",
  "sender_key",
  "recipient_key",
  "owner_key_shadow"
];

const USERNAME_COLUMNS = ["username"];

const MANUAL_RULES = [
  {
    table: "deck_cards",
    whereSql:
      "(deck_key IN (SELECT deck_key FROM deck_headers WHERE owner_key = @ownerKey) OR owner_key_shadow = @ownerKey)",
    label: "deck_cards (via deck_headers.owner_key/deck_key ou owner_key_shadow)",
    priority: 5
  }
];

const EXPECTED_TABLES = [
  "users",
  "player_profiles",
  "profile_scanners",
  "profile_history",
  "profile_creature_usage",
  "profile_discoveries",
  "profile_notifications",
  "scan_entries",
  "deck_headers",
  "deck_cards",
  "friend_requests",
  "friends",
  "perim_player_state",
  "perim_runs",
  "perim_rewards",
  "perim_player_quests",
  "perim_quest_unlocks",
  "perim_location_chat",
  "global_chat_messages",
  "trade_history",
  "trade_history_items",
  "trade_wishlist",
  "ranked_drome_selection",
  "ranked_drome_stats",
  "ranked_drome_streaks",
  "ranked_global",
  "drome_challenge_invites",
  "drome_challenge_outcomes",
  "drome_codemasters",
  "drome_season_titles",
  "season_player_stats",
  "season_rewards",
  "achievements",
  "daily_mission_progress",
  "weekly_mission_progress",
  "audit_log"
];

function parseArgs(argv) {
  const out = { action: "", dbPath: "", username: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--action") {
      out.action = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--db") {
      out.dbPath = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--username") {
      out.username = String(argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return out;
}

function jsonOk(payload) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, ...payload }, null, 2)}\n`
  );
}

function jsonErr(message, details) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        error: String(message || "unknown_error"),
        details: details || null
      },
      null,
      2
    )}\n`
  );
}

function quoteIdent(name) {
  return `"${String(name || "").replace(/"/g, '""')}"`;
}

function normalizeUserKey(username) {
  return String(username || "").trim().toLowerCase();
}

function getSchemaMap(db) {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all();
  const map = new Map();
  for (const row of rows) {
    const table = row.name;
    const cols = db
      .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
      .all()
      .map((col) => col.name);
    map.set(table, new Set(cols));
  }
  return map;
}

function buildTableRules(schemaMap) {
  const rules = [];
  for (const table of schemaMap.keys()) {
    if (table === "users") {
      const cols = schemaMap.get(table);
      if (cols && cols.has("username")) {
        rules.push({
          table,
          label: "users.username",
          whereSql: `${quoteIdent("username")} = @username COLLATE NOCASE`,
          priority: 1000
        });
      }
      continue;
    }

    const manual = MANUAL_RULES.find((rule) => rule.table === table);
    if (manual) {
      rules.push({
        table,
        label: manual.label,
        whereSql: manual.whereSql,
        priority: manual.priority || 10
      });
      continue;
    }

    const cols = schemaMap.get(table);
    if (!cols) {
      continue;
    }

    const keyPreds = [];
    for (const col of USER_KEY_COLUMNS) {
      if (cols.has(col)) {
        keyPreds.push(`${quoteIdent(col)} = @ownerKey`);
      }
    }
    for (const col of USERNAME_COLUMNS) {
      if (cols.has(col)) {
        keyPreds.push(`${quoteIdent(col)} = @username COLLATE NOCASE`);
      }
    }

    if (!keyPreds.length) {
      continue;
    }

    rules.push({
      table,
      label: `${table} (${keyPreds.length} coluna[s])`,
      whereSql: keyPreds.join(" OR "),
      priority: table === "deck_headers" ? 900 : 10
    });
  }

  const dedup = new Map();
  for (const rule of rules) {
    const key = `${rule.table}::${rule.whereSql}`;
    if (!dedup.has(key)) {
      dedup.set(key, rule);
    }
  }
  return Array.from(dedup.values());
}

function countPerRule(db, rules, params) {
  const lines = [];
  for (const rule of rules) {
    const sql = `SELECT COUNT(*) AS c FROM ${quoteIdent(rule.table)} WHERE ${rule.whereSql}`;
    const row = db.prepare(sql).get(buildQueryParams(sql, params));
    lines.push({
      table: rule.table,
      label: rule.label,
      count: Number(row?.c || 0),
      status: "ok"
    });
  }
  return lines;
}

function getExpectedCoverage(schemaMap, rules) {
  const covered = new Set(rules.map((r) => r.table));
  return EXPECTED_TABLES.map((table) => {
    if (!schemaMap.has(table)) {
      return { table, status: "missing_table" };
    }
    if (covered.has(table)) {
      return { table, status: "covered" };
    }
    return { table, status: "present_without_user_columns" };
  });
}

function listUsers(db) {
  const rows = db
    .prepare("SELECT username FROM users ORDER BY username COLLATE NOCASE")
    .all();
  return rows.map((row) => String(row.username || "").trim()).filter(Boolean);
}

function deleteByRules(db, rules, params) {
  const sortedRules = [...rules].sort((a, b) => {
    const pa = Number(a.priority || 10);
    const pb = Number(b.priority || 10);
    if (pa !== pb) {
      return pa - pb;
    }
    return a.table.localeCompare(b.table);
  });

  const removed = [];
  for (const rule of sortedRules) {
    const sql = `DELETE FROM ${quoteIdent(rule.table)} WHERE ${rule.whereSql}`;
    const stmt = db.prepare(sql);
    const result = stmt.run(buildQueryParams(sql, params));
    removed.push({
      table: rule.table,
      removed: Number(result?.changes || 0),
      label: rule.label
    });
  }
  return removed;
}

function buildQueryParams(sql, params) {
  const out = {};
  if (sql.includes("@ownerKey")) {
    out.ownerKey = params.ownerKey;
  }
  if (sql.includes("@username")) {
    out.username = params.username;
  }
  return out;
}

function ensureDbPath(dbPathArg) {
  const value = String(dbPathArg || "").trim();
  if (!value) {
    throw new Error("Parametro --db e obrigatorio.");
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Banco SQLite nao encontrado: ${resolved}`);
  }
  return resolved;
}

function ensureUsername(usernameArg) {
  const username = String(usernameArg || "").trim();
  if (!username) {
    throw new Error("Parametro --username e obrigatorio.");
  }
  return username;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.action) {
    throw new Error("Parametro --action e obrigatorio.");
  }

  const dbPath = ensureDbPath(args.dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    if (args.action === "list-users") {
      jsonOk({ users: listUsers(db), dbPath });
      return;
    }

    const username = ensureUsername(args.username);
    const ownerKey = normalizeUserKey(username);
    const schemaMap = getSchemaMap(db);
    const rules = buildTableRules(schemaMap);
    const coverage = getExpectedCoverage(schemaMap, rules);
    const params = { ownerKey, username };

    const existing = db
      .prepare("SELECT username FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
    if (!existing) {
      jsonErr(`Usuario nao encontrado: ${username}`, {
        code: "user_not_found",
        username
      });
      return;
    }

    if (args.action === "preview") {
      const impact = countPerRule(db, rules, params);
      const total = impact.reduce((sum, line) => sum + Number(line.count || 0), 0);
      jsonOk({
        username: existing.username,
        ownerKey,
        impact,
        totalMatchedRows: total,
        coverage
      });
      return;
    }

    if (args.action === "delete") {
      const before = countPerRule(db, rules, params);
      let removed = [];
      try {
        db.exec("BEGIN IMMEDIATE");
        removed = deleteByRules(db, rules, params);
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch (_) {
          // noop
        }
        throw error;
      }
      const totalRemoved = removed.reduce(
        (sum, line) => sum + Number(line.removed || 0),
        0
      );
      jsonOk({
        username: existing.username,
        ownerKey,
        before,
        removed,
        totalRemoved,
        coverage
      });
      return;
    }

    throw new Error(`Acao desconhecida: ${args.action}`);
  } finally {
    db.close();
  }
}

try {
  run();
} catch (error) {
  jsonErr(error.message || String(error), { stack: error.stack || null });
  process.exitCode = 1;
}
