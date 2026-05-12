#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CARD_TYPES = ["creatures", "attacks", "battlegear", "locations", "mugic"];
const LOCATION_TRIBE_KEYS = ["overworld", "underworld", "danian", "mipedian", "marrillian", "tribeless"];
const QUEST_ALLOWED_SET_KEYS = new Set(["dop", "zoth", "ss"]);

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

function decodePayload(payloadB64) {
  const raw = String(payloadB64 || "").trim();
  if (!raw) {
    return {};
  }
  try {
    const text = Buffer.from(raw, "base64").toString("utf8");
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
    cardType,
    cardId,
    locationCardId,
    chancePercent: Math.max(0, Math.min(100, chancePercent)),
    startAt,
    endAt,
    enabled: enabled ? 1 : 0
  };
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
      const payload = decodePayload(args.payloadB64);
      const sanitized = sanitizeDropEventPayload(db, payload);
      const createdAt = nowIso();
      const updatedAt = createdAt;
      const createdId = withTransaction(db, () => {
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
        return Number(res?.lastInsertRowid || 0);
      });
      jsonOk({ createdId, events: listDropEvents(db) });
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
      const payload = decodePayload(args.payloadB64);
      const sanitized = sanitizeDropEventPayload(db, payload);
      const updatedAt = nowIso();
      withTransaction(db, () => {
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
      });
      jsonOk({ updatedId: eventId, events: listDropEvents(db) });
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
      const payload = decodePayload(args.payloadB64);
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
      const payload = decodePayload(args.payloadB64);
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

    if (args.action === "quests-list") {
      jsonOk({ quests: listQuests(db) });
      return;
    }

    if (args.action === "quest-create") {
      const payload = decodePayload(args.payloadB64);
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
      const payload = decodePayload(args.payloadB64);
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
