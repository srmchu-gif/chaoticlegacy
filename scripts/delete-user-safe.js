#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const CARD_TYPES = ["creatures", "attacks", "battlegear", "locations", "mugic"];
const LOCATION_TRIBE_KEYS = ["overworld", "underworld", "danian", "mipedian", "marrillian", "tribeless"];
const LOCATION_CLIMATE_KEYS = [
  "ensolarado",
  "chuvoso",
  "ventania",
  "tempestade",
  "nublado",
  "umido",
  "seco",
  "frio",
  "quente",
  "lugar_fechado"
];
const LOCATION_CLIMATE_LABELS = {
  ensolarado: "Ensolarado",
  chuvoso: "Chuvoso",
  ventania: "Ventania",
  tempestade: "Tempestade",
  nublado: "Nublado",
  umido: "Úmido",
  seco: "Seco",
  frio: "Frio",
  quente: "Quente",
  lugar_fechado: "Lugar Fechado",
};
const QUEST_ALLOWED_SET_KEYS = new Set(["dop", "zoth", "ss"]);
const DROME_IDS = ["crellan", "hotekk", "amzen", "oron", "tirasis", "imthor", "chirrul", "beta"];
const PERIM_RUNTIME_CONFIG_NAMESPACE = "perim_runtime_config";
const PERIM_RUNTIME_CONFIG_KEY = "state";
const DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS = ["dop", "zoth", "ss"];
const DEFAULT_PERIM_DAILY_WALK_TIMES = ["00:00"];

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
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (typeof next === "undefined" || String(next).startsWith("--")) {
      out[key] = "1";
      continue;
    }
    out[key] = String(next);
    i += 1;
  }
  return {
    action: String(out.action || "").trim(),
    dbPath: String(out.db || "").trim(),
    username: String(out.username || "").trim(),
    password: String(out.password || "").trim(),
    id: String(out.id || "").trim(),
    questKey: String(out.questKey || "").trim(),
    payloadB64: String(out.payloadB64 || "").trim(),
    payloadFile: String(out.payloadFile || "").trim(),
    cardType: String(out.cardType || "").trim()
  };
}

function jsonOk(payload) {
  const jsonText = JSON.stringify({ ok: true, ...payload }, null, 2);
  const b64 = Buffer.from(jsonText, "utf8").toString("base64");
  process.stdout.write(`${jsonText}\n`);
  process.stdout.write(`__DELETE_USER_SAFE_JSON_B64__:${b64}\n`);
}

function jsonErr(message, details) {
  const jsonText = JSON.stringify(
    {
      ok: false,
      error: String(message || "unknown_error"),
      details: details || null
    },
    null,
    2
  );
  const b64 = Buffer.from(jsonText, "utf8").toString("base64");
  process.stdout.write(`${jsonText}\n`);
  process.stdout.write(`__DELETE_USER_SAFE_JSON_B64__:${b64}\n`);
}

function quoteIdent(name) {
  return `"${String(name || "").replace(/"/g, "\"\"")}"`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserKey(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeCardType(value) {
  const key = String(value || "").trim().toLowerCase();
  return CARD_TYPES.includes(key) ? key : "";
}

function normalizeSetKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePerimDropSetKey(value) {
  const key = normalizeSetKey(value);
  if (!key) return "";
  if (key === "unknownset") return "unknown";
  return key;
}

function normalizeWalkTimeToken(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sortWalkTimes(times = []) {
  return [...times].sort((a, b) => {
    const [ha, ma] = String(a || "").split(":").map((entry) => Number(entry));
    const [hb, mb] = String(b || "").split(":").map((entry) => Number(entry));
    return ((ha * 60) + ma) - ((hb * 60) + mb);
  });
}

function isQuestCardSetAllowed(card) {
  const setKey = normalizeSetKey(card?.setName || "");
  return QUEST_ALLOWED_SET_KEYS.has(setKey);
}

function normalizeLocationTribeKey(value) {
  const token = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!token) return "";
  if (
    token === "tribeless"
    || token === "semtribo"
    || token === "generic"
    || token === "notribe"
    || token === "neutral"
    || token === "none"
  ) {
    return "tribeless";
  }
  if (token.includes("overworld") || token.includes("outromundo")) return "overworld";
  if (token.includes("underworld") || token.includes("submundo")) return "underworld";
  if (token.includes("danian")) return "danian";
  if (token.includes("mipedian") || token.includes("miprdian") || token.includes("maipidian")) return "mipedian";
  if (token.includes("marrillian") || token.includes("marrilian")) return "marrillian";
  return "";
}

function normalizeLocationClimateKey(value) {
  const token = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!token) return "";
  if (token.includes("ensolar")) return "ensolarado";
  if (token.includes("chuv")) return "chuvoso";
  if (token.includes("vent")) return "ventania";
  if (token.includes("tempest")) return "tempestade";
  if (token.includes("nublad")) return "nublado";
  if (token.includes("umid") || token.includes("humid")) return "umido";
  if (token.includes("sec")) return "seco";
  if (token.includes("fri")) return "frio";
  if (token.includes("quent") || token.includes("calor") || token.includes("hot")) return "quente";
  if (token.includes("lugarfechado") || token.includes("fechado") || token.includes("indoor") || token.includes("interno")) return "lugar_fechado";
  return "";
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

function decodePayload(input) {
  let payloadFile = "";
  let payloadB64 = "";

  if (input && typeof input === "object" && !Buffer.isBuffer(input)) {
    payloadFile = String(input.payloadFile || "").trim();
    payloadB64 = String(input.payloadB64 || "").trim();
  } else {
    payloadB64 = String(input || "").trim();
  }

  let text = "";
  if (payloadFile) {
    const resolved = path.resolve(payloadFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Arquivo de payload nao encontrado: ${resolved}`);
    }
    text = fs.readFileSync(resolved, "utf8").trim();
    if (!text) {
      return {};
    }
  } else if (payloadB64) {
    text = Buffer.from(payloadB64, "base64").toString("utf8");
  } else {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("payload_not_object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Payload invalido: ${error.message || error}`);
  }
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

function hasTable(schemaMap, tableName) {
  return schemaMap.has(tableName);
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

function listUsers(db) {
  const rows = db
    .prepare("SELECT username FROM users ORDER BY username COLLATE NOCASE")
    .all();
  return rows.map((row) => String(row.username || "").trim()).filter(Boolean);
}

function hashPasswordLikeClient(passwordPlain) {
  const base64 = Buffer.from(String(passwordPlain || ""), "utf8").toString("base64");
  return base64.split("").reverse().join("");
}

function ensurePerimDropEventTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS perim_drop_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_text TEXT NOT NULL,
      card_type TEXT NOT NULL,
      card_id TEXT NOT NULL,
      location_card_id TEXT NOT NULL,
      chance_percent REAL NOT NULL DEFAULT 0,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_perim_drop_events_active_window ON perim_drop_events(enabled, location_card_id, start_at, end_at);");
}

function ensurePerimLocationTribesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_tribes (
      location_card_id TEXT NOT NULL PRIMARY KEY,
      tribe_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_tribes_tribe ON perim_location_tribes(tribe_key, updated_at DESC);");
}

function ensurePerimLocationClimateRulesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_climate_rules (
      location_card_id TEXT NOT NULL PRIMARY KEY,
      allowed_climates_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_climate_rules_updated ON perim_location_climate_rules(updated_at DESC);");
}

function ensurePerimLocationAdjacencyTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_adjacency (
      from_location_card_id TEXT NOT NULL,
      to_location_card_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (from_location_card_id, to_location_card_id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_adjacency_from ON perim_location_adjacency(from_location_card_id, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_adjacency_to ON perim_location_adjacency(to_location_card_id, updated_at DESC);");
}

function ensureKvStoreTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      namespace TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, entity_key)
    );
  `);
}

function readKvPayload(db, namespace, entityKey) {
  ensureKvStoreTable(db);
  const row = db
    .prepare("SELECT payload FROM kv_store WHERE namespace = ? AND entity_key = ? LIMIT 1")
    .get(String(namespace || ""), String(entityKey || ""));
  if (!row?.payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(String(row.payload || "{}"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeKvPayload(db, namespace, entityKey, payload) {
  ensureKvStoreTable(db);
  const body = payload && typeof payload === "object" ? payload : {};
  db.prepare(`
    INSERT INTO kv_store (namespace, entity_key, payload, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace, entity_key)
    DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(
    String(namespace || ""),
    String(entityKey || ""),
    JSON.stringify(body),
    nowIso()
  );
}

function listCatalogSetKeys(db) {
  const rows = db
    .prepare("SELECT DISTINCT lower(trim(set_name)) AS set_key FROM card_catalog WHERE set_name IS NOT NULL AND trim(set_name) <> '' ORDER BY set_key")
    .all();
  return [...new Set(
    rows
      .map((row) => normalizePerimDropSetKey(row?.set_key || ""))
      .filter((entry) => entry && entry !== "unknown")
  )];
}

function normalizePerimRuntimeConfig(raw, availableSetKeys = []) {
  const source = raw && typeof raw === "object" ? raw : {};
  const availableSetKeySet = new Set((Array.isArray(availableSetKeys) ? availableSetKeys : []).map((entry) => normalizePerimDropSetKey(entry)));

  let allowedDropSets = [...new Set(
    (Array.isArray(source.allowedDropSets) ? source.allowedDropSets : DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS)
      .map((entry) => normalizePerimDropSetKey(entry))
      .filter((entry) => entry && entry !== "unknown")
  )];
  if (availableSetKeySet.size) {
    allowedDropSets = allowedDropSets.filter((entry) => availableSetKeySet.has(entry));
  }
  if (!allowedDropSets.length) {
    allowedDropSets = [...DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS].filter((entry) => !availableSetKeySet.size || availableSetKeySet.has(entry));
  }
  if (!allowedDropSets.length && availableSetKeySet.size) {
    allowedDropSets = [availableSetKeys[0]];
  }

  let dailyWalkTimes = [...new Set(
    (Array.isArray(source.dailyWalkTimes) ? source.dailyWalkTimes : DEFAULT_PERIM_DAILY_WALK_TIMES)
      .map((entry) => normalizeWalkTimeToken(entry))
      .filter(Boolean)
  )];
  if (!dailyWalkTimes.length) {
    dailyWalkTimes = [...DEFAULT_PERIM_DAILY_WALK_TIMES];
  }
  dailyWalkTimes = sortWalkTimes(dailyWalkTimes);

  return {
    allowedDropSets,
    dailyWalkTimes,
    walksPerDay: dailyWalkTimes.length,
  };
}

function sanitizePerimConfigPayload(db, raw) {
  const availableSetKeys = listCatalogSetKeys(db);
  const availableSetKeySet = new Set(availableSetKeys);
  const source = raw && typeof raw === "object" ? raw : {};
  const allowedDropSetsRaw = Array.isArray(source.allowedDropSets) ? source.allowedDropSets : [];
  const dailyWalkTimesRaw = Array.isArray(source.dailyWalkTimes) ? source.dailyWalkTimes : [];

  const allowedDropSets = [...new Set(
    allowedDropSetsRaw
      .map((entry) => normalizePerimDropSetKey(entry))
      .filter((entry) => entry && entry !== "unknown")
  )];
  if (!allowedDropSets.length) {
    throw new Error("Selecione ao menos 1 set liberado para drops.");
  }
  if (availableSetKeySet.size) {
    const invalidSet = allowedDropSets.find((entry) => !availableSetKeySet.has(entry));
    if (invalidSet) {
      throw new Error(`Set invalido para drop: ${invalidSet}`);
    }
  }

  const dailyWalkTimes = [...new Set(
    dailyWalkTimesRaw
      .map((entry) => normalizeWalkTimeToken(entry))
      .filter(Boolean)
  )];
  if (!dailyWalkTimes.length) {
    throw new Error("Informe ao menos 1 horario de caminhada (HH:mm).");
  }

  return normalizePerimRuntimeConfig(
    { allowedDropSets, dailyWalkTimes },
    availableSetKeys
  );
}

function fetchPerimRuntimeConfig(db) {
  const availableSetKeys = listCatalogSetKeys(db);
  const stored = readKvPayload(db, PERIM_RUNTIME_CONFIG_NAMESPACE, PERIM_RUNTIME_CONFIG_KEY);
  const normalized = normalizePerimRuntimeConfig(stored, availableSetKeys);
  return {
    config: normalized,
    availableSetKeys,
  };
}

function getCatalogCardById(db, cardIdRaw) {
  const cardId = String(cardIdRaw || "").trim();
  if (!cardId) {
    return null;
  }
  const row = db
    .prepare("SELECT id, type, name, set_name, rarity FROM card_catalog WHERE id = ? LIMIT 1")
    .get(cardId);
  if (!row) {
    return null;
  }
  return {
    id: String(row.id || ""),
    type: normalizeCardType(row.type || ""),
    name: String(row.name || row.id || ""),
    setName: String(row.set_name || ""),
    rarity: String(row.rarity || "")
  };
}

function listCatalogCards(db, cardTypeRaw = "") {
  const normalizedType = normalizeCardType(cardTypeRaw);
  const rows = normalizedType
    ? db
        .prepare("SELECT id, type, name, set_name, rarity, tribe FROM card_catalog WHERE type = ? ORDER BY name COLLATE NOCASE, id")
        .all(normalizedType)
    : db
        .prepare("SELECT id, type, name, set_name, rarity, tribe FROM card_catalog ORDER BY type, name COLLATE NOCASE, id")
        .all();
  return rows.map((row) => ({
    id: String(row.id || ""),
    type: normalizeCardType(row.type || ""),
    name: String(row.name || row.id || ""),
    setName: String(row.set_name || ""),
    rarity: String(row.rarity || ""),
    tribe: String(row.tribe || "")
  }));
}

function sanitizeLocationTribePayload(db, raw) {
  const locationCardId = String(raw?.locationCardId || "").trim();
  const tribeKey = normalizeLocationTribeKey(raw?.tribeKey || raw?.tribe || "");
  if (!locationCardId) {
    throw new Error("locationCardId e obrigatorio.");
  }
  if (!tribeKey || !LOCATION_TRIBE_KEYS.includes(tribeKey)) {
    throw new Error("tribeKey invalida para local.");
  }
  const locationCard = getCatalogCardById(db, locationCardId);
  if (!locationCard || locationCard.type !== "locations") {
    throw new Error(`Local invalido: ${locationCardId}`);
  }
  return { locationCardId, tribeKey };
}

function sanitizeLocationTribeDeletePayload(db, raw) {
  const locationCardId = String(raw?.locationCardId || "").trim();
  if (!locationCardId) {
    throw new Error("locationCardId e obrigatorio.");
  }
  const locationCard = getCatalogCardById(db, locationCardId);
  if (!locationCard || locationCard.type !== "locations") {
    throw new Error(`Local invalido: ${locationCardId}`);
  }
  return { locationCardId };
}

function sanitizeLocationClimateSetPayload(db, raw) {
  const locationCardId = String(raw?.locationCardId || "").trim();
  if (!locationCardId) {
    throw new Error("locationCardId e obrigatorio.");
  }
  const locationCard = getCatalogCardById(db, locationCardId);
  if (!locationCard || locationCard.type !== "locations") {
    throw new Error(`Local invalido: ${locationCardId}`);
  }
  const input = Array.isArray(raw?.allowedClimates) ? raw.allowedClimates : [];
  const normalized = [...new Set(
    input
      .map((entry) => normalizeLocationClimateKey(entry))
      .filter((entry) => LOCATION_CLIMATE_KEYS.includes(entry))
  )];
  if (!normalized.length) {
    throw new Error("Selecione ao menos 1 clima permitido para o local.");
  }
  return { locationCardId, allowedClimates: normalized };
}

function sanitizeLocationClimateDeletePayload(db, raw) {
  const locationCardId = String(raw?.locationCardId || "").trim();
  if (!locationCardId) {
    throw new Error("locationCardId e obrigatorio.");
  }
  const locationCard = getCatalogCardById(db, locationCardId);
  if (!locationCard || locationCard.type !== "locations") {
    throw new Error(`Local invalido: ${locationCardId}`);
  }
  return { locationCardId };
}

function normalizeAllowedClimateKeys(raw) {
  const values = Array.isArray(raw) ? raw : [];
  return [...new Set(
    values
      .map((entry) => normalizeLocationClimateKey(entry))
      .filter((entry) => LOCATION_CLIMATE_KEYS.includes(entry))
  )];
}

function listLocationClimateRules(db) {
  ensurePerimLocationClimateRulesTable(db);
  const rows = db
    .prepare(`
      SELECT
        r.location_card_id,
        r.allowed_climates_json,
        r.updated_at,
        c.name AS location_name,
        c.set_name AS location_set
      FROM perim_location_climate_rules r
      LEFT JOIN card_catalog c ON c.id = r.location_card_id
      ORDER BY c.name COLLATE NOCASE, r.location_card_id
    `)
    .all();
  return rows.map((row) => {
    let parsed = [];
    try {
      parsed = JSON.parse(String(row.allowed_climates_json || "[]"));
    } catch {}
    const allowedClimateKeys = normalizeAllowedClimateKeys(parsed);
    return {
      locationCardId: String(row.location_card_id || ""),
      locationName: String(row.location_name || row.location_card_id || ""),
      locationSet: String(row.location_set || ""),
      allowedClimateKeys,
      allowedClimateLabels: allowedClimateKeys.map((entry) => LOCATION_CLIMATE_LABELS[entry] || entry),
      updatedAt: String(row.updated_at || ""),
    };
  });
}

function normalizeClimateFromState(raw) {
  const key = normalizeLocationClimateKey(raw);
  return key || "nublado";
}

function climateLabelFromKey(climateKey) {
  return LOCATION_CLIMATE_LABELS[normalizeLocationClimateKey(climateKey)] || "Nublado";
}

function reconcileLocationStateClimateRule(db, locationCardId, allowedClimateKeys) {
  const allowed = normalizeAllowedClimateKeys(allowedClimateKeys);
  if (!allowed.length) {
    return null;
  }
  const row = db
    .prepare("SELECT climate FROM perim_location_state WHERE location_id = ? LIMIT 1")
    .get(locationCardId);
  if (!row) {
    return null;
  }
  const currentKey = normalizeClimateFromState(row.climate);
  if (allowed.includes(currentKey)) {
    return {
      changed: false,
      climate: climateLabelFromKey(currentKey),
    };
  }
  const replacement = allowed[Math.floor(Math.random() * allowed.length)] || "nublado";
  const replacementLabel = climateLabelFromKey(replacement);
  db.prepare("UPDATE perim_location_state SET climate = ?, updated_at = ? WHERE location_id = ?").run(
    replacementLabel,
    nowIso(),
    locationCardId
  );
  return {
    changed: true,
    climate: replacementLabel,
  };
}

function listLocationTribes(db) {
  ensurePerimLocationTribesTable(db);
  return db
    .prepare(`
      SELECT
        t.location_card_id,
        t.tribe_key,
        t.updated_at,
        c.name AS location_name,
        c.set_name AS location_set
      FROM perim_location_tribes t
      LEFT JOIN card_catalog c ON c.id = t.location_card_id
      ORDER BY c.name COLLATE NOCASE, t.location_card_id
    `)
    .all()
    .map((row) => ({
      locationCardId: String(row.location_card_id || ""),
      locationName: String(row.location_name || row.location_card_id || ""),
      locationSet: String(row.location_set || ""),
      tribeKey: normalizeLocationTribeKey(row.tribe_key || ""),
      updatedAt: String(row.updated_at || ""),
    }));
}

function resolveProjectRootFromDbPath(dbPath) {
  const absoluteDbPath = path.resolve(String(dbPath || ""));
  return path.resolve(path.dirname(absoluteDbPath), "..");
}

function parseLocationsMatrixRows(locationsFilePath) {
  const filePath = path.resolve(String(locationsFilePath || ""));
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo locais.xlsx nao encontrado: ${filePath}`);
  }
  const workbook = XLSX.readFile(filePath, { cellDates: false, dense: false });
  const sheet = workbook.Sheets.Planilha1 || workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return [];
  }
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows = [];
  rawRows.forEach((row) => {
    const type = normalizeCardType(row?.["Column1.type"] || "");
    if (type !== "locations") {
      return;
    }
    const name = String(row?.["Column1.name"] || "").trim();
    if (!name) {
      return;
    }
    const setName = String(row?.["Column1.set"] || "").trim();
    const linkedLocationNames = [];
    for (let idx = 1; idx <= 11; idx += 1) {
      const linkedName = String(row?.[`LIGADO A LOCAL ${idx}`] || "").trim();
      if (linkedName) {
        linkedLocationNames.push(linkedName);
      }
    }
    rows.push({ name, setName, linkedLocationNames });
  });
  return rows;
}

function buildLocationLookupMaps(db) {
  const rows = db
    .prepare(`
      SELECT id, name, set_name
      FROM card_catalog
      WHERE lower(type) = 'locations'
      ORDER BY name COLLATE NOCASE, id
    `)
    .all();
  const byNameSet = new Map();
  const byName = new Map();
  rows.forEach((row) => {
    const id = String(row?.id || "").trim();
    const nameKey = normalizeSetKey(row?.name || "");
    const setKey = normalizeSetKey(row?.set_name || "");
    if (!id || !nameKey) {
      return;
    }
    const nameSetKey = `${nameKey}|${setKey}`;
    if (!byNameSet.has(nameSetKey)) {
      byNameSet.set(nameSetKey, []);
    }
    byNameSet.get(nameSetKey).push(id);
    if (!byName.has(nameKey)) {
      byName.set(nameKey, []);
    }
    byName.get(nameKey).push(id);
  });
  return { byNameSet, byName };
}

function resolveLocationIdsFromRow(lookup, nameRaw, setRaw = "") {
  const nameKey = normalizeSetKey(nameRaw || "");
  const setKey = normalizeSetKey(setRaw || "");
  if (!nameKey) {
    return [];
  }
  const resolved = [
    ...(lookup.byNameSet.get(`${nameKey}|${setKey}`) || []),
    ...(lookup.byName.get(nameKey) || []),
  ];
  return [...new Set(resolved)];
}

function sanitizeLocationLinkPayload(db, raw) {
  ensurePerimLocationAdjacencyTable(db);
  const fromLocationCardId = String(raw?.fromLocationCardId || raw?.from || "").trim();
  const toLocationCardId = String(raw?.toLocationCardId || raw?.to || "").trim();
  if (!fromLocationCardId || !toLocationCardId) {
    throw new Error("fromLocationCardId e toLocationCardId sao obrigatorios.");
  }
  if (fromLocationCardId === toLocationCardId) {
    throw new Error("Auto-link nao permitido: origem e destino sao iguais.");
  }
  const fromCard = getCatalogCardById(db, fromLocationCardId);
  const toCard = getCatalogCardById(db, toLocationCardId);
  if (!fromCard || fromCard.type !== "locations") {
    throw new Error(`Local de origem invalido: ${fromLocationCardId}`);
  }
  if (!toCard || toCard.type !== "locations") {
    throw new Error(`Local de destino invalido: ${toLocationCardId}`);
  }
  return { fromLocationCardId, toLocationCardId };
}

function listLocationLinks(db) {
  ensurePerimLocationAdjacencyTable(db);
  const rows = db
    .prepare(`
      SELECT
        a.from_location_card_id,
        a.to_location_card_id,
        a.updated_at,
        cf.name AS from_location_name,
        cf.set_name AS from_location_set,
        ct.name AS to_location_name,
        ct.set_name AS to_location_set
      FROM perim_location_adjacency a
      LEFT JOIN card_catalog cf ON cf.id = a.from_location_card_id
      LEFT JOIN card_catalog ct ON ct.id = a.to_location_card_id
      ORDER BY cf.name COLLATE NOCASE, ct.name COLLATE NOCASE, a.from_location_card_id, a.to_location_card_id
    `)
    .all();
  return rows.map((row) => ({
    fromLocationCardId: String(row?.from_location_card_id || ""),
    fromLocationName: String(row?.from_location_name || row?.from_location_card_id || ""),
    fromLocationSet: String(row?.from_location_set || ""),
    toLocationCardId: String(row?.to_location_card_id || ""),
    toLocationName: String(row?.to_location_name || row?.to_location_card_id || ""),
    toLocationSet: String(row?.to_location_set || ""),
    updatedAt: String(row?.updated_at || ""),
  }));
}

function importLocationLinksFromMatrix(db, options = {}) {
  ensurePerimLocationAdjacencyTable(db);
  const replace = options?.replace !== false;
  const projectRoot = options?.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const locationsFilePath = options?.locationsFilePath
    ? path.resolve(options.locationsFilePath)
    : path.join(projectRoot, "locais.xlsx");
  const rows = parseLocationsMatrixRows(locationsFilePath);
  const lookup = buildLocationLookupMaps(db);
  const pairs = new Set();
  let unresolvedSources = 0;
  let unresolvedTargets = 0;

  rows.forEach((row) => {
    const sourceIds = resolveLocationIdsFromRow(lookup, row.name, row.setName);
    if (!sourceIds.length) {
      unresolvedSources += 1;
      return;
    }
    const linkedNames = Array.isArray(row.linkedLocationNames) ? row.linkedLocationNames : [];
    linkedNames.forEach((linkedName) => {
      const targetIds = resolveLocationIdsFromRow(lookup, linkedName, "");
      if (!targetIds.length) {
        unresolvedTargets += 1;
        return;
      }
      sourceIds.forEach((fromId) => {
        targetIds.forEach((toId) => {
          if (!fromId || !toId || fromId === toId) {
            return;
          }
          pairs.add(`${fromId}=>${toId}`);
        });
      });
    });
  });

  const linksBefore = Number(db.prepare("SELECT COUNT(*) AS total FROM perim_location_adjacency").get()?.total || 0);
  const now = nowIso();
  withTransaction(db, () => {
    if (replace) {
      db.prepare("DELETE FROM perim_location_adjacency").run();
    }
    const upsert = db.prepare(`
      INSERT INTO perim_location_adjacency (from_location_card_id, to_location_card_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(from_location_card_id, to_location_card_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `);
    pairs.forEach((entry) => {
      const [fromId, toId] = String(entry).split("=>");
      upsert.run(fromId, toId, now);
    });
  });
  const linksAfter = Number(db.prepare("SELECT COUNT(*) AS total FROM perim_location_adjacency").get()?.total || 0);
  return {
    imported: pairs.size,
    linksBefore,
    linksAfter,
    unresolvedSources,
    unresolvedTargets,
    matrixRows: rows.length,
    locationsFilePath,
  };
}

function parseDateIsoRequired(value, fieldName) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`Campo '${fieldName}' e obrigatorio.`);
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    throw new Error(`Data invalida em '${fieldName}'.`);
  }
  return new Date(ms).toISOString();
}

function sanitizeDropEventPayload(db, raw) {
  const eventText = String(raw?.eventText || raw?.text || "").trim();
  const notifyAllPlayers = Boolean(raw?.notifyAllPlayers);
  const notificationText = String(raw?.notificationText || "").trim();
  const cardType = normalizeCardType(raw?.cardType || "");
  const cardId = String(raw?.cardId || "").trim();
  const locationCardId = String(raw?.locationCardId || "").trim();
  const chancePercent = Number(raw?.chancePercent);
  const startAt = parseDateIsoRequired(raw?.startAt, "startAt");
  const endAt = parseDateIsoRequired(raw?.endAt, "endAt");
  const enabled = Boolean(raw?.enabled);

  if (!eventText) {
    throw new Error("Texto do evento e obrigatorio.");
  }
  if (!cardType) {
    throw new Error("cardType invalido.");
  }
  if (!cardId) {
    throw new Error("cardId e obrigatorio.");
  }
  if (!locationCardId) {
    throw new Error("locationCardId e obrigatorio.");
  }
  if (!Number.isFinite(chancePercent) || chancePercent < 0 || chancePercent > 100) {
    throw new Error("chancePercent deve estar entre 0 e 100.");
  }
  if (Date.parse(startAt) > Date.parse(endAt)) {
    throw new Error("startAt deve ser menor ou igual a endAt.");
  }
  if (notifyAllPlayers && !notificationText) {
    throw new Error("Preencha o texto da notificacao global para enviar aos jogadores.");
  }

  const eventCard = getCatalogCardById(db, cardId);
  if (!eventCard) {
    throw new Error(`Carta de evento nao encontrada: ${cardId}`);
  }
  if (eventCard.type !== cardType) {
    throw new Error(`cardType nao corresponde a carta ${cardId}. Esperado: ${eventCard.type}`);
  }
  const locationCard = getCatalogCardById(db, locationCardId);
  if (!locationCard || locationCard.type !== "locations") {
    throw new Error(`Local de evento invalido: ${locationCardId}`);
  }

  return {
    eventText,
    notifyAllPlayers,
    notificationText,
    cardType,
    cardId,
    locationCardId,
    chancePercent: Math.max(0, Math.min(100, chancePercent)),
    startAt,
    endAt,
    enabled: enabled ? 1 : 0
  };
}

function ensureProfileNotificationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_key TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_profile_notifications_owner_read_created ON profile_notifications(owner_key, is_read, created_at DESC);");
}

function listNotificationRecipientOwnerKeys(db) {
  const owners = new Set();
  const userRows = db.prepare("SELECT username FROM users").all();
  userRows.forEach((row) => {
    const ownerKey = normalizeUserKey(row?.username || "");
    if (ownerKey) {
      owners.add(ownerKey);
    }
  });
  const profileRows = db
    .prepare("SELECT owner_key FROM player_profiles WHERE owner_key IS NOT NULL AND TRIM(owner_key) <> ''")
    .all();
  profileRows.forEach((row) => {
    const ownerKey = normalizeUserKey(row?.owner_key || "");
    if (ownerKey) {
      owners.add(ownerKey);
    }
  });
  return [...owners];
}

function createGlobalEventNotification(db, notificationText, payload = {}) {
  const message = String(notificationText || "").trim();
  if (!message) {
    return { sent: 0 };
  }
  ensureProfileNotificationsTable(db);
  const recipients = listNotificationRecipientOwnerKeys(db);
  if (!recipients.length) {
    return { sent: 0 };
  }
  const createdAt = nowIso();
  const payloadJson = JSON.stringify(payload && typeof payload === "object" ? payload : {});
  const insert = db.prepare(`
    INSERT INTO profile_notifications (owner_key, type, title, message, payload_json, is_read, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
  `);
  recipients.forEach((ownerKey) => {
    insert.run(ownerKey, "admin_event_broadcast", "Evento do sistema", message, payloadJson, createdAt);
  });
  return { sent: recipients.length };
}

function listDropEvents(db) {
  ensurePerimDropEventTable(db);
  return db
    .prepare(`
      SELECT id, event_text, card_type, card_id, location_card_id, chance_percent, start_at, end_at, enabled, created_at, updated_at
      FROM perim_drop_events
      ORDER BY datetime(start_at) DESC, id DESC
    `)
    .all()
    .map((row) => ({
      id: Number(row.id || 0),
      eventText: String(row.event_text || ""),
      cardType: String(row.card_type || ""),
      cardId: String(row.card_id || ""),
      locationCardId: String(row.location_card_id || ""),
      chancePercent: Number(row.chance_percent || 0),
      startAt: String(row.start_at || ""),
      endAt: String(row.end_at || ""),
      enabled: Number(row.enabled || 0) === 1,
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || "")
    }));
}

function sanitizeQuestRequirements(db, requirementsRaw) {
  const source = Array.isArray(requirementsRaw) ? requirementsRaw : [];
  const out = source
    .map((entry) => {
      const cardType = normalizeCardType(entry?.cardType || entry?.type || "");
      const cardId = String(entry?.cardId || "").trim();
      const required = Math.max(1, Math.floor(Number(entry?.required || entry?.amount || 1)));
      if (!cardType || !cardId) {
        return null;
      }
      const card = getCatalogCardById(db, cardId);
      if (!card || card.type !== cardType) {
        throw new Error(`Requisito invalido: ${cardType}:${cardId}`);
      }
      if (!isQuestCardSetAllowed(card)) {
        throw new Error(`Requisito fora dos sets liberados (DOP/ZOTH/SS): ${cardType}:${cardId}`);
      }
      return { cardType, cardId, required };
    })
    .filter(Boolean);
  if (!out.length) {
    throw new Error("A quest precisa de pelo menos 1 requisito.");
  }
  return out;
}

function sanitizeQuestPayload(db, raw, isUpdate = false) {
  const questKey = String(raw?.questKey || "").trim();
  const title = String(raw?.title || "").trim();
  const description = String(raw?.description || "").trim();
  const rewardType = normalizeCardType(raw?.rewardType || "");
  const rewardCardId = String(raw?.rewardCardId || "").trim();
  const targetLocationCardId = String(raw?.targetLocationCardId || "").trim();
  const enabled = raw?.enabled === false ? 0 : 1;
  const anomalyLocationIdsRaw = Array.isArray(raw?.anomalyLocationIds)
    ? raw.anomalyLocationIds
    : [];

  if (!isUpdate && !questKey) {
    throw new Error("questKey e obrigatorio.");
  }
  if (!title) {
    throw new Error("title e obrigatorio.");
  }
  if (!rewardType) {
    throw new Error("rewardType invalido.");
  }
  if (!rewardCardId) {
    throw new Error("rewardCardId e obrigatorio.");
  }
  if (!targetLocationCardId) {
    throw new Error("targetLocationCardId e obrigatorio.");
  }
  const rewardCard = getCatalogCardById(db, rewardCardId);
  if (!rewardCard || rewardCard.type !== rewardType) {
    throw new Error(`rewardCardId invalido para rewardType: ${rewardCardId}`);
  }
  if (!isQuestCardSetAllowed(rewardCard)) {
    throw new Error(`rewardCardId fora dos sets liberados (DOP/ZOTH/SS): ${rewardCardId}`);
  }
  const targetLocation = getCatalogCardById(db, targetLocationCardId);
  if (!targetLocation || targetLocation.type !== "locations") {
    throw new Error(`targetLocationCardId invalido: ${targetLocationCardId}`);
  }

  const anomalyLocationIds = [...new Set(
    anomalyLocationIdsRaw
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  )];
  anomalyLocationIds.forEach((locationId) => {
    const row = getCatalogCardById(db, locationId);
    if (!row || row.type !== "locations") {
      throw new Error(`anomalyLocationIds contem local invalido: ${locationId}`);
    }
  });
  const requirements = sanitizeQuestRequirements(db, raw?.requirements);

  return {
    questKey,
    title,
    description,
    rewardType,
    rewardCardId,
    targetLocationCardId,
    anomalyLocationIds,
    requirements,
    enabled
  };
}

function listQuests(db) {
  return db
    .prepare(`
      SELECT quest_key, title, description, reward_type, reward_card_id, target_location_card_id,
             anomaly_location_ids_json, requirements_json, enabled, created_at, updated_at
      FROM perim_quest_templates
      ORDER BY quest_key
    `)
    .all()
    .map((row) => ({
      questKey: String(row.quest_key || ""),
      title: String(row.title || ""),
      description: String(row.description || ""),
      rewardType: String(row.reward_type || ""),
      rewardCardId: String(row.reward_card_id || ""),
      targetLocationCardId: String(row.target_location_card_id || ""),
      anomalyLocationIds: safeJsonArray(row.anomaly_location_ids_json),
      requirements: safeJsonArray(row.requirements_json),
      enabled: Number(row.enabled || 0) === 1,
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || "")
    }));
}

function safeJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function withTransaction(db, task) {
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function requireExistingUser(db, username) {
  const user = db
    .prepare(`
      SELECT id, username, email, tribe, verified, created_at, updated_at, session_expires_at, session_ip, session_device, last_login_at
      FROM users
      WHERE username = ? COLLATE NOCASE
      LIMIT 1
    `)
    .get(username);
  if (!user) {
    throw new Error(`Usuario nao encontrado: ${username}`);
  }
  return user;
}

function fetchUserDetail(db, username) {
  const user = requireExistingUser(db, username);
  const ownerKey = normalizeUserKey(user.username);
  const profile = db
    .prepare(`
      SELECT owner_key, favorite_tribe, avatar, score, wins, losses, win_rate, most_played_name, admin_scanner_maxed_at, updated_at
      FROM player_profiles
      WHERE owner_key = ?
      LIMIT 1
    `)
    .get(ownerKey);
  return {
    username: String(user.username || ""),
    ownerKey,
    email: String(user.email || ""),
    tribe: String(user.tribe || ""),
    verified: Number(user.verified || 0) === 1,
    createdAt: String(user.created_at || ""),
    updatedAt: String(user.updated_at || ""),
    sessionExpiresAt: String(user.session_expires_at || ""),
    sessionIp: String(user.session_ip || ""),
    sessionDevice: String(user.session_device || ""),
    lastLoginAt: String(user.last_login_at || ""),
    profile: profile
      ? {
          favoriteTribe: String(profile.favorite_tribe || ""),
          avatar: String(profile.avatar || ""),
          score: Number(profile.score || 0),
          wins: Number(profile.wins || 0),
          losses: Number(profile.losses || 0),
          winRate: Number(profile.win_rate || 0),
          mostPlayedName: String(profile.most_played_name || ""),
          adminScannerMaxedAt: String(profile.admin_scanner_maxed_at || ""),
          updatedAt: String(profile.updated_at || "")
        }
      : null
  };
}

function ensureOwnerKeyFromUsername(db, usernameRaw) {
  const username = ensureUsername(usernameRaw);
  const user = requireExistingUser(db, username);
  const ownerKey = normalizeUserKey(user.username);
  if (!ownerKey) {
    throw new Error(`owner_key invalido para usuario: ${username}`);
  }
  return { username: String(user.username || username), ownerKey };
}

function makeScanEntryId() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `scan_${Date.now().toString(36)}_${randomPart}`;
}

function normalizeStarsPreset(valueRaw) {
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function buildCreatureVariantFromStars(starsRaw) {
  const stars = normalizeStarsPreset(starsRaw);
  if (stars === null) {
    return null;
  }
  const energyDeltaByStars = new Map([
    [1.0, -5],
    [1.5, -3],
    [2.0, 0],
    [2.5, 3],
    [3.0, 5],
  ]);
  const energyDelta = energyDeltaByStars.has(stars) ? energyDeltaByStars.get(stars) : 0;
  return {
    energyDelta,
    courageDelta: 0,
    powerDelta: 0,
    wisdomDelta: 0,
    speedDelta: 0,
    perfect: false,
    starsPreset: stars,
  };
}

function parseVariantJsonOrNull(raw) {
  if (raw === null || typeof raw === "undefined") {
    return null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("variant_json deve ser objeto.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`variant_json invalido: ${error.message || error}`);
  }
}

function touchUserCaches(db, ownerKey) {
  const now = nowIso();
  db.prepare("UPDATE player_profiles SET updated_at = ? WHERE owner_key = ?").run(now, ownerKey);
  db.prepare("UPDATE perim_player_state SET updated_at = ? WHERE owner_key = ?").run(now, ownerKey);
}

function ensureAuditLogTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      owner_key TEXT,
      ip_address TEXT,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
}

function appendAuditLogEntry(db, eventType, ownerKey, message, payload = {}) {
  ensureAuditLogTable(db);
  const event = String(eventType || "").trim() || "admin_local_tool";
  const targetOwner = String(ownerKey || "").trim();
  const msg = String(message || "").trim() || "Acao administrativa local";
  const payloadJson = JSON.stringify(payload && typeof payload === "object" ? payload : {});
  db.prepare(`
    INSERT INTO audit_log (event_type, severity, owner_key, ip_address, message, payload_json, created_at)
    VALUES (?, 'info', ?, 'local-admin', ?, ?, ?)
  `).run(event, targetOwner, msg, payloadJson, nowIso());
}

function listScanEntriesByOwner(db, ownerKey, filters = {}) {
  const cardType = normalizeCardType(filters.cardType || "");
  const setKey = normalizeSetKey(filters.setKey || filters.setName || "");
  const query = String(filters.query || "").trim().toLowerCase();
  const limitRaw = Number(filters.limit || 500);
  const limit = Number.isFinite(limitRaw) ? Math.max(50, Math.min(2000, Math.floor(limitRaw))) : 500;
  const rows = db.prepare(`
    SELECT
      s.scan_entry_id,
      s.owner_key,
      s.card_type,
      s.card_id,
      s.variant_json,
      s.obtained_at,
      s.source,
      s.created_at,
      c.name AS card_name,
      c.set_name,
      c.rarity
    FROM scan_entries s
    LEFT JOIN card_catalog c ON c.id = s.card_id
    WHERE s.owner_key = ?
    ORDER BY datetime(COALESCE(s.obtained_at, s.created_at)) DESC, s.scan_entry_id DESC
    LIMIT ?
  `).all(ownerKey, limit);
  return rows
    .filter((row) => {
      if (cardType && normalizeCardType(row.card_type || "") !== cardType) {
        return false;
      }
      if (setKey && normalizeSetKey(row.set_name || "") !== setKey) {
        return false;
      }
      if (query) {
        const haystack = [
          row.scan_entry_id,
          row.card_id,
          row.card_name,
          row.set_name,
          row.rarity,
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return haystack.includes(query);
      }
      return true;
    })
    .map((row) => ({
      scanEntryId: String(row.scan_entry_id || ""),
      ownerKey: String(row.owner_key || ""),
      cardType: normalizeCardType(row.card_type || ""),
      cardId: String(row.card_id || ""),
      cardName: String(row.card_name || row.card_id || ""),
      setName: String(row.set_name || ""),
      rarity: String(row.rarity || ""),
      variantJson: String(row.variant_json || ""),
      obtainedAt: String(row.obtained_at || ""),
      source: String(row.source || ""),
      createdAt: String(row.created_at || ""),
    }));
}

function sanitizeScansGrantPayload(db, raw) {
  const cardId = String(raw?.cardId || "").trim();
  if (!cardId) {
    throw new Error("cardId e obrigatorio para grant.");
  }
  const card = getCatalogCardById(db, cardId);
  if (!card) {
    throw new Error(`Carta nao encontrada: ${cardId}`);
  }
  const quantityRaw = Number(raw?.quantity || 1);
  const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.min(100, Math.floor(quantityRaw))) : 1;
  const source = String(raw?.source || "admin_manual_grant").trim() || "admin_manual_grant";
  const starsPreset = normalizeStarsPreset(raw?.starsPreset);
  const variantFromText = parseVariantJsonOrNull(raw?.variantJson);
  const variant =
    variantFromText
    || (card.type === "creatures" ? buildCreatureVariantFromStars(starsPreset) : null);
  return {
    card,
    quantity,
    source,
    variant,
  };
}

function sanitizeScanEntryIds(raw) {
  const source = Array.isArray(raw?.scanEntryIds) ? raw.scanEntryIds : [];
  const ids = [...new Set(source.map((entry) => String(entry || "").trim()).filter(Boolean))];
  if (!ids.length) {
    throw new Error("Selecione ao menos 1 scan_entry_id.");
  }
  return ids;
}

function ensurePlayerProfileRow(db, ownerKey) {
  const existing = db.prepare("SELECT owner_key FROM player_profiles WHERE owner_key = ? LIMIT 1").get(ownerKey);
  if (existing) {
    return;
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO player_profiles (
      owner_key, favorite_tribe, starter_pack_granted_at, starter_pack_tribe, admin_scanner_maxed_at,
      avatar, score, wins, losses, win_rate, most_played_card_id, most_played_name, most_played_count, created_at, updated_at
    ) VALUES (?, '', '', '', '', '', 0, 0, 0, 0, '', '', 0, ?, ?)
  `).run(ownerKey, now, now);
}

function currentSeasonKey() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeDromeId(valueRaw) {
  const token = String(valueRaw || "").trim().toLowerCase();
  return DROME_IDS.includes(token) ? token : "";
}

function sanitizeProfileRankedUpdatePayload(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : null;
  const rankedGlobal = payload.rankedGlobal && typeof payload.rankedGlobal === "object" ? payload.rankedGlobal : null;
  const drome = payload.drome && typeof payload.drome === "object" ? payload.drome : null;
  const seasonKey = String(payload.seasonKey || drome?.seasonKey || currentSeasonKey()).trim() || currentSeasonKey();
  const dromeId = normalizeDromeId(payload.dromeId || drome?.dromeId || "");
  return { profile, rankedGlobal, drome, seasonKey, dromeId };
}

function upsertRankedGlobal(db, ownerKey, values = {}) {
  const now = nowIso();
  const existing = db.prepare("SELECT owner_key FROM ranked_global WHERE owner_key = ? LIMIT 1").get(ownerKey);
  const elo = Number.isFinite(Number(values.elo)) ? Math.max(0, Math.min(6000, Math.floor(Number(values.elo)))) : 1200;
  const wins = Number.isFinite(Number(values.wins)) ? Math.max(0, Math.floor(Number(values.wins))) : 0;
  const losses = Number.isFinite(Number(values.losses)) ? Math.max(0, Math.floor(Number(values.losses))) : 0;
  if (existing) {
    db.prepare("UPDATE ranked_global SET elo = ?, wins = ?, losses = ?, updated_at = ? WHERE owner_key = ?")
      .run(elo, wins, losses, now, ownerKey);
  } else {
    db.prepare("INSERT INTO ranked_global (owner_key, elo, wins, losses, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(ownerKey, elo, wins, losses, now);
  }
}

function upsertRankedDromeStats(db, ownerKey, seasonKey, dromeId, values = {}) {
  if (!dromeId) {
    throw new Error("dromeId invalido para atualizacao mensal.");
  }
  const now = nowIso();
  const score = Number.isFinite(Number(values.score)) ? Math.max(0, Math.min(99999, Math.floor(Number(values.score)))) : 1200;
  const wins = Number.isFinite(Number(values.wins)) ? Math.max(0, Math.floor(Number(values.wins))) : 0;
  const losses = Number.isFinite(Number(values.losses)) ? Math.max(0, Math.floor(Number(values.losses))) : 0;
  const existing = db
    .prepare("SELECT owner_key FROM ranked_drome_stats WHERE season_key = ? AND drome_id = ? AND owner_key = ? LIMIT 1")
    .get(seasonKey, dromeId, ownerKey);
  if (existing) {
    db.prepare(`
      UPDATE ranked_drome_stats
      SET score = ?, wins = ?, losses = ?, updated_at = ?
      WHERE season_key = ? AND drome_id = ? AND owner_key = ?
    `).run(score, wins, losses, now, seasonKey, dromeId, ownerKey);
  } else {
    db.prepare(`
      INSERT INTO ranked_drome_stats (season_key, drome_id, owner_key, score, wins, losses, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(seasonKey, dromeId, ownerKey, score, wins, losses, now);
  }
}

function fetchProfileRankedState(db, ownerKey, seasonKeyRaw = "") {
  const seasonKey = String(seasonKeyRaw || "").trim() || currentSeasonKey();
  const profile = db.prepare(`
    SELECT owner_key, favorite_tribe, avatar, score, wins, losses, win_rate, updated_at
    FROM player_profiles WHERE owner_key = ? LIMIT 1
  `).get(ownerKey);
  const rankedGlobal = db.prepare(`
    SELECT owner_key, elo, wins, losses, updated_at
    FROM ranked_global WHERE owner_key = ? LIMIT 1
  `).get(ownerKey);
  const rankedSelection = db.prepare(`
    SELECT season_key, drome_id, locked_at
    FROM ranked_drome_selection
    WHERE owner_key = ? AND season_key = ?
    LIMIT 1
  `).get(ownerKey, seasonKey);
  const rankedDromeStats = db.prepare(`
    SELECT season_key, drome_id, owner_key, score, wins, losses, updated_at
    FROM ranked_drome_stats
    WHERE owner_key = ? AND season_key = ?
    ORDER BY drome_id
  `).all(ownerKey, seasonKey);
  const rankedDromeStreaks = db.prepare(`
    SELECT season_key, drome_id, owner_key, current_streak, best_streak, updated_at
    FROM ranked_drome_streaks
    WHERE owner_key = ? AND season_key = ?
    ORDER BY drome_id
  `).all(ownerKey, seasonKey);
  return {
    seasonKey,
    profile: profile
      ? {
          ownerKey: String(profile.owner_key || ""),
          favoriteTribe: String(profile.favorite_tribe || ""),
          avatar: String(profile.avatar || ""),
          score: Number(profile.score || 0),
          wins: Number(profile.wins || 0),
          losses: Number(profile.losses || 0),
          winRate: Number(profile.win_rate || 0),
          updatedAt: String(profile.updated_at || ""),
        }
      : null,
    rankedGlobal: rankedGlobal
      ? {
          ownerKey: String(rankedGlobal.owner_key || ""),
          elo: Number(rankedGlobal.elo || 0),
          wins: Number(rankedGlobal.wins || 0),
          losses: Number(rankedGlobal.losses || 0),
          updatedAt: String(rankedGlobal.updated_at || ""),
        }
      : null,
    rankedSelection: rankedSelection
      ? {
          seasonKey: String(rankedSelection.season_key || ""),
          dromeId: String(rankedSelection.drome_id || ""),
          lockedAt: String(rankedSelection.locked_at || ""),
        }
      : null,
    rankedDromeStats: rankedDromeStats.map((row) => ({
      seasonKey: String(row.season_key || ""),
      dromeId: String(row.drome_id || ""),
      ownerKey: String(row.owner_key || ""),
      score: Number(row.score || 0),
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      updatedAt: String(row.updated_at || ""),
    })),
    rankedDromeStreaks: rankedDromeStreaks.map((row) => ({
      seasonKey: String(row.season_key || ""),
      dromeId: String(row.drome_id || ""),
      ownerKey: String(row.owner_key || ""),
      currentStreak: Number(row.current_streak || 0),
      bestStreak: Number(row.best_streak || 0),
      updatedAt: String(row.updated_at || ""),
    })),
  };
}

function safeJsonObject(valueRaw) {
  if (!valueRaw) {
    return {};
  }
  if (typeof valueRaw === "object" && !Array.isArray(valueRaw)) {
    return valueRaw;
  }
  try {
    const parsed = JSON.parse(String(valueRaw || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function fetchPerimStateForOwner(db, ownerKey) {
  const stateRow = db.prepare(`
    SELECT owner_key, history_json, camp_wait_json, updated_at
    FROM perim_player_state
    WHERE owner_key = ?
    LIMIT 1
  `).get(ownerKey);
  const activeRuns = db.prepare(`
    SELECT run_id, action_id, action_label, status, location_card_id, location_name, start_at, end_at, updated_at
    FROM perim_runs
    WHERE owner_key = ? AND status = 'active'
    ORDER BY datetime(start_at) ASC
  `).all(ownerKey);
  const recentRuns = db.prepare(`
    SELECT run_id, action_id, action_label, status, location_card_id, location_name, start_at, end_at, claimed_at, updated_at
    FROM perim_runs
    WHERE owner_key = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 30
  `).all(ownerKey);
  const pendingRewards = db.prepare(`
    SELECT id, run_id, reward_type, card_id, is_new, payload_json
    FROM perim_rewards
    WHERE owner_key = ?
    ORDER BY id DESC
    LIMIT 200
  `).all(ownerKey);
  return {
    state: stateRow
      ? {
          ownerKey: String(stateRow.owner_key || ""),
          historyJson: safeJsonObject(stateRow.history_json),
          campWaitJson: safeJsonObject(stateRow.camp_wait_json),
          updatedAt: String(stateRow.updated_at || ""),
        }
      : null,
    activeRuns: activeRuns.map((row) => ({
      runId: String(row.run_id || ""),
      actionId: String(row.action_id || ""),
      actionLabel: String(row.action_label || ""),
      status: String(row.status || ""),
      locationCardId: String(row.location_card_id || ""),
      locationName: String(row.location_name || ""),
      startAt: String(row.start_at || ""),
      endAt: String(row.end_at || ""),
      updatedAt: String(row.updated_at || ""),
    })),
    recentRuns: recentRuns.map((row) => ({
      runId: String(row.run_id || ""),
      actionId: String(row.action_id || ""),
      actionLabel: String(row.action_label || ""),
      status: String(row.status || ""),
      locationCardId: String(row.location_card_id || ""),
      locationName: String(row.location_name || ""),
      startAt: String(row.start_at || ""),
      endAt: String(row.end_at || ""),
      claimedAt: String(row.claimed_at || ""),
      updatedAt: String(row.updated_at || ""),
    })),
    pendingRewards: pendingRewards.map((row) => ({
      id: Number(row.id || 0),
      runId: String(row.run_id || ""),
      rewardType: String(row.reward_type || ""),
      cardId: String(row.card_id || ""),
      isNew: Number(row.is_new || 0) === 1,
      payloadJson: safeJsonObject(row.payload_json),
    })),
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.action) {
    throw new Error("Parametro --action e obrigatorio.");
  }
  const dbPath = ensureDbPath(args.dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const schemaMap = getSchemaMap(db);
    if (!hasTable(schemaMap, "card_catalog")) {
      throw new Error("Tabela card_catalog nao encontrada. Rode o importador da biblioteca antes de usar o painel admin.");
    }

    if (args.action === "list-users") {
      jsonOk({ users: listUsers(db), dbPath });
      return;
    }

    if (args.action === "user-detail") {
      const username = ensureUsername(args.username);
      jsonOk({ user: fetchUserDetail(db, username) });
      return;
    }

    if (args.action === "set-password") {
      const username = ensureUsername(args.username);
      const password = String(args.password || "");
      if (!password) {
        throw new Error("Parametro --password e obrigatorio.");
      }
      const user = requireExistingUser(db, username);
      const passwordHash = hashPasswordLikeClient(password);
      const updatedAt = nowIso();
      const result = withTransaction(db, () =>
        db
          .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
          .run(passwordHash, updatedAt, Number(user.id))
      );
      jsonOk({
        username: String(user.username || ""),
        changed: Number(result?.changes || 0) > 0
      });
      return;
    }

    if (args.action === "catalog-cards") {
      const cards = listCatalogCards(db, args.cardType);
      jsonOk({ cards });
      return;
    }

    if (args.action === "events-list") {
      jsonOk({ events: listDropEvents(db) });
      return;
    }

    if (args.action === "event-create") {
      ensurePerimDropEventTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeDropEventPayload(db, payload);
      const createdAt = nowIso();
      const updatedAt = createdAt;
      const outcome = withTransaction(db, () => {
        const res = db
          .prepare(`
            INSERT INTO perim_drop_events (
              event_text, card_type, card_id, location_card_id, chance_percent, start_at, end_at, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            sanitized.eventText,
            sanitized.cardType,
            sanitized.cardId,
            sanitized.locationCardId,
            sanitized.chancePercent,
            sanitized.startAt,
            sanitized.endAt,
            sanitized.enabled,
            createdAt,
            updatedAt
          );
        const createdId = Number(res?.lastInsertRowid || 0);
        const notify = sanitized.notifyAllPlayers
          ? createGlobalEventNotification(db, sanitized.notificationText, {
              source: "admin_event_create",
              eventId: createdId,
              eventText: sanitized.eventText,
            })
          : { sent: 0 };
        return { createdId, notifiedCount: Number(notify?.sent || 0) };
      });
      jsonOk({
        createdId: Number(outcome?.createdId || 0),
        notifiedCount: Number(outcome?.notifiedCount || 0),
        events: listDropEvents(db)
      });
      return;
    }

    if (args.action === "event-update") {
      ensurePerimDropEventTable(db);
      const eventId = Number(args.id || 0);
      if (!Number.isInteger(eventId) || eventId <= 0) {
        throw new Error("Parametro --id invalido para event-update.");
      }
      const existing = db.prepare("SELECT id FROM perim_drop_events WHERE id = ?").get(eventId);
      if (!existing) {
        throw new Error(`Evento nao encontrado: ${eventId}`);
      }
      const payload = decodePayload(args);
      const sanitized = sanitizeDropEventPayload(db, payload);
      const updatedAt = nowIso();
      const notifyResult = withTransaction(db, () => {
        db
          .prepare(`
            UPDATE perim_drop_events
            SET event_text = ?, card_type = ?, card_id = ?, location_card_id = ?, chance_percent = ?,
                start_at = ?, end_at = ?, enabled = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(
            sanitized.eventText,
            sanitized.cardType,
            sanitized.cardId,
            sanitized.locationCardId,
            sanitized.chancePercent,
            sanitized.startAt,
            sanitized.endAt,
            sanitized.enabled,
            updatedAt,
            eventId
          );
        const notify = sanitized.notifyAllPlayers
          ? createGlobalEventNotification(db, sanitized.notificationText, {
              source: "admin_event_update",
              eventId,
              eventText: sanitized.eventText,
            })
          : { sent: 0 };
        return { sent: Number(notify?.sent || 0) };
      });
      jsonOk({
        updatedId: eventId,
        notifiedCount: Number(notifyResult?.sent || 0),
        events: listDropEvents(db)
      });
      return;
    }

    if (args.action === "event-delete") {
      ensurePerimDropEventTable(db);
      const eventId = Number(args.id || 0);
      if (!Number.isInteger(eventId) || eventId <= 0) {
        throw new Error("Parametro --id invalido para event-delete.");
      }
      const removed = withTransaction(db, () =>
        db.prepare("DELETE FROM perim_drop_events WHERE id = ?").run(eventId)
      );
      jsonOk({
        deletedId: eventId,
        deleted: Number(removed?.changes || 0) > 0,
        events: listDropEvents(db)
      });
      return;
    }

    if (args.action === "location-tribes-list") {
      jsonOk({ locationTribes: listLocationTribes(db) });
      return;
    }

    if (args.action === "location-tribe-set") {
      ensurePerimLocationTribesTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeLocationTribePayload(db, payload);
      const updatedAt = nowIso();
      withTransaction(db, () => {
        db
          .prepare(`
            INSERT INTO perim_location_tribes (location_card_id, tribe_key, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(location_card_id) DO UPDATE SET
              tribe_key = excluded.tribe_key,
              updated_at = excluded.updated_at
          `)
          .run(sanitized.locationCardId, sanitized.tribeKey, updatedAt);
      });
      jsonOk({
        locationCardId: sanitized.locationCardId,
        tribeKey: sanitized.tribeKey,
        locationTribes: listLocationTribes(db),
      });
      return;
    }

    if (args.action === "location-tribe-delete") {
      ensurePerimLocationTribesTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeLocationTribeDeletePayload(db, payload);
      const removed = withTransaction(db, () =>
        db.prepare("DELETE FROM perim_location_tribes WHERE location_card_id = ?").run(sanitized.locationCardId)
      );
      jsonOk({
        locationCardId: sanitized.locationCardId,
        deleted: Number(removed?.changes || 0) > 0,
        locationTribes: listLocationTribes(db),
      });
      return;
    }

    if (args.action === "location-climates-list") {
      jsonOk({
        climateKeys: LOCATION_CLIMATE_KEYS,
        locationClimateRules: listLocationClimateRules(db),
      });
      return;
    }

    if (args.action === "location-climate-set") {
      ensurePerimLocationClimateRulesTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeLocationClimateSetPayload(db, payload);
      const updatedAt = nowIso();
      let appliedClimateUpdate = null;
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO perim_location_climate_rules (location_card_id, allowed_climates_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(location_card_id) DO UPDATE SET
            allowed_climates_json = excluded.allowed_climates_json,
            updated_at = excluded.updated_at
        `).run(
          sanitized.locationCardId,
          JSON.stringify(sanitized.allowedClimates),
          updatedAt
        );
        appliedClimateUpdate = reconcileLocationStateClimateRule(db, sanitized.locationCardId, sanitized.allowedClimates);
      });
      jsonOk({
        locationCardId: sanitized.locationCardId,
        allowedClimates: sanitized.allowedClimates,
        appliedClimateUpdate,
        locationClimateRules: listLocationClimateRules(db),
      });
      return;
    }

    if (args.action === "location-climate-delete") {
      ensurePerimLocationClimateRulesTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeLocationClimateDeletePayload(db, payload);
      const removed = withTransaction(db, () =>
        db.prepare("DELETE FROM perim_location_climate_rules WHERE location_card_id = ?").run(sanitized.locationCardId)
      );
      jsonOk({
        locationCardId: sanitized.locationCardId,
        deleted: Number(removed?.changes || 0) > 0,
        locationClimateRules: listLocationClimateRules(db),
      });
      return;
    }

    if (args.action === "location-links-list") {
      jsonOk({
        locationLinks: listLocationLinks(db),
      });
      return;
    }

    if (args.action === "location-link-add") {
      ensurePerimLocationAdjacencyTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeLocationLinkPayload(db, payload);
      const existing = db
        .prepare(`
          SELECT 1
          FROM perim_location_adjacency
          WHERE from_location_card_id = ? AND to_location_card_id = ?
          LIMIT 1
        `)
        .get(sanitized.fromLocationCardId, sanitized.toLocationCardId);
      if (existing) {
        throw new Error("Link ja existe para origem -> destino selecionados.");
      }
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO perim_location_adjacency (from_location_card_id, to_location_card_id, updated_at)
          VALUES (?, ?, ?)
        `).run(sanitized.fromLocationCardId, sanitized.toLocationCardId, nowIso());
      });
      jsonOk({
        fromLocationCardId: sanitized.fromLocationCardId,
        toLocationCardId: sanitized.toLocationCardId,
        locationLinks: listLocationLinks(db),
      });
      return;
    }

    if (args.action === "location-link-remove") {
      ensurePerimLocationAdjacencyTable(db);
      const payload = decodePayload(args);
      const sanitized = sanitizeLocationLinkPayload(db, payload);
      const removed = withTransaction(db, () =>
        db.prepare(`
          DELETE FROM perim_location_adjacency
          WHERE from_location_card_id = ? AND to_location_card_id = ?
        `).run(sanitized.fromLocationCardId, sanitized.toLocationCardId)
      );
      jsonOk({
        fromLocationCardId: sanitized.fromLocationCardId,
        toLocationCardId: sanitized.toLocationCardId,
        deleted: Number(removed?.changes || 0) > 0,
        locationLinks: listLocationLinks(db),
      });
      return;
    }

    if (args.action === "location-links-import-from-matrix") {
      ensurePerimLocationAdjacencyTable(db);
      const payload = decodePayload(args);
      const projectRoot = resolveProjectRootFromDbPath(dbPath);
      const summary = importLocationLinksFromMatrix(db, {
        replace: payload?.replace !== false,
        projectRoot,
      });
      appendAuditLogEntry(
        db,
        "admin_location_links_import_matrix",
        "system",
        "Importacao de adjacencia de locais a partir de locais.xlsx.",
        summary
      );
      jsonOk({
        summary,
        locationLinks: listLocationLinks(db),
      });
      return;
    }

    if (args.action === "perim-config-get") {
      const snapshot = fetchPerimRuntimeConfig(db);
      jsonOk({
        config: snapshot.config,
        availableSetKeys: snapshot.availableSetKeys,
      });
      return;
    }

    if (args.action === "perim-config-save") {
      const payload = decodePayload(args);
      const sanitized = sanitizePerimConfigPayload(db, payload);
      withTransaction(db, () => {
        writeKvPayload(db, PERIM_RUNTIME_CONFIG_NAMESPACE, PERIM_RUNTIME_CONFIG_KEY, {
          allowedDropSets: sanitized.allowedDropSets,
          dailyWalkTimes: sanitized.dailyWalkTimes,
        });
        appendAuditLogEntry(
          db,
          "admin_perim_runtime_config_update",
          "system",
          "Atualizacao da configuracao de drops e caminhada do PERIM.",
          {
            allowedDropSets: sanitized.allowedDropSets,
            dailyWalkTimes: sanitized.dailyWalkTimes,
            walksPerDay: sanitized.walksPerDay,
          }
        );
      });
      const snapshot = fetchPerimRuntimeConfig(db);
      jsonOk({
        config: snapshot.config,
        availableSetKeys: snapshot.availableSetKeys,
      });
      return;
    }

    if (args.action === "quests-list") {
      jsonOk({ quests: listQuests(db) });
      return;
    }

    if (args.action === "quest-create") {
      const payload = decodePayload(args);
      const quest = sanitizeQuestPayload(db, payload, false);
      const now = nowIso();
      withTransaction(db, () => {
        db
          .prepare(`
            INSERT INTO perim_quest_templates (
              quest_key, title, description, reward_type, reward_card_id, target_location_card_id,
              anomaly_location_ids_json, requirements_json, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            quest.questKey,
            quest.title,
            quest.description,
            quest.rewardType,
            quest.rewardCardId,
            quest.targetLocationCardId,
            JSON.stringify(quest.anomalyLocationIds),
            JSON.stringify(quest.requirements),
            quest.enabled,
            now,
            now
          );
      });
      jsonOk({ createdQuestKey: quest.questKey, quests: listQuests(db) });
      return;
    }

    if (args.action === "quest-update") {
      const questKey = String(args.questKey || "").trim();
      if (!questKey) {
        throw new Error("Parametro --questKey e obrigatorio para quest-update.");
      }
      const existing = db
        .prepare("SELECT quest_key FROM perim_quest_templates WHERE quest_key = ? LIMIT 1")
        .get(questKey);
      if (!existing) {
        throw new Error(`Quest nao encontrada: ${questKey}`);
      }
      const payload = decodePayload(args);
      const quest = sanitizeQuestPayload(db, { ...payload, questKey }, true);
      const updatedAt = nowIso();
      withTransaction(db, () => {
        db
          .prepare(`
            UPDATE perim_quest_templates
            SET title = ?, description = ?, reward_type = ?, reward_card_id = ?, target_location_card_id = ?,
                anomaly_location_ids_json = ?, requirements_json = ?, enabled = ?, updated_at = ?
            WHERE quest_key = ?
          `)
          .run(
            quest.title,
            quest.description,
            quest.rewardType,
            quest.rewardCardId,
            quest.targetLocationCardId,
            JSON.stringify(quest.anomalyLocationIds),
            JSON.stringify(quest.requirements),
            quest.enabled,
            updatedAt,
            questKey
          );
      });
      jsonOk({ updatedQuestKey: questKey, quests: listQuests(db) });
      return;
    }

    if (args.action === "quest-delete") {
      const questKey = String(args.questKey || "").trim();
      if (!questKey) {
        throw new Error("Parametro --questKey e obrigatorio para quest-delete.");
      }
      const deleted = withTransaction(db, () =>
        db
          .prepare("DELETE FROM perim_quest_templates WHERE quest_key = ?")
          .run(questKey)
      );
      jsonOk({
        deletedQuestKey: questKey,
        deleted: Number(deleted?.changes || 0) > 0,
        quests: listQuests(db)
      });
      return;
    }

    if (args.action === "scans-list") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const scans = listScanEntriesByOwner(db, ownerKey, payload);
      jsonOk({ username, ownerKey, scans });
      return;
    }

    if (args.action === "scans-grant") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const grant = sanitizeScansGrantPayload(db, payload);
      const now = nowIso();
      const inserted = withTransaction(db, () => {
        const insert = db.prepare(`
          INSERT INTO scan_entries (
            scan_entry_id, owner_key, card_type, card_id, variant_json, obtained_at, source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const out = [];
        for (let i = 0; i < grant.quantity; i += 1) {
          const scanEntryId = makeScanEntryId();
          insert.run(
            scanEntryId,
            ownerKey,
            grant.card.type,
            grant.card.id,
            grant.variant ? JSON.stringify(grant.variant) : null,
            now,
            grant.source,
            now
          );
          out.push(scanEntryId);
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_scans_grant",
          ownerKey,
          `Grant manual de ${grant.quantity}x ${grant.card.id}`,
          { username, cardId: grant.card.id, cardType: grant.card.type, quantity: grant.quantity, source: grant.source }
        );
        return out;
      });
      jsonOk({
        username,
        ownerKey,
        granted: inserted.length,
        scanEntryIds: inserted,
        scans: listScanEntriesByOwner(db, ownerKey, payload),
      });
      return;
    }

    if (args.action === "scans-delete") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const scanEntryIds = sanitizeScanEntryIds(payload);
      const deleted = withTransaction(db, () => {
        const existingRows = db.prepare(`
          SELECT scan_entry_id
          FROM scan_entries
          WHERE owner_key = ? AND scan_entry_id = ?
        `);
        const removeStmt = db.prepare("DELETE FROM scan_entries WHERE owner_key = ? AND scan_entry_id = ?");
        let count = 0;
        for (const scanEntryId of scanEntryIds) {
          const exists = existingRows.get(ownerKey, scanEntryId);
          if (!exists) {
            continue;
          }
          const result = removeStmt.run(ownerKey, scanEntryId);
          count += Number(result?.changes || 0);
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_scans_delete",
          ownerKey,
          `Remocao manual de scans (${count})`,
          { username, removedCount: count, scanEntryIds }
        );
        return count;
      });
      jsonOk({
        username,
        ownerKey,
        deleted,
        scans: listScanEntriesByOwner(db, ownerKey, payload),
      });
      return;
    }

    if (args.action === "profile-ranked-fetch") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const seasonKey = String(payload?.seasonKey || "").trim() || currentSeasonKey();
      const snapshot = fetchProfileRankedState(db, ownerKey, seasonKey);
      jsonOk({ username, ownerKey, ...snapshot });
      return;
    }

    if (args.action === "profile-ranked-update") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const update = sanitizeProfileRankedUpdatePayload(payload);
      withTransaction(db, () => {
        if (update.profile) {
          ensurePlayerProfileRow(db, ownerKey);
          const score = Number.isFinite(Number(update.profile.score)) ? Math.max(0, Math.floor(Number(update.profile.score))) : 0;
          const wins = Number.isFinite(Number(update.profile.wins)) ? Math.max(0, Math.floor(Number(update.profile.wins))) : 0;
          const losses = Number.isFinite(Number(update.profile.losses)) ? Math.max(0, Math.floor(Number(update.profile.losses))) : 0;
          const totalMatches = wins + losses;
          const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;
          db.prepare(`
            UPDATE player_profiles
            SET score = ?, wins = ?, losses = ?, win_rate = ?, favorite_tribe = ?, avatar = ?, updated_at = ?
            WHERE owner_key = ?
          `).run(
            score,
            wins,
            losses,
            Math.round(winRate * 100) / 100,
            String(update.profile.favoriteTribe || "").trim(),
            String(update.profile.avatar || "").trim(),
            nowIso(),
            ownerKey
          );
        }
        if (update.rankedGlobal) {
          upsertRankedGlobal(db, ownerKey, update.rankedGlobal);
        }
        if (update.drome) {
          if (!update.dromeId) {
            throw new Error("Selecione um drome valido para atualizar ranking mensal.");
          }
          upsertRankedDromeStats(db, ownerKey, update.seasonKey, update.dromeId, update.drome);
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_profile_ranked_update",
          ownerKey,
          "Atualizacao manual de perfil/ranked.",
          {
            username,
            seasonKey: update.seasonKey,
            dromeId: update.dromeId || null,
            updatedProfile: Boolean(update.profile),
            updatedRankedGlobal: Boolean(update.rankedGlobal),
            updatedRankedDrome: Boolean(update.drome),
          }
        );
      });
      const snapshot = fetchProfileRankedState(db, ownerKey, update.seasonKey);
      jsonOk({ username, ownerKey, ...snapshot });
      return;
    }

    if (args.action === "profile-ranked-reset") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const mode = String(payload?.mode || "").trim().toLowerCase();
      const seasonKey = String(payload?.seasonKey || "").trim() || currentSeasonKey();
      const dromeId = normalizeDromeId(payload?.dromeId || "");
      if (!mode || !["drome-monthly", "drome-streak", "global"].includes(mode)) {
        throw new Error("mode invalido para reset. Use drome-monthly, drome-streak ou global.");
      }
      withTransaction(db, () => {
        if (mode === "drome-monthly") {
          if (!dromeId) {
            throw new Error("dromeId e obrigatorio para reset mensal.");
          }
          db.prepare(`
            UPDATE ranked_drome_stats
            SET score = 1200, wins = 0, losses = 0, updated_at = ?
            WHERE owner_key = ? AND season_key = ? AND drome_id = ?
          `).run(nowIso(), ownerKey, seasonKey, dromeId);
        } else if (mode === "drome-streak") {
          if (!dromeId) {
            throw new Error("dromeId e obrigatorio para reset de streak.");
          }
          db.prepare(`
            UPDATE ranked_drome_streaks
            SET current_streak = 0, best_streak = 0, updated_at = ?
            WHERE owner_key = ? AND season_key = ? AND drome_id = ?
          `).run(nowIso(), ownerKey, seasonKey, dromeId);
        } else if (mode === "global") {
          db.prepare(`
            UPDATE ranked_global
            SET wins = 0, losses = 0, updated_at = ?
            WHERE owner_key = ?
          `).run(nowIso(), ownerKey);
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_profile_ranked_reset",
          ownerKey,
          "Reset manual de ranking.",
          { username, mode, seasonKey, dromeId: dromeId || null }
        );
      });
      const snapshot = fetchProfileRankedState(db, ownerKey, seasonKey);
      jsonOk({ username, ownerKey, ...snapshot });
      return;
    }

    if (args.action === "perim-state-fetch") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const snapshot = fetchPerimStateForOwner(db, ownerKey);
      jsonOk({ username, ownerKey, ...snapshot });
      return;
    }

    if (args.action === "perim-fix-run") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const runId = String(payload?.runId || "").trim();
      const now = nowIso();
      const result = withTransaction(db, () => {
        let fixed = 0;
        if (runId) {
          fixed = Number(
            db.prepare(`
              UPDATE perim_runs
              SET status = 'cancelled', completed_at = COALESCE(completed_at, ?), updated_at = ?
              WHERE owner_key = ? AND run_id = ? AND status = 'active'
            `).run(now, now, ownerKey, runId)?.changes || 0
          );
        } else {
          fixed = Number(
            db.prepare(`
              UPDATE perim_runs
              SET status = 'cancelled', completed_at = COALESCE(completed_at, ?), updated_at = ?
              WHERE owner_key = ? AND status = 'active'
            `).run(now, now, ownerKey)?.changes || 0
          );
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_perim_fix_run",
          ownerKey,
          "Correcao manual de run ativa PERIM.",
          { username, runId: runId || null, fixed }
        );
        return fixed;
      });
      const snapshot = fetchPerimStateForOwner(db, ownerKey);
      jsonOk({ username, ownerKey, fixedRuns: result, ...snapshot });
      return;
    }

    if (args.action === "perim-clear-rewards") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const rewardIds = Array.isArray(payload?.rewardIds)
        ? [...new Set(payload.rewardIds.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0))]
        : [];
      if (!rewardIds.length) {
        throw new Error("Selecione ao menos 1 recompensa pendente.");
      }
      const deleted = withTransaction(db, () => {
        const delStmt = db.prepare("DELETE FROM perim_rewards WHERE owner_key = ? AND id = ?");
        let count = 0;
        for (const id of rewardIds) {
          count += Number(delStmt.run(ownerKey, id)?.changes || 0);
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_perim_clear_rewards",
          ownerKey,
          "Limpeza manual de recompensas PERIM.",
          { username, rewardIds, deleted: count }
        );
        return count;
      });
      const snapshot = fetchPerimStateForOwner(db, ownerKey);
      jsonOk({ username, ownerKey, deletedRewards: deleted, ...snapshot });
      return;
    }

    if (args.action === "perim-update-camp-progress") {
      const { username, ownerKey } = ensureOwnerKeyFromUsername(db, args.username);
      const payload = decodePayload(args);
      const locationCardId = String(payload?.locationCardId || "").trim();
      const progressRaw = Number(payload?.progress || 0);
      const progress = Number.isFinite(progressRaw) ? Math.max(0, Math.floor(progressRaw)) : 0;
      if (!locationCardId) {
        throw new Error("locationCardId e obrigatorio.");
      }
      const locationCard = getCatalogCardById(db, locationCardId);
      if (!locationCard || locationCard.type !== "locations") {
        throw new Error(`Local invalido: ${locationCardId}`);
      }
      withTransaction(db, () => {
        const existing = db
          .prepare("SELECT owner_key, history_json, camp_wait_json FROM perim_player_state WHERE owner_key = ? LIMIT 1")
          .get(ownerKey);
        const campWait = safeJsonObject(existing?.camp_wait_json);
        campWait[locationCardId] = progress;
        const now = nowIso();
        if (existing) {
          db.prepare(`
            UPDATE perim_player_state
            SET camp_wait_json = ?, updated_at = ?
            WHERE owner_key = ?
          `).run(JSON.stringify(campWait), now, ownerKey);
        } else {
          db.prepare(`
            INSERT INTO perim_player_state (owner_key, history_json, camp_wait_json, updated_at)
            VALUES (?, '{}', ?, ?)
          `).run(ownerKey, JSON.stringify(campWait), now);
        }
        touchUserCaches(db, ownerKey);
        appendAuditLogEntry(
          db,
          "admin_perim_update_camp_progress",
          ownerKey,
          "Atualizacao manual de progresso de acampamento.",
          { username, locationCardId, progress }
        );
      });
      const snapshot = fetchPerimStateForOwner(db, ownerKey);
      jsonOk({ username, ownerKey, ...snapshot });
      return;
    }

    const username = ensureUsername(args.username);
    const ownerKey = normalizeUserKey(username);
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
      const removed = withTransaction(db, () => deleteByRules(db, rules, params));
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

