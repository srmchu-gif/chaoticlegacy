const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const nodemailer = require("nodemailer");
const { URL, pathToFileURL } = require("url");
const { buildLibrary, ensureCardCatalog, CARD_CATALOG_STORAGE } = require("./lib/library");
const {
  normalizeBattleIntent,
  mapProtocolIntentToLegacyAction,
  buildBattleStateView,
  classifyActionFamily,
} = require("./lib/battle-protocol");
const {
  initializeCreatureDropTables,
  setCreatureDropSettings,
  setLocationAdjacencies,
} = require("./lib/creature-drops-db");

bootstrapEnvFromDotEnv();

function bootstrapEnvFromDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
      return;
    } catch (error) {
      console.warn(`[ENV] Falha no process.loadEnvFile(${envPath}): ${error?.message || error}. Aplicando fallback parser.`);
    }
  }

  try {
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) {
        continue;
      }
      const key = String(match[1] || "").trim();
      let value = String(match[2] || "").trim();
      if (!key) {
        continue;
      }
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn(`[ENV] Falha ao carregar .env via fallback parser: ${error?.message || error}`);
  }
}

const ROOT_DIR = process.cwd();
const PERSIST_DIR = process.env.PERSIST_DIR ? path.resolve(process.env.PERSIST_DIR) : ROOT_DIR;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DOWNLOADS_DIR = path.join(ROOT_DIR, "downloads");
const MUSIC_DIR = path.join(ROOT_DIR, "Music");
const MUSIC_DIR_FALLBACK = path.join(ROOT_DIR, "music");
const DB_DIR = path.join(PERSIST_DIR, "db");
const USERS_FILE = path.join(DB_DIR, "users.json");
const SCANS_FILE = path.join(PERSIST_DIR, "scans.json");
const PERIM_STATE_FILE = path.join(PERSIST_DIR, "perim_state.json");
const PERIM_LOCATIONS_FILE = path.join(ROOT_DIR, "locais.xlsx");
const PERIM_CREATURES_FILE = path.join(ROOT_DIR, "criaturas.xlsx");
const PROFILES_FILE = path.join(PERSIST_DIR, "profiles.json");
const SETTINGS_FILE = path.join(PERSIST_DIR, "settings.json");
const DEBUG_LOGS_DIR = path.join(PERSIST_DIR, "debug-logs");
const BACKUPS_DIR = path.join(PERSIST_DIR, "backups");
const ATTACK_PENDING_FILE = path.join(PERSIST_DIR, "ataques_pendentes.txt");
const CREATURE_PENDING_FILE = path.join(ROOT_DIR, "exports", "criaturas_pendentes.txt");
const PERIM_ACTIONS_DROPS_REPORT_FILE = path.join(ROOT_DIR, "exports", "perim_acoes_drops.txt");
const CREATURE_DROPS_ALIAS_REPORT_FILE = path.join(ROOT_DIR, "exports", "creature_drops_alias_report.txt");
const PERIM_FIXED_CREATURE_SPAWN_REPORT_FILE = path.join(ROOT_DIR, "exports", "perim_fixed_creature_spawn_report.txt");
const PERIM_DROP_TABLES_FILE = path.join(ROOT_DIR, "runtime", "perim-drop-tables.json");
const ENGINE_FILE = path.join(ROOT_DIR, "public", "js", "battle", "engine.js");
const DEFAULT_SQLITE_FILE = path.join(ROOT_DIR, "runtime", "chaotic.db");
const LEGACY_SQLITE_FILE = path.join(ROOT_DIR, "chaotic.db");
const SQLITE_FILE = process.env.SQLITE_FILE ? path.resolve(process.env.SQLITE_FILE) : DEFAULT_SQLITE_FILE;
const SQLITE_IS_DEFAULT_PATH = !process.env.SQLITE_FILE;
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_SIZE = 2 * 1024 * 1024;
const MULTIPLAYER_DISCONNECT_FORFEIT_MS = 120 * 1000;
const MULTIPLAYER_FINISHED_ROOM_TTL_MS = Math.max(60 * 1000, Number(process.env.MULTIPLAYER_FINISHED_ROOM_TTL_MS || 10 * 60 * 1000));
const MULTIPLAYER_ROOM_GC_INTERVAL_MS = Math.max(15 * 1000, Number(process.env.MULTIPLAYER_ROOM_GC_INTERVAL_MS || 30 * 1000));
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || (7 * 24 * 60 * 60 * 1000));
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 25);
const ACTION_RATE_LIMIT_WINDOW_MS = Number(process.env.ACTION_RATE_LIMIT_WINDOW_MS || 10 * 1000);
const ACTION_RATE_LIMIT_MAX = Number(process.env.ACTION_RATE_LIMIT_MAX || 40);
const CREATURE_DAILY_ALGO_VERSION = 3;
const SMTP_HOST = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || "").trim();
const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ADMIN_BOOTSTRAP_PASSWORD = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "").trim();
const SESSION_COOKIE_NAME = "chaotic_sid";
const USER_CACHE_TTL_MS = Math.max(5 * 1000, Number(process.env.USER_CACHE_TTL_MS || 30 * 1000));
const METRICS_WINDOW_MS = Math.max(5 * 60 * 1000, Number(process.env.METRICS_WINDOW_MS || 30 * 60 * 1000));
const METRICS_SAMPLE_LIMIT = Math.max(300, Number(process.env.METRICS_SAMPLE_LIMIT || 2500));
const DB_BACKUP_RETENTION_DAYS = Math.max(1, Number(process.env.DB_BACKUP_RETENTION_DAYS || 7));
const DB_BACKUP_HOUR = Math.max(0, Math.min(23, Number(process.env.DB_BACKUP_HOUR || 2)));
const SQL_V2_SCHEMA_VERSION = 2;
const SQL_V2_STORAGE_MODE = "sql_v2_cutover";
const SQL_CATALOG_SCHEMA_VERSION = 4;
const TRADE_MONTHLY_COMPLETED_LIMIT = 2;
const MATCH_TYPE_CASUAL_MULTIPLAYER = "casual_multiplayer";
const MATCH_TYPE_RANKED_DROME = "ranked_drome";
const MATCH_TYPE_CODEMASTER_CHALLENGE = "codemaster_challenge";
const TRUST_PROXY_HOPS = Math.max(0, Number(process.env.TRUST_PROXY_HOPS || 0));
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;
const STRICT_USERNAME_REGEX = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const USERNAME_ALIAS_NAMESPACE = "auth_username_alias";
const DROME_BASE_SCORE = 1200;
const DROME_RANKED_WIN_SCORE = 24;
const DROME_RANKED_LOSS_SCORE = -8;
const CODEMASTER_WIN_BONUS_SCORE = 14;
const DROME_CHALLENGE_INVITE_TTL_MS = 10 * 60 * 1000;
const RANKED_BANLIST_DEFAULT_NAME = "Ranked Default";
const GLOBAL_CHAT_RETENTION_DAYS = Math.max(1, Number(process.env.GLOBAL_CHAT_RETENTION_DAYS || 1));
const GLOBAL_CHAT_MAX_MESSAGE_LENGTH = 240;
const CHAT_TRANSLATION_CACHE_TTL_MS = Math.max(60 * 1000, Number(process.env.CHAT_TRANSLATION_CACHE_TTL_MS || 10 * 60 * 1000));
const CHAT_TRANSLATION_HTTP_TIMEOUT_MS = Math.max(1500, Number(process.env.CHAT_TRANSLATION_HTTP_TIMEOUT_MS || 6500));
const LIBRETRANSLATE_URL = String(process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate").trim();
const LIBRETRANSLATE_API_KEY = String(process.env.LIBRETRANSLATE_API_KEY || "").trim();
const XLSX_MAX_FILE_BYTES = Math.max(64 * 1024, Number(process.env.XLSX_MAX_FILE_BYTES || 8 * 1024 * 1024));
const CASUAL_INVITE_TTL_MS = 5 * 60 * 1000;
const RANKED_QUEUE_STALE_MS = 6 * 60 * 1000;
const RANKED_QUEUE_BASE_RANGE = 40;
const RANKED_QUEUE_RANGE_STEP = 25;
const RANKED_QUEUE_RANGE_STEP_MS = 15 * 1000;
const RANKED_QUEUE_RANGE_MAX = 420;
const DROME_CATALOG = [
  { id: "crellan", name: "Crellan Drome" },
  { id: "hotekk", name: "Hotekk Drome" },
  { id: "amzen", name: "Amzen Drome" },
  { id: "oron", name: "Oron Drome" },
  { id: "tirasis", name: "Tirasis Drome" },
  { id: "imthor", name: "Imthor Drome" },
  { id: "chirrul", name: "Chirrul Drome" },
  { id: "beta", name: "Beta Drome" },
];
const DROME_TRIBE_TAGS = {
  danian: "DANIANS",
  mipedian: "MIPEDIANS",
  overworld: "OUTROMUNDO",
  underworld: "SUBMUNDO",
};

if (!fs.existsSync(PERSIST_DIR)) {
  fs.mkdirSync(PERSIST_DIR, { recursive: true });
}
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}
if (!fs.existsSync(DEBUG_LOGS_DIR)) {
  fs.mkdirSync(DEBUG_LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}
const SQLITE_DIR = path.dirname(SQLITE_FILE);
if (!fs.existsSync(SQLITE_DIR)) {
  fs.mkdirSync(SQLITE_DIR, { recursive: true });
}

function sqliteDailyLocationCountFromFile(DatabaseSync, dbFilePath) {
  if (!dbFilePath || !fs.existsSync(dbFilePath)) {
    return 0;
  }
  let probeDb = null;
  try {
    probeDb = new DatabaseSync(dbFilePath, { readOnly: true });
    const table = probeDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'creature_daily_locations' LIMIT 1")
      .get();
    if (!table) {
      return 0;
    }
    const row = probeDb.prepare("SELECT COUNT(*) AS total FROM creature_daily_locations").get();
    return Number(row?.total || 0);
  } catch {
    return 0;
  } finally {
    if (probeDb) {
      try {
        probeDb.close();
      } catch {}
    }
  }
}

function reconcileSqliteSource(DatabaseSync) {
  if (!SQLITE_IS_DEFAULT_PATH) {
    return;
  }
  const defaultPath = path.resolve(SQLITE_FILE);
  const legacyPath = path.resolve(LEGACY_SQLITE_FILE);
  if (defaultPath === legacyPath || !fs.existsSync(legacyPath)) {
    return;
  }
  const defaultCount = sqliteDailyLocationCountFromFile(DatabaseSync, defaultPath);
  const legacyCount = sqliteDailyLocationCountFromFile(DatabaseSync, legacyPath);
  if (defaultCount > 0) {
    if (legacyCount > 0) {
      console.log(`[DB] Mantendo fonte oficial em runtime (daily rows runtime=${defaultCount}, legacy=${legacyCount}).`);
    }
    return;
  }
  if (legacyCount <= 0) {
    return;
  }
  const hadDefaultFile = fs.existsSync(defaultPath);
  if (hadDefaultFile) {
    const backupPath = `${defaultPath}.bak.${Date.now()}`;
    fs.copyFileSync(defaultPath, backupPath);
    console.log(`[DB] Backup do SQLite padrao criado em ${backupPath}`);
  }
  fs.copyFileSync(legacyPath, defaultPath);
  console.log(
    `[DB] Migracao one-shot aplicada: sqlite legado copiado para runtime (daily rows legacy=${legacyCount}).`
  );
}

let sqliteDb = null;
let sqlStorageMode = "json_fallback";
let sqlSchemaVersion = 1;
const SQLITE_CORRUPT_ERROR_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB"]);
const SQLITE_CORRUPT_MESSAGE_TOKENS = ["database disk image is malformed", "malformed", "not a database"];
const DB_HEALTH_CACHE_MS = 30 * 1000;
let dbIntegrityProbe = {
  checkedAt: 0,
  status: "unknown",
  details: [],
};
let dbCorruptionState = {
  detected: false,
  detectedAt: "",
  lastOperation: "",
  namespace: "",
  entityKey: "",
  message: "",
};

function isSqliteCorruptionError(error) {
  if (!error) {
    return false;
  }
  if (SQLITE_CORRUPT_ERROR_CODES.has(String(error.code || "").toUpperCase())) {
    return true;
  }
  const message = String(error.message || "").toLowerCase();
  return SQLITE_CORRUPT_MESSAGE_TOKENS.some((token) => message.includes(token));
}

function captureSqliteCorruption(operation, namespace, entityKey, error) {
  dbCorruptionState = {
    detected: true,
    detectedAt: nowIso(),
    lastOperation: String(operation || ""),
    namespace: String(namespace || ""),
    entityKey: String(entityKey || ""),
    message: String(error?.message || error || "Erro desconhecido de SQLite"),
  };
  dbIntegrityProbe = {
    checkedAt: Date.now(),
    status: "corrupt",
    details: [dbCorruptionState.message],
  };
  console.error(
    `[DB][CORRUPT] op=${dbCorruptionState.lastOperation} namespace=${dbCorruptionState.namespace} key=${dbCorruptionState.entityKey} error=${dbCorruptionState.message}`
  );
}

function markDbOperationHealthy() {
  if (!dbCorruptionState.detected) {
    return;
  }
  dbCorruptionState = {
    detected: false,
    detectedAt: "",
    lastOperation: "",
    namespace: "",
    entityKey: "",
    message: "",
  };
}

function runIntegrityProbe(force = false) {
  if (!sqliteDb) {
    return { status: "unavailable", details: [] };
  }
  const now = Date.now();
  if (!force && now - Number(dbIntegrityProbe.checkedAt || 0) < DB_HEALTH_CACHE_MS) {
    return {
      status: dbIntegrityProbe.status || "unknown",
      details: Array.isArray(dbIntegrityProbe.details) ? dbIntegrityProbe.details : [],
    };
  }
  try {
    const rows = sqliteDb.prepare("PRAGMA integrity_check").all();
    const details = Array.isArray(rows)
      ? rows
          .map((row) => {
            if (!row || typeof row !== "object") {
              return "";
            }
            const values = Object.values(row);
            return String(values[0] || "").trim();
          })
          .filter(Boolean)
      : [];
    const status = details.length === 1 && String(details[0]).toLowerCase() === "ok" ? "ok" : "corrupt";
    dbIntegrityProbe = {
      checkedAt: now,
      status,
      details,
    };
    if (status === "ok") {
      markDbOperationHealthy();
    }
  } catch (error) {
    const message = String(error?.message || error || "Falha ao executar integrity_check");
    dbIntegrityProbe = {
      checkedAt: now,
      status: "corrupt",
      details: [message],
    };
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("integrity_check", "system", "integrity", error);
    }
  }
  return {
    status: dbIntegrityProbe.status || "unknown",
    details: Array.isArray(dbIntegrityProbe.details) ? dbIntegrityProbe.details : [],
  };
}

try {
  const { DatabaseSync } = require("node:sqlite");
  reconcileSqliteSource(DatabaseSync);
  sqliteDb = new DatabaseSync(SQLITE_FILE);
  console.log(`[DB] SQLite ativo em: ${SQLITE_FILE}`);
  sqlStorageMode = "sqlite_legacy_kv";
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      namespace TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, entity_key)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      tribe TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'player',
      verified INTEGER NOT NULL DEFAULT 0,
      session_token TEXT,
      session_expires_at TEXT,
      session_ip TEXT NOT NULL DEFAULT '',
      session_device TEXT NOT NULL DEFAULT '',
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const userColumns = sqliteDb.prepare("PRAGMA table_info(users)").all();
  const userColumnSet = new Set(userColumns.map((entry) => String(entry?.name || "").toLowerCase()));
  if (!userColumnSet.has("session_expires_at")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN session_expires_at TEXT;");
  }
  if (!userColumnSet.has("session_ip")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN session_ip TEXT NOT NULL DEFAULT '';");
  }
  if (!userColumnSet.has("session_device")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN session_device TEXT NOT NULL DEFAULT '';");
  }
  if (!userColumnSet.has("last_login_at")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT;");
  }
  if (!userColumnSet.has("role")) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player';");
  }
  sqliteDb.prepare("UPDATE users SET role = 'admin' WHERE lower(username) = 'admin'").run();
  sqliteDb.prepare("UPDATE users SET role = 'player' WHERE role IS NULL OR trim(role) = ''").run();
} catch (error) {
  console.warn(`[DB] SQLite indisponivel, fallback JSON ativo: ${error.message}`);
}

// Inicializar tabelas de drops de criaturas
if (sqliteDb) {
  initializeCreatureDropTables(sqliteDb);
}

function sqlGet(namespace, entityKey) {
  if (!sqliteDb) {
    return null;
  }
  try {
    const row = sqliteDb
      .prepare("SELECT payload FROM kv_store WHERE namespace = ? AND entity_key = ?")
      .get(String(namespace || ""), String(entityKey || ""));
    if (!row?.payload) {
      return null;
    }
    markDbOperationHealthy();
    return safeJsonParse(row.payload, null);
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("sqlGet", namespace, entityKey, error);
      return null;
    }
    console.error(
      `[DB][ERROR] op=sqlGet namespace=${String(namespace || "")} key=${String(entityKey || "")} error=${error?.message || error}`
    );
    return null;
  }
}

function sqlSet(namespace, entityKey, payload) {
  if (!sqliteDb) {
    return false;
  }
  try {
    sqliteDb
      .prepare(`
        INSERT INTO kv_store (namespace, entity_key, payload, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace, entity_key)
        DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .run(
        String(namespace || ""),
        String(entityKey || ""),
        JSON.stringify(payload || {}),
        nowIso()
      );
    markDbOperationHealthy();
    return true;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("sqlSet", namespace, entityKey, error);
      return false;
    }
    console.error(
      `[DB][ERROR] op=sqlSet namespace=${String(namespace || "")} key=${String(entityKey || "")} error=${error?.message || error}`
    );
    return false;
  }
}

function sqlDelete(namespace, entityKey) {
  if (!sqliteDb) {
    return false;
  }
  try {
    sqliteDb
      .prepare("DELETE FROM kv_store WHERE namespace = ? AND entity_key = ?")
      .run(String(namespace || ""), String(entityKey || ""));
    markDbOperationHealthy();
    return true;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("sqlDelete", namespace, entityKey, error);
      return false;
    }
    console.error(
      `[DB][ERROR] op=sqlDelete namespace=${String(namespace || "")} key=${String(entityKey || "")} error=${error?.message || error}`
    );
    return false;
  }
}

function sqlList(namespace) {
  if (!sqliteDb) {
    return [];
  }
  try {
    const rows = sqliteDb
      .prepare("SELECT entity_key, payload, updated_at FROM kv_store WHERE namespace = ?")
      .all(String(namespace || ""));
    markDbOperationHealthy();
    return rows;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("sqlList", namespace, "*", error);
      return [];
    }
    console.error(
      `[DB][ERROR] op=sqlList namespace=${String(namespace || "")} error=${error?.message || error}`
    );
    return [];
  }
}

function parseJsonText(value, fallback = null) {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createSqlV2Tables() {
  if (!sqliteDb) {
    return;
  }
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER NOT NULL PRIMARY KEY,
      migrated_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS deck_headers (
      deck_key TEXT NOT NULL PRIMARY KEY,
      owner_key TEXT NOT NULL DEFAULT '',
      is_ownerless_legacy INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS deck_cards (
      deck_key TEXT NOT NULL,
      card_type TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      owner_key_shadow TEXT NOT NULL DEFAULT '',
      card_id TEXT NOT NULL,
      scan_entry_id TEXT,
      variant_json TEXT,
      PRIMARY KEY (deck_key, card_type, slot_index)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_deck_headers_owner_updated ON deck_headers(owner_key, updated_at);");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_type ON deck_cards(deck_key, card_type);");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_deck_cards_owner_type_card ON deck_cards(owner_key_shadow, card_type, card_id);");

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS scan_entries (
      scan_entry_id TEXT NOT NULL PRIMARY KEY,
      owner_key TEXT NOT NULL,
      card_type TEXT NOT NULL,
      card_id TEXT NOT NULL,
      variant_json TEXT,
      obtained_at TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_scan_entries_owner_type_card ON scan_entries(owner_key, card_type, card_id);");

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS player_profiles (
      owner_key TEXT NOT NULL PRIMARY KEY,
      favorite_tribe TEXT NOT NULL DEFAULT '',
      starter_pack_granted_at TEXT NOT NULL DEFAULT '',
      starter_pack_tribe TEXT NOT NULL DEFAULT '',
      admin_scanner_maxed_at TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 1200,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      most_played_card_id TEXT NOT NULL DEFAULT '',
      most_played_name TEXT NOT NULL DEFAULT '',
      most_played_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS profile_scanners (
      owner_key TEXT NOT NULL,
      scanner_key TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_key, scanner_key)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS profile_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      result TEXT NOT NULL,
      opponent TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_profile_history_owner_time ON profile_history(owner_key, timestamp DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS profile_creature_usage (
      owner_key TEXT NOT NULL,
      card_id TEXT NOT NULL,
      name TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_key, card_id)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS profile_discoveries (
      owner_key TEXT NOT NULL,
      card_id TEXT NOT NULL,
      discovered INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner_key, card_id)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_owner_key TEXT NOT NULL,
      to_owner_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      responded_at TEXT
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_friend_requests_target_status_created ON friend_requests(to_owner_key, status, created_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      owner_key TEXT NOT NULL,
      friend_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_request_id INTEGER,
      PRIMARY KEY (owner_key, friend_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_friends_owner_created ON friends(owner_key, created_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS profile_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_key TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_profile_notifications_owner_read_created ON profile_notifications(owner_key, is_read, created_at DESC);");

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_player_state (
      owner_key TEXT NOT NULL PRIMARY KEY,
      history_json TEXT NOT NULL,
      camp_wait_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `);
  const perimPlayerStateColumns = sqliteDb.prepare("PRAGMA table_info(perim_player_state)").all();
  const perimPlayerStateColumnSet = new Set(perimPlayerStateColumns.map((entry) => String(entry?.name || "").toLowerCase()));
  if (!perimPlayerStateColumnSet.has("camp_wait_json")) {
    sqliteDb.exec("ALTER TABLE perim_player_state ADD COLUMN camp_wait_json TEXT NOT NULL DEFAULT '{}';");
  }
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_runs (
      run_id TEXT NOT NULL PRIMARY KEY,
      owner_key TEXT NOT NULL,
      location_card_id TEXT NOT NULL,
      location_name TEXT NOT NULL,
      location_image TEXT NOT NULL DEFAULT '',
      action_id TEXT NOT NULL,
      action_label TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      scanner_json TEXT,
      context_json TEXT,
      rewards_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      completed_at TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_runs_owner_status_end ON perim_runs(owner_key, status, end_at);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      card_id TEXT NOT NULL,
      variant_json TEXT,
      is_new INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_rewards_owner_run ON perim_rewards(owner_key, run_id);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_quest_templates (
      quest_key TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      reward_type TEXT NOT NULL,
      reward_card_id TEXT NOT NULL,
      quest_set_key TEXT NOT NULL DEFAULT '',
      difficulty_key TEXT NOT NULL DEFAULT 'ok',
      is_draft INTEGER NOT NULL DEFAULT 0,
      target_location_card_id TEXT NOT NULL,
      anomaly_location_ids_json TEXT NOT NULL DEFAULT '[]',
      requirements_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const perimQuestTemplateColumns = sqliteDb.prepare("PRAGMA table_info(perim_quest_templates)").all();
  const perimQuestTemplateColumnSet = new Set(perimQuestTemplateColumns.map((entry) => String(entry?.name || "").toLowerCase()));
  if (!perimQuestTemplateColumnSet.has("quest_set_key")) {
    sqliteDb.exec("ALTER TABLE perim_quest_templates ADD COLUMN quest_set_key TEXT NOT NULL DEFAULT '';");
  }
  if (!perimQuestTemplateColumnSet.has("difficulty_key")) {
    sqliteDb.exec("ALTER TABLE perim_quest_templates ADD COLUMN difficulty_key TEXT NOT NULL DEFAULT 'ok';");
  }
  if (!perimQuestTemplateColumnSet.has("is_draft")) {
    sqliteDb.exec("ALTER TABLE perim_quest_templates ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;");
  }
  sqliteDb.exec(`
    UPDATE perim_quest_templates
    SET quest_set_key = lower(trim((SELECT set_name FROM card_catalog WHERE id = reward_card_id LIMIT 1)))
    WHERE trim(COALESCE(quest_set_key, '')) = ''
  `);
  sqliteDb.exec("UPDATE perim_quest_templates SET difficulty_key = 'ok' WHERE trim(COALESCE(difficulty_key, '')) = '';");
  sqliteDb.exec("UPDATE perim_quest_templates SET is_draft = 0 WHERE is_draft IS NULL;");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_quest_templates_enabled ON perim_quest_templates(enabled, reward_type);");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_quest_templates_runtime ON perim_quest_templates(enabled, is_draft, quest_set_key);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_player_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_key TEXT NOT NULL,
      quest_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      reserved_run_id TEXT,
      assigned_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      granted_at TEXT,
      UNIQUE (owner_key, quest_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_player_quests_owner_status ON perim_player_quests(owner_key, status, updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_quest_unlocks (
      owner_key TEXT NOT NULL,
      card_type TEXT NOT NULL,
      card_id TEXT NOT NULL,
      source_quest_key TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, card_type, card_id)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_quest_unlocks_owner ON perim_quest_unlocks(owner_key, unlocked_at DESC);");
  sqliteDb.exec(`
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
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_drop_events_active_window ON perim_drop_events(enabled, location_card_id, start_at, end_at);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_climate_daily_effects (
      date_key TEXT NOT NULL,
      climate_key TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      effect_label TEXT NOT NULL,
      effect_description TEXT NOT NULL,
      modifiers_json TEXT NOT NULL DEFAULT '{}',
      rolled_at TEXT NOT NULL,
      PRIMARY KEY (date_key, climate_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_climate_daily_effects_date ON perim_climate_daily_effects(date_key, climate_key);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_state (
      location_id TEXT NOT NULL PRIMARY KEY,
      turn_label TEXT NOT NULL,
      climate TEXT NOT NULL,
      creatures_today_count INTEGER NOT NULL DEFAULT 0,
      event_chance_percent INTEGER NOT NULL DEFAULT 0,
      hour_token TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_tribes (
      location_card_id TEXT NOT NULL PRIMARY KEY,
      tribe_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_tribes_tribe ON perim_location_tribes(tribe_key, updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_climate_rules (
      location_card_id TEXT NOT NULL PRIMARY KEY,
      allowed_climates_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_climate_rules_updated ON perim_location_climate_rules(updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_adjacency (
      from_location_card_id TEXT NOT NULL,
      to_location_card_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (from_location_card_id, to_location_card_id)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_adjacency_from ON perim_location_adjacency(from_location_card_id, updated_at DESC);");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_adjacency_to ON perim_location_adjacency(to_location_card_id, updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_battlegear_spawn_rules (
      card_id TEXT NOT NULL PRIMARY KEY,
      location_1_card_id TEXT NOT NULL,
      location_2_card_id TEXT NOT NULL,
      chance_percent REAL NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_battlegear_spawn_rules_enabled ON perim_battlegear_spawn_rules(enabled, updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_battlegear_daily_spawns (
      date_key TEXT NOT NULL,
      card_id TEXT NOT NULL,
      selected_location_card_id TEXT NOT NULL,
      chance_percent REAL NOT NULL DEFAULT 0,
      roll_value REAL NOT NULL DEFAULT 0,
      is_available INTEGER NOT NULL DEFAULT 0,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (date_key, card_id)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_battlegear_daily_spawns_lookup ON perim_battlegear_daily_spawns(date_key, selected_location_card_id, is_available);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_location_chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      day_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_perim_location_chat_loc_day_created ON perim_location_chat(location_id, day_key, created_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS global_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_key TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      day_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_global_chat_day_created ON global_chat_messages(day_key, created_at DESC);");

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      season_key TEXT NOT NULL PRIMARY KEY,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS season_player_stats (
      season_key TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      perim_claims INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (season_key, owner_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_season_stats_score ON season_player_stats(season_key, score DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS season_rewards (
      season_key TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (season_key, owner_key, reward_type, reward_value)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS daily_missions (
      mission_key TEXT NOT NULL PRIMARY KEY,
      mission_date TEXT NOT NULL,
      mission_type TEXT NOT NULL,
      target_value INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS daily_mission_progress (
      mission_key TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      progress_value INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      claimed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_key, owner_key)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS trade_history (
      trade_id TEXT NOT NULL PRIMARY KEY,
      room_code TEXT NOT NULL,
      host_key TEXT NOT NULL,
      guest_key TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS trade_history_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL,
      from_owner_key TEXT NOT NULL,
      to_owner_key TEXT NOT NULL,
      scan_entry_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      card_id TEXT NOT NULL,
      variant_json TEXT
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS trade_wishlist (
      owner_key TEXT NOT NULL,
      card_type TEXT NOT NULL,
      card_id TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, card_type, card_id)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_trade_wishlist_owner ON trade_wishlist(owner_key, updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS weekly_missions (
      mission_key TEXT NOT NULL PRIMARY KEY,
      week_start TEXT NOT NULL,
      mission_type TEXT NOT NULL,
      target_value INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS weekly_mission_progress (
      mission_key TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      progress_value INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      claimed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_key, owner_key)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      owner_key TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      unlocked_at TEXT NOT NULL,
      payload_json TEXT,
      PRIMARY KEY (owner_key, achievement_key)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      owner_key TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);");
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_owner ON audit_log(owner_key, created_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS ranked_global (
      owner_key TEXT NOT NULL PRIMARY KEY,
      elo INTEGER NOT NULL DEFAULT 1200,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS ranked_drome_selection (
      season_key TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      locked_at TEXT NOT NULL,
      PRIMARY KEY (season_key, owner_key)
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS ranked_drome_stats (
      season_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (season_key, drome_id, owner_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_ranked_drome_score ON ranked_drome_stats(season_key, drome_id, score DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS ranked_drome_streaks (
      season_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (season_key, drome_id, owner_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_ranked_drome_streaks_current ON ranked_drome_streaks(season_key, drome_id, current_streak DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS drome_season_rollups (
      season_key TEXT NOT NULL PRIMARY KEY,
      next_season_key TEXT NOT NULL,
      finalized_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS drome_season_titles (
      season_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      rank INTEGER NOT NULL,
      title_text TEXT NOT NULL,
      tribe_key TEXT NOT NULL DEFAULT '',
      source_season_key TEXT NOT NULL DEFAULT '',
      granted_at TEXT NOT NULL,
      PRIMARY KEY (season_key, drome_id, rank),
      UNIQUE (season_key, owner_key)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_drome_titles_owner ON drome_season_titles(owner_key, season_key);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS drome_codemasters (
      season_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      deck_key TEXT NOT NULL DEFAULT '',
      declared_at TEXT NOT NULL,
      deck_locked_at TEXT,
      source_season_key TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (season_key, drome_id)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_drome_codemasters_owner ON drome_codemasters(owner_key, season_key);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS drome_challenge_invites (
      invite_id TEXT NOT NULL PRIMARY KEY,
      season_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      codemaster_key TEXT NOT NULL,
      challenger_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      room_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      responded_at TEXT
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_drome_challenge_invites_target ON drome_challenge_invites(challenger_key, status, created_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS drome_challenge_outcomes (
      room_id TEXT NOT NULL PRIMARY KEY,
      season_key TEXT NOT NULL,
      drome_id TEXT NOT NULL,
      codemaster_key TEXT NOT NULL,
      challenger_key TEXT NOT NULL,
      winner_key TEXT NOT NULL DEFAULT '',
      loser_key TEXT NOT NULL DEFAULT '',
      reward_granted_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS ranked_banlists (
      banlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_ranked_banlists_active ON ranked_banlists(is_active, updated_at DESC);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS ranked_banlist_cards (
      banlist_id INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (banlist_id, card_id)
    );
  `);
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_ranked_banlist_cards_card ON ranked_banlist_cards(card_id, banlist_id);");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS perim_group_rooms (
      room_code TEXT NOT NULL PRIMARY KEY,
      host_key TEXT NOT NULL,
      guest_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const hasAnyBanlist = sqliteDb.prepare("SELECT 1 AS ok FROM ranked_banlists LIMIT 1").get();
  if (!hasAnyBanlist) {
    const now = nowIso();
    sqliteDb.prepare(`
      INSERT INTO ranked_banlists (name, description, is_active, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(RANKED_BANLIST_DEFAULT_NAME, "Banlist padrao do modo ranked.", now, now);
  } else {
    const activeCount = Number(sqliteDb.prepare("SELECT COUNT(*) AS total FROM ranked_banlists WHERE is_active = 1").get()?.total || 0);
    if (activeCount === 0) {
      sqliteDb.prepare(`
        UPDATE ranked_banlists
        SET is_active = 1, updated_at = ?
        WHERE banlist_id = (
          SELECT banlist_id FROM ranked_banlists
          ORDER BY banlist_id ASC
          LIMIT 1
        )
      `).run(nowIso());
    }
  }
}

function getSqlSchemaVersion() {
  if (!sqliteDb) {
    return 0;
  }
  try {
    const row = sqliteDb.prepare("SELECT MAX(version) AS version FROM schema_meta").get();
    return Number(row?.version || 0);
  } catch {
    return 0;
  }
}

function migrateKvToSqlV2IfNeeded() {
  if (!sqliteDb) {
    return;
  }

  createSqlV2Tables();
  const currentVersion = getSqlSchemaVersion();
  if (currentVersion >= SQL_V2_SCHEMA_VERSION) {
    sqlSchemaVersion = currentVersion;
    sqlStorageMode = SQL_V2_STORAGE_MODE;
    return;
  }

  const now = nowIso();
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    sqliteDb.exec("DELETE FROM deck_cards;");
    sqliteDb.exec("DELETE FROM deck_headers;");
    sqliteDb.exec("DELETE FROM scan_entries;");
    sqliteDb.exec("DELETE FROM player_profiles;");
    sqliteDb.exec("DELETE FROM profile_scanners;");
    sqliteDb.exec("DELETE FROM profile_history;");
    sqliteDb.exec("DELETE FROM profile_creature_usage;");
    sqliteDb.exec("DELETE FROM profile_discoveries;");
    sqliteDb.exec("DELETE FROM perim_rewards;");
    sqliteDb.exec("DELETE FROM perim_runs;");
    sqliteDb.exec("DELETE FROM perim_player_state;");
    sqliteDb.exec("DELETE FROM perim_location_state;");
    sqliteDb.exec("DELETE FROM schema_meta;");

    const deckRows = sqlList("decks");
    const upsertDeckHeader = sqliteDb.prepare(`
      INSERT INTO deck_headers (deck_key, owner_key, is_ownerless_legacy, name, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(deck_key) DO UPDATE SET
        owner_key = excluded.owner_key,
        is_ownerless_legacy = excluded.is_ownerless_legacy,
        name = excluded.name,
        mode = excluded.mode,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    const insertDeckCard = sqliteDb.prepare(`
      INSERT INTO deck_cards (deck_key, card_type, slot_index, owner_key_shadow, card_id, scan_entry_id, variant_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    deckRows.forEach((row) => {
      const payload = parseJsonText(row?.payload, null);
      if (!payload || typeof payload !== "object") {
        return;
      }
      const deckKey = normalizeDeckName(payload?.name || row?.entity_key || "");
      if (!deckKey) {
        return;
      }
      const ownerKey = deckOwnerKey(payload);
      const isOwnerlessLegacy = ownerKey ? 0 : 1;
      const deckCreatedAt = String(payload?.createdAt || row?.updated_at || now);
      const deckUpdatedAt = String(payload?.updatedAt || row?.updated_at || now);
      const mode = String(payload?.mode || "competitive");
      upsertDeckHeader.run(
        deckKey,
        ownerKey,
        isOwnerlessLegacy,
        String(payload?.name || deckKey),
        mode,
        deckCreatedAt,
        deckUpdatedAt
      );

      DECK_CARD_TYPES.forEach((type) => {
        const list = Array.isArray(payload?.cards?.[type]) ? payload.cards[type] : [];
        list.forEach((entry, slotIndex) => {
          const cardId = deckCardIdFromEntry(type, entry);
          if (!cardId) {
            return;
          }
          let scanEntryId = null;
          let variantJson = null;
          if (type === "creatures" && entry && typeof entry === "object") {
            const normalizedVariant = normalizeCreatureVariant(entry.variant);
            scanEntryId = deckCreatureScanEntryId(entry) || null;
            variantJson = normalizedVariant ? JSON.stringify(normalizedVariant) : null;
          }
          insertDeckCard.run(
            deckKey,
            type,
            Number(slotIndex),
            ownerKey,
            cardId,
            scanEntryId,
            variantJson
          );
        });
      });
    });

    const scansState = sqlGet("scans", "state");
    const scansPayload = scansState && typeof scansState === "object"
      ? normalizeScansFilePayload(scansState)
      : normalizeScansFilePayload({});
    const insertScanEntry = sqliteDb.prepare(`
      INSERT INTO scan_entries (scan_entry_id, owner_key, card_type, card_id, variant_json, obtained_at, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    Object.entries(scansPayload.players || {}).forEach(([usernameKey, playerData]) => {
      const ownerKey = normalizeUserKey(usernameKey);
      DECK_CARD_TYPES.forEach((type) => {
        const list = Array.isArray(playerData?.cards?.[type]) ? playerData.cards[type] : [];
        list.forEach((entry, idx) => {
          const cardId = scanEntryToCardId(type, entry);
          if (!cardId) {
            return;
          }
          const createdAt = now;
          let scanEntryId = "";
          let variantJson = null;
          let obtainedAt = null;
          let source = null;
          if (type === "creatures") {
            const normalizedEntry = normalizeScansEntryByType(type, entry);
            scanEntryId = String(normalizedEntry?.scanEntryId || generateScanEntryId());
            const variant = normalizeCreatureVariant(normalizedEntry?.variant);
            variantJson = variant ? JSON.stringify(variant) : null;
            obtainedAt = normalizedEntry?.obtainedAt ? String(normalizedEntry.obtainedAt) : null;
            source = normalizedEntry?.source ? String(normalizedEntry.source) : null;
          } else {
            scanEntryId = `scan_${ownerKey}_${type}_${idx}_${crypto.randomBytes(6).toString("hex")}`;
          }
          insertScanEntry.run(
            scanEntryId,
            ownerKey,
            type,
            cardId,
            variantJson,
            obtainedAt,
            source,
            createdAt
          );
        });
      });
    });

    const profilesState = sqlGet("profiles", "state");
    const rawProfiles = profilesState && typeof profilesState === "object" && profilesState.profiles && typeof profilesState.profiles === "object"
      ? profilesState.profiles
      : {};
    const upsertProfile = sqliteDb.prepare(`
      INSERT INTO player_profiles (
        owner_key, favorite_tribe, starter_pack_granted_at, starter_pack_tribe, admin_scanner_maxed_at, avatar,
        score, wins, losses, win_rate, most_played_card_id, most_played_name, most_played_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        favorite_tribe = excluded.favorite_tribe,
        starter_pack_granted_at = excluded.starter_pack_granted_at,
        starter_pack_tribe = excluded.starter_pack_tribe,
        admin_scanner_maxed_at = excluded.admin_scanner_maxed_at,
        avatar = excluded.avatar,
        score = excluded.score,
        wins = excluded.wins,
        losses = excluded.losses,
        win_rate = excluded.win_rate,
        most_played_card_id = excluded.most_played_card_id,
        most_played_name = excluded.most_played_name,
        most_played_count = excluded.most_played_count,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    const insertScanner = sqliteDb.prepare(`
      INSERT INTO profile_scanners (owner_key, scanner_key, level, xp)
      VALUES (?, ?, ?, ?)
    `);
    const insertHistory = sqliteDb.prepare(`
      INSERT INTO profile_history (owner_key, mode, result, opponent, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertCreatureUsage = sqliteDb.prepare(`
      INSERT INTO profile_creature_usage (owner_key, card_id, name, count)
      VALUES (?, ?, ?, ?)
    `);
    const insertDiscovery = sqliteDb.prepare(`
      INSERT INTO profile_discoveries (owner_key, card_id, discovered)
      VALUES (?, ?, 1)
    `);

    const usersRows = sqliteDb.prepare("SELECT username, tribe FROM users").all();
    const allProfileKeys = new Set(Object.keys(rawProfiles).map((key) => normalizeUserKey(key)));
    usersRows.forEach((row) => allProfileKeys.add(normalizeUserKey(row?.username)));
    allProfileKeys.forEach((ownerKey) => {
      const sourceRaw = rawProfiles[ownerKey] || rawProfiles[String(ownerKey).toLowerCase()] || {};
      const normalized = normalizeProfilePayload(ownerKey, sourceRaw);
      upsertProfile.run(
        ownerKey,
        String(normalized.favoriteTribe || ""),
        String(normalized.starterPackGrantedAt || ""),
        String(normalized.starterPackTribe || ""),
        String(normalized.adminScannerMaxedAt || ""),
        String(normalized.avatar || ""),
        Math.max(0, Number(normalized.score || 1200)),
        Math.max(0, Number(normalized.wins || 0)),
        Math.max(0, Number(normalized.losses || 0)),
        Number(normalized.winRate || 0),
        String(normalized?.mostPlayedCreature?.cardId || ""),
        String(normalized?.mostPlayedCreature?.name || ""),
        Math.max(0, Number(normalized?.mostPlayedCreature?.count || 0)),
        String(normalized.createdAt || now),
        String(normalized.updatedAt || now)
      );
      const scanners = normalizeScannersPayload(normalized.scanners);
      SCANNER_KEYS.forEach((scannerKey) => {
        const scanner = scanners[scannerKey] || { level: 1, xp: 0 };
        insertScanner.run(ownerKey, scannerKey, Number(scanner.level || 1), Number(scanner.xp || 0));
      });
      (normalized.battleHistory || []).forEach((entry) => {
        insertHistory.run(
          ownerKey,
          String(entry?.mode || "unknown"),
          String(entry?.result || "unknown"),
          String(entry?.opponent || "Oponente"),
          String(entry?.timestamp || now)
        );
      });
      Object.values(normalized.creatureUsage || {}).forEach((entry) => {
        const cardId = String(entry?.cardId || "").trim();
        if (!cardId) {
          return;
        }
        insertCreatureUsage.run(
          ownerKey,
          cardId,
          String(entry?.name || cardId),
          Math.max(0, Number(entry?.count || 0))
        );
      });
      Object.entries(normalized.discoveredCards || {}).forEach(([cardId, flag]) => {
        if (!cardId || !flag) {
          return;
        }
        insertDiscovery.run(ownerKey, String(cardId));
      });
    });

    const perimState = sqlGet("perim_state", "state");
    const normalizedPerim = (() => {
      if (perimState && typeof perimState === "object") {
        const players = {};
        Object.entries(perimState?.players || {}).forEach(([key, value]) => {
          players[normalizePerimPlayerKey(key)] = normalizePerimPlayerState(value);
        });
        return {
          schemaVersion: 1,
          createdAt: perimState?.createdAt || now,
          updatedAt: perimState?.updatedAt || now,
          players,
        };
      }
      return { schemaVersion: 1, createdAt: now, updatedAt: now, players: {} };
    })();

    const insertPerimRun = sqliteDb.prepare(`
      INSERT INTO perim_runs (
        run_id, owner_key, location_card_id, location_name, location_image, action_id, action_label,
        start_at, end_at, duration_ms, scanner_json, context_json, rewards_json, status, completed_at, claimed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPerimReward = sqliteDb.prepare(`
      INSERT INTO perim_rewards (run_id, owner_key, reward_type, card_id, variant_json, is_new, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertPerimPlayer = sqliteDb.prepare(`
      INSERT INTO perim_player_state (owner_key, history_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        history_json = excluded.history_json,
        updated_at = excluded.updated_at
    `);

    Object.entries(normalizedPerim.players || {}).forEach(([ownerRawKey, playerState]) => {
      const ownerKey = normalizePerimPlayerKey(ownerRawKey);
      const state = normalizePerimPlayerState(playerState);
      upsertPerimPlayer.run(
        ownerKey,
        JSON.stringify(Array.isArray(state?.history) ? state.history.slice(-30) : []),
        String(state?.updatedAt || now)
      );
      const activeRun = state.activeRun && typeof state.activeRun === "object" ? state.activeRun : null;
      if (activeRun?.runId) {
        insertPerimRun.run(
          String(activeRun.runId),
          ownerKey,
          String(activeRun.locationId || activeRun.locationCardId || ""),
          String(activeRun.locationName || ""),
          String(activeRun.locationImage || ""),
          String(activeRun.actionId || ""),
          String(activeRun.actionLabel || ""),
          String(activeRun.startAt || now),
          String(activeRun.endAt || now),
          Number(activeRun.durationMs || 0),
          JSON.stringify(activeRun.scanner || {}),
          JSON.stringify(activeRun.contextSnapshot || {}),
          JSON.stringify(activeRun.rewards || []),
          "active",
          null,
          null,
          String(activeRun.startAt || now),
          String(activeRun.updatedAt || state.updatedAt || now)
        );
      }
      (state.pendingRewards || []).forEach((pending) => {
        const runId = String(pending?.runId || crypto.randomBytes(8).toString("hex"));
        const rewards = Array.isArray(pending?.rewards) ? pending.rewards : [];
        insertPerimRun.run(
          runId,
          ownerKey,
          String(pending?.locationId || ""),
          String(pending?.locationName || ""),
          String(pending?.locationImage || ""),
          String(pending?.actionId || ""),
          String(pending?.actionName || ""),
          String(pending?.completedAt || pending?.claimedAt || now),
          String(pending?.completedAt || pending?.claimedAt || now),
          0,
          JSON.stringify({}),
          JSON.stringify({
            choiceSelections: normalizePerimChoiceSelections(pending?.choiceSelections || {}),
          }),
          JSON.stringify(rewards),
          pending?.claimedAt ? "claimed" : "pending",
          String(pending?.completedAt || now),
          pending?.claimedAt ? String(pending.claimedAt) : null,
          String(pending?.completedAt || now),
          String(pending?.claimedAt || pending?.completedAt || now)
        );
        rewards.forEach((reward) => {
          const variant = reward?.variant ? normalizeCreatureVariant(reward.variant) : null;
          insertPerimReward.run(
            runId,
            ownerKey,
            String(reward?.type || ""),
            String(reward?.cardId || ""),
            variant ? JSON.stringify(variant) : null,
            0,
            JSON.stringify(reward || {})
          );
        });
      });
    });

    const perimLocationRows = sqlList("perim_location_state_global");
    const upsertLocationState = sqliteDb.prepare(`
      INSERT INTO perim_location_state (location_id, turn_label, climate, creatures_today_count, event_chance_percent, hour_token, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET
        turn_label = excluded.turn_label,
        climate = excluded.climate,
        creatures_today_count = excluded.creatures_today_count,
        event_chance_percent = excluded.event_chance_percent,
        hour_token = excluded.hour_token,
        updated_at = excluded.updated_at
    `);
    perimLocationRows.forEach((row) => {
      const payload = parseJsonText(row?.payload, null);
      if (!payload || typeof payload !== "object") {
        return;
      }
      upsertLocationState.run(
        String(row?.entity_key || ""),
        String(payload?.turnLabel || ""),
        String(payload?.climate || "Nublado"),
        Number(payload?.creaturesTodayCount || 0),
        Number(payload?.eventChancePercent || 0),
        String(payload?.hourToken || ""),
        String(payload?.updatedAt || row?.updated_at || now)
      );
    });

    sqliteDb.prepare("INSERT INTO schema_meta (version, migrated_at, notes) VALUES (?, ?, ?)")
      .run(SQL_V2_SCHEMA_VERSION, now, "cutover from kv_store to normalized sql tables");
    sqliteDb.exec("COMMIT");
    sqlSchemaVersion = SQL_V2_SCHEMA_VERSION;
    sqlStorageMode = SQL_V2_STORAGE_MODE;
    console.log(`[DB] SQL v${SQL_V2_SCHEMA_VERSION} cutover concluido (dominios: decks/scans/profiles/perim).`);
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    console.error(`[DB] Falha ao migrar SQL v${SQL_V2_SCHEMA_VERSION}: ${error?.message || error}`);
    throw error;
  }
}

function isSqlV2Ready() {
  return Boolean(sqliteDb && Number(sqlSchemaVersion || 0) >= SQL_V2_SCHEMA_VERSION);
}

function getTodayDailyCreatureRowsCount() {
  if (!sqliteDb) {
    return 0;
  }
  try {
    const row = sqliteDb
      .prepare("SELECT COUNT(*) AS total FROM creature_daily_locations WHERE location_date = ?")
      .get(String(todayDateKey()));
    return Number(row?.total || 0);
  } catch {
    return 0;
  }
}

function areProfilesReadable() {
  try {
    const fromSql = sqlGet("profiles", "state");
    if (fromSql && typeof fromSql === "object") {
      return true;
    }
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("profilesHealthCheck", "profiles", "state", error);
    }
  }

  if (fs.existsSync(PROFILES_FILE)) {
    try {
      const parsed = safeJsonParse(fs.readFileSync(PROFILES_FILE, "utf8"), null);
      return Boolean(parsed && typeof parsed === "object");
    } catch {
      return false;
    }
  }

  return Boolean(sqliteDb);
}

let library = buildLibrary(ROOT_DIR);
function refreshLibraryCatalog(forceImport = false) {
  if (sqliteDb) {
    try {
      const catalog = ensureCardCatalog(sqliteDb, ROOT_DIR, { forceImport: Boolean(forceImport) });
      if (catalog?.ok) {
        sqliteDb
          .prepare("INSERT OR IGNORE INTO schema_meta (version, migrated_at, notes) VALUES (?, ?, ?)")
          .run(SQL_CATALOG_SCHEMA_VERSION, nowIso(), "sql catalog cards import");
        const schemaRow = sqliteDb.prepare("SELECT MAX(version) AS version FROM schema_meta").get();
        sqlSchemaVersion = Math.max(Number(sqlSchemaVersion || 0), Number(schemaRow?.version || 0));
      }
    } catch (error) {
      console.error(`[LIB] Falha ao sincronizar catalogo SQL: ${error?.message || error}`);
    }
  }
  library = buildLibrary(ROOT_DIR, {
    db: sqliteDb,
    preferSql: true,
    forceImport: Boolean(forceImport),
  });
  return library;
}

const debugSessions = new Map();
const attackPendingRuntimeKeys = new Set();
const creaturePendingRuntimeKeys = new Set();
let effectPendingStats = writeBasePendingEffectsReport();
let creaturePendingStats = writeBaseCreaturePendingEffectsReport();
migrateDeckFilesToSqlIfNeeded();

// ─── Seed admin account ───────────────────────────────────────────────
function seedAdminAccount() {
  if (!sqliteDb) return;
  const ADMIN_USER = "admin";
  const existing = sqliteDb.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(ADMIN_USER);
  if (!existing) {
    if (!ADMIN_BOOTSTRAP_PASSWORD) {
      console.warn("[SEED] Conta admin ausente e ADMIN_BOOTSTRAP_PASSWORD nao configurado. Nenhuma conta admin foi criada automaticamente.");
      return;
    }
    const now = nowIso();
    const adminHash = hashPasswordSecure(ADMIN_BOOTSTRAP_PASSWORD);
    sqliteDb.prepare(`
      INSERT INTO users (username, email, password_hash, tribe, role, verified, session_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)
    `).run(ADMIN_USER, "admin@chaotic.local", adminHash, "", null, now, now);
    console.log("[SEED] Conta admin criada via bootstrap seguro (ADMIN_BOOTSTRAP_PASSWORD).");
  }
  sqliteDb.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE username = ? COLLATE NOCASE")
    .run(nowIso(), ADMIN_USER);
  // Give admin 3 copies of every card in the library
  const adminKey = normalizeUserKey(ADMIN_USER);
  const scans = loadScansData();
  const allCards = library?.cards || [];
  const buckets = createEmptyCardBuckets();
  const COPIES = 3;
  allCards.forEach((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) return;
    const type = String(card?.type || "").toLowerCase();
    let bucketKey = "";
    if (type === "creature" || type === "creatures") bucketKey = "creatures";
    else if (type === "attack" || type === "attacks") bucketKey = "attacks";
    else if (type === "battlegear") bucketKey = "battlegear";
    else if (type === "location" || type === "locations") bucketKey = "locations";
    else if (type === "mugic") bucketKey = "mugic";
    if (!bucketKey || !buckets[bucketKey]) return;
    for (let i = 0; i < COPIES; i++) {
      if (bucketKey === "creatures") {
        buckets[bucketKey].push({
          cardId,
          scanEntryId: generateScanEntryId(),
          variant: buildCreatureScanVariant(),
          obtainedAt: nowIso(),
          source: "admin_seed",
        });
      } else {
        buckets[bucketKey].push(cardId);
      }
    }
  });
  scans.players[adminKey] = { cards: buckets };
  writeScansData(scans, "admin_seed");
  console.log(`[SEED] Admin scans: ${allCards.length} cartas x${COPIES} copias = ${allCards.length * COPIES} entradas`);
}
// ─── End seed ─────────────────────────────────────────────────────────

const multiplayerRooms = new Map();
let engineModulePromise = null;
const tradeRooms = new Map();
const TRADE_ROOM_CODE_LENGTH = 6;
const TRADE_ROOM_IDLE_TTL_MS = 30 * 60 * 1000;
const TRADE_INVITE_TTL_MS = 10 * 60 * 1000;
const tradeCardLocks = new Map();
const tradeInvites = new Map();
const perimLocationChatClients = new Map();
const globalChatClients = new Set();
const chatTranslationCache = new Map();
const activePresenceByOwner = new Map();
const casualBattleInvites = new Map();
const rankedQueueByDrome = new Map();
const rankedQueueByOwner = new Map();
const rankedQueueMatches = new Map();
const PRESENCE_HEARTBEAT_TTL_MS = 90 * 1000;

const runtimeMetrics = {
  requestSamplesByRoute: new Map(),
  routeErrorCounts: new Map(),
  tradeCompletedCount: 0,
  cache: {
    hits: 0,
    misses: 0,
    invalidations: 0,
  },
  perimJobs: {
    lastRunAt: "",
    lastSuccessAt: "",
    lastErrorAt: "",
    lastError: "",
    queued: false,
    degraded: false,
    degradedReason: "",
  },
  backups: {
    lastRunAt: "",
    lastSuccessAt: "",
    lastErrorAt: "",
    lastError: "",
  },
};

const userResponseCache = {
  profile: new Map(),
  scans: new Map(),
  perim: new Map(),
};

let lastKnownDailyCreaturePayload = null;
let perimDailyJobTimer = null;
let lastDailyBackupDateKey = "";

function pruneMetricSamples(routeKey, nowMsValue) {
  const samples = runtimeMetrics.requestSamplesByRoute.get(routeKey);
  if (!Array.isArray(samples) || !samples.length) {
    return;
  }
  const cutoff = nowMsValue - METRICS_WINDOW_MS;
  while (samples.length && Number(samples[0]?.at || 0) < cutoff) {
    samples.shift();
  }
  if (samples.length > METRICS_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - METRICS_SAMPLE_LIMIT);
  }
}

function trackRequestMetric(routePath, method, statusCode, durationMs) {
  const nowValue = Date.now();
  const routeKey = `${String(method || "GET").toUpperCase()} ${String(routePath || "/")}`;
  if (!runtimeMetrics.requestSamplesByRoute.has(routeKey)) {
    runtimeMetrics.requestSamplesByRoute.set(routeKey, []);
  }
  const samples = runtimeMetrics.requestSamplesByRoute.get(routeKey);
  samples.push({
    at: nowValue,
    status: Number(statusCode || 0),
    durationMs: Math.max(0, Number(durationMs || 0)),
  });
  pruneMetricSamples(routeKey, nowValue);
  if (Number(statusCode || 0) >= 400) {
    runtimeMetrics.routeErrorCounts.set(routeKey, (runtimeMetrics.routeErrorCounts.get(routeKey) || 0) + 1);
  }
}

function percentileFromSorted(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || !sortedValues.length) {
    return 0;
  }
  const p = Math.max(0, Math.min(1, Number(percentile || 0)));
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((sortedValues.length * p) - 1)));
  return Number(sortedValues[idx] || 0);
}

function countActiveValidSessions() {
  if (!sqliteDb) {
    return 0;
  }
  const now = nowIso();
  try {
    const row = sqliteDb
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE session_token IS NOT NULL
          AND session_token != ''
          AND session_expires_at IS NOT NULL
          AND session_expires_at > ?
      `)
      .get(now);
    return Math.max(0, Number(row?.total || 0));
  } catch {
    return 0;
  }
}

function pruneActivePresence(nowValue = nowMs()) {
  const nowTimestamp = Number(nowValue || 0);
  if (!Number.isFinite(nowTimestamp)) {
    return;
  }
  activePresenceByOwner.forEach((entry, ownerKey) => {
    const lastSeenMs = Number(entry?.lastSeenMs || 0);
    if (!lastSeenMs || (nowTimestamp - lastSeenMs) > PRESENCE_HEARTBEAT_TTL_MS) {
      activePresenceByOwner.delete(ownerKey);
    }
  });
}

function markUserPresenceActive(usernameRaw = "") {
  const ownerKey = normalizeUserKey(usernameRaw || "", "");
  if (!ownerKey) {
    return null;
  }
  const currentMs = nowMs();
  activePresenceByOwner.set(ownerKey, {
    ownerKey,
    username: String(usernameRaw || ownerKey),
    lastSeenMs: currentMs,
    lastSeenAt: isoFromMs(currentMs),
  });
  pruneActivePresence(currentMs);
  return activePresenceByOwner.get(ownerKey) || null;
}

function clearUserPresence(usernameRaw = "") {
  const ownerKey = normalizeUserKey(usernameRaw || "", "");
  if (!ownerKey) {
    return;
  }
  activePresenceByOwner.delete(ownerKey);
}

function listActivePresenceOwnerKeys(candidateKeysRaw = null) {
  pruneActivePresence(nowMs());
  const keys = Array.from(activePresenceByOwner.keys());
  if (!Array.isArray(candidateKeysRaw) || !candidateKeysRaw.length) {
    return keys;
  }
  const allowed = new Set(
    candidateKeysRaw
      .map((value) => normalizeUserKey(value || "", ""))
      .filter(Boolean)
  );
  return keys.filter((key) => allowed.has(key));
}

function listOnlinePresencePlayers(limitRaw = 50) {
  if (!sqliteDb) {
    return [];
  }
  const limit = Math.max(1, Math.min(100, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50));
  const activeKeys = listActivePresenceOwnerKeys();
  if (!activeKeys.length) {
    return [];
  }
  const placeholders = activeKeys.map(() => "?").join(", ");
  const seasonKey = seasonKeyFromDate(new Date());
  const rows = sqliteDb
    .prepare(`
      SELECT
        lower(u.username) AS owner_key,
        u.username AS username,
        COALESCE(p.avatar, '') AS avatar,
        COALESCE(rg.elo, p.score, 1200) AS score,
        sel.drome_id AS drome_id
      FROM users u
      LEFT JOIN player_profiles p
        ON p.owner_key = lower(u.username)
      LEFT JOIN ranked_global rg
        ON rg.owner_key = lower(u.username)
      LEFT JOIN ranked_drome_selection sel
        ON sel.owner_key = lower(u.username) AND sel.season_key = ?
      WHERE COALESCE(u.verified, 0) = 1
        AND lower(u.username) IN (${placeholders})
      ORDER BY COALESCE(rg.elo, p.score, 1200) DESC, lower(u.username) ASC
      LIMIT ?
    `)
    .all(seasonKey, ...activeKeys, limit);
  return rows.map((row, index) => {
    const ownerKey = normalizeUserKey(row?.owner_key || "", "");
    const presenceEntry = activePresenceByOwner.get(ownerKey) || null;
    return {
      rank: index + 1,
      username: String(row?.username || ownerKey || ""),
      ownerKey,
      avatar: String(row?.avatar || ""),
      score: Math.max(0, Number(row?.score || 0)),
      currentDrome: {
        id: normalizeDromeId(row?.drome_id || ""),
        name: dromeNameById(row?.drome_id || ""),
      },
      lastSeenAt: presenceEntry?.lastSeenAt || nowIso(),
    };
  });
}

function buildRuntimeMetricsSnapshot() {
  const nowValue = Date.now();
  const routes = {};
  runtimeMetrics.requestSamplesByRoute.forEach((samples, routeKey) => {
    pruneMetricSamples(routeKey, nowValue);
    const durations = samples.map((entry) => Math.max(0, Number(entry?.durationMs || 0))).sort((a, b) => a - b);
    routes[routeKey] = {
      samples: durations.length,
      p50: Math.round(percentileFromSorted(durations, 0.5) * 100) / 100,
      p95: Math.round(percentileFromSorted(durations, 0.95) * 100) / 100,
      p99: Math.round(percentileFromSorted(durations, 0.99) * 100) / 100,
    };
  });
  const perimRoute = routes["GET /api/perim/state"] || { samples: 0, p50: 0, p95: 0, p99: 0 };
  const errorsByRoute = {};
  runtimeMetrics.routeErrorCounts.forEach((count, routeKey) => {
    errorsByRoute[routeKey] = Number(count || 0);
  });
  return {
    generatedAt: nowIso(),
    windowMs: METRICS_WINDOW_MS,
    perimStateLatencyMs: perimRoute,
    routes,
    errorsByRoute,
    onlinePlayers: countActiveValidSessions(),
    activeRooms: {
      multiplayer: multiplayerRooms.size,
      trades: tradeRooms.size,
    },
    trades: {
      completed: Number(runtimeMetrics.tradeCompletedCount || 0),
      locksActive: tradeCardLocks.size,
    },
    cache: {
      hits: Number(runtimeMetrics.cache.hits || 0),
      misses: Number(runtimeMetrics.cache.misses || 0),
      invalidations: Number(runtimeMetrics.cache.invalidations || 0),
      buckets: {
        profile: userResponseCache.profile.size,
        scans: userResponseCache.scans.size,
        perim: userResponseCache.perim.size,
      },
      ttlMs: USER_CACHE_TTL_MS,
    },
    security: {
      turnstileConfigured: Boolean(TURNSTILE_SECRET_KEY),
      activeLoginBlocks: countActiveLoginBlocks(),
    },
    jobs: {
      perim: { ...runtimeMetrics.perimJobs },
      backup: { ...runtimeMetrics.backups },
    },
  };
}

function cacheRead(scopeMap, cacheKey, loader) {
  const nowValue = Date.now();
  const cached = scopeMap.get(cacheKey);
  if (cached && nowValue - Number(cached.at || 0) < USER_CACHE_TTL_MS) {
    runtimeMetrics.cache.hits += 1;
    return cached.value;
  }
  runtimeMetrics.cache.misses += 1;
  const value = loader();
  scopeMap.set(cacheKey, { at: nowValue, value });
  return value;
}

function invalidateUserCaches(usernameRaw = "", options = {}) {
  const key = normalizeUserKey(usernameRaw || "", "");
  const invalidateAll = Boolean(options.all) || !key;
  const scanDeckPrefix = `${key}:`;
  if (invalidateAll) {
    userResponseCache.profile.clear();
    userResponseCache.perim.clear();
    userResponseCache.scans.clear();
    runtimeMetrics.cache.invalidations += 1;
    return;
  }
  userResponseCache.profile.delete(key);
  userResponseCache.perim.delete(key);
  [...userResponseCache.scans.keys()].forEach((entryKey) => {
    if (String(entryKey).startsWith(scanDeckPrefix)) {
      userResponseCache.scans.delete(entryKey);
    }
  });
  runtimeMetrics.cache.invalidations += 1;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

function sendJson(response, statusCode, data) {
  const payload = JSON.stringify(data);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendFile(response, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  
  fs.createReadStream(filePath).pipe(response);
}

const CORS_ALLOWED_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => String(value || "").trim())
  .filter(Boolean);
const IS_PRODUCTION_ENV = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function isAllowedCorsOrigin(origin) {
  const normalized = String(origin || "").trim();
  if (!normalized) {
    return false;
  }
  if (CORS_ALLOWED_ORIGINS.includes(normalized)) {
    return true;
  }
  if (!IS_PRODUCTION_ENV) {
    if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(normalized)) {
      return true;
    }
    if (/^https?:\/\/localhost(?::\d+)?$/i.test(normalized)) {
      return true;
    }
    if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(normalized)) {
      return true;
    }
  }
  return false;
}

function applyCorsHeaders(request, response) {
  const origin = String(request?.headers?.origin || "").trim();
  if (!origin || !isAllowedCorsOrigin(origin)) {
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function applySecurityHeaders(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self' https://challenges.cloudflare.com https://libretranslate.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
  if (isHttpsRequest(request)) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function normalizeDeckName(name) {
  const trimmed = String(name || "").trim();
  return trimmed.replace(/[^a-zA-Z0-9 _-]+/g, "").replace(/\s+/g, "-").toLowerCase();
}

function getDeckFilePath(rawName) {
  // Obsolete function, retained interface for compatibility but no longer returns a file path
  return null;
}

const DECK_CARD_TYPES = ["creatures", "attacks", "battlegear", "locations", "mugic"];
const INVENTORY_MAX_COPIES = 3;
const SCANNER_KEYS = ["danian", "overworld", "underworld", "mipedian", "marrillian"];
const SCANNER_XP_THRESHOLDS = [0, 100, 350, 850];

function createEmptyCardBuckets() {
  return {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  };
}

function cloneCardBuckets(cards) {
  const out = createEmptyCardBuckets();
  DECK_CARD_TYPES.forEach((type) => {
    out[type] = Array.isArray(cards?.[type]) ? [...cards[type]] : [];
  });
  return out;
}

function countBucketCards(cards) {
  const counts = {};
  let total = 0;
  DECK_CARD_TYPES.forEach((type) => {
    const amount = Array.isArray(cards?.[type]) ? cards[type].length : 0;
    counts[type] = amount;
    total += amount;
  });
  return { counts, total };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function safeReadWorkbookFromFile(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  if (!isPathInside(ROOT_DIR, resolved)) {
    throw new Error("xlsx_path_forbidden");
  }
  if (!resolved.toLowerCase().endsWith(".xlsx")) {
    throw new Error("xlsx_extension_invalid");
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error("xlsx_not_file");
  }
  if (stat.size > XLSX_MAX_FILE_BYTES) {
    throw new Error(`xlsx_too_large:${stat.size}`);
  }
  return XLSX.readFile(resolved, {
    cellDates: false,
    dense: true,
    WTF: false,
  });
}

function isoFromMs(value) {
  return new Date(Number(value || 0)).toISOString();
}

function getPackageVersion() {
  try {
    const pkg = safeJsonParse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"), {});
    return String(pkg?.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function parseIsoToMs(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getClientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "");
  if (forwarded && TRUST_PROXY_HOPS > 0) {
    const chain = forwarded
      .split(",")
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (chain.length) {
      const index = Math.max(0, chain.length - TRUST_PROXY_HOPS - 1);
      return chain[index] || chain[0];
    }
  }
  const rawSocket = request.socket?.remoteAddress;
  return String(rawSocket || "unknown");
}

function buildClientFingerprint(request) {
  const explicit = String(request?.headers?.["x-device-fingerprint"] || "").trim();
  if (explicit) {
    return explicit.slice(0, 96);
  }
  const userAgent = String(request?.headers?.["user-agent"] || "").trim();
  if (!userAgent) {
    return "unknown";
  }
  return crypto.createHash("sha256").update(userAgent).digest("hex").slice(0, 24);
}

function parseCookies(request) {
  const header = String(request?.headers?.cookie || "");
  if (!header) {
    return {};
  }
  return header.split(";").reduce((acc, chunk) => {
    const eqIdx = chunk.indexOf("=");
    if (eqIdx <= 0) {
      return acc;
    }
    const key = chunk.slice(0, eqIdx).trim();
    const value = chunk.slice(eqIdx + 1).trim();
    if (!key) {
      return acc;
    }
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function isHttpsRequest(request) {
  const proto = String(request?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  if (proto.includes("https")) {
    return true;
  }
  return Boolean(request?.socket?.encrypted);
}

function buildSessionCookieHeader(request, token, expiresAtIso) {
  const secure = IS_PRODUCTION_ENV ? true : isHttpsRequest(request);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(String(token || ""))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    parts.push("Secure");
  }
  if (expiresAtIso) {
    parts.push(`Expires=${new Date(expiresAtIso).toUTCString()}`);
  }
  return parts.join("; ");
}

function clearSessionCookieHeader(request) {
  const secure = IS_PRODUCTION_ENV ? true : isHttpsRequest(request);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function getRequestSessionToken(request) {
  const cookies = parseCookies(request);
  const fromCookie = String(cookies?.[SESSION_COOKIE_NAME] || "").trim();
  if (fromCookie) {
    return fromCookie;
  }
  const authHeader = String(request?.headers?.authorization || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
}

function getAuthenticatedUserFromRequest(request) {
  const token = getRequestSessionToken(request);
  if (!token) {
    return null;
  }
  return loadUserByValidSessionToken(token);
}

const rateLimitState = new Map();
function applyRateLimit(request, response, bucket, options = {}) {
  const windowMs = Number(options.windowMs || 60 * 1000);
  const maxHits = Number(options.maxHits || 30);
  const key = `${bucket}:${getClientIp(request)}`;
  const now = nowMs();
  const current = rateLimitState.get(key);
  if (!current || now >= current.resetAt) {
    rateLimitState.set(key, {
      hits: 1,
      resetAt: now + windowMs,
    });
    return false;
  }
  if (current.hits >= maxHits) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    response.setHeader("Retry-After", String(retryAfterSeconds));
    sendJson(response, 429, {
      error: "Muitas requisicoes em pouco tempo. Aguarde alguns segundos e tente novamente.",
      retryAfterSeconds,
    });
    return true;
  }
  current.hits += 1;
  return false;
}

function applyRateLimitWithUser(request, response, bucket, userKeyRaw = "", options = {}) {
  const userKey = normalizeUserKey(userKeyRaw || "", "anonymous");
  const compositeBucket = `${bucket}:${userKey}`;
  return applyRateLimit(request, response, compositeBucket, options);
}

function legacyPasswordHash(passwordRaw) {
  return Buffer.from(String(passwordRaw || ""), "utf8").toString("base64").split("").reverse().join("");
}

function decodeLegacyPasswordHash(hashRaw) {
  const reversed = String(hashRaw || "").split("").reverse().join("");
  try {
    return Buffer.from(reversed, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function hashPasswordSecure(passwordRaw) {
  const password = String(passwordRaw || "");
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function safeStringEqual(leftRaw, rightRaw) {
  const left = Buffer.from(String(leftRaw || ""), "utf8");
  const right = Buffer.from(String(rightRaw || ""), "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function verifyPasswordAgainstStored(passwordRaw, storedHashRaw) {
  const password = String(passwordRaw || "");
  const storedHash = String(storedHashRaw || "");
  if (!password || !storedHash) {
    return { ok: false, needsUpgrade: false };
  }
  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 3) {
      return { ok: false, needsUpgrade: false };
    }
    const saltHex = String(parts[1] || "");
    const expectedHex = String(parts[2] || "");
    if (!/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(expectedHex)) {
      return { ok: false, needsUpgrade: false };
    }
    const digest = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
    return {
      ok: safeStringEqual(digest, expectedHex),
      needsUpgrade: false,
    };
  }
  const legacy = legacyPasswordHash(password);
  return {
    ok: safeStringEqual(legacy, storedHash),
    needsUpgrade: true,
  };
}

function buildSessionExpiryIso(fromMs = nowMs()) {
  return isoFromMs(fromMs + SESSION_TTL_MS);
}

function issueSessionForUserId(userId, options = {}) {
  if (!sqliteDb) {
    return null;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const issuedAt = nowIso();
  const expiresAt = buildSessionExpiryIso(nowMs());
  const clientIp = String(options.clientIp || "").trim();
  const clientFingerprint = String(options.clientFingerprint || "").trim();
  sqliteDb
    .prepare("UPDATE users SET session_token = ?, session_expires_at = ?, session_ip = ?, session_device = ?, last_login_at = ?, updated_at = ? WHERE id = ?")
    .run(token, expiresAt, clientIp, clientFingerprint, issuedAt, issuedAt, Number(userId));
  return {
    sessionToken: token,
    expiresAt,
  };
}

function clearSessionToken(token) {
  if (!sqliteDb || !token) {
    return;
  }
  sqliteDb
    .prepare("UPDATE users SET session_token = NULL, session_expires_at = NULL, updated_at = ? WHERE session_token = ?")
    .run(nowIso(), token);
}

function loadUserByValidSessionToken(token) {
  if (!sqliteDb || !token) {
    return null;
  }
  const user = sqliteDb
    .prepare("SELECT id, username, email, tribe, role, session_expires_at, session_ip, session_device, last_login_at FROM users WHERE session_token = ?")
    .get(token);
  if (!user) {
    return null;
  }
  const expiresAtMs = parseIsoToMs(user.session_expires_at);
  if (!expiresAtMs || nowMs() >= expiresAtMs) {
    clearSessionToken(token);
    return null;
  }
  return user;
}

function appendAuditLog(eventType, options = {}) {
  if (!sqliteDb) {
    return;
  }
  const severity = String(options.severity || "info").trim() || "info";
  const ownerKey = normalizeUserKey(options.ownerKey || "", "");
  const ipAddress = String(options.ipAddress || "").trim();
  const message = String(options.message || "").trim();
  const payload = options.payload && typeof options.payload === "object" ? options.payload : null;
  try {
    sqliteDb
      .prepare(`
        INSERT INTO audit_log (event_type, severity, owner_key, ip_address, message, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        String(eventType || "event"),
        severity,
        ownerKey,
        ipAddress,
        message,
        payload ? JSON.stringify(payload) : null,
        nowIso()
      );
  } catch (error) {
    console.warn(`[AUDIT] Falha ao gravar evento ${eventType}: ${error?.message || error}`);
  }
}

const authLoginFailureState = new Map();

function countActiveLoginBlocks() {
  const now = nowMs();
  let total = 0;
  authLoginFailureState.forEach((entry) => {
    if (Number(entry?.blockedUntilMs || 0) > now) {
      total += 1;
    }
  });
  return total;
}

function getLoginLockState(ipAddress, username) {
  const key = `${String(ipAddress || "unknown").trim()}::${normalizeUserKey(username || "", "anonymous")}`;
  const now = nowMs();
  const state = authLoginFailureState.get(key);
  if (!state) {
    return { key, blocked: false, retryAfterSeconds: 0 };
  }
  if (state.blockedUntilMs && now < state.blockedUntilMs) {
    return {
      key,
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntilMs - now) / 1000)),
    };
  }
  return { key, blocked: false, retryAfterSeconds: 0 };
}

function registerLoginFailure(ipAddress, username) {
  const key = `${String(ipAddress || "unknown").trim()}::${normalizeUserKey(username || "", "anonymous")}`;
  const current = authLoginFailureState.get(key) || { failures: 0, blockedUntilMs: 0 };
  const failures = Number(current.failures || 0) + 1;
  const penaltyMs = Math.min(30 * 60 * 1000, Math.pow(2, Math.max(0, failures - 2)) * 15 * 1000);
  const blockedUntilMs = nowMs() + penaltyMs;
  authLoginFailureState.set(key, { failures, blockedUntilMs });
  return { failures, blockedUntilMs, retryAfterSeconds: Math.max(1, Math.ceil(penaltyMs / 1000)) };
}

function clearLoginFailure(ipAddress, username) {
  const key = `${String(ipAddress || "unknown").trim()}::${normalizeUserKey(username || "", "anonymous")}`;
  authLoginFailureState.delete(key);
}

async function validateTurnstileToken(turnstileToken, clientIp) {
  if (!TURNSTILE_SECRET_KEY) {
    return { ok: false, error: "turnstile_not_configured" };
  }
  const token = String(turnstileToken || "").trim();
  if (!token) {
    return { ok: false, error: "turnstile_token_missing" };
  }
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: String(clientIp || "").trim(),
      }).toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      return { ok: false, error: "turnstile_invalid", details: payload };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "turnstile_verify_failed", details: String(error?.message || error) };
  }
}

function requireAuthenticatedUser(request, response) {
  const user = getAuthenticatedUserFromRequest(request);
  if (!user) {
    sendJson(response, 401, { error: "Sessao expirada ou invalida." });
    return null;
  }
  return user;
}

function requireAdminUser(request, response) {
  const user = requireAuthenticatedUser(request, response);
  if (!user) {
    return null;
  }
  const role = String(user.role || "").trim().toLowerCase();
  const legacyAdmin = normalizeUserKey(user.username) === "admin";
  if (role !== "admin" && !legacyAdmin) {
    sendJson(response, 403, { error: "Acesso restrito ao administrador." });
    return null;
  }
  if (role !== "admin" && legacyAdmin) {
    appendAuditLog("auth_admin_legacy_fallback", {
      severity: "warn",
      ownerKey: user.username,
      ipAddress: getClientIp(request),
      message: "Acesso admin permitido por fallback legado baseado em username.",
    });
  }
  return user;
}

function normalizeStrictUsernameCandidate(valueRaw = "") {
  return String(valueRaw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function isStrictUsernameValid(valueRaw = "") {
  const value = String(valueRaw || "").trim().toLowerCase();
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    return false;
  }
  return STRICT_USERNAME_REGEX.test(value);
}

function toStrictUsernameOrFallback(valueRaw = "", fallbackSeed = "player") {
  let base = normalizeStrictUsernameCandidate(valueRaw);
  if (base.length > USERNAME_MAX_LENGTH) {
    base = base.slice(0, USERNAME_MAX_LENGTH);
  }
  if (isStrictUsernameValid(base)) {
    return base;
  }
  const fallback = normalizeStrictUsernameCandidate(fallbackSeed);
  if (isStrictUsernameValid(fallback)) {
    return fallback;
  }
  const generated = `u${crypto.randomBytes(4).toString("hex")}`;
  return generated.slice(0, USERNAME_MAX_LENGTH);
}

function normalizeUserKey(value, fallback = "local-player") {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || fallback;
}

function updateOwnerKeyReferences(oldOwnerKeyRaw, newOwnerKeyRaw) {
  if (!sqliteDb) {
    return;
  }
  const oldOwnerKey = normalizeUserKey(oldOwnerKeyRaw || "", "");
  const newOwnerKey = normalizeUserKey(newOwnerKeyRaw || "", "");
  if (!oldOwnerKey || !newOwnerKey || oldOwnerKey === newOwnerKey) {
    return;
  }
  const keyColumns = new Set([
    "owner_key",
    "owner_key_shadow",
    "from_owner_key",
    "to_owner_key",
    "friend_key",
    "host_key",
    "guest_key",
    "codemaster_key",
    "challenger_key",
    "winner_key",
    "loser_key",
    "player_key",
    "user_key",
    "sender_key",
    "recipient_key",
  ]);
  const tables = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  for (const tableRow of tables) {
    const tableName = String(tableRow?.name || "").trim();
    if (!tableName || tableName.startsWith("sqlite_")) {
      continue;
    }
    const columns = sqliteDb.prepare(`PRAGMA table_info("${tableName.replace(/"/g, "\"\"")}")`).all();
    for (const columnRow of columns) {
      const columnName = String(columnRow?.name || "").trim();
      if (!keyColumns.has(columnName)) {
        continue;
      }
      sqliteDb
        .prepare(`UPDATE "${tableName.replace(/"/g, "\"\"")}" SET "${columnName.replace(/"/g, "\"\"")}" = ? WHERE "${columnName.replace(/"/g, "\"\"")}" = ?`)
        .run(newOwnerKey, oldOwnerKey);
    }
  }
}

function resolveAuthUsernameInput(rawUsername, options = {}) {
  const strict = Boolean(options.strict);
  const typedUsername = String(rawUsername || "").trim().toLowerCase();
  if (!typedUsername) {
    return { ok: false, username: "", error: "Username obrigatorio." };
  }
  if (strict && !isStrictUsernameValid(typedUsername)) {
    return {
      ok: false,
      username: "",
      error: `Username invalido. Use ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} caracteres [a-z0-9._-] sem separadores repetidos.`,
    };
  }
  if (!strict && isStrictUsernameValid(typedUsername)) {
    return { ok: true, username: typedUsername };
  }
  const aliasPayload = sqlGet(USERNAME_ALIAS_NAMESPACE, typedUsername);
  const mappedUsername = String(aliasPayload?.username || "").trim().toLowerCase();
  if (mappedUsername && isStrictUsernameValid(mappedUsername)) {
    return { ok: true, username: mappedUsername, aliasedFrom: typedUsername };
  }
  if (!strict) {
    return {
      ok: false,
      username: "",
      error: `Username invalido. Use ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} caracteres [a-z0-9._-].`,
    };
  }
  return { ok: true, username: typedUsername };
}

function migrateExistingUsernamesToStrictPolicy() {
  if (!sqliteDb) {
    return { changed: 0, aliases: 0 };
  }
  const rows = sqliteDb
    .prepare("SELECT id, username FROM users ORDER BY id ASC")
    .all();
  if (!rows.length) {
    return { changed: 0, aliases: 0 };
  }
  const used = new Set();
  const plans = [];
  for (const row of rows) {
    const current = String(row?.username || "").trim();
    const currentLower = current.toLowerCase();
    let candidate = toStrictUsernameOrFallback(currentLower, `player${Number(row?.id || 0)}`);
    if (candidate.length > USERNAME_MAX_LENGTH) {
      candidate = candidate.slice(0, USERNAME_MAX_LENGTH);
    }
    if (!isStrictUsernameValid(candidate)) {
      candidate = toStrictUsernameOrFallback(`user${Number(row?.id || 0)}`, `player${Number(row?.id || 0)}`);
    }
    if (used.has(candidate)) {
      const suffix = `-${Number(row?.id || 0)}`.slice(0, 8);
      const head = candidate.slice(0, Math.max(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH - suffix.length));
      candidate = `${head}${suffix}`.slice(0, USERNAME_MAX_LENGTH);
      if (!isStrictUsernameValid(candidate)) {
        candidate = `u${Number(row?.id || 0)}`.slice(0, USERNAME_MAX_LENGTH);
      }
    }
    while (used.has(candidate) || !isStrictUsernameValid(candidate)) {
      candidate = `u${crypto.randomBytes(4).toString("hex")}`.slice(0, USERNAME_MAX_LENGTH);
    }
    used.add(candidate);
    if (candidate !== currentLower) {
      plans.push({
        id: Number(row?.id || 0),
        from: current,
        fromLower: currentLower,
        to: candidate,
        oldOwnerKey: normalizeUserKey(current, ""),
        newOwnerKey: normalizeUserKey(candidate, ""),
      });
    }
  }
  if (!plans.length) {
    return { changed: 0, aliases: 0 };
  }
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    let aliasCount = 0;
    for (const plan of plans) {
      sqliteDb
        .prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = ?")
        .run(plan.to, nowIso(), plan.id);
      updateOwnerKeyReferences(plan.oldOwnerKey, plan.newOwnerKey);
      sqlSet(USERNAME_ALIAS_NAMESPACE, plan.fromLower, {
        username: plan.to,
        migratedAt: nowIso(),
      });
      aliasCount += 1;
    }
    sqliteDb.exec("COMMIT");
    console.warn(`[AUTH] Migracao de usernames aplicada para politica estrita. usuarios=${plans.length}`);
    return { changed: plans.length, aliases: aliasCount };
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    console.error(`[AUTH] Falha ao migrar usernames para politica estrita: ${error?.message || error}`);
    return { changed: 0, aliases: 0 };
  }
}

function generateSeatToken() {
  return crypto.randomBytes(16).toString("hex");
}

function generateMultiplayerRoomId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `rm_${crypto.randomBytes(10).toString("hex")}`;
    if (!multiplayerRooms.has(candidate)) {
      return candidate;
    }
  }
  return `rm_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function generateScanEntryId() {
  return `scan_${crypto.randomBytes(10).toString("hex")}`;
}

function isValidRulesMode(value) {
  return value === "casual" || value === "competitive" || value === "1v1";
}

function normalizeMatchType(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === MATCH_TYPE_RANKED_DROME) {
    return MATCH_TYPE_RANKED_DROME;
  }
  if (token === MATCH_TYPE_CODEMASTER_CHALLENGE) {
    return MATCH_TYPE_CODEMASTER_CHALLENGE;
  }
  return MATCH_TYPE_CASUAL_MULTIPLAYER;
}

const RULESET_VALIDATION = {
  casual: {
    exactCounts: null,
  },
  competitive: {
    exactCounts: {
      creatures: 6,
      battlegear: 6,
      mugic: 6,
      locations: 10,
      attacks: 20,
    },
  },
  "1v1": {
    exactCounts: {
      creatures: 1,
      battlegear: 1,
      mugic: 1,
      locations: 1,
      attacks: 20,
    },
  },
};

const RARITY_COPY_LIMITS = {
  common: 3,
  uncommon: 3,
  rare: 2,
  "super rare": 2,
  "ultra rare": 1,
};

function normalizedCardName(card) {
  return String(card?.normalizedName || card?.name || "").trim().toLowerCase();
}

function validateDeckForRulesMode(deckData, rulesMode = "competitive") {
  const modeKey = isValidRulesMode(rulesMode) ? rulesMode : "competitive";
  const ruleset = RULESET_VALIDATION[modeKey] || RULESET_VALIDATION.competitive;
  const battleDeck = toBattleDeckFromStoredDeck(deckData);
  const counts = {
    creatures: battleDeck.creatures.length,
    battlegear: battleDeck.battlegear.length,
    mugic: battleDeck.mugic.length,
    locations: battleDeck.locations.length,
    attacks: battleDeck.attacks.length,
  };
  const errors = [];

  if (ruleset.exactCounts) {
    Object.entries(ruleset.exactCounts).forEach(([type, required]) => {
      if (Number(counts[type] || 0) !== Number(required)) {
        errors.push(`${type} deve ter ${required} cartas (atual: ${counts[type] || 0}).`);
      }
    });
  }

  const seenCopies = new Map();
  Object.entries(battleDeck).forEach(([type, cards]) => {
    cards.forEach((card) => {
      const key = `${type}:${normalizedCardName(card)}`;
      if (!seenCopies.has(key)) {
        seenCopies.set(key, { card, count: 0 });
      }
      seenCopies.get(key).count += 1;
    });
  });
  seenCopies.forEach(({ card, count }) => {
    const rarityKey = String(card?.rarity || "").trim().toLowerCase();
    const limit = Number.isFinite(Number(RARITY_COPY_LIMITS[rarityKey])) ? RARITY_COPY_LIMITS[rarityKey] : 2;
    if (count > limit) {
      errors.push(`${card?.name || "Carta"}: limite ${limit}, atual ${count}.`);
    }
  });

  const totalAttackBP = battleDeck.attacks.reduce((sum, card) => sum + Number(card?.stats?.bp || 0), 0);
  if (totalAttackBP > 20) {
    errors.push(`Pontuacao total de Ataques excede 20 BP (atual: ${totalAttackBP}).`);
  }

  return {
    ok: errors.length === 0,
    errors,
    counts,
    mode: modeKey,
  };
}

function getActiveRankedBanlistSnapshot() {
  if (!sqliteDb) {
    return null;
  }
  const header = sqliteDb
    .prepare(`
      SELECT banlist_id, name, description, is_active, updated_at
      FROM ranked_banlists
      WHERE is_active = 1
      ORDER BY updated_at DESC, banlist_id DESC
      LIMIT 1
    `)
    .get();
  if (!header) {
    return null;
  }
  const banlistId = Number(header?.banlist_id || 0);
  const rows = sqliteDb
    .prepare(`
      SELECT bc.card_id, COALESCE(cc.name, bc.card_id) AS card_name
      FROM ranked_banlist_cards bc
      LEFT JOIN card_catalog cc ON cc.id = bc.card_id
      WHERE bc.banlist_id = ?
      ORDER BY lower(COALESCE(cc.name, bc.card_id)) ASC, bc.card_id ASC
    `)
    .all(banlistId);
  const cards = rows
    .map((row) => ({
      cardId: String(row?.card_id || "").trim(),
      cardName: String(row?.card_name || row?.card_id || "").trim(),
    }))
    .filter((entry) => entry.cardId);
  return {
    banlistId,
    name: String(header?.name || ""),
    description: String(header?.description || ""),
    isActive: Number(header?.is_active || 0) === 1,
    updatedAt: String(header?.updated_at || ""),
    cards,
  };
}

function findBannedCardsInDeck(deckData, banlistSnapshot) {
  if (!banlistSnapshot || !Array.isArray(banlistSnapshot.cards) || !banlistSnapshot.cards.length) {
    return [];
  }
  const battleDeck = toBattleDeckFromStoredDeck(deckData);
  const bannedMap = new Map(
    banlistSnapshot.cards
      .map((entry) => [String(entry?.cardId || "").trim(), String(entry?.cardName || entry?.cardId || "").trim()])
      .filter(([cardId]) => cardId)
  );
  const matches = [];
  Object.entries(battleDeck || {}).forEach(([type, cards]) => {
    if (!Array.isArray(cards)) {
      return;
    }
    cards.forEach((card) => {
      const cardId = String(card?.id || "").trim();
      if (!cardId || !bannedMap.has(cardId)) {
        return;
      }
      matches.push({
        cardId,
        cardName: String(card?.name || bannedMap.get(cardId) || cardId),
        cardType: String(type || card?.type || ""),
      });
    });
  });
  return matches;
}

function validateDeckAgainstRankedBanlist(deckData, banlistSnapshot) {
  const bannedCards = findBannedCardsInDeck(deckData, banlistSnapshot);
  return {
    ok: bannedCards.length === 0,
    bannedCards,
  };
}

function getLibraryCardIndexes() {
  const byId = new Map();
  const byName = new Map();
  (library?.cards || []).forEach((card) => {
    const idKey = String(card?.id || "").trim();
    if (idKey) {
      byId.set(idKey, card);
    }
    const nameKey = String(card?.name || "").trim().toLowerCase();
    if (nameKey && !byName.has(nameKey)) {
      byName.set(nameKey, card);
    }
  });
  return { byId, byName };
}

function resolveDeckCardReference(entry, indexes) {
  if (!entry) {
    return null;
  }
  if (typeof entry === "string") {
    return indexes.byId.get(entry) || indexes.byName.get(entry.trim().toLowerCase()) || null;
  }
  if (typeof entry === "object") {
    const idKey = String(entry.cardId || entry.id || "").trim();
    if (idKey && indexes.byId.has(idKey)) {
      return indexes.byId.get(idKey);
    }
    const nameKey = String(entry.name || "").trim().toLowerCase();
    if (nameKey && indexes.byName.has(nameKey)) {
      return indexes.byName.get(nameKey);
    }
  }
  return null;
}

function toBattleDeckFromStoredDeck(deckData) {
  const indexes = getLibraryCardIndexes();
  const out = {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  };
  const cards = deckData?.cards && typeof deckData.cards === "object" ? deckData.cards : {};
  Object.keys(out).forEach((type) => {
    const list = Array.isArray(cards[type]) ? cards[type] : [];
    out[type] = list
      .map((entry) => {
        const baseCard = resolveDeckCardReference(entry, indexes);
        if (!baseCard) {
          return null;
        }
        if (type === "creatures" && entry && typeof entry === "object" && entry.variant) {
          const variant = normalizeCreatureVariant(entry.variant);
          if (!variant) {
            return baseCard;
          }
          const stats = baseCard.stats || {};
          return {
            ...baseCard,
            stats: {
              ...stats,
              energy: Number(stats.energy || 0) + Number(variant.energyDelta || 0),
              courage: Number(stats.courage || 0) + Number(variant.courageDelta || 0),
              power: Number(stats.power || 0) + Number(variant.powerDelta || 0),
              wisdom: Number(stats.wisdom || 0) + Number(variant.wisdomDelta || 0),
              speed: Number(stats.speed || 0) + Number(variant.speedDelta || 0),
            },
            scanVariant: variant,
            scanEntryId: String(entry.scanEntryId || ""),
          };
        }
        return baseCard;
      })
      .filter(Boolean);
  });
  return out;
}

function listDeckFileNames() {
  if (isSqlV2Ready()) {
    const rows = sqliteDb
      .prepare("SELECT deck_key FROM deck_headers ORDER BY deck_key")
      .all();
    return rows.map((row) => `${String(row?.deck_key || "").trim()}.json`).filter(Boolean);
  }
  if (sqliteDb) {
    const rows = sqlList("decks");
    return rows.map((row) => `${row.entity_key}.json`);
  }
  return [];
}

function readDeckFromSqlV2(deckKey) {
  if (!isSqlV2Ready()) {
    return null;
  }
  const key = normalizeDeckName(deckKey);
  if (!key) {
    return null;
  }
  const header = sqliteDb
    .prepare("SELECT deck_key, owner_key, name, mode, created_at, updated_at FROM deck_headers WHERE deck_key = ?")
    .get(key);
  if (!header) {
    return null;
  }
  const cardsRows = sqliteDb
    .prepare(`
      SELECT card_type, slot_index, card_id, scan_entry_id, variant_json
      FROM deck_cards
      WHERE deck_key = ?
      ORDER BY card_type, slot_index
    `)
    .all(key);
  const cards = createEmptyCardBuckets();
  cardsRows.forEach((row) => {
    const type = String(row?.card_type || "");
    if (!cards[type]) {
      return;
    }
    const cardId = String(row?.card_id || "").trim();
    if (!cardId) {
      return;
    }
    if (type === "creatures") {
      const scanEntryId = String(row?.scan_entry_id || "").trim();
      const variant = normalizeCreatureVariant(parseJsonText(row?.variant_json, null));
      if (scanEntryId || variant) {
        const creatureEntry = { cardId };
        if (scanEntryId) {
          creatureEntry.scanEntryId = scanEntryId;
        }
        if (variant) {
          creatureEntry.variant = variant;
        }
        cards[type].push(creatureEntry);
      } else {
        cards[type].push(cardId);
      }
      return;
    }
    cards[type].push(cardId);
  });
  return {
    name: String(header?.name || key),
    owner: String(header?.owner_key || ""),
    createdAt: String(header?.created_at || nowIso()),
    updatedAt: String(header?.updated_at || nowIso()),
    mode: String(header?.mode || "competitive"),
    cards,
  };
}

function readDeckFileByName(fileName) {
  const name = fileName.replace(/\.json$/i, "");
  const normalized = normalizeDeckName(name);
  if (!normalized) {
    return null;
  }
  if (isSqlV2Ready()) {
    return readDeckFromSqlV2(normalized);
  }
  const fromDb = sqlGet("decks", normalized);
  if (fromDb && typeof fromDb === "object") {
    return fromDb;
  }
  return null;
}

function migrateDeckFilesToSqlIfNeeded() {
  if (!sqliteDb) {
    return;
  }
  const existing = sqlList("decks");
  if (existing.length) {
    return;
  }
  // DEPRECATED: No longer reading from file system.
}

function writeDeckStored(normalizedDeckName, deckData) {
  if (normalizedDeckName) {
    if (isSqlV2Ready()) {
      const key = normalizeDeckName(normalizedDeckName);
      if (!key) {
        return;
      }
      const owner = deckOwnerKey(deckData);
      const createdAt = String(deckData?.createdAt || nowIso());
      const updatedAt = String(deckData?.updatedAt || nowIso());
      const mode = String(deckData?.mode || "competitive");
      const name = String(deckData?.name || key);
      const cards = deckData?.cards && typeof deckData.cards === "object" ? deckData.cards : {};
      sqliteDb.exec("BEGIN IMMEDIATE");
      try {
        sqliteDb.prepare(`
          INSERT INTO deck_headers (deck_key, owner_key, is_ownerless_legacy, name, mode, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(deck_key) DO UPDATE SET
            owner_key = excluded.owner_key,
            is_ownerless_legacy = excluded.is_ownerless_legacy,
            name = excluded.name,
            mode = excluded.mode,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `).run(key, owner, owner ? 0 : 1, name, mode, createdAt, updatedAt);
        sqliteDb.prepare("DELETE FROM deck_cards WHERE deck_key = ?").run(key);
        const insertCard = sqliteDb.prepare(`
          INSERT INTO deck_cards (deck_key, card_type, slot_index, owner_key_shadow, card_id, scan_entry_id, variant_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        DECK_CARD_TYPES.forEach((type) => {
          const list = Array.isArray(cards[type]) ? cards[type] : [];
          list.forEach((entry, slotIndex) => {
            const cardId = deckCardIdFromEntry(type, entry);
            if (!cardId) {
              return;
            }
            let scanEntryId = null;
            let variantJson = null;
            if (type === "creatures" && entry && typeof entry === "object") {
              const scanId = deckCreatureScanEntryId(entry);
              if (scanId) {
                scanEntryId = scanId;
              }
              const normalizedVariant = normalizeCreatureVariant(entry.variant);
              if (normalizedVariant) {
                variantJson = JSON.stringify(normalizedVariant);
              }
            }
            insertCard.run(
              key,
              type,
              Number(slotIndex),
              owner,
              cardId,
              scanEntryId,
              variantJson
            );
          });
        });
        sqliteDb.exec("COMMIT");
        return;
      } catch (error) {
        try {
          sqliteDb.exec("ROLLBACK");
        } catch {}
        console.error(`[DB] Falha ao salvar deck SQL v2 (${key}): ${error?.message || error}`);
        throw error;
      }
      return;
    }
    sqlSet("decks", normalizedDeckName, deckData);
  }
}

function deleteDeckStored(normalizedDeckName) {
  if (normalizedDeckName) {
    if (isSqlV2Ready()) {
      const key = normalizeDeckName(normalizedDeckName);
      if (key) {
        sqliteDb.exec("BEGIN IMMEDIATE");
        try {
          sqliteDb.prepare("DELETE FROM deck_cards WHERE deck_key = ?").run(key);
          sqliteDb.prepare("DELETE FROM deck_headers WHERE deck_key = ?").run(key);
          sqliteDb.exec("COMMIT");
          return;
        } catch (error) {
          try {
            sqliteDb.exec("ROLLBACK");
          } catch {}
          console.error(`[DB] Falha ao remover deck SQL v2 (${key}): ${error?.message || error}`);
          throw error;
        }
      }
      return;
    }
    sqlDelete("decks", normalizedDeckName);
  }
}

function deckOwnerKey(deckData) {
  const rawOwner = String(deckData?.owner || deckData?.username || "").trim();
  if (!rawOwner) {
    return "";
  }
  return normalizeUserKey(rawOwner);
}

function claimOwnerlessDeckForUser(deckKeyRaw, requesterKeyRaw = "") {
  if (!isSqlV2Ready()) {
    return false;
  }
  const deckKey = normalizeDeckName(deckKeyRaw);
  const requesterKey = normalizeUserKey(requesterKeyRaw, "");
  if (!deckKey || !requesterKey) {
    return false;
  }
  const header = sqliteDb
    .prepare("SELECT owner_key, is_ownerless_legacy FROM deck_headers WHERE deck_key = ?")
    .get(deckKey);
  if (!header) {
    return false;
  }
  const ownerKey = String(header?.owner_key || "");
  const isLegacyOwnerless = Number(header?.is_ownerless_legacy || 0) === 1;
  if (ownerKey || !isLegacyOwnerless) {
    return false;
  }
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    const updatedAt = nowIso();
    sqliteDb
      .prepare("UPDATE deck_headers SET owner_key = ?, is_ownerless_legacy = 0, updated_at = ? WHERE deck_key = ?")
      .run(requesterKey, updatedAt, deckKey);
    sqliteDb
      .prepare("UPDATE deck_cards SET owner_key_shadow = ? WHERE deck_key = ?")
      .run(requesterKey, deckKey);
    sqliteDb.exec("COMMIT");
    console.log(`[DECK] Deck legado ownerless ${deckKey} atribuido para ${requesterKey}.`);
    return true;
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    console.error(`[DECK] Falha ao atribuir owner no deck ${deckKey}: ${error?.message || error}`);
    return false;
  }
}

function buildScansSeedFromDecks(ownerKey = "") {
  const targetOwner = ownerKey ? normalizeUserKey(ownerKey) : "";
  const buckets = createEmptyCardBuckets();
  const fileNames = listDeckFileNames();
  fileNames.forEach((fileName) => {
    const deck = readDeckFileByName(fileName);
    if (!deck || typeof deck !== "object") {
      return;
    }
    const owner = deckOwnerKey(deck);
    if (targetOwner && owner !== targetOwner) {
      return;
    }
    const battleDeck = toBattleDeckFromStoredDeck(deck);
    DECK_CARD_TYPES.forEach((type) => {
      (battleDeck[type] || []).forEach((card) => {
        if (card?.id) {
          buckets[type].push(card.id);
        }
      });
    });
  });
  return buckets;
}

function scanEntryToCardId(type, entry) {
  if (typeof entry === "string") {
    return String(entry || "").trim();
  }
  if (entry && typeof entry === "object") {
    if (typeof entry.cardId === "string" && entry.cardId.trim()) {
      return entry.cardId.trim();
    }
    if (type === "creatures" && typeof entry.id === "string" && entry.id.trim()) {
      return entry.id.trim();
    }
  }
  return "";
}

function deckCardIdFromEntry(type, entry) {
  if (type === "creatures") {
    return scanEntryToCardId(type, entry);
  }
  if (typeof entry === "string") {
    return String(entry || "").trim();
  }
  if (entry && typeof entry === "object") {
    if (typeof entry.cardId === "string" && entry.cardId.trim()) {
      return entry.cardId.trim();
    }
    if (typeof entry.id === "string" && entry.id.trim()) {
      return entry.id.trim();
    }
  }
  return "";
}

function deckCreatureScanEntryId(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  return String(entry.scanEntryId || "").trim();
}

function creatureVariantStarValue(rawVariant) {
  const variant = rawVariant && typeof rawVariant === "object" ? rawVariant : {};
  const sum = Number(variant.energyDelta || 0)
    + Number(variant.courageDelta || 0)
    + Number(variant.powerDelta || 0)
    + Number(variant.wisdomDelta || 0)
    + Number(variant.speedDelta || 0);
  const normalized = (sum + 25) / 10;
  const halfStep = Math.round(normalized * 2) / 2;
  return Math.max(0, Math.min(5, halfStep));
}

function creatureVariantStarsLabel(rawVariant) {
  const stars = creatureVariantStarValue(rawVariant);
  return stars.toFixed(1);
}

function creatureVariantBadge(rawVariant) {
  return `${creatureVariantStarsLabel(rawVariant)}?`;
}

function normalizeCreatureVariant(rawVariant) {
  if (!rawVariant || typeof rawVariant !== "object") {
    return null;
  }
  const variant = {
    energyDelta: Number(rawVariant.energyDelta || 0),
    courageDelta: Number(rawVariant.courageDelta || 0),
    powerDelta: Number(rawVariant.powerDelta || 0),
    wisdomDelta: Number(rawVariant.wisdomDelta || 0),
    speedDelta: Number(rawVariant.speedDelta || 0),
    perfect: Boolean(rawVariant.perfect),
  };
  const keys = ["energyDelta", "courageDelta", "powerDelta", "wisdomDelta", "speedDelta"];
  keys.forEach((key) => {
    if (!Number.isFinite(variant[key])) {
      variant[key] = 0;
    }
    variant[key] = Math.round(variant[key] / 5) * 5;
  });
  variant.energyDelta = Math.max(-5, Math.min(5, variant.energyDelta));
  variant.courageDelta = Math.max(-5, Math.min(5, variant.courageDelta));
  variant.powerDelta = Math.max(-5, Math.min(5, variant.powerDelta));
  variant.wisdomDelta = Math.max(-5, Math.min(5, variant.wisdomDelta));
  variant.speedDelta = Math.max(-5, Math.min(5, variant.speedDelta));
  variant.perfect = variant.perfect || (
    variant.energyDelta === 5
    && variant.courageDelta === 5
    && variant.powerDelta === 5
    && variant.wisdomDelta === 5
    && variant.speedDelta === 5
  );
  variant.stars = creatureVariantStarValue(variant);
  variant.starsLabel = creatureVariantStarsLabel(variant);
  return variant;
}

function normalizeScansEntryByType(type, entry) {
  const cardId = scanEntryToCardId(type, entry);
  if (!cardId) {
    return null;
  }
  const scanEntryId = typeof entry?.scanEntryId === "string" && entry.scanEntryId.trim()
    ? entry.scanEntryId.trim()
    : generateScanEntryId();
  const out = {
    cardId,
    scanEntryId,
    obtainedAt: entry?.obtainedAt ? String(entry.obtainedAt) : nowIso(),
  };
  if (entry?.source) {
    out.source = String(entry.source);
  }
  if (type === "creatures") {
    const variant = normalizeCreatureVariant(entry?.variant);
    if (variant) {
      out.variant = variant;
    }
  }
  return out;
}

function countCardEntriesByType(entries, type) {
  const counts = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const cardId = scanEntryToCardId(type, entry);
    if (!cardId) {
      return;
    }
    counts.set(cardId, (counts.get(cardId) || 0) + 1);
  });
  return counts;
}

function countDeckEntriesByType(entries, type) {
  const counts = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const cardId = deckCardIdFromEntry(type, entry);
    if (!cardId) {
      return;
    }
    counts.set(cardId, (counts.get(cardId) || 0) + 1);
  });
  return counts;
}

function trimCardsToInventoryCap(cards, cap = INVENTORY_MAX_COPIES) {
  const out = createEmptyCardBuckets();
  DECK_CARD_TYPES.forEach((type) => {
    const counts = new Map();
    const inputList = Array.isArray(cards?.[type]) ? cards[type] : [];
    inputList.forEach((entry) => {
      const cardId = scanEntryToCardId(type, entry);
      if (!cardId) {
        return;
      }
      const nextCount = (counts.get(cardId) || 0) + 1;
      if (nextCount > cap) {
        return;
      }
      counts.set(cardId, nextCount);
      out[type].push(entry);
    });
  });
  return out;
}

function normalizeScansPayload(payload) {
  const cards = createEmptyCardBuckets();
  const source = payload?.cards && typeof payload.cards === "object" ? payload.cards : payload;
  DECK_CARD_TYPES.forEach((type) => {
    const input = Array.isArray(source?.[type]) ? source[type] : [];
    cards[type] = input
      .map((entry) => normalizeScansEntryByType(type, entry))
      .filter(Boolean);
  });
  return trimCardsToInventoryCap(cards, INVENTORY_MAX_COPIES);
}

function buildCardsFromCountMap(countMap, templateEntriesByCardId = new Map()) {
  const cards = createEmptyCardBuckets();
  DECK_CARD_TYPES.forEach((type) => {
    const templates = templateEntriesByCardId.get(type) || new Map();
    countMap[type].forEach((amount, cardId) => {
      for (let idx = 0; idx < amount; idx += 1) {
        const templateList = templates.get(cardId) || [];
        if (templateList[idx]) {
          cards[type].push(templateList[idx]);
        } else {
          cards[type].push(cardId);
        }
      }
    });
  });
  return cards;
}

function buildScansCountMap(cards) {
  const out = {
    creatures: new Map(),
    attacks: new Map(),
    battlegear: new Map(),
    locations: new Map(),
    mugic: new Map(),
  };
  DECK_CARD_TYPES.forEach((type) => {
    const counts = countCardEntriesByType(cards?.[type], type);
    counts.forEach((value, cardId) => {
      out[type].set(cardId, value);
    });
  });
  return out;
}

function removeAllocatedDeckCardsFromScans(cards, ownerKey) {
  const baseCounts = buildScansCountMap(cards);
  const templateEntriesByType = new Map();
  DECK_CARD_TYPES.forEach((type) => {
    const map = new Map();
    (Array.isArray(cards?.[type]) ? cards[type] : []).forEach((entry) => {
      const cardId = scanEntryToCardId(type, entry);
      if (!cardId) {
        return;
      }
      if (!map.has(cardId)) {
        map.set(cardId, []);
      }
      map.get(cardId).push(entry);
    });
    templateEntriesByType.set(type, map);
  });
  const allocated = buildDeckAllocationByKey("", ownerKey);
  allocated.forEach((amount, key) => {
    const separator = key.indexOf(":");
    if (separator <= 0) {
      return;
    }
    const type = key.slice(0, separator);
    const cardId = key.slice(separator + 1);
    if (!baseCounts[type]) {
      return;
    }
    const current = baseCounts[type].get(cardId) || 0;
    baseCounts[type].set(cardId, Math.max(0, current - amount));
  });
  return buildCardsFromCountMap(baseCounts, templateEntriesByType);
}

function normalizeScansFilePayload(payload) {
  const createdAt = payload?.createdAt || nowIso();
  const updatedAt = payload?.updatedAt || nowIso();
  const source = payload?.source || "manual";
  const schemaVersion = Number(payload?.schemaVersion || 1);
  const players = {};

  if (payload?.players && typeof payload.players === "object") {
    Object.entries(payload.players).forEach(([username, value]) => {
      const key = normalizeUserKey(username);
      const cards = normalizeScansPayload(value);
      players[key] = { cards };
    });
  } else if (payload?.cards || payload?.creatures || payload?.attacks || payload?.battlegear || payload?.locations || payload?.mugic) {
    const cards = normalizeScansPayload(payload);
    players["local-player"] = { cards };
  }

  if (!Object.keys(players).length) {
    players["local-player"] = {
      cards: trimCardsToInventoryCap(buildScansSeedFromDecks("local-player"), INVENTORY_MAX_COPIES),
    };
  }

  return {
    schemaVersion,
    createdAt,
    updatedAt,
    source,
    players,
  };
}

function loadScansData() {
  if (isSqlV2Ready()) {
    const players = {};
    const rows = sqliteDb
      .prepare(`
        SELECT owner_key, card_type, card_id, scan_entry_id, variant_json, obtained_at, source, created_at
        FROM scan_entries
        ORDER BY owner_key ASC, card_type ASC, rowid ASC
      `)
      .all();
    rows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key);
      if (!players[ownerKey]) {
        players[ownerKey] = { cards: createEmptyCardBuckets() };
      }
      const type = String(row?.card_type || "");
      if (!DECK_CARD_TYPES.includes(type)) {
        return;
      }
      const cardId = String(row?.card_id || "").trim();
      if (!cardId) {
        return;
      }
      const obtainedAt = row?.obtained_at
        ? String(row.obtained_at)
        : row?.created_at
          ? String(row.created_at)
          : nowIso();
      const baseEntry = {
        cardId,
        scanEntryId: String(row?.scan_entry_id || generateScanEntryId()),
        obtainedAt,
      };
      if (row?.source) {
        baseEntry.source = String(row.source);
      }
      if (type === "creatures") {
        const variant = normalizeCreatureVariant(parseJsonText(row?.variant_json, null));
        if (variant) {
          baseEntry.variant = variant;
        }
      }
      players[ownerKey].cards[type].push(baseEntry);
    });
    if (!Object.keys(players).length) {
      players["local-player"] = {
        cards: trimCardsToInventoryCap(buildScansSeedFromDecks("local-player"), INVENTORY_MAX_COPIES),
      };
    }
    Object.keys(players).forEach((ownerKey) => {
      players[ownerKey].cards = trimCardsToInventoryCap(players[ownerKey].cards, INVENTORY_MAX_COPIES);
    });
    return {
      schemaVersion: 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "sql_v2_scan_entries",
      players,
    };
  }
  const fromSql = sqlGet("scans", "state");
  if (fromSql && typeof fromSql === "object") {
    return normalizeScansFilePayload(fromSql);
  }
  // Fallback recovery if needed
  try {
    const parsed = JSON.parse(fs.readFileSync(SCANS_FILE, "utf8"));
    let body = normalizeScansFilePayload(parsed);
    sqlSet("scans", "state", body);
    return body;
  } catch {
    const cards = trimCardsToInventoryCap(buildScansSeedFromDecks("local-player"), INVENTORY_MAX_COPIES);
    const body = {
      schemaVersion: 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "decks_seed",
      players: {
        "local-player": { cards },
      },
    };
    sqlSet("scans", "state", body);
    return body;
  }
}

function writeScansData(payload, source = "manual") {
  const normalized = normalizeScansFilePayload(payload);
  const body = {
    schemaVersion: 2,
    createdAt: normalized.createdAt || nowIso(),
    updatedAt: nowIso(),
    source,
    players: normalized.players,
  };
  if (isSqlV2Ready()) {
    sqliteDb.exec("BEGIN IMMEDIATE");
    try {
      sqliteDb.prepare("DELETE FROM scan_entries").run();
      const insertScanEntry = sqliteDb.prepare(`
        INSERT INTO scan_entries (scan_entry_id, owner_key, card_type, card_id, variant_json, obtained_at, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      Object.entries(body.players || {}).forEach(([ownerRaw, value]) => {
        const ownerKey = normalizeUserKey(ownerRaw);
        DECK_CARD_TYPES.forEach((type) => {
          const list = Array.isArray(value?.cards?.[type]) ? value.cards[type] : [];
          list.forEach((entry, index) => {
            const cardId = scanEntryToCardId(type, entry);
            if (!cardId) {
              return;
            }
            let scanEntryId = "";
            let variantJson = null;
            let obtainedAt = null;
            let sourceValue = null;
            const normalizedEntry = normalizeScansEntryByType(type, entry);
            scanEntryId = String(normalizedEntry?.scanEntryId || generateScanEntryId());
            obtainedAt = normalizedEntry?.obtainedAt ? String(normalizedEntry.obtainedAt) : nowIso();
            sourceValue = normalizedEntry?.source ? String(normalizedEntry.source) : null;
            if (type === "creatures") {
              const variant = normalizeCreatureVariant(normalizedEntry?.variant);
              variantJson = variant ? JSON.stringify(variant) : null;
            }
            insertScanEntry.run(
              scanEntryId,
              ownerKey,
              type,
              cardId,
              variantJson,
              obtainedAt,
              sourceValue,
              nowIso()
            );
          });
        });
      });
      sqliteDb.exec("COMMIT");
      invalidateUserCaches("", { all: true });
      return body;
    } catch (error) {
      try {
        sqliteDb.exec("ROLLBACK");
      } catch {}
      console.error(`[DB] Falha ao persistir scans SQL v2: ${error?.message || error}`);
      throw error;
    }
  }
  sqlSet("scans", "state", body);
  invalidateUserCaches("", { all: true });
  return body;
}

function getScansCardsForUser(scansData, username, seedIfMissing = true) {
  const key = normalizeUserKey(username);
  let changed = false;
  if (!scansData.players[key] && seedIfMissing) {
    scansData.players[key] = {
      cards: trimCardsToInventoryCap(buildScansSeedFromDecks(key), INVENTORY_MAX_COPIES),
    };
    changed = true;
  }
  if (!scansData.players[key]) {
    const cards = createEmptyCardBuckets();
    scansData.players[key] = { cards };
    return { key, cards, changed: true };
  }
  const rawCards = scansData.players[key]?.cards;
  const hasAllBuckets = DECK_CARD_TYPES.every((type) => Array.isArray(rawCards?.[type]));
  if (!hasAllBuckets) {
    scansData.players[key].cards = trimCardsToInventoryCap(normalizeScansPayload(scansData.players[key] || {}), INVENTORY_MAX_COPIES);
    changed = true;
  }
  return { key, cards: scansData.players[key].cards, changed };
}

function isOwnerExcludedFromSetPurge(ownerKeyRaw) {
  return normalizeUserKey(ownerKeyRaw, "") === "admin";
}

function getPurgeUserStat(statsMap, ownerKeyRaw) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey || isOwnerExcludedFromSetPurge(ownerKey)) {
    return null;
  }
  if (!statsMap.has(ownerKey)) {
    statsMap.set(ownerKey, {
      username: ownerKey,
      scansRemoved: 0,
      deckCardsRemoved: 0,
    });
  }
  return statsMap.get(ownerKey);
}

function buildSetPurgeReport(options = {}) {
  const userStatsMap = options.userStatsMap instanceof Map ? options.userStatsMap : new Map();
  const users = Array.from(userStatsMap.values())
    .map((entry) => ({
      username: entry.username,
      scansRemoved: Number(entry.scansRemoved || 0),
      deckCardsRemoved: Number(entry.deckCardsRemoved || 0),
      totalRemoved: Number(entry.scansRemoved || 0) + Number(entry.deckCardsRemoved || 0),
    }))
    .filter((entry) => entry.totalRemoved > 0)
    .sort((a, b) => b.totalRemoved - a.totalRemoved || a.username.localeCompare(b.username));
  const totals = users.reduce((acc, entry) => {
    acc.scans += entry.scansRemoved;
    acc.deckCards += entry.deckCardsRemoved;
    return acc;
  }, { scans: 0, deckCards: 0 });
  return {
    ok: true,
    mode: options.mode || "unknown",
    allowedSets: ["DOP", "ZOTH", "SS"],
    removed: {
      scanEntries: totals.scans,
      deckCards: totals.deckCards,
      total: totals.scans + totals.deckCards,
    },
    affectedUsersCount: users.length,
    affectedUsers: users,
    generatedAt: nowIso(),
  };
}

function purgeDisallowedSetsFromSqlV2(userStatsMap) {
  const statsMap = userStatsMap instanceof Map ? userStatsMap : new Map();
  const scanRows = sqliteDb
    .prepare("SELECT scan_entry_id, owner_key, card_type, card_id FROM scan_entries")
    .all();
  const deckRows = sqliteDb
    .prepare(`
      SELECT dc.deck_key, dc.card_type, dc.slot_index, dc.card_id,
             COALESCE(NULLIF(dh.owner_key, ''), NULLIF(dc.owner_key_shadow, '')) AS owner_key
      FROM deck_cards dc
      LEFT JOIN deck_headers dh ON dh.deck_key = dc.deck_key
    `)
    .all();

  const deleteScanEntry = sqliteDb.prepare("DELETE FROM scan_entries WHERE scan_entry_id = ?");
  const deleteDeckCard = sqliteDb.prepare("DELETE FROM deck_cards WHERE deck_key = ? AND card_type = ? AND slot_index = ?");
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    scanRows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key || "", "");
      if (!ownerKey || isOwnerExcludedFromSetPurge(ownerKey)) {
        return;
      }
      if (isPlayerCardSetAllowedByCardId(row?.card_id || "")) {
        return;
      }
      deleteScanEntry.run(String(row?.scan_entry_id || ""));
      const stat = getPurgeUserStat(statsMap, ownerKey);
      if (stat) {
        stat.scansRemoved += 1;
      }
    });
    deckRows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key || "", "");
      if (!ownerKey || isOwnerExcludedFromSetPurge(ownerKey)) {
        return;
      }
      if (isPlayerCardSetAllowedByCardId(row?.card_id || "")) {
        return;
      }
      deleteDeckCard.run(String(row?.deck_key || ""), String(row?.card_type || ""), Number(row?.slot_index || 0));
      const stat = getPurgeUserStat(statsMap, ownerKey);
      if (stat) {
        stat.deckCardsRemoved += 1;
      }
    });
    sqliteDb.exec("COMMIT");
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function purgeDisallowedSetsFromScansState(scansState, userStatsMap) {
  const statsMap = userStatsMap instanceof Map ? userStatsMap : new Map();
  let changed = false;
  Object.entries(scansState?.players || {}).forEach(([ownerRaw, value]) => {
    const ownerKey = normalizeUserKey(ownerRaw, "");
    if (!ownerKey || isOwnerExcludedFromSetPurge(ownerKey)) {
      return;
    }
    const cards = value?.cards && typeof value.cards === "object" ? value.cards : createEmptyCardBuckets();
    const nextCards = createEmptyCardBuckets();
    DECK_CARD_TYPES.forEach((type) => {
      const list = Array.isArray(cards[type]) ? cards[type] : [];
      let removedByType = 0;
      list.forEach((entry) => {
        const cardId = scanEntryToCardId(type, entry);
        if (!cardId || !isPlayerCardSetAllowedByCardId(cardId)) {
          removedByType += 1;
          return;
        }
        nextCards[type].push(entry);
      });
      if (removedByType > 0) {
        changed = true;
        const stat = getPurgeUserStat(statsMap, ownerKey);
        if (stat) {
          stat.scansRemoved += removedByType;
        }
      }
    });
    scansState.players[ownerKey] = { cards: nextCards };
  });
  return changed;
}

function purgeDisallowedSetsFromDeckStoreLegacy(userStatsMap) {
  const statsMap = userStatsMap instanceof Map ? userStatsMap : new Map();
  let changed = false;
  const deckRows = sqlList("decks");
  deckRows.forEach((row) => {
    const deckKey = String(row?.entity_key || "").trim();
    if (!deckKey) {
      return;
    }
    const deck = sqlGet("decks", deckKey);
    if (!deck || typeof deck !== "object") {
      return;
    }
    const ownerKey = deckOwnerKey(deck);
    if (!ownerKey || isOwnerExcludedFromSetPurge(ownerKey)) {
      return;
    }
    const deckCards = deck?.cards && typeof deck.cards === "object" ? deck.cards : {};
    const nextCards = createEmptyCardBuckets();
    let removedFromDeck = 0;
    DECK_CARD_TYPES.forEach((type) => {
      const list = Array.isArray(deckCards[type]) ? deckCards[type] : [];
      list.forEach((entry) => {
        const cardId = deckCardIdFromEntry(type, entry);
        if (!cardId || !isPlayerCardSetAllowedByCardId(cardId)) {
          removedFromDeck += 1;
          return;
        }
        nextCards[type].push(entry);
      });
    });
    if (!removedFromDeck) {
      return;
    }
    deck.cards = nextCards;
    deck.updatedAt = nowIso();
    writeDeckStored(deckKey, deck);
    const stat = getPurgeUserStat(statsMap, ownerKey);
    if (stat) {
      stat.deckCardsRemoved += removedFromDeck;
    }
    changed = true;
  });
  return changed;
}

function purgeDisallowedPlayerCardSets() {
  const userStatsMap = new Map();
  if (isSqlV2Ready()) {
    purgeDisallowedSetsFromSqlV2(userStatsMap);
  } else {
    const scans = loadScansData();
    const scansChanged = purgeDisallowedSetsFromScansState(scans, userStatsMap);
    if (scansChanged) {
      writeScansData(scans, "admin_purge_disallowed_sets");
    }
    purgeDisallowedSetsFromDeckStoreLegacy(userStatsMap);
  }
  invalidateUserCaches("", { all: true });
  return buildSetPurgeReport({
    mode: isSqlV2Ready() ? "sql_v2" : "legacy_json",
    userStatsMap,
  });
}

function listAvailableCreatureCopiesForCard(scansData, username, cardId, editingDeck = "") {
  const normalizedCardId = String(cardId || "").trim();
  if (!normalizedCardId) {
    return [];
  }
  const ownerKey = normalizeUserKey(username || "local-player");
  const scansCards = getScansCardsForUser(scansData, ownerKey, true).cards;
  const availableData = buildAvailableScansForDeck(editingDeck, ownerKey);
  const availableEntries = Array.isArray(availableData?.available?.creatures) ? availableData.available.creatures : [];
  const allUserEntries = Array.isArray(scansCards?.creatures) ? scansCards.creatures : [];

  const takenEntryIds = new Set();
  availableEntries.forEach((entry) => {
    if (typeof entry === "object" && entry?.scanEntryId) {
      takenEntryIds.add(String(entry.scanEntryId));
    }
  });

  const result = [];
  allUserEntries.forEach((entry, index) => {
    const resolvedCardId = scanEntryToCardId("creatures", entry);
    if (resolvedCardId !== normalizedCardId) {
      return;
    }
    const scanEntryId = typeof entry === "object" && entry?.scanEntryId
      ? String(entry.scanEntryId)
      : `legacy_${normalizedCardId}_${index}`;
    if (!takenEntryIds.has(scanEntryId)) {
      return;
    }
    result.push({
      scanEntryId,
      cardId: normalizedCardId,
      variant: normalizeCreatureVariant(entry?.variant),
      obtainedAt: entry?.obtainedAt || null,
      source: entry?.source || null,
    });
  });
  return result;
}

function buildDeckAllocationByKey(excludedDeckNormalized = "", username = "local-player") {
  const ownerKey = normalizeUserKey(username);
  const allocated = new Map();
  const creatureScanEntryIds = new Set();
  const fileNames = listDeckFileNames();
  fileNames.forEach((fileName) => {
    const normalized = String(fileName).replace(/\.json$/i, "").toLowerCase();
    if (excludedDeckNormalized && normalized === excludedDeckNormalized) {
      return;
    }
    const deck = readDeckFileByName(fileName);
    if (!deck || typeof deck !== "object") {
      return;
    }
    const owner = deckOwnerKey(deck);
    if (owner && owner !== ownerKey) {
      return;
    }
    DECK_CARD_TYPES.forEach((type) => {
      const list = Array.isArray(deck?.cards?.[type]) ? deck.cards[type] : [];
      list.forEach((entry) => {
        const cardId = deckCardIdFromEntry(type, entry);
        if (!cardId) {
          return;
        }
        if (type === "creatures") {
          const scanEntryId = deckCreatureScanEntryId(entry);
          if (scanEntryId) {
            creatureScanEntryIds.add(scanEntryId);
          }
        }
        const key = `${type}:${cardId}`;
        allocated.set(key, (allocated.get(key) || 0) + 1);
      });
    });
  });
  return {
    allocated,
    creatureScanEntryIds,
  };
}

function countDeckCardsByKey(deckData) {
  const counts = new Map();
  DECK_CARD_TYPES.forEach((type) => {
    const list = Array.isArray(deckData?.cards?.[type]) ? deckData.cards[type] : [];
    countDeckEntriesByType(list, type).forEach((value, cardId) => {
      const key = `${type}:${cardId}`;
      counts.set(key, (counts.get(key) || 0) + value);
    });
  });
  return counts;
}

function buildAvailableScansForDeck(editingDeckName = "", username = "local-player") {
  const scans = loadScansData();
  const { key: ownerKey, cards: userCards } = getScansCardsForUser(scans, username, true);

  // Clone the user's full inventory
  const available = createEmptyCardBuckets();
  DECK_CARD_TYPES.forEach((type) => {
    available[type] = (userCards[type] || []).map((entry) =>
      typeof entry === "object" ? JSON.parse(JSON.stringify(entry)) : entry
    );
  });

  // Build a flat availableCounts map keyed as "type:cardId"
  const availableCounts = new Map();
  DECK_CARD_TYPES.forEach((type) => {
    countCardEntriesByType(available[type], type).forEach((count, cardId) => {
      availableCounts.set(`${type}:${cardId}`, count);
    });
  });

  return { scans, available, ownerKey, userCards, availableCounts };
}

function validateDeckAgainstScans(deckData, editingDeckName = "", username = "local-player") {
  const scans = loadScansData();
  const { cards: userCards } = getScansCardsForUser(scans, username, true);
  const availableCounts = buildInventoryCountMap(userCards);
  const requiredCounts = countDeckCardsByKey(deckData);
  const errors = [];
  requiredCounts.forEach((candidateAmount, key) => {
    const availableAmount = availableCounts.get(key) || 0;
    if (candidateAmount > availableAmount) {
      const separator = key.indexOf(":");
      const type = separator > 0 ? key.slice(0, separator) : "card";
      const cardId = separator > 0 ? key.slice(separator + 1) : key;
      const card = library?.cards?.find((entry) => entry.id === cardId);
      const label = card?.name || cardId;
      errors.push(`${label} (${type}) excede inventario de scans.`);
    }
  });
  return {
    ok: errors.length === 0,
    errors,
  };
}

function buildDeckDiffCounts(previousDeck, nextDeck) {
  const consume = new Map();
  const release = new Map();
  const consumeEntries = [];
  const releaseEntries = [];

  DECK_CARD_TYPES.forEach((type) => {
    const prevList = Array.isArray(previousDeck?.cards?.[type]) ? previousDeck.cards[type] : [];
    const nextList = Array.isArray(nextDeck?.cards?.[type]) ? nextDeck.cards[type] : [];

    // Match by scanEntryId first for creatures.
    if (type === "creatures") {
      const prevByScan = new Map();
      const nextByScan = new Map();
      prevList.forEach((entry) => {
        const scanEntryId = deckCreatureScanEntryId(entry);
        if (scanEntryId) {
          prevByScan.set(scanEntryId, entry);
        }
      });
      nextList.forEach((entry) => {
        const scanEntryId = deckCreatureScanEntryId(entry);
        if (scanEntryId) {
          nextByScan.set(scanEntryId, entry);
        }
      });
      prevByScan.forEach((entry, scanEntryId) => {
        if (!nextByScan.has(scanEntryId)) {
          const cardId = deckCardIdFromEntry(type, entry);
          if (cardId) {
            const key = `${type}:${cardId}`;
            release.set(key, (release.get(key) || 0) + 1);
            releaseEntries.push({ type, cardId, entry });
          }
        }
      });
      nextByScan.forEach((entry, scanEntryId) => {
        if (!prevByScan.has(scanEntryId)) {
          const cardId = deckCardIdFromEntry(type, entry);
          if (cardId) {
            const key = `${type}:${cardId}`;
            consume.set(key, (consume.get(key) || 0) + 1);
            consumeEntries.push({ type, cardId, entry });
          }
        }
      });
    }

    // Handle non-scan creature entries and all other types by card id counts.
    const prevCountsByCard = new Map();
    const nextCountsByCard = new Map();
    prevList.forEach((entry) => {
      const cardId = deckCardIdFromEntry(type, entry);
      if (!cardId) {
        return;
      }
      if (type === "creatures" && deckCreatureScanEntryId(entry)) {
        return;
      }
      prevCountsByCard.set(cardId, (prevCountsByCard.get(cardId) || 0) + 1);
    });
    nextList.forEach((entry) => {
      const cardId = deckCardIdFromEntry(type, entry);
      if (!cardId) {
        return;
      }
      if (type === "creatures" && deckCreatureScanEntryId(entry)) {
        return;
      }
      nextCountsByCard.set(cardId, (nextCountsByCard.get(cardId) || 0) + 1);
    });
    const allCardIds = new Set([...prevCountsByCard.keys(), ...nextCountsByCard.keys()]);
    allCardIds.forEach((cardId) => {
      const prevAmount = prevCountsByCard.get(cardId) || 0;
      const nextAmount = nextCountsByCard.get(cardId) || 0;
      const delta = nextAmount - prevAmount;
      if (!delta) {
        return;
      }
      const key = `${type}:${cardId}`;
      if (delta > 0) {
        consume.set(key, (consume.get(key) || 0) + delta);
        let remaining = delta;
        nextList.forEach((entry) => {
          if (remaining <= 0) {
            return;
          }
          if (deckCardIdFromEntry(type, entry) !== cardId) {
            return;
          }
          if (type === "creatures" && deckCreatureScanEntryId(entry)) {
            return;
          }
          consumeEntries.push({ type, cardId, entry });
          remaining -= 1;
        });
      } else {
        const releaseAmount = Math.abs(delta);
        release.set(key, (release.get(key) || 0) + releaseAmount);
        let remaining = releaseAmount;
        prevList.forEach((entry) => {
          if (remaining <= 0) {
            return;
          }
          if (deckCardIdFromEntry(type, entry) !== cardId) {
            return;
          }
          if (type === "creatures" && deckCreatureScanEntryId(entry)) {
            return;
          }
          releaseEntries.push({ type, cardId, entry });
          remaining -= 1;
        });
      }
    });
  });

  return { consume, release, consumeEntries, releaseEntries };
}

function buildInventoryCountMap(cards) {
  const countMap = new Map();
  DECK_CARD_TYPES.forEach((type) => {
    (cards[type] || []).forEach((entry) => {
      const cardId = scanEntryToCardId(type, entry);
      if (!cardId) {
        return;
      }
      const key = `${type}:${cardId}`;
      countMap.set(key, (countMap.get(key) || 0) + 1);
    });
  });
  return countMap;
}

function canReleaseCardsToInventory(cards, releaseCounts, cap = INVENTORY_MAX_COPIES) {
  const current = buildInventoryCountMap(cards);
  const errors = [];
  releaseCounts.forEach((amount, key) => {
    const currentAmount = current.get(key) || 0;
    if (currentAmount + amount > cap) {
      const separator = key.indexOf(":");
      const type = separator > 0 ? key.slice(0, separator) : "card";
      const cardId = separator > 0 ? key.slice(separator + 1) : key;
      const card = library?.cards?.find((entry) => entry.id === cardId);
      const label = card?.name || cardId;
      errors.push(`${label} (${type}) sem espaco no inventario (max ${cap}).`);
    }
  });
  return {
    ok: errors.length === 0,
    errors,
  };
}

function applyDeckInventoryTransfer(cards, previousDeck, nextDeck) {
  const nextCards = cloneCardBuckets(cards);
  const { release, consumeEntries, releaseEntries } = buildDeckDiffCounts(previousDeck, nextDeck);

  const releaseValidation = canReleaseCardsToInventory(nextCards, release, INVENTORY_MAX_COPIES);
  if (!releaseValidation.ok) {
    return releaseValidation;
  }

  consumeEntries.forEach((payload) => {
    const type = payload.type;
    const cardId = payload.cardId;
    const entry = payload.entry;
    if (!nextCards[type]) {
      return;
    }
    if (type === "creatures") {
      const scanEntryId = deckCreatureScanEntryId(entry);
      if (scanEntryId) {
        const targetIndex = nextCards[type].findIndex((candidate) => deckCreatureScanEntryId(candidate) === scanEntryId);
        if (targetIndex >= 0) {
          nextCards[type].splice(targetIndex, 1);
          return;
        }
      }
    }
    const targetIndex = nextCards[type].findIndex((candidate) => scanEntryToCardId(type, candidate) === cardId);
    if (targetIndex >= 0) {
      nextCards[type].splice(targetIndex, 1);
    }
  });

  releaseEntries.forEach((payload) => {
    const type = payload.type;
    const cardId = payload.cardId;
    const entry = payload.entry;
    if (!nextCards[type]) {
      return;
    }
    if (type === "creatures") {
      const normalized = normalizeScansEntryByType(type, entry);
      if (normalized) {
        nextCards[type].push(normalized);
      } else {
        nextCards[type].push(cardId);
      }
      return;
    }
    const normalized = normalizeScansEntryByType(type, entry);
    nextCards[type].push(normalized || cardId);
  });

  return {
    ok: true,
    cards: trimCardsToInventoryCap(nextCards, INVENTORY_MAX_COPIES),
  };
}

function releaseDeckCardsToInventoryWithCap(cards, deckToRelease, cap = INVENTORY_MAX_COPIES) {
  const nextCards = cloneCardBuckets(cards);
  const countMap = buildInventoryCountMap(nextCards);
  const releaseDeck = deckToRelease && typeof deckToRelease === "object" ? deckToRelease : { cards: {} };
  const breakdown = {};
  DECK_CARD_TYPES.forEach((type) => {
    breakdown[type] = { returned: 0, skippedByCap: 0 };
  });
  let returnedCount = 0;
  let skippedByCapCount = 0;

  DECK_CARD_TYPES.forEach((type) => {
    const entries = Array.isArray(releaseDeck?.cards?.[type]) ? releaseDeck.cards[type] : [];
    entries.forEach((entry) => {
      const cardId = deckCardIdFromEntry(type, entry);
      if (!cardId) {
        return;
      }
      const key = `${type}:${cardId}`;
      const currentAmount = countMap.get(key) || 0;
      if (currentAmount >= cap) {
        skippedByCapCount += 1;
        breakdown[type].skippedByCap += 1;
        return;
      }
      const normalized = normalizeScansEntryByType(type, entry);
      if (type === "creatures") {
        nextCards[type].push(normalized || cardId);
      } else {
        nextCards[type].push(normalized || cardId);
      }
      countMap.set(key, currentAmount + 1);
      returnedCount += 1;
      breakdown[type].returned += 1;
    });
  });

  return {
    ok: true,
    cards: trimCardsToInventoryCap(nextCards, cap),
    returnedCount,
    skippedByCapCount,
    breakdown,
  };
}

const MECHANICS_DECK_FAMILIES = [
  { id: "stat", label: "Stat Buff-Debuff", slug: "STAT" },
  { id: "element", label: "Element Control", slug: "ELEMENT" },
  { id: "damage", label: "Damage-Heal", slug: "DAMAGE" },
  { id: "mugic", label: "Mugic Control", slug: "MUGIC" },
  { id: "keywords", label: "Combat Keywords", slug: "KEYWORDS" },
  { id: "target", label: "Target-Retarget", slug: "TARGET" },
  { id: "challenge", label: "Challenge-Engage", slug: "CHALLENGE" },
  { id: "movement", label: "Movement-Position", slug: "MOVEMENT" },
  { id: "attack", label: "Attack Interaction", slug: "ATTACK" },
  { id: "resource", label: "Resource-Counter", slug: "RESOURCE" },
  { id: "discard", label: "Discard-Shuffle-Swap", slug: "DISCARD" },
  { id: "conditional", label: "Conditional-Triggered", slug: "CONDITIONAL" },
];

const MECHANICS_FAMILY_KIND_PATTERNS = {
  stat: [
    /stat/i,
    /discipline/i,
    /courage|power|wisdom|speed|energy/i,
    /modifier/i,
  ],
  element: [
    /element/i,
    /fire|air|earth|water/i,
  ],
  damage: [
    /damage/i,
    /heal/i,
    /prevent/i,
    /reflect/i,
  ],
  mugic: [
    /mugic/i,
    /mugician/i,
    /negateMugic/i,
  ],
  keywords: [
    /keyword/i,
    /invisibility/i,
    /intimidate/i,
    /hive/i,
    /elementproof/i,
  ],
  target: [
    /target/i,
    /retarget/i,
    /redirect/i,
    /swapBattlegear/i,
  ],
  challenge: [
    /challenge/i,
    /engage/i,
    /infect/i,
    /suppressTarget/i,
  ],
  movement: [
    /move/i,
    /relocate/i,
    /adjacent/i,
    /location/i,
  ],
  attack: [
    /attack/i,
    /strike/i,
    /bp/i,
  ],
  resource: [
    /counter/i,
    /cost/i,
    /resource/i,
    /draw/i,
    /scry/i,
  ],
  discard: [
    /discard/i,
    /shuffle/i,
    /swap/i,
    /deck/i,
    /returnFromDiscard/i,
    /searchDeck/i,
  ],
  conditional: [
    /conditional/i,
    /beginCombat/i,
    /on[A-Z]/,
    /if/i,
    /when/i,
  ],
};

const MECHANICS_DECK_TYPE_COUNTS = Object.freeze({
  creatures: 6,
  battlegear: 6,
  mugic: 6,
  locations: 10,
  attacks: 20,
});

const MECHANICS_DECK_PRIMARY_MINIMUM = Object.freeze({
  creatures: 2,
  battlegear: 2,
  mugic: 2,
  locations: 3,
  attacks: 2,
});

const mechanicsDeckGenerationReports = new Map();

function mechanicsDeckRunId() {
  return `mech_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isMechanicsEligibleCard(card) {
  const cardId = String(card?.id || "").trim();
  if (!cardId) {
    return false;
  }
  if (!isPlayerCardSetAllowedByCardId(cardId)) {
    return false;
  }
  return Array.isArray(card?.parsedEffects) && card.parsedEffects.length > 0;
}

function collectEffectKindsDeep(node, collector, depth = 0) {
  if (!node || depth > 10) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => collectEffectKindsDeep(entry, collector, depth + 1));
    return;
  }
  if (typeof node !== "object") {
    return;
  }
  const kind = String(node.kind || "").trim();
  if (kind) {
    collector.add(kind);
  }
  Object.keys(node).forEach((key) => {
    if (key === "kind") {
      return;
    }
    collectEffectKindsDeep(node[key], collector, depth + 1);
  });
}

function collectCardEffectKinds(card) {
  const out = new Set();
  collectEffectKindsDeep(card?.parsedEffects || [], out, 0);
  return out;
}

function resolveMechanicsFamiliesForKinds(kindSet) {
  const families = new Set();
  if (!(kindSet instanceof Set) || !kindSet.size) {
    return families;
  }
  kindSet.forEach((kind) => {
    Object.entries(MECHANICS_FAMILY_KIND_PATTERNS).forEach(([familyId, patterns]) => {
      if (!Array.isArray(patterns) || !patterns.length) {
        return;
      }
      if (patterns.some((pattern) => pattern.test(kind))) {
        families.add(familyId);
      }
    });
  });
  return families;
}

function mechanicsDeckCardCopyLimit(card) {
  const rarityKey = String(card?.rarity || "").trim().toLowerCase();
  const rarityLimit = Number(RARITY_COPY_LIMITS?.[rarityKey]);
  if (Number.isFinite(rarityLimit) && rarityLimit > 0) {
    return rarityLimit;
  }
  return 2;
}

function mechanicsAttackBp(card) {
  const raw = Number(card?.stats?.bp || 0);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.round(raw));
}

function buildMechanicsDeckPools() {
  const cards = Array.isArray(library?.cards) ? library.cards : [];
  const byType = {
    creatures: [],
    battlegear: [],
    mugic: [],
    locations: [],
    attacks: [],
  };
  const byFamily = {};
  MECHANICS_DECK_FAMILIES.forEach((family) => {
    byFamily[family.id] = {
      creatures: [],
      battlegear: [],
      mugic: [],
      locations: [],
      attacks: [],
    };
  });

  cards.forEach((card) => {
    const type = String(card?.type || "").trim().toLowerCase();
    if (!byType[type]) {
      return;
    }
    if (!isMechanicsEligibleCard(card)) {
      return;
    }
    const kindSet = collectCardEffectKinds(card);
    if (!kindSet.size) {
      return;
    }
    byType[type].push(card);
    const families = resolveMechanicsFamiliesForKinds(kindSet);
    families.forEach((familyId) => {
      if (byFamily[familyId] && Array.isArray(byFamily[familyId][type])) {
        byFamily[familyId][type].push(card);
      }
    });
  });

  Object.keys(byType).forEach((type) => {
    byType[type].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "en"));
  });
  Object.keys(byFamily).forEach((familyId) => {
    Object.keys(byFamily[familyId]).forEach((type) => {
      byFamily[familyId][type].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "en"));
    });
  });
  return { byType, byFamily };
}

function buildMechanicsCapacityMapForOwner(ownerKey) {
  const owner = normalizeUserKey(ownerKey || "admin");
  const availableData = buildAvailableScansForDeck("", owner);
  const capacity = new Map();
  const availableCounts = availableData?.availableCounts instanceof Map ? availableData.availableCounts : new Map();
  availableCounts.forEach((amount, key) => {
    capacity.set(String(key), Math.max(0, Number(amount || 0)));
  });
  return capacity;
}

function cloneMechanicsCapacityMap(sourceMap) {
  const out = new Map();
  if (!(sourceMap instanceof Map)) {
    return out;
  }
  sourceMap.forEach((value, key) => {
    out.set(String(key), Math.max(0, Number(value || 0)));
  });
  return out;
}

function uniqueCardsById(cards) {
  const out = [];
  const seen = new Set();
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId || seen.has(cardId)) {
      return;
    }
    seen.add(cardId);
    out.push(card);
  });
  return out;
}

function pickMechanicsCardsForType(options = {}) {
  const type = String(options.type || "");
  const required = Math.max(0, Number(options.required || 0));
  const primaryMinimum = Math.max(0, Number(options.primaryMinimum || 0));
  const capacityMap = options.capacityMap instanceof Map ? options.capacityMap : new Map();
  const preferred = uniqueCardsById(options.preferredCards || []);
  const fallback = uniqueCardsById(options.fallbackCards || []);
  const bpCap = Number.isFinite(Number(options.attackBpCap)) ? Number(options.attackBpCap) : 20;
  const bpState = options.bpState && typeof options.bpState === "object" ? options.bpState : { used: 0 };
  const selected = [];
  const selectedCountById = new Map();
  let primaryPicked = 0;

  const rankedPreferred = [...preferred];
  const rankedFallback = fallback.filter((card) => !rankedPreferred.some((candidate) => candidate.id === card.id));
  const isAttack = type === "attacks";
  const attackSort = (a, b) => {
    const aBp = mechanicsAttackBp(a);
    const bBp = mechanicsAttackBp(b);
    if (aBp !== bBp) {
      return aBp - bBp;
    }
    return String(a?.name || "").localeCompare(String(b?.name || ""), "en");
  };
  if (isAttack) {
    rankedPreferred.sort(attackSort);
    rankedFallback.sort(attackSort);
  }

  const tryAddCard = (card, countAsPrimary) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) {
      return false;
    }
    const key = `${type}:${cardId}`;
    const remaining = Number(capacityMap.get(key) || 0);
    if (remaining <= 0) {
      return false;
    }
    const currentCount = Number(selectedCountById.get(cardId) || 0);
    const perDeckLimit = mechanicsDeckCardCopyLimit(card);
    if (currentCount >= perDeckLimit) {
      return false;
    }
    if (isAttack) {
      const bpCost = mechanicsAttackBp(card);
      if (bpState.used + bpCost > bpCap) {
        return false;
      }
      bpState.used += bpCost;
    }
    selected.push(cardId);
    selectedCountById.set(cardId, currentCount + 1);
    capacityMap.set(key, remaining - 1);
    if (countAsPrimary) {
      primaryPicked += 1;
    }
    return true;
  };

  const fillFromPool = (cardsPool, goalCount, countAsPrimary = false) => {
    if (!Array.isArray(cardsPool) || !cardsPool.length) {
      return;
    }
    for (let pass = 0; pass < INVENTORY_MAX_COPIES && selected.length < required; pass += 1) {
      for (const card of cardsPool) {
        if (selected.length >= required) {
          return;
        }
        if (goalCount > 0 && countAsPrimary && primaryPicked >= goalCount) {
          return;
        }
        const cardId = String(card?.id || "").trim();
        const currentCount = Number(selectedCountById.get(cardId) || 0);
        if (currentCount > pass) {
          continue;
        }
        if (tryAddCard(card, countAsPrimary)) {
          if (goalCount > 0 && countAsPrimary && primaryPicked >= goalCount) {
            return;
          }
        }
      }
    }
  };

  const maxPrimaryPossible = rankedPreferred.reduce((sum, card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) {
      return sum;
    }
    const key = `${type}:${cardId}`;
    const remaining = Number(capacityMap.get(key) || 0);
    return sum + Math.max(0, Math.min(remaining, mechanicsDeckCardCopyLimit(card)));
  }, 0);
  const primaryGoal = Math.min(required, primaryMinimum, maxPrimaryPossible);
  fillFromPool(rankedPreferred, primaryGoal, true);
  fillFromPool(rankedPreferred, 0, false);
  fillFromPool(rankedFallback, 0, false);

  if (selected.length !== required) {
    return {
      ok: false,
      error: `Sem cartas suficientes para ${type} (${selected.length}/${required}).`,
      selected,
      primaryPicked,
    };
  }
  if (primaryPicked < primaryGoal) {
    return {
      ok: false,
      error: `Nao foi possivel atingir o nucleo tematico em ${type} (${primaryPicked}/${primaryGoal}).`,
      selected,
      primaryPicked,
    };
  }
  return {
    ok: true,
    selected,
    primaryPicked,
  };
}

function countDeckCardsByTypeAndId(deckData) {
  const out = new Map();
  DECK_CARD_TYPES.forEach((type) => {
    const list = Array.isArray(deckData?.cards?.[type]) ? deckData.cards[type] : [];
    list.forEach((entry) => {
      const cardId = deckCardIdFromEntry(type, entry);
      if (!cardId) {
        return;
      }
      const key = `${type}:${cardId}`;
      out.set(key, (out.get(key) || 0) + 1);
    });
  });
  return out;
}

function ensureOwnerInventoryForDeck(ownerKey, deckName, deckData, sourceTag = "admin_mechanics_autoboost") {
  const owner = normalizeUserKey(ownerKey, "");
  if (!owner) {
    return { ok: false, error: "owner_invalido" };
  }
  const normalizedDeckName = normalizeDeckName(deckName || "");
  const existingDeck = normalizedDeckName ? readDeckFileByName(`${normalizedDeckName}.json`) : null;
  const scans = loadScansData();
  const ownerData = getScansCardsForUser(scans, owner, true);
  const inventory = cloneCardBuckets(ownerData.cards);
  const inventoryCountByType = {};
  DECK_CARD_TYPES.forEach((type) => {
    inventoryCountByType[type] = countCardEntriesByType(inventory[type], type);
  });
  const availableData = buildAvailableScansForDeck(normalizedDeckName, owner);
  const availableCounts = availableData.availableCounts instanceof Map ? availableData.availableCounts : new Map();
  const diff = buildDeckDiffCounts(existingDeck || { cards: {} }, deckData);
  const boosted = {
    creatures: 0,
    attacks: 0,
    battlegear: 0,
    mugic: 0,
    locations: 0,
  };

  let inventoryChanged = false;
  diff.consume.forEach((requiredAmount, key) => {
    const separator = key.indexOf(":");
    if (separator <= 0) {
      return;
    }
    const type = key.slice(0, separator);
    const cardId = key.slice(separator + 1);
    if (!DECK_CARD_TYPES.includes(type)) {
      return;
    }
    const availableAmount = Number(availableCounts.get(key) || 0);
    let missing = Math.max(0, Number(requiredAmount || 0) - availableAmount);
    if (!missing) {
      return;
    }
    const inventoryCounts = inventoryCountByType[type] || new Map();
    while (missing > 0) {
      const currentInventoryAmount = Number(inventoryCounts.get(cardId) || 0);
      if (currentInventoryAmount >= INVENTORY_MAX_COPIES) {
        break;
      }
      const baseEntry = {
        cardId,
        obtainedAt: nowIso(),
        source: sourceTag,
      };
      if (type === "creatures") {
        baseEntry.variant = normalizeCreatureVariant(buildCreatureScanVariant());
      }
      const normalized = normalizeScansEntryByType(type, baseEntry);
      if (!normalized) {
        break;
      }
      inventory[type].push(normalized);
      inventoryCounts.set(cardId, currentInventoryAmount + 1);
      boosted[type] += 1;
      missing -= 1;
      inventoryChanged = true;
    }
  });

  if (inventoryChanged) {
    scans.players[ownerData.key] = {
      cards: trimCardsToInventoryCap(inventory, INVENTORY_MAX_COPIES),
    };
    writeScansData(scans, sourceTag);
  }
  const postValidation = validateDeckAgainstScans(deckData, normalizedDeckName, owner);
  if (!postValidation.ok) {
    return {
      ok: false,
      error: `inventario_insuficiente_pos_boost: ${postValidation.errors.slice(0, 4).join(" | ")}`,
      boosted,
    };
  }
  return {
    ok: true,
    boosted,
    scansChanged: inventoryChanged,
  };
}

function saveDeckForOwnerUsingOfficialFlow(ownerKey, deckName, deckData) {
  const owner = normalizeUserKey(ownerKey, "");
  const normalizedDeckName = normalizeDeckName(deckName || "");
  if (!owner || !normalizedDeckName) {
    return { ok: false, error: "owner_ou_deck_invalido" };
  }
  const existingDeck = readDeckFileByName(`${normalizedDeckName}.json`);
  const scansValidation = validateDeckAgainstScans(deckData, normalizedDeckName, owner);
  if (!scansValidation.ok) {
    return {
      ok: false,
      error: `deck_excede_inventario: ${scansValidation.errors.slice(0, 4).join(" | ")}`,
    };
  }
  writeDeckStored(normalizedDeckName, deckData);
  invalidateUserCaches(owner);
  return { ok: true };
}

function buildMechanicsDeckName(family, sequence, usedNames) {
  const familySlug = String(family?.slug || family?.id || "MECH").toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  let index = Math.max(1, Number(sequence || 1));
  while (index < 9999) {
    const name = `MECH-${familySlug}-${String(index).padStart(2, "0")}`;
    const normalized = normalizeDeckName(name);
    if (normalized && !usedNames.has(normalized)) {
      usedNames.add(normalized);
      return normalized;
    }
    index += 1;
  }
  return "";
}

function runMechanicsDeckGeneration(options = {}) {
  const owner = normalizeUserKey(options.ownerKey || "admin", "admin");
  const runId = mechanicsDeckRunId();
  const startedAt = nowIso();
  const report = {
    ok: true,
    runId,
    owner,
    startedAt,
    finishedAt: "",
    familiesRequested: MECHANICS_DECK_FAMILIES.map((family) => family.label),
    familiesCovered: [],
    skippedFamilies: [],
    totalCreated: 0,
    createdDecks: [],
    failedFamilies: [],
    warnings: [],
  };

  const pools = buildMechanicsDeckPools();
  const fallbackByType = pools.byType;
  const existingDeckNames = listDecks(owner).map((entry) => normalizeDeckName(entry?.name || "")).filter(Boolean);
  const usedDeckNames = new Set(existingDeckNames);
  const existingFamilyById = new Set();
  MECHANICS_DECK_FAMILIES.forEach((family) => {
    const prefix = `mech-${String(family.slug || "").toLowerCase()}-`;
    if (existingDeckNames.some((name) => String(name || "").startsWith(prefix))) {
      existingFamilyById.add(family.id);
    }
  });

  let sequence = 1;
  MECHANICS_DECK_FAMILIES.forEach((family) => {
    if (existingFamilyById.has(family.id)) {
      report.skippedFamilies.push({
        family: family.label,
        reason: "ja_possui_deck_gerado",
      });
      return;
    }
    const familyPool = pools.byFamily?.[family.id] || {};
    const tempCapacity = cloneMechanicsCapacityMap(buildMechanicsCapacityMapForOwner(owner));
    const bpState = { used: 0 };
    const deckCards = {
      creatures: [],
      attacks: [],
      battlegear: [],
      mugic: [],
      locations: [],
    };
    const themedUsage = {
      creatures: 0,
      attacks: 0,
      battlegear: 0,
      mugic: 0,
      locations: 0,
    };

    const buildOrder = ["attacks", "creatures", "battlegear", "mugic", "locations"];
    for (const type of buildOrder) {
      const selection = pickMechanicsCardsForType({
        type,
        required: MECHANICS_DECK_TYPE_COUNTS[type],
        primaryMinimum: MECHANICS_DECK_PRIMARY_MINIMUM[type],
        preferredCards: familyPool[type] || [],
        fallbackCards: fallbackByType[type] || [],
        capacityMap: tempCapacity,
        attackBpCap: 20,
        bpState,
      });
      if (!selection.ok) {
        report.failedFamilies.push({
          family: family.label,
          reason: selection.error,
          type,
        });
        return;
      }
      deckCards[type] = selection.selected.slice(0, MECHANICS_DECK_TYPE_COUNTS[type]);
      themedUsage[type] = selection.primaryPicked;
    }

    const totalThemeCards = Object.values(themedUsage).reduce((sum, value) => sum + Number(value || 0), 0);
    if (totalThemeCards <= 0) {
      report.failedFamilies.push({
        family: family.label,
        reason: "Sem cartas tematicas suficientes para montar deck representativo.",
      });
      return;
    }

    const deckName = buildMechanicsDeckName(family, sequence, usedDeckNames);
    sequence += 1;
    if (!deckName) {
      report.failedFamilies.push({
        family: family.label,
        reason: "Nao foi possivel gerar nome unico para o deck.",
      });
      return;
    }

    const deckData = {
      name: deckName,
      owner,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mode: "competitive",
      cards: deckCards,
    };

    const validation = validateDeckForRulesMode(deckData, "competitive");
    if (!validation.ok) {
      report.failedFamilies.push({
        family: family.label,
        reason: `Deck invalido para regras competitivas: ${validation.errors.slice(0, 3).join(" | ")}`,
      });
      return;
    }

    const boostResult = ensureOwnerInventoryForDeck(owner, deckName, deckData, "admin_mechanics_autoboost");
    if (!boostResult.ok) {
      report.failedFamilies.push({
        family: family.label,
        reason: boostResult.error,
      });
      return;
    }

    const saveResult = saveDeckForOwnerUsingOfficialFlow(owner, deckName, deckData);
    if (!saveResult.ok) {
      report.failedFamilies.push({
        family: family.label,
        reason: saveResult.error,
      });
      return;
    }

    report.familiesCovered.push(family.label);
    report.totalCreated += 1;
    report.createdDecks.push({
      family: family.label,
      deckName,
      attackBP: Number(validation?.counts?.attacks ? bpState.used : 0),
      counts: validation.counts,
      themedUsage,
      autoBoosted: boostResult.boosted,
    });
  });

  report.finishedAt = nowIso();
  report.ok = report.failedFamilies.length === 0;
  mechanicsDeckGenerationReports.set(runId, report);
  while (mechanicsDeckGenerationReports.size > 25) {
    const firstKey = mechanicsDeckGenerationReports.keys().next().value;
    if (!firstKey) {
      break;
    }
    mechanicsDeckGenerationReports.delete(firstKey);
  }
  return report;
}

const PERIM_ACTIONS = [
  {
    id: "explore",
    name: "Explorar a Area",
    description: "Busca geral por itens comuns, criaturas e maior chance de locais proximos.",
    durationMs: 60 * 60 * 1000,
  },
  {
    id: "track",
    name: "Rastrear Criaturas",
    description: "Foco em escanear criaturas; se falhar, revela uma pista da area.",
    durationMs: 65 * 60 * 1000,
  },
  {
    id: "anomaly",
    name: "Investigar Anomalias",
    description: "Investiga criatura da area com 1 a 5 pistas e menor chance de carta.",
    durationMs: 80 * 60 * 1000,
  },
  {
    id: "camp",
    name: "Acampar / Esperar",
    description: "Aguarda criaturas raras. Processo mais lento.",
    durationMs: 90 * 60 * 1000,
  },
  {
    id: "relic",
    name: "Procurar Recursos / Reliquias",
    description: "Busca focada em ataques, equipamentos e mugics.",
    durationMs: 70 * 60 * 1000,
  },
];

const PERIM_EVENTS_BY_CLIMATE = {
  ensolarado: { id: "sun_burst", label: "Surto Solar", effect: "+8% drops de Battlegear e Mugic", bonus: { battlegear: 0.08, mugic: 0.08 } },
  chuvoso: { id: "rain_echo", label: "Eco Chuvoso", effect: "+10% drops de Attacks aquaticos", bonus: { attacks: 0.1 } },
  ventania: { id: "wind_paths", label: "Trilhas de Ventania", effect: "+7% chance de local adjacente em exploracao", bonus: { locations: 0.07 } },
  tempestade: { id: "storm_hunt", label: "Cacada da Tempestade", effect: "+10% chance de criatura em rastreio", bonus: { creatures: 0.1 } },
  nublado: { id: "mist_watch", label: "Vigilia Nebulosa", effect: "Sem bonus extremo; leitura estavel de sinais", bonus: {} },
  umido: { id: "humid_flow", label: "Fluxo Umido", effect: "Clima neutro operacional.", bonus: {} },
  seco: { id: "dry_flow", label: "Fluxo Seco", effect: "Clima neutro operacional.", bonus: {} },
  frio: { id: "cold_flow", label: "Fluxo Frio", effect: "Clima neutro operacional.", bonus: {} },
  quente: { id: "hot_flow", label: "Fluxo Quente", effect: "Clima neutro operacional.", bonus: {} },
  lugar_fechado: { id: "indoor_flow", label: "Lugar Fechado", effect: "Clima neutro operacional.", bonus: {} },
};

const PERIM_DAILY_CLIMATE_EFFECTS = {
  ensolarado: [
    { id: "sun_scout_1", label: "Rastros Dourados", description: "Criaturas aparecem um pouco mais em exploracao.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "sun_relic_2", label: "Calor de Reliquia", description: "Leve foco em reliquias e equipamentos.", modifiers: { typeWeightMultiplier: { battlegear: 1.06 } } },
    { id: "sun_attack_3", label: "Brilho de Combate", description: "Ataques ficam levemente mais frequentes.", modifiers: { typeWeightMultiplier: { attacks: 1.06 }, attackChanceMultiplier: 1.04 } },
    { id: "sun_swift_4", label: "Janela Clara", description: "Pequeno ganho de sucesso e duracao estavel.", modifiers: { successChanceAdd: 0.03 } },
    { id: "sun_stable_5", label: "Sinal Limpo", description: "Leve bonus para drop extra na run.", modifiers: { bonusChanceMultiplier: 1.06 } },
  ],
  chuvoso: [
    { id: "rain_water_1", label: "Pulso Aquatico", description: "Ataques aquaticos ficam um pouco mais comuns.", modifiers: { typeWeightMultiplier: { attacks: 1.06 } } },
    { id: "rain_mugic_2", label: "Canal Umido", description: "Mugics recebem leve impulso de chance.", modifiers: { typeWeightMultiplier: { mugic: 1.06 } } },
    { id: "rain_creature_3", label: "Pegadas Fundas", description: "Rastreamento de criatura sobe um pouco.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "rain_drift_4", label: "Corrente Lenta", description: "Leve penalidade de chance de bonus.", modifiers: { bonusChanceMultiplier: 0.95 } },
    { id: "rain_cache_5", label: "Pocao de Itens", description: "Equipamentos tem pequeno reforco.", modifiers: { typeWeightMultiplier: { battlegear: 1.05 } } },
  ],
  ventania: [
    { id: "wind_track_1", label: "Trilha de Ar", description: "Chance de criatura sobe levemente.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "wind_attack_2", label: "Corte de Vento", description: "Ataques ficam um pouco mais provaveis.", modifiers: { typeWeightMultiplier: { attacks: 1.06 }, attackChanceMultiplier: 1.05 } },
    { id: "wind_loc_3", label: "Rotas Abertas", description: "Locais ganham leve bonus de drop.", modifiers: { locationDropChanceMultiplier: 1.07 } },
    { id: "wind_focus_4", label: "Foco de Patrulha", description: "Leve aumento na taxa de sucesso.", modifiers: { successChanceAdd: 0.03 } },
    { id: "wind_turb_5", label: "Rajada Turbulenta", description: "Pequena queda no bonus de run.", modifiers: { bonusChanceMultiplier: 0.95 } },
  ],
  tempestade: [
    { id: "storm_hunt_1", label: "Cacada da Tempestade", description: "Criaturas sobem um pouco na run.", modifiers: { creatureDropChanceAdd: 0.04 } },
    { id: "storm_mugic_2", label: "Condutor Arcano", description: "Mugics e raridade recebem impulso leve.", modifiers: { typeWeightMultiplier: { mugic: 1.07 }, rareBoostAdd: 0.05 } },
    { id: "storm_gear_3", label: "Ferragens Expostas", description: "Equipamentos aparecem mais no clima instavel.", modifiers: { typeWeightMultiplier: { battlegear: 1.06 } } },
    { id: "storm_risk_4", label: "Ruido Eletrico", description: "Leve queda de sucesso na acao.", modifiers: { successChanceAdd: -0.03 } },
    { id: "storm_attack_5", label: "Impacto Duplo", description: "Ataques tem reforco pequeno por slot.", modifiers: { attackChanceMultiplier: 1.06, typeWeightMultiplier: { attacks: 1.05 } } },
  ],
  nublado: [
    { id: "cloud_balance_1", label: "Leitura Estavel", description: "Distribuicao equilibrada, sem extremos.", modifiers: {} },
    { id: "cloud_clue_2", label: "Eco de Sinais", description: "Chance de bonus da run sobe levemente.", modifiers: { bonusChanceMultiplier: 1.05 } },
    { id: "cloud_attack_3", label: "Janela Tatica", description: "Ataques sobem um pouco no sorteio.", modifiers: { typeWeightMultiplier: { attacks: 1.05 } } },
    { id: "cloud_loc_4", label: "Mapa Coberto", description: "Locais ganham leve chance extra.", modifiers: { locationDropChanceMultiplier: 1.06 } },
    { id: "cloud_watch_5", label: "Observacao Longa", description: "Rastreio de criaturas sobe de forma leve.", modifiers: { creatureDropChanceAdd: 0.03 } },
  ],
  umido: [
    { id: "humid_mugic_1", label: "Canal Saturado", description: "Mugics recebem pequeno bonus.", modifiers: { typeWeightMultiplier: { mugic: 1.06 } } },
    { id: "humid_pack_2", label: "Bolso Encharcado", description: "Equipamentos ficam ligeiramente mais comuns.", modifiers: { typeWeightMultiplier: { battlegear: 1.05 } } },
    { id: "humid_track_3", label: "Rastro Pesado", description: "Leve aumento para criaturas.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "humid_drag_4", label: "Terreno Denso", description: "Leve reducao na chance de ataque.", modifiers: { attackChanceMultiplier: 0.95 } },
    { id: "humid_sync_5", label: "Umidade Harmonica", description: "Sucesso geral sobe um pouco.", modifiers: { successChanceAdd: 0.03 } },
  ],
  seco: [
    { id: "dry_attack_1", label: "Ar Seco", description: "Ataques ficam um pouco mais presentes.", modifiers: { typeWeightMultiplier: { attacks: 1.06 }, attackChanceMultiplier: 1.05 } },
    { id: "dry_relic_2", label: "Vestigio Exposto", description: "Leve bonus para battlegear.", modifiers: { typeWeightMultiplier: { battlegear: 1.06 } } },
    { id: "dry_trace_3", label: "Pegada Clara", description: "Rastreio ganha pequeno impulso.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "dry_break_4", label: "Quebra de Ritmo", description: "Bonus de run cai um pouco.", modifiers: { bonusChanceMultiplier: 0.95 } },
    { id: "dry_map_5", label: "Horizonte Livre", description: "Chance de local sobe levemente.", modifiers: { locationDropChanceMultiplier: 1.06 } },
  ],
  frio: [
    { id: "cold_focus_1", label: "Frio Preciso", description: "Leve aumento de sucesso.", modifiers: { successChanceAdd: 0.03 } },
    { id: "cold_mugic_2", label: "Canal Gelado", description: "Mugic e raridade sobem de leve.", modifiers: { typeWeightMultiplier: { mugic: 1.05 }, rareBoostAdd: 0.04 } },
    { id: "cold_track_3", label: "Rastro Congelado", description: "Criaturas ficam um pouco mais detectaveis.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "cold_attack_4", label: "Golpe Rigido", description: "Ataques recebem pequeno bonus.", modifiers: { typeWeightMultiplier: { attacks: 1.05 } } },
    { id: "cold_slow_5", label: "Passo Lento", description: "Leve queda de chance extra.", modifiers: { bonusChanceMultiplier: 0.95 } },
  ],
  quente: [
    { id: "hot_burst_1", label: "Pico Termico", description: "Ataques ficam um pouco mais frequentes.", modifiers: { attackChanceMultiplier: 1.06, typeWeightMultiplier: { attacks: 1.05 } } },
    { id: "hot_hunt_2", label: "Cacada Escaldante", description: "Leve impulso para criaturas.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "hot_tools_3", label: "Sucata Quente", description: "Equipamentos sobem um pouco no sorteio.", modifiers: { typeWeightMultiplier: { battlegear: 1.06 } } },
    { id: "hot_focus_4", label: "Luz Aberta", description: "Chance de sucesso sobe levemente.", modifiers: { successChanceAdd: 0.03 } },
    { id: "hot_drift_5", label: "Miragem Instavel", description: "Mugic perde um pouco de peso.", modifiers: { typeWeightMultiplier: { mugic: 0.95 } } },
  ],
  lugar_fechado: [
    { id: "indoor_cache_1", label: "Deposito Oculto", description: "Equipamentos recebem pequeno bonus.", modifiers: { typeWeightMultiplier: { battlegear: 1.07 } } },
    { id: "indoor_echo_2", label: "Eco de Corredor", description: "Mugics sobem de leve.", modifiers: { typeWeightMultiplier: { mugic: 1.05 } } },
    { id: "indoor_steps_3", label: "Passos Contidos", description: "Leve ganho de sucesso.", modifiers: { successChanceAdd: 0.03 } },
    { id: "indoor_hunt_4", label: "Rastro Curto", description: "Criaturas ficam um pouco mais visiveis.", modifiers: { creatureDropChanceAdd: 0.03 } },
    { id: "indoor_closed_5", label: "Mapa Restrito", description: "Locais tem leve reducao de chance.", modifiers: { locationDropChanceMultiplier: 0.94 } },
  ],
};

const PERIM_DAILY_CLIMATE_KEYS = Object.keys(PERIM_DAILY_CLIMATE_EFFECTS);
const PERIM_ATTACK_SLOT_OVERRIDE_CHANCE = 0.0001;
const PERIM_ATTACK_SLOT_OVERRIDE_NAMES = new Set([
  "supercooledrain",
  "innerflood",
  "primalsmash",
  "whirlingwail",
  "deadwaterdevastation",
]);

const PERIM_FIXED_CREATURE_LOCATION_RULES = [
  { creatureNames: ["Xaerv"], locations: ["The Storm Tunnel"] },
  { creatureNames: ["Xaerv, Monsoon Defender"], aliases: ["Xaerv Moonsor"], locations: ["The Storm Tunnel"] },
  { creatureNames: ["Najarin"], locations: ["Lake Ken-I-Po"] },
  { creatureNames: ["Najarin, High Muge of the Lake"], aliases: ["Najarin High Muge of the Lake"], locations: ["Lake Ken-I-Po"] },
  { creatureNames: ["Mezzmarr"], locations: ["Lake Ken-I-Po"] },
  { creatureNames: ["Porthyn"], locations: ["Lake Ken-I-Po"] },
  { creatureNames: ["Relic"], locations: ["The Passage, OverWorld"] },
  { creatureNames: ["Owis"], locations: ["Codarc Falls"] },
  { creatureNames: ["Garv"], locations: ["Stronghold Morn"] },
  { creatureNames: ["Blugon"], locations: ["Glacier Plains"] },
  { creatureNames: ["Iparu"], locations: ["Iparu Jungle"] },
  { creatureNames: ["Donmar"], locations: ["Runic Grove"] },
  { creatureNames: ["Frafdo"], locations: ["Castle Bodhran"] },
  { creatureNames: ["Frafdo, The Hero"], aliases: ["Frafdo Hero"], locations: ["Castle Bodhran"] },
  { creatureNames: ["Crawsectus"], locations: ["Riverlands"] },
  { creatureNames: ["Lomma"], locations: ["Forest of Life"] },
  { creatureNames: ["Kinnianne, Ambassador to the Mipedians"], aliases: ["Kinniane"], locations: ["OverWorld Embassy at Mipedim Oasis"] },
  {
    creatureNames: ["Illexia, The Danian Queen", "Illexia, The Danian Queen (Misprint)"],
    aliases: ["Illexia"],
    locations: ["Queen's Gate"],
  },
  { creatureNames: ["Aszil, the Young Queen"], aliases: ["Aszil"], locations: ["Queen's Gate"] },
  { creatureNames: ["Gorram, Danian General"], aliases: ["Gorram", "Danian General"], locations: ["Gorram's Briefing"] },
  { creatureNames: ["Katharaz"], locations: ["Mount Pillar Reservoir"] },
  { creatureNames: ["Lore"], locations: ["Grand Hall of Muge's Summit"] },
  { creatureNames: ["Mhein"], locations: ["The Hive Gallery"] },
  { creatureNames: ["Lore, Ancestral Caller"], aliases: ["Lore Ancestral Caller"], locations: ["Lore's Chamber of Recall"] },
  { creatureNames: ["Melke"], locations: ["The Hunter's Perimeter"] },
  { creatureNames: ["Owayki"], locations: ["The Hunter's Perimeter"] },
  { creatureNames: ["Cerbie"], locations: ["The Passage, UnderWorld"] },
  { creatureNames: ["Dyrtax"], locations: ["Jade Pillar"] },
  { creatureNames: ["Kamangareth"], locations: ["Mount Pillar"] },
  { creatureNames: ["Kopond"], locations: ["Lava Pond"] },
  { creatureNames: ["Magmon"], locations: ["Lava Pond"] },
  { creatureNames: ["Slufurah"], locations: ["Lava Pond"] },
  { creatureNames: ["Magmon, Engulfed"], aliases: ["Magmon Engulfed"], locations: ["Lava Pond"] },
  { creatureNames: ["Skithia"], locations: ["Gothos Tower"] },
  { creatureNames: ["Lord Van Bloot"], locations: ["Gothos Tower", "UnderWorld City, During Van Bloot's Ascent"] },
  { creatureNames: ["Nauthilax"], locations: ["Everrain"] },
  { creatureNames: ["Phelphor"], locations: ["Doors of the Deepmines"] },
  { creatureNames: ["Toxis"], locations: ["The Pits"] },
  { creatureNames: ["Dardemus"], locations: ["Castle Pillar"] },
  { creatureNames: ["Miklon"], locations: ["Castle Pillar"] },
  { creatureNames: ["Rarran"], locations: ["Castle Pillar"] },
  { creatureNames: ["Kopond, High Muge of the Hearth"], aliases: ["Kopond High Muge of the Hearth"], locations: ["Pyrogenousist's Hearth"] },
  { creatureNames: ["Slufurah, Treacherous Translator"], aliases: ["Slufurah Treacherous Translator"], locations: ["Pyrogenousist's Hearth"] },
  { creatureNames: ["Ghuul"], locations: ["Stone Pillar"] },
  { creatureNames: ["Zamool, Lord Van Bloot's Enforcer"], locations: ["Van Bloot's Banquet"] },
  { creatureNames: ["Lord Van Bloot, Servant of Aa'une"], locations: ["Van Bloot's Banquet"] },
  { creatureNames: ["Najarin, Younger"], aliases: ["Najarin Younger"], locations: ["Dranakis Threshold, Portal to the Past"] },
  { creatureNames: ["Kiru"], locations: ["Kiru Village"] },
  { creatureNames: ["Vlar"], locations: ["Kiru Village"] },
  { creatureNames: ["Kaal"], locations: ["Kiru Village"] },
  { creatureNames: ["Skorblust"], locations: ["Kiru Village"] },
  { creatureNames: ["Ixxik"], locations: ["Mipedim Tropics"] },
  { creatureNames: ["Ajara"], locations: ["Mipedim Tropics"] },
  { creatureNames: ["Proboscar"], locations: ["Mipedim Tropics"] },
  { creatureNames: ["Afjak"], locations: ["Graalorn Forest"] },
  { creatureNames: ["Korg"], locations: ["Graalorn Forest"] },
  { creatureNames: ["Makromil"], aliases: ["Makromill"], locations: ["Graalorn Forest"] },
  { creatureNames: ["Voorx"], locations: ["Graalorn Forest"] },
  { creatureNames: ["Ursis"], locations: ["Prexxor Chasm"] },
  { creatureNames: ["Cromaxx"], locations: ["Prexxor Chasm"] },
  { creatureNames: ["Smildon"], locations: ["Prexxor Chasm"] },
];

function normalizePerimPlayerKey(value) {
  const fallback = "local-player";
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || fallback;
}

function isPerimInstantAdmin(playerKeyOrUsername) {
  return normalizePerimPlayerKey(playerKeyOrUsername) === "admin";
}

function hashTokenToInt(token) {
  const hash = crypto.createHash("sha256").update(String(token || ""), "utf8").digest();
  return hash.readUInt32BE(0);
}

function buildPerimActionLookup() {
  const map = new Map();
  PERIM_ACTIONS.forEach((entry) => map.set(entry.id, entry));
  return map;
}

const PERIM_ACTION_LOOKUP = buildPerimActionLookup();

function createEmptyPerimPlayerState() {
  return {
    activeRun: null,
    pendingRewards: [],
    history: [],
    campWaitByLocation: {},
    updatedAt: nowIso(),
  };
}

function normalizePerimPlayerState(input) {
  const state = createEmptyPerimPlayerState();
  if (input && typeof input === "object") {
    state.activeRun = input.activeRun && typeof input.activeRun === "object" ? input.activeRun : null;
    state.pendingRewards = Array.isArray(input.pendingRewards) ? input.pendingRewards.filter(Boolean) : [];
    state.history = Array.isArray(input.history) ? input.history.filter(Boolean).slice(-30) : [];
    state.campWaitByLocation = normalizePerimCampWaitMap(input.campWaitByLocation);
    state.updatedAt = String(input.updatedAt || state.updatedAt);
  }
  return state;
}

function loadPerimStateFile() {
  if (isSqlV2Ready()) {
    const players = {};
    const playerRows = sqliteDb
      .prepare("SELECT owner_key, history_json, camp_wait_json, updated_at FROM perim_player_state")
      .all();
    playerRows.forEach((row) => {
      const ownerKey = normalizePerimPlayerKey(row?.owner_key || "local-player");
      const state = createEmptyPerimPlayerState();
      state.history = Array.isArray(parseJsonText(row?.history_json, []))
        ? parseJsonText(row?.history_json, []).filter(Boolean).slice(-30)
        : [];
      state.campWaitByLocation = normalizePerimCampWaitMap(parseJsonText(row?.camp_wait_json, {}));
      state.updatedAt = String(row?.updated_at || state.updatedAt);
      players[ownerKey] = state;
    });
    const rows = sqliteDb
      .prepare(`
        SELECT run_id, owner_key, location_card_id, location_name, location_image, action_id, action_label,
               start_at, end_at, duration_ms, scanner_json, context_json, rewards_json, status, completed_at, claimed_at, updated_at
        FROM perim_runs
        ORDER BY updated_at ASC
      `)
      .all();
    rows.forEach((row) => {
      const ownerKey = normalizePerimPlayerKey(row?.owner_key || "local-player");
      if (!players[ownerKey]) {
        players[ownerKey] = createEmptyPerimPlayerState();
      }
      const rewards = Array.isArray(parseJsonText(row?.rewards_json, []))
        ? parseJsonText(row?.rewards_json, [])
        : [];
      const baseRun = {
        runId: String(row?.run_id || ""),
        locationId: String(row?.location_card_id || ""),
        locationName: String(row?.location_name || ""),
        locationImage: String(row?.location_image || ""),
        actionId: String(row?.action_id || ""),
        actionLabel: String(row?.action_label || ""),
        actionName: String(row?.action_label || ""),
        startAt: String(row?.start_at || nowIso()),
        endAt: String(row?.end_at || nowIso()),
        durationMs: Number(row?.duration_ms || 0),
        scanner: parseJsonText(row?.scanner_json, {}),
        contextSnapshot: parseJsonText(row?.context_json, {}),
        rewards,
      };
      const status = String(row?.status || "active");
      if (status === "active") {
        players[ownerKey].activeRun = baseRun;
      } else {
        const pendingContext = parseJsonText(row?.context_json, {});
        players[ownerKey].pendingRewards.push({
          runId: baseRun.runId,
          locationId: baseRun.locationId,
          locationName: baseRun.locationName,
          locationImage: baseRun.locationImage,
          actionId: baseRun.actionId,
          actionName: baseRun.actionName,
          completedAt: String(row?.completed_at || row?.end_at || nowIso()),
          claimedAt: row?.claimed_at ? String(row.claimed_at) : null,
          contextSnapshot: pendingContext && typeof pendingContext === "object"
            ? { ...pendingContext }
            : {},
          choiceSelections: normalizePerimChoiceSelections(pendingContext?.choiceSelections || {}),
          rewards: rewards,
        });
      }
      players[ownerKey].updatedAt = String(row?.updated_at || players[ownerKey].updatedAt || nowIso());
    });
    Object.keys(players).forEach((key) => {
      players[key] = normalizePerimPlayerState(players[key]);
    });
    return {
      schemaVersion: 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      players,
    };
  }
  const fromSql = sqlGet("perim_state", "state");
  if (fromSql && typeof fromSql === "object") {
    const players = {};
    Object.entries(fromSql?.players || {}).forEach(([key, value]) => {
      players[normalizePerimPlayerKey(key)] = normalizePerimPlayerState(value);
    });
    return {
      schemaVersion: 1,
      createdAt: fromSql?.createdAt || nowIso(),
      updatedAt: fromSql?.updatedAt || nowIso(),
      players,
    };
  }
  if (!fs.existsSync(PERIM_STATE_FILE)) {
    const base = {
      schemaVersion: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      players: {},
    };
    fs.writeFileSync(PERIM_STATE_FILE, JSON.stringify(base, null, 2), "utf8");
    sqlSet("perim_state", "state", base);
    return base;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(PERIM_STATE_FILE, "utf8"));
    const players = {};
    Object.entries(parsed?.players || {}).forEach(([key, value]) => {
      players[normalizePerimPlayerKey(key)] = normalizePerimPlayerState(value);
    });
    const payload = {
      schemaVersion: 1,
      createdAt: parsed?.createdAt || nowIso(),
      updatedAt: parsed?.updatedAt || nowIso(),
      players,
    };
    sqlSet("perim_state", "state", payload);
    return payload;
  } catch {
    const recovered = {
      schemaVersion: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      players: {},
    };
    fs.writeFileSync(PERIM_STATE_FILE, JSON.stringify(recovered, null, 2), "utf8");
    sqlSet("perim_state", "state", recovered);
    return recovered;
  }
}

function writePerimStateFile(state) {
  const payload = {
    schemaVersion: isSqlV2Ready() ? 2 : 1,
    createdAt: state?.createdAt || nowIso(),
    updatedAt: nowIso(),
    players: {},
  };
  Object.entries(state?.players || {}).forEach(([key, value]) => {
    payload.players[normalizePerimPlayerKey(key)] = normalizePerimPlayerState(value);
  });
  if (isSqlV2Ready()) {
    sqliteDb.exec("BEGIN IMMEDIATE");
    try {
      sqliteDb.prepare("DELETE FROM perim_rewards").run();
      sqliteDb.prepare("DELETE FROM perim_runs").run();
      sqliteDb.prepare("DELETE FROM perim_player_state").run();
      const insertPerimPlayerState = sqliteDb.prepare(`
        INSERT INTO perim_player_state (owner_key, history_json, camp_wait_json, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      const insertPerimRun = sqliteDb.prepare(`
        INSERT INTO perim_runs (
          run_id, owner_key, location_card_id, location_name, location_image, action_id, action_label,
          start_at, end_at, duration_ms, scanner_json, context_json, rewards_json, status, completed_at, claimed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertPerimReward = sqliteDb.prepare(`
        INSERT INTO perim_rewards (run_id, owner_key, reward_type, card_id, variant_json, is_new, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      Object.entries(payload.players || {}).forEach(([ownerRawKey, playerStateRaw]) => {
        const ownerKey = normalizePerimPlayerKey(ownerRawKey);
        const playerState = normalizePerimPlayerState(playerStateRaw);
        insertPerimPlayerState.run(
          ownerKey,
          JSON.stringify(Array.isArray(playerState?.history) ? playerState.history.slice(-30) : []),
          JSON.stringify(normalizePerimCampWaitMap(playerState?.campWaitByLocation)),
          String(playerState?.updatedAt || nowIso())
        );
        const activeRun = playerState.activeRun && typeof playerState.activeRun === "object" ? playerState.activeRun : null;
        if (activeRun?.runId) {
          insertPerimRun.run(
            String(activeRun.runId),
            ownerKey,
            String(activeRun.locationId || activeRun.locationCardId || ""),
            String(activeRun.locationName || ""),
            String(activeRun.locationImage || ""),
            String(activeRun.actionId || ""),
            String(activeRun.actionLabel || ""),
            String(activeRun.startAt || nowIso()),
            String(activeRun.endAt || nowIso()),
            Number(activeRun.durationMs || 0),
            JSON.stringify(activeRun.scanner || {}),
            JSON.stringify(activeRun.contextSnapshot || {}),
            JSON.stringify(activeRun.rewards || []),
            "active",
            null,
            null,
            String(activeRun.startAt || nowIso()),
            nowIso()
          );
          (activeRun.rewards || []).forEach((reward) => {
            const variant = reward?.variant ? normalizeCreatureVariant(reward.variant) : null;
            insertPerimReward.run(
              String(activeRun.runId),
              ownerKey,
              String(reward?.type || ""),
              String(reward?.cardId || ""),
              variant ? JSON.stringify(variant) : null,
              Number(reward?.isNew ? 1 : 0),
              JSON.stringify(reward || {})
            );
          });
        }
        (playerState.pendingRewards || []).forEach((pending) => {
          const runId = String(pending?.runId || crypto.randomBytes(8).toString("hex"));
          const rewards = Array.isArray(pending?.rewards) ? pending.rewards : [];
          const pendingContext = pending?.contextSnapshot && typeof pending.contextSnapshot === "object"
            ? { ...pending.contextSnapshot }
            : {};
          pendingContext.choiceSelections = normalizePerimChoiceSelections(pending?.choiceSelections || {});
          insertPerimRun.run(
            runId,
            ownerKey,
            String(pending?.locationId || ""),
            String(pending?.locationName || ""),
            String(pending?.locationImage || ""),
            String(pending?.actionId || ""),
            String(pending?.actionName || ""),
            String(pending?.completedAt || nowIso()),
            String(pending?.completedAt || nowIso()),
            0,
            JSON.stringify({}),
            JSON.stringify(pendingContext),
            JSON.stringify(rewards),
            pending?.claimedAt ? "claimed" : "pending",
            String(pending?.completedAt || nowIso()),
            pending?.claimedAt ? String(pending.claimedAt) : null,
            String(pending?.completedAt || nowIso()),
            nowIso()
          );
          rewards.forEach((reward) => {
            const variant = reward?.variant ? normalizeCreatureVariant(reward.variant) : null;
            insertPerimReward.run(
              runId,
              ownerKey,
              String(reward?.type || ""),
              String(reward?.cardId || ""),
              variant ? JSON.stringify(variant) : null,
              Number(reward?.isNew ? 1 : 0),
              JSON.stringify(reward || {})
            );
          });
        });
      });
      sqliteDb.exec("COMMIT");
      invalidateUserCaches("", { all: true });
      return payload;
    } catch (error) {
      try {
        sqliteDb.exec("ROLLBACK");
      } catch {}
      console.error(`[DB] Falha ao persistir PERIM SQL v2: ${error?.message || error}`);
      throw error;
    }
  }
  fs.writeFileSync(PERIM_STATE_FILE, JSON.stringify(payload, null, 2), "utf8");
  sqlSet("perim_state", "state", payload);
  userResponseCache.perim.clear();
  runtimeMetrics.cache.invalidations += 1;
  return payload;
}

function getOrCreatePerimPlayerState(rootState, playerKey) {
  const key = normalizePerimPlayerKey(playerKey);
  if (!rootState.players[key]) {
    rootState.players[key] = createEmptyPerimPlayerState();
  }
  rootState.players[key] = normalizePerimPlayerState(rootState.players[key]);
  return { key, state: rootState.players[key] };
}

let perimLocationsMatrixCache = null;
let perimLocationAdjacencyGraphCache = { token: "", value: null };
let perimLocationMetaByCardIdCache = { token: "", value: null };
let perimLocationAdjacencyCache = { token: "", byFromCardId: new Map(), links: [] };
let libraryIndexCache = { versionToken: "", value: null };
let dailyCreatureIndexCache = { dateKey: "", generatedAt: "", value: null };

function getLibraryIndexes() {
  const locations = Array.isArray(library?.cardsByType?.locations) ? library.cardsByType.locations : [];
  const creatures = Array.isArray(library?.cardsByType?.creatures) ? library.cardsByType.creatures : [];
  const versionToken = `${locations.length}:${creatures.length}`;
  if (libraryIndexCache.value && libraryIndexCache.versionToken === versionToken) {
    return libraryIndexCache.value;
  }
  const locationsById = new Map();
  const creaturesById = new Map();
  const creaturesByNormalizedName = new Map();
  const locationsByNormalizedName = new Map();
  locations.forEach((card) => {
    locationsById.set(String(card.id), card);
    locationsByNormalizedName.set(normalizePerimText(card?.name || ""), card);
  });
  creatures.forEach((card) => {
    creaturesById.set(String(card.id), card);
    creaturesByNormalizedName.set(normalizePerimText(card?.name || ""), card);
  });
  const indexes = {
    locationsById,
    creaturesById,
    creaturesByNormalizedName,
    locationsByNormalizedName,
  };
  libraryIndexCache = { versionToken, value: indexes };
  return indexes;
}

const DEFAULT_PERIM_CREATURE_CHANCE_BY_ACTION = {
  explore: 58,
  track: 76,
  anomaly: 46,
  camp: 52,
  relic: 34,
};

const DEFAULT_PERIM_RARITY_CREATURE_DELTA = {
  common: 8,
  uncommon: 4,
  rare: 0,
  "super rare": -4,
  "ultra rare": -8,
  promo: -12,
};

const DEFAULT_PERIM_REWARD_PROFILE_BY_ACTION = {
  explore: {
    primary: { creatures: 44, attacks: 18, battlegear: 14, mugic: 10, locations: 14 },
    bonusChance: 0.54,
    attackChance: 0.58,
    baseSuccessChance: 0.68,
    locationDropBias: 1.45,
  },
  track: {
    primary: { creatures: 74, attacks: 12, battlegear: 6, mugic: 8 },
    bonusChance: 0.38,
    attackChance: 0.7,
    baseSuccessChance: 0.76,
    locationDropBias: 0.92,
  },
  anomaly: {
    primary: { creatures: 34, attacks: 17, battlegear: 23, mugic: 20, locations: 6 },
    bonusChance: 0.26,
    attackChance: 0.36,
    baseSuccessChance: 0.44,
    locationDropBias: 0.8,
  },
  camp: {
    primary: { creatures: 58, attacks: 13, battlegear: 15, mugic: 10, locations: 4 },
    bonusChance: 0.48,
    attackChance: 0.5,
    baseSuccessChance: 0.6,
    locationDropBias: 0.88,
  },
  relic: {
    primary: { creatures: 12, attacks: 31, battlegear: 39, mugic: 18 },
    bonusChance: 0.62,
    attackChance: 0.66,
    baseSuccessChance: 0.64,
    locationDropBias: 0.96,
  },
};

const DEFAULT_CREATURE_RARITY_DROP_CHANCE = {
  common: 1,
  uncommon: 0.76,
  rare: 0.24,
  "super rare": 0.084,
  "ultra rare": 0.0315,
  promo: 0.03,
};

const DEFAULT_CREATURE_SCAN_RARITY_MULTIPLIER = {
  "super rare": 0.6,
  "ultra rare": 0.45,
};

const DEFAULT_LOCATION_RARITY_DROP_CHANCE = {
  common: 0.2,
  uncommon: 0.16,
  rare: 0.11,
  "super rare": 0.07,
  "ultra rare": 0.04,
  promo: 0.02,
};

const PERIM_ANOMALY_DIRECT_REVEAL_CHANCE = 0.02;
const PERIM_ANOMALY_QUEST_DROP_CHANCE = 0.1;
const PERIM_LOCATION_DROP_COPY_CAP = 3;
const PERIM_LOCATION_DROP_BASE_CHANCE_MULTIPLIER = 0.82;
const PERIM_QUEST_EXCLUSIVE_REWARD_TYPES = new Set(["creatures", "battlegear"]);
const PERIM_QUEST_EXCLUSIVE_MAX_COPIES = 1;
const PERIM_GENERIC_MUGIC_BASE_WEIGHT = 0.75;
const PERIM_GENERIC_MUGIC_RUNIC_GROVE_MULTIPLIER = 1.35;
const DEFAULT_PLAYER_ALLOWED_SET_KEYS = ["dop", "zoth", "ss"];
const PLAYER_ALLOWED_SET_KEYS = new Set(DEFAULT_PLAYER_ALLOWED_SET_KEYS);
const PERIM_QUEST_REWARD_RARITIES = new Set(["rare", "super rare", "ultra rare"]);
const PERIM_QUEST_TEMPLATE_TARGET_COUNT = 5;
const PERIM_RUNTIME_CONFIG_NAMESPACE = "perim_runtime_config";
const PERIM_RUNTIME_CONFIG_KEY = "state";
const DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS = [...DEFAULT_PLAYER_ALLOWED_SET_KEYS];
const DEFAULT_PERIM_DAILY_WALK_TIMES = ["00:00"];

const DEFAULT_PERIM_CAMP_CREATURE_STACKING = {
  enabled: true,
  bonusPerWaitPercent: 5,
  maxBonusPercent: 40,
  bonusMaxRarity: "super rare",
};

const DEFAULT_PERIM_DROP_TABLES = Object.freeze({
  schemaVersion: 1,
  actions: {
    explore: { creatureBaseChance: 58, primary: { creatures: 44, attacks: 18, battlegear: 14, mugic: 10, locations: 14 }, bonusChance: 0.54, attackChance: 0.58, baseSuccessChance: 0.68, locationDropBias: 1.45 },
    track: { creatureBaseChance: 76, primary: { creatures: 74, attacks: 12, battlegear: 6, mugic: 8 }, bonusChance: 0.38, attackChance: 0.7, baseSuccessChance: 0.76, locationDropBias: 0.92 },
    anomaly: { creatureBaseChance: 46, primary: { creatures: 34, attacks: 17, battlegear: 23, mugic: 20, locations: 6 }, bonusChance: 0.26, attackChance: 0.36, baseSuccessChance: 0.44, locationDropBias: 0.8 },
    camp: { creatureBaseChance: 52, primary: { creatures: 58, attacks: 13, battlegear: 15, mugic: 10, locations: 4 }, bonusChance: 0.48, attackChance: 0.5, baseSuccessChance: 0.6, locationDropBias: 0.88 },
    relic: { creatureBaseChance: 34, primary: { creatures: 12, attacks: 31, battlegear: 39, mugic: 18 }, bonusChance: 0.62, attackChance: 0.66, baseSuccessChance: 0.64, locationDropBias: 0.96 },
  },
  rarityCreatureDelta: DEFAULT_PERIM_RARITY_CREATURE_DELTA,
  creatureRarityDropChance: DEFAULT_CREATURE_RARITY_DROP_CHANCE,
  creatureScanRarityMultiplier: DEFAULT_CREATURE_SCAN_RARITY_MULTIPLIER,
  locationRarityDropChance: DEFAULT_LOCATION_RARITY_DROP_CHANCE,
  climateTypeModifiers: {
    ensolarado: { creatures: 1.04, attacks: 1.08, battlegear: 1.02, mugic: 0.96, locations: 1.0 },
    chuvoso: { creatures: 1.02, attacks: 0.98, battlegear: 0.96, mugic: 1.08, locations: 1.0 },
    ventania: { creatures: 1.03, attacks: 1.05, battlegear: 1.0, mugic: 0.97, locations: 1.0 },
    tempestade: { creatures: 1.06, attacks: 0.95, battlegear: 0.98, mugic: 1.08, locations: 1.0 },
    nublado: { creatures: 1.0, attacks: 1.0, battlegear: 1.0, mugic: 1.0, locations: 1.0 },
    umido: { creatures: 1.0, attacks: 1.0, battlegear: 1.0, mugic: 1.0, locations: 1.0 },
    seco: { creatures: 1.0, attacks: 1.0, battlegear: 1.0, mugic: 1.0, locations: 1.0 },
    frio: { creatures: 1.0, attacks: 1.0, battlegear: 1.0, mugic: 1.0, locations: 1.0 },
    quente: { creatures: 1.0, attacks: 1.0, battlegear: 1.0, mugic: 1.0, locations: 1.0 },
    lugar_fechado: { creatures: 1.0, attacks: 1.0, battlegear: 1.0, mugic: 1.0, locations: 1.0 },
  },
  locationRules: {
    adjacentFirstChance: 0.72,
    fallbackCurrentMinChance: 0.05,
  },
  campCreatureStacking: DEFAULT_PERIM_CAMP_CREATURE_STACKING,
  limits: {
    maxCreatureDropsPerRun: 1,
    maxTotalDropsPerRun: 4,
  },
  scanner: {
    globalDurationByTotalLevel: [
      { minTotalLevel: 0, multiplier: 1.0 },
      { minTotalLevel: 7, multiplier: 0.96 },
      { minTotalLevel: 11, multiplier: 0.92 },
      { minTotalLevel: 15, multiplier: 0.88 },
      { minTotalLevel: 19, multiplier: 0.84 },
    ],
    tribeLevelEffects: {
      1: { successBoostPercent: 0, creatureRareBoost: 0.0, mugicRareBoost: 0.0 },
      2: { successBoostPercent: 6, creatureRareBoost: 0.15, mugicRareBoost: 0.12 },
      3: { successBoostPercent: 12, creatureRareBoost: 0.3, mugicRareBoost: 0.24 },
      4: { successBoostPercent: 20, creatureRareBoost: 0.48, mugicRareBoost: 0.38 },
    },
  },
});

let perimDropTablesCache = null;

function cloneDefaultPerimDropTables() {
  return JSON.parse(JSON.stringify(DEFAULT_PERIM_DROP_TABLES));
}

function clampUnitInterval(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number(fallback || 0);
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizePerimDropSetKey(setRaw) {
  const normalized = String(setRaw || "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (normalized === "unknownset") {
    return "unknown";
  }
  return normalized;
}

let perimRuntimeConfigCache = null;

function normalizePerimDailyWalkTime(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return "";
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sortPerimWalkTimes(times = []) {
  return [...times].sort((a, b) => {
    const [ha, ma] = String(a || "").split(":").map((entry) => Number(entry));
    const [hb, mb] = String(b || "").split(":").map((entry) => Number(entry));
    return ((ha * 60) + ma) - ((hb * 60) + mb);
  });
}

function listPerimCatalogSetKeys() {
  const setKeys = new Set();
  const cards = Array.isArray(library?.cards) ? library.cards : [];
  cards.forEach((card) => {
    const setKey = normalizePerimDropSetKey(card?.set || "");
    if (setKey && setKey !== "unknown") {
      setKeys.add(setKey);
    }
  });
  return [...setKeys].sort((a, b) => String(a).localeCompare(String(b), "en"));
}

function normalizePerimRuntimeConfig(payload = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  const knownSetKeys = new Set(listPerimCatalogSetKeys());
  const allowedDropSetsSource = Array.isArray(source.allowedDropSets)
    ? source.allowedDropSets
    : DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS;
  let allowedDropSets = [...new Set(
    allowedDropSetsSource
      .map((entry) => normalizePerimDropSetKey(entry))
      .filter((entry) => entry && entry !== "unknown")
  )];
  if (knownSetKeys.size) {
    allowedDropSets = allowedDropSets.filter((entry) => knownSetKeys.has(entry));
  }
  if (!allowedDropSets.length) {
    allowedDropSets = [...DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS];
  }

  const dailyWalkTimesSource = Array.isArray(source.dailyWalkTimes)
    ? source.dailyWalkTimes
    : DEFAULT_PERIM_DAILY_WALK_TIMES;
  let dailyWalkTimes = [...new Set(
    dailyWalkTimesSource
      .map((entry) => normalizePerimDailyWalkTime(entry))
      .filter(Boolean)
  )];
  if (!dailyWalkTimes.length) {
    dailyWalkTimes = [...DEFAULT_PERIM_DAILY_WALK_TIMES];
  }
  dailyWalkTimes = sortPerimWalkTimes(dailyWalkTimes);

  return {
    allowedDropSets: [...new Set(allowedDropSets)],
    dailyWalkTimes,
  };
}

function getPerimRuntimeConfig(forceReload = false) {
  const fromDb = (!forceReload && perimRuntimeConfigCache && !sqliteDb)
    ? perimRuntimeConfigCache
    : sqlGet(PERIM_RUNTIME_CONFIG_NAMESPACE, PERIM_RUNTIME_CONFIG_KEY);
  const normalized = normalizePerimRuntimeConfig(fromDb);
  if (!fromDb || JSON.stringify(fromDb) !== JSON.stringify(normalized)) {
    sqlSet(PERIM_RUNTIME_CONFIG_NAMESPACE, PERIM_RUNTIME_CONFIG_KEY, normalized);
  }
  perimRuntimeConfigCache = normalized;
  return normalized;
}

function savePerimRuntimeConfig(payload) {
  const normalized = normalizePerimRuntimeConfig(payload);
  sqlSet(PERIM_RUNTIME_CONFIG_NAMESPACE, PERIM_RUNTIME_CONFIG_KEY, normalized);
  perimRuntimeConfigCache = normalized;
  return normalized;
}

function getPerimAllowedDropSetKeys() {
  return new Set(getPerimRuntimeConfig().allowedDropSets || DEFAULT_PERIM_ALLOWED_DROP_SET_KEYS);
}

function getPerimDailyWalkTimes() {
  return getPerimRuntimeConfig().dailyWalkTimes || DEFAULT_PERIM_DAILY_WALK_TIMES;
}

let librarySetLookupCache = { versionToken: "", byCardId: new Map() };

function resolveLibraryCardSetKey(card) {
  const setValue = card && typeof card === "object"
    ? (card.set ?? card.setName ?? card.collection ?? "")
    : "";
  return normalizePerimDropSetKey(setValue);
}

function getLibraryCardSetLookup() {
  const cards = Array.isArray(library?.cards) ? library.cards : [];
  const versionToken = String(cards.length);
  if (librarySetLookupCache.byCardId.size && librarySetLookupCache.versionToken === versionToken) {
    return librarySetLookupCache.byCardId;
  }
  const byCardId = new Map();
  cards.forEach((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) {
      return;
    }
    byCardId.set(cardId, resolveLibraryCardSetKey(card));
  });
  librarySetLookupCache = { versionToken, byCardId };
  return byCardId;
}

function resolveCardSetKeyById(cardIdRaw) {
  const cardId = String(cardIdRaw || "").trim();
  if (!cardId) {
    return "unknown";
  }
  const lookup = getLibraryCardSetLookup();
  return lookup.get(cardId) || "unknown";
}

function isPlayerCardSetAllowedByCardId(cardIdRaw) {
  return PLAYER_ALLOWED_SET_KEYS.has(resolveCardSetKeyById(cardIdRaw));
}

function isPerimDropSetAllowed(setRaw) {
  const key = normalizePerimDropSetKey(setRaw);
  return getPerimAllowedDropSetKeys().has(key);
}

function normalizeQuestCardType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!DECK_CARD_TYPES.includes(type)) {
    return "";
  }
  return type;
}

function parseQuestRequirements(value) {
  const source = Array.isArray(value) ? value : parseJsonText(value, []);
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const cardType = normalizeQuestCardType(entry.cardType || entry.type || "");
      const cardId = String(entry.cardId || "").trim();
      const required = Math.max(1, Math.floor(Number(entry.required || entry.amount || 1)));
      if (!cardType || !cardId) {
        return null;
      }
      return { cardType, cardId, required };
    })
    .filter(Boolean);
}

function buildQuestTemplateSeedList() {
  const cards = Array.isArray(library?.cards) ? library.cards : [];
  const perimAllowedSetKeys = getPerimAllowedDropSetKeys();
  const allowedCards = cards.filter((card) => {
    const setKey = normalizePerimDropSetKey(card?.set || "");
    if (!perimAllowedSetKeys.has(setKey)) {
      return false;
    }
    const name = String(card?.name || "").toLowerCase();
    return !name.includes("unused") && !name.includes("alpha");
  });
  const rewardCandidates = allowedCards
    .filter((card) => {
      const rarityKey = normalizePerimDropSetKey(card?.rarity || "");
      return normalizeQuestCardType(card?.type || "") && PERIM_QUEST_REWARD_RARITIES.has(rarityKey);
    })
    .sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || ""), "en"));
  const requirementPool = allowedCards
    .filter((card) => {
      const type = normalizeQuestCardType(card?.type || "");
      if (!type || type === "locations") {
        return false;
      }
      const rarityKey = normalizePerimDropSetKey(card?.rarity || "");
      return rarityKey === "common" || rarityKey === "uncommon" || rarityKey === "rare";
    })
    .sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || ""), "en"));
  const locations = allowedCards
    .filter((card) => normalizeQuestCardType(card?.type || "") === "locations")
    .sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || ""), "en"));
  if (!rewardCandidates.length || !requirementPool.length || !locations.length) {
    return [];
  }
  const templates = [];
  const chunk = Math.max(1, Math.floor(rewardCandidates.length / PERIM_QUEST_TEMPLATE_TARGET_COUNT));
  for (let i = 0; i < PERIM_QUEST_TEMPLATE_TARGET_COUNT; i += 1) {
    const rewardCard = rewardCandidates[Math.min(rewardCandidates.length - 1, i * chunk)];
    if (!rewardCard?.id) {
      continue;
    }
    const rewardSetKey = normalizePerimDropSetKey(rewardCard?.set || "");
    const reqPoolBySet = requirementPool.filter(
      (entry) =>
        normalizePerimDropSetKey(entry?.set || "") === rewardSetKey
        && String(entry?.id || "") !== String(rewardCard.id)
    );
    const requirementA = reqPoolBySet[0] || null;
    const requirementB = reqPoolBySet[1] || null;
    if (!requirementA || !requirementB) {
      continue;
    }
    const targetLocation = locations[(i * 7) % locations.length];
    const questKey = `quest_v1_${rewardSetKey}_${String(rewardCard.id).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    const requirements = [
      {
        cardType: normalizeQuestCardType(requirementA.type),
        cardId: String(requirementA.id),
        required: 2,
      },
      {
        cardType: normalizeQuestCardType(requirementB.type),
        cardId: String(requirementB.id),
        required: 1,
      },
    ].filter((entry) => entry.cardType && entry.cardId);
    if (requirements.length < 2) {
      continue;
    }
    templates.push({
      questKey,
      title: `Missao de Anomalia: ${rewardCard.name}`,
      description: "Reuna os recursos exigidos e resgate uma carta rara no local indicado.",
      rewardType: normalizeQuestCardType(rewardCard.type),
      rewardCardId: String(rewardCard.id),
      targetLocationCardId: String(targetLocation.id),
      anomalyLocationIds: [String(targetLocation.id)],
      requirements,
    });
  }
  return templates.slice(0, PERIM_QUEST_TEMPLATE_TARGET_COUNT);
}

function ensurePerimQuestTemplatesSeed() {
  if (!isSqlV2Ready()) {
    return;
  }
  try {
    const existing = sqliteDb.prepare("SELECT COUNT(*) AS total FROM perim_quest_templates").get();
    if (Number(existing?.total || 0) > 0) {
      return;
    }
    const templates = buildQuestTemplateSeedList();
    if (!templates.length) {
      console.warn("[PERIM][QUESTS] Seed inicial nao gerado: sem cartas elegiveis.");
      return;
    }
    const now = nowIso();
    const insert = sqliteDb.prepare(`
      INSERT INTO perim_quest_templates (
        quest_key, title, description, reward_type, reward_card_id, quest_set_key, difficulty_key, is_draft,
        target_location_card_id, anomaly_location_ids_json, requirements_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ok', 0, ?, ?, ?, 1, ?, ?)
    `);
    sqliteDb.exec("BEGIN IMMEDIATE");
    templates.forEach((template) => {
      insert.run(
        String(template.questKey),
        String(template.title),
        String(template.description || ""),
        String(template.rewardType),
        String(template.rewardCardId),
        resolveCardSetKeyById(template.rewardCardId),
        String(template.targetLocationCardId),
        JSON.stringify(template.anomalyLocationIds || []),
        JSON.stringify(template.requirements || []),
        now,
        now
      );
    });
    sqliteDb.exec("COMMIT");
    console.log(`[PERIM][QUESTS] Seed inicial criado com ${templates.length} quests.`);
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    console.warn(`[PERIM][QUESTS] Falha ao criar seed inicial: ${error?.message || error}`);
  }
}

function listPerimQuestTemplates() {
  if (!isSqlV2Ready()) {
    return [];
  }
  ensurePerimQuestTemplatesSeed();
  const rows = sqliteDb
    .prepare(`
      SELECT quest_key, title, description, reward_type, reward_card_id, quest_set_key, difficulty_key, is_draft,
             target_location_card_id, anomaly_location_ids_json, requirements_json, enabled
      FROM perim_quest_templates
      WHERE enabled = 1
      ORDER BY quest_key
    `)
    .all();
  const indexes = getLibraryCardIndexes();
  return rows
    .map((row) => {
      const rewardType = normalizeQuestCardType(row?.reward_type || "");
      const rewardCardId = String(row?.reward_card_id || "").trim();
      const rewardCard = indexes.byId.get(rewardCardId) || null;
      const questSetKey = normalizePerimDropSetKey(row?.quest_set_key || rewardCard?.set || "");
      const difficultyKeyRaw = String(row?.difficulty_key || "ok").trim().toLowerCase();
      const difficultyKey = difficultyKeyRaw === "muito_dificil" || difficultyKeyRaw === "impossivel" ? difficultyKeyRaw : "ok";
      const isDraft = Number(row?.is_draft || 0) === 1;
      const requirements = parseQuestRequirements(row?.requirements_json);
      const targetLocationCardId = String(row?.target_location_card_id || "").trim();
      const targetLocationCard = indexes.byId.get(targetLocationCardId) || null;
      const anomalyLocationIds = Array.isArray(parseJsonText(row?.anomaly_location_ids_json, []))
        ? parseJsonText(row?.anomaly_location_ids_json, [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        : [];
      if (!rewardType || !rewardCardId || !rewardCard) {
        return null;
      }
      if (isDraft || !targetLocationCard || !requirements.length) {
        return null;
      }
      const rewardSetAllowed = isPerimDropSetAllowed(questSetKey || rewardCard?.set || "");
      if (!rewardSetAllowed) {
        return null;
      }
      const requirementSetAllowed = requirements.every((entry) => {
        const card = indexes.byId.get(entry.cardId) || null;
        return Boolean(card) && isPerimDropSetAllowed(card?.set || "");
      });
      if (!requirementSetAllowed) {
        return null;
      }
      return {
        questKey: String(row?.quest_key || ""),
        title: String(row?.title || ""),
        description: String(row?.description || ""),
        rewardType,
        rewardCardId,
        rewardCard,
        questSetKey,
        difficultyKey,
        isDraft,
        targetLocationCardId,
        targetLocationCard,
        anomalyLocationIds,
        requirements,
      };
    })
    .filter(Boolean);
}

function listPerimPlayerQuestRows(ownerKeyRaw) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return [];
  }
  return sqliteDb
    .prepare(`
      SELECT id, owner_key, quest_key, status, reserved_run_id, assigned_at, updated_at, granted_at
      FROM perim_player_quests
      WHERE owner_key = ?
      ORDER BY assigned_at ASC
    `)
    .all(ownerKey);
}

function isPerimQuestExclusiveRewardType(cardTypeRaw) {
  const cardType = normalizeQuestCardType(cardTypeRaw || "");
  return PERIM_QUEST_EXCLUSIVE_REWARD_TYPES.has(cardType);
}

function getPerimQuestExclusiveRewardCardKeySet() {
  const set = new Set();
  if (!isSqlV2Ready()) {
    return set;
  }
  let rows = [];
  try {
    rows = sqliteDb
      .prepare(`
        SELECT reward_type, reward_card_id
        FROM perim_quest_templates
        WHERE trim(COALESCE(reward_type, '')) <> ''
          AND trim(COALESCE(reward_card_id, '')) <> ''
      `)
      .all();
  } catch (error) {
    console.warn(`[PERIM][QUESTS] Falha ao carregar cartas quest-exclusive: ${error?.message || error}`);
    return set;
  }
  rows.forEach((row) => {
    const rewardType = normalizeQuestCardType(row?.reward_type || "");
    const rewardCardId = String(row?.reward_card_id || "").trim();
    if (!rewardType || !rewardCardId || !isPerimQuestExclusiveRewardType(rewardType)) {
      return;
    }
    set.add(`${rewardType}:${rewardCardId}`);
  });
  return set;
}

function getPerimRewardMaxCopies(rewardTypeRaw, rewardCardIdRaw, questExclusiveRewardCardKeys = null) {
  const rewardType = normalizeQuestCardType(rewardTypeRaw || "");
  const rewardCardId = String(rewardCardIdRaw || "").trim();
  if (!rewardType || !rewardCardId) {
    return INVENTORY_MAX_COPIES;
  }
  const key = `${rewardType}:${rewardCardId}`;
  const questExclusive = questExclusiveRewardCardKeys instanceof Set
    ? questExclusiveRewardCardKeys
    : getPerimQuestExclusiveRewardCardKeySet();
  if (questExclusive.has(key)) {
    return PERIM_QUEST_EXCLUSIVE_MAX_COPIES;
  }
  return INVENTORY_MAX_COPIES;
}

function getQuestUnlockedRewardKeySet(ownerKeyRaw) {
  const set = new Set();
  if (!isSqlV2Ready()) {
    return set;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return set;
  }
  sqliteDb
    .prepare("SELECT card_type, card_id FROM perim_quest_unlocks WHERE owner_key = ?")
    .all(ownerKey)
    .forEach((row) => {
      const cardType = normalizeQuestCardType(row?.card_type || "");
      const cardId = String(row?.card_id || "").trim();
      if (!cardType || !cardId) {
        return;
      }
      set.add(`${cardType}:${cardId}`);
    });
  return set;
}

function getQuestLockedRewardKeySet(ownerKeyRaw) {
  return getPerimQuestExclusiveRewardCardKeySet();
}

function computePerimQuestProgress(ownerKeyRaw, cards) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey || !isSqlV2Ready()) {
    return [];
  }
  const templates = listPerimQuestTemplates();
  if (!templates.length) {
    return [];
  }
  const rows = listPerimPlayerQuestRows(ownerKey);
  const rowByQuest = new Map(rows.map((row) => [String(row?.quest_key || ""), row]));
  const inventoryCounts = buildInventoryCountMap(cards);
  const cardIndexes = getLibraryCardIndexes();
  const now = nowIso();
  const quests = [];
  templates.forEach((template) => {
    const row = rowByQuest.get(template.questKey);
    if (!row) {
      return;
    }
    let status = String(row?.status || "active");
    const requirements = template.requirements.map((entry) => {
      const owned = Math.max(0, Number(inventoryCounts.get(`${entry.cardType}:${entry.cardId}`) || 0));
      const card = cardIndexes.byId.get(entry.cardId) || null;
      return {
        ...entry,
        cardName: String(card?.name || entry.cardId),
        owned,
        done: owned >= entry.required,
      };
    });
    const readyByInventory = requirements.every((entry) => entry.done);
    if (status === "active" && readyByInventory) {
      status = "ready_to_redeem";
      sqliteDb
        .prepare("UPDATE perim_player_quests SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, now, Number(row.id));
    }
    const rewardKey = `${template.rewardType}:${template.rewardCardId}`;
    const rewardSet = normalizePerimDropSetKey(template.rewardCard?.set || "");
    quests.push({
      questKey: template.questKey,
      title: template.title,
      description: template.description,
      questSetKey: template.questSetKey || normalizePerimDropSetKey(template.rewardCard?.set || ""),
      difficultyKey: template.difficultyKey || "ok",
      status,
      assignedAt: String(row?.assigned_at || now),
      updatedAt: String(row?.updated_at || now),
      grantedAt: row?.granted_at ? String(row.granted_at) : null,
      reservedRunId: row?.reserved_run_id ? String(row.reserved_run_id) : "",
      reward: {
        key: rewardKey,
        type: template.rewardType,
        cardId: template.rewardCardId,
        cardName: String(template.rewardCard?.name || template.rewardCardId),
        set: String(template.rewardCard?.set || ""),
        rarity: String(template.rewardCard?.rarity || ""),
        image: String(template.rewardCard?.image || ""),
        setAllowed: getPerimAllowedDropSetKeys().has(rewardSet),
      },
      targetLocation: {
        cardId: template.targetLocationCardId,
        name: String(template.targetLocationCard?.name || template.targetLocationCardId),
        set: String(template.targetLocationCard?.set || ""),
      },
      requirements,
      readyByInventory,
    });
  });
  return quests;
}

function assignPerimQuestFromAnomaly(ownerKeyRaw, locationCardIdRaw, cards) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const locationCardId = String(locationCardIdRaw || "").trim();
  if (!ownerKey || !locationCardId || !isSqlV2Ready()) {
    return null;
  }
  if (Math.random() > PERIM_ANOMALY_QUEST_DROP_CHANCE) {
    return null;
  }
  const templates = listPerimQuestTemplates();
  if (!templates.length) {
    return null;
  }
  const rows = listPerimPlayerQuestRows(ownerKey);
  const existing = new Set(rows.map((row) => String(row?.quest_key || "")));
  const eligible = templates.filter((template) => {
    if (existing.has(template.questKey)) {
      return false;
    }
    const anomalyLocations = Array.isArray(template.anomalyLocationIds) ? template.anomalyLocationIds : [];
    if (!anomalyLocations.length) {
      return true;
    }
    return anomalyLocations.includes(locationCardId);
  });
  if (!eligible.length) {
    return null;
  }
  const picked = pickFromList(eligible);
  if (!picked) {
    return null;
  }
  const now = nowIso();
  sqliteDb.prepare(`
    INSERT OR IGNORE INTO perim_player_quests (owner_key, quest_key, status, reserved_run_id, assigned_at, updated_at, granted_at)
    VALUES (?, ?, 'active', NULL, ?, ?, NULL)
  `).run(ownerKey, picked.questKey, now, now);
  createProfileNotification(
    ownerKey,
    "quest_unlocked",
    "Nova quest de anomalia",
    `Missao desbloqueada: ${picked.title}.`,
    { questKey: picked.questKey }
  );
  return picked;
}

function reserveQuestRewardForRun(ownerKeyRaw, runIdRaw, locationCardIdRaw, rewards, inventoryCounts, options = {}) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const runId = String(runIdRaw || "").trim();
  const locationCardId = String(locationCardIdRaw || "").trim();
  if (!ownerKey || !runId || !locationCardId || !Array.isArray(rewards) || !isSqlV2Ready()) {
    return null;
  }
  const cards = Array.isArray(options.cards) ? options.cards : [];
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const questExclusiveRewardCardKeys = options.questExclusiveRewardCardKeys instanceof Set
    ? options.questExclusiveRewardCardKeys
    : getPerimQuestExclusiveRewardCardKeySet();
  const quests = computePerimQuestProgress(ownerKey, cards);
  const candidate = quests.find(
    (quest) => quest.status === "ready_to_redeem" && String(quest?.targetLocation?.cardId || "") === locationCardId
  );
  if (!candidate) {
    return null;
  }
  const rewardType = normalizeQuestCardType(candidate?.reward?.type || "");
  const rewardCardId = String(candidate?.reward?.cardId || "").trim();
  if (!rewardType || !rewardCardId) {
    return null;
  }
  const stockKey = `${rewardType}:${rewardCardId}`;
  const currentAmount = Math.max(0, Number(inventoryCounts?.get(stockKey) || 0));
  const maxCopies = getPerimRewardMaxCopies(rewardType, rewardCardId, questExclusiveRewardCardKeys);
  if (!ignoreInventoryCap && currentAmount >= maxCopies) {
    return null;
  }
  const rewardPayload = normalizeRewardPayload({
    type: rewardType,
    cardId: rewardCardId,
    cardName: candidate?.reward?.cardName || rewardCardId,
    rarity: candidate?.reward?.rarity || "Unknown",
    image: candidate?.reward?.image || "",
    source: "perim_quest_reward",
    questKey: candidate.questKey,
  });
  if (!rewardPayload) {
    return null;
  }
  rewardPayload.source = "perim_quest_reward";
  rewardPayload.questKey = candidate.questKey;
  rewards.push(rewardPayload);
  increaseInventoryCountMap(inventoryCounts, rewardPayload);
  sqliteDb
    .prepare("UPDATE perim_player_quests SET status = 'reward_reserved', reserved_run_id = ?, updated_at = ? WHERE owner_key = ? AND quest_key = ?")
    .run(runId, nowIso(), ownerKey, candidate.questKey);
  return { questKey: candidate.questKey, reward: rewardPayload };
}

function grantReservedQuestByRun(ownerKeyRaw, runIdRaw, rewards, options = {}) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const runId = String(runIdRaw || "").trim();
  if (!ownerKey || !runId || !isSqlV2Ready()) {
    return null;
  }
  const row = sqliteDb
    .prepare(`
      SELECT quest_key
      FROM perim_player_quests
      WHERE owner_key = ? AND reserved_run_id = ? AND status = 'reward_reserved'
      LIMIT 1
    `)
    .get(ownerKey, runId);
  if (!row?.quest_key) {
    return null;
  }
  const questKey = String(row.quest_key);
  const templates = listPerimQuestTemplates();
  const template = templates.find((entry) => entry.questKey === questKey) || null;
  if (!template) {
    return null;
  }
  const rewardType = normalizeQuestCardType(template.rewardType);
  const rewardCardId = String(template.rewardCardId || "").trim();
  const questExclusiveRewardCardKeys = options.questExclusiveRewardCardKeys instanceof Set
    ? options.questExclusiveRewardCardKeys
    : getPerimQuestExclusiveRewardCardKeySet();
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : null;
  const hasRewardInRun = Array.isArray(rewards)
    && rewards.some((entry) => String(entry?.type || "") === rewardType && String(entry?.cardId || "") === rewardCardId);
  const rewardStockKey = `${rewardType}:${rewardCardId}`;
  const currentAmount = inventoryCounts instanceof Map
    ? Math.max(0, Number(inventoryCounts.get(rewardStockKey) || 0))
    : 0;
  const maxCopies = getPerimRewardMaxCopies(rewardType, rewardCardId, questExclusiveRewardCardKeys);
  const capReachedWithoutReward = !hasRewardInRun && Boolean(inventoryCounts instanceof Map) && currentAmount >= maxCopies;
  if (!hasRewardInRun) {
    if (!capReachedWithoutReward) {
      return null;
    }
    console.log(
      `[PERIM][QUEST] ${questKey} marcado como concedido sem copia extra para ${ownerKey} (cap ${maxCopies}).`
    );
  }
  if (!hasRewardInRun && capReachedWithoutReward) {
    // Continue with status update/unlock insertion to avoid leaving the quest in reward_reserved.
  }
  if (!rewardType || !rewardCardId) {
    return null;
  }
  const now = nowIso();
  sqliteDb
    .prepare("UPDATE perim_player_quests SET status = 'reward_granted', granted_at = ?, updated_at = ?, reserved_run_id = NULL WHERE owner_key = ? AND quest_key = ?")
    .run(now, now, ownerKey, questKey);
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO perim_quest_unlocks (owner_key, card_type, card_id, source_quest_key, unlocked_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(ownerKey, rewardType, rewardCardId, questKey, now);
  createProfileNotification(
    ownerKey,
    "quest_completed",
    "Quest concluida",
    `Voce concluiu ${template.title} e liberou ${template.rewardCard?.name || rewardCardId}.`,
    { questKey, rewardType, rewardCardId }
  );
  return { questKey, rewardType, rewardCardId };
}

function normalizePerimDropTables(payload) {
  const defaults = cloneDefaultPerimDropTables();
  const source = payload && typeof payload === "object" ? payload : {};

  const normalized = {
    schemaVersion: 1,
    updatedAt: nowIso(),
    actions: {},
    rarityCreatureDelta: { ...defaults.rarityCreatureDelta },
    creatureRarityDropChance: { ...defaults.creatureRarityDropChance },
    creatureScanRarityMultiplier: { ...defaults.creatureScanRarityMultiplier },
    locationRarityDropChance: { ...defaults.locationRarityDropChance },
    climateTypeModifiers: {},
    locationRules: { ...defaults.locationRules },
    campCreatureStacking: { ...defaults.campCreatureStacking },
    limits: { ...defaults.limits },
    scanner: {
      globalDurationByTotalLevel: [...defaults.scanner.globalDurationByTotalLevel],
      tribeLevelEffects: { ...defaults.scanner.tribeLevelEffects },
    },
  };

  const actionSource = source.actions && typeof source.actions === "object" ? source.actions : {};
  PERIM_ACTIONS.forEach((action) => {
    const actionId = String(action?.id || "");
    const fallback = defaults.actions[actionId] || defaults.actions.explore;
    const candidate = actionSource[actionId] && typeof actionSource[actionId] === "object"
      ? actionSource[actionId]
      : {};
    const primaryFallback = fallback?.primary && typeof fallback.primary === "object" ? fallback.primary : {};
    const primaryCandidate = candidate.primary && typeof candidate.primary === "object" ? candidate.primary : {};
    const primary = {};
    Object.keys(primaryFallback).forEach((rewardType) => {
      const weight = Number(primaryCandidate[rewardType]);
      primary[rewardType] = Number.isFinite(weight) && weight > 0 ? weight : Number(primaryFallback[rewardType] || 0);
    });
    normalized.actions[actionId] = {
      creatureBaseChance: clampPercent(Number(candidate.creatureBaseChance ?? fallback.creatureBaseChance ?? 50)),
      primary,
      bonusChance: clampUnitInterval(candidate.bonusChance, fallback.bonusChance),
      attackChance: clampUnitInterval(candidate.attackChance, fallback.attackChance),
      baseSuccessChance: clampUnitInterval(candidate.baseSuccessChance, fallback.baseSuccessChance),
      locationDropBias: Math.max(0.2, Number(candidate.locationDropBias ?? fallback.locationDropBias ?? 1)),
    };
  });

  Object.keys(normalized.rarityCreatureDelta).forEach((key) => {
    const raw = source?.rarityCreatureDelta?.[key];
    if (Number.isFinite(Number(raw))) {
      normalized.rarityCreatureDelta[key] = Number(raw);
    }
  });
  Object.keys(normalized.creatureRarityDropChance).forEach((key) => {
    const raw = source?.creatureRarityDropChance?.[key];
    if (Number.isFinite(Number(raw))) {
      normalized.creatureRarityDropChance[key] = clampUnitInterval(raw, normalized.creatureRarityDropChance[key]);
    }
  });
  Object.keys(normalized.creatureScanRarityMultiplier).forEach((key) => {
    const raw = source?.creatureScanRarityMultiplier?.[key];
    if (Number.isFinite(Number(raw))) {
      normalized.creatureScanRarityMultiplier[key] = Math.max(0.05, Number(raw));
    }
  });
  Object.keys(normalized.locationRarityDropChance).forEach((key) => {
    const raw = source?.locationRarityDropChance?.[key];
    if (Number.isFinite(Number(raw))) {
      normalized.locationRarityDropChance[key] = clampUnitInterval(raw, normalized.locationRarityDropChance[key]);
    }
  });

  const climateDefaults = defaults.climateTypeModifiers || {};
  Object.keys(climateDefaults).forEach((climateKey) => {
    const fallback = climateDefaults[climateKey] || {};
    const candidate = source?.climateTypeModifiers?.[climateKey] && typeof source.climateTypeModifiers[climateKey] === "object"
      ? source.climateTypeModifiers[climateKey]
      : {};
    normalized.climateTypeModifiers[climateKey] = {};
    Object.keys(fallback).forEach((rewardType) => {
      const raw = Number(candidate[rewardType]);
      normalized.climateTypeModifiers[climateKey][rewardType] = Number.isFinite(raw) ? Math.max(0.1, raw) : Number(fallback[rewardType] || 1);
    });
  });

  normalized.locationRules.adjacentFirstChance = clampUnitInterval(
    source?.locationRules?.adjacentFirstChance,
    defaults.locationRules.adjacentFirstChance
  );
  normalized.locationRules.fallbackCurrentMinChance = clampUnitInterval(
    source?.locationRules?.fallbackCurrentMinChance,
    defaults.locationRules.fallbackCurrentMinChance
  );
  const campStackingSource = source?.campCreatureStacking && typeof source.campCreatureStacking === "object"
    ? source.campCreatureStacking
    : {};
  normalized.campCreatureStacking = {
    enabled: campStackingSource.enabled !== undefined
      ? Boolean(campStackingSource.enabled)
      : Boolean(defaults.campCreatureStacking.enabled),
    bonusPerWaitPercent: clampPercent(
      Number(campStackingSource.bonusPerWaitPercent ?? defaults.campCreatureStacking.bonusPerWaitPercent)
    ),
    maxBonusPercent: clampPercent(
      Number(campStackingSource.maxBonusPercent ?? defaults.campCreatureStacking.maxBonusPercent)
    ),
    bonusMaxRarity: String(
      campStackingSource.bonusMaxRarity
      || defaults.campCreatureStacking.bonusMaxRarity
      || "super rare"
    ),
  };
  if (normalized.campCreatureStacking.maxBonusPercent < normalized.campCreatureStacking.bonusPerWaitPercent) {
    normalized.campCreatureStacking.maxBonusPercent = normalized.campCreatureStacking.bonusPerWaitPercent;
  }

  normalized.limits.maxCreatureDropsPerRun = Math.max(
    0,
    Math.min(3, Math.floor(Number(source?.limits?.maxCreatureDropsPerRun ?? defaults.limits.maxCreatureDropsPerRun)))
  );
  normalized.limits.maxTotalDropsPerRun = Math.max(
    1,
    Math.min(12, Math.floor(Number(source?.limits?.maxTotalDropsPerRun ?? defaults.limits.maxTotalDropsPerRun ?? 4)))
  );

  const durationEntries = Array.isArray(source?.scanner?.globalDurationByTotalLevel)
    ? source.scanner.globalDurationByTotalLevel
    : defaults.scanner.globalDurationByTotalLevel;
  normalized.scanner.globalDurationByTotalLevel = durationEntries
    .map((entry) => ({
      minTotalLevel: Math.max(0, Math.floor(Number(entry?.minTotalLevel ?? 0))),
      multiplier: Math.max(0.55, Math.min(1.0, Number(entry?.multiplier ?? 1))),
    }))
    .filter((entry) => Number.isFinite(entry.minTotalLevel) && Number.isFinite(entry.multiplier))
    .sort((a, b) => a.minTotalLevel - b.minTotalLevel);
  if (!normalized.scanner.globalDurationByTotalLevel.length) {
    normalized.scanner.globalDurationByTotalLevel = [...defaults.scanner.globalDurationByTotalLevel];
  }

  const tribeDefaultEffects = defaults.scanner.tribeLevelEffects || {};
  const tribeSource = source?.scanner?.tribeLevelEffects && typeof source.scanner.tribeLevelEffects === "object"
    ? source.scanner.tribeLevelEffects
    : {};
  const tribeEffects = {};
  [1, 2, 3, 4].forEach((level) => {
    const fallback = tribeDefaultEffects[level] || tribeDefaultEffects[String(level)] || {};
    const candidate = tribeSource[level] || tribeSource[String(level)] || {};
    tribeEffects[level] = {
      successBoostPercent: Math.max(0, Math.min(40, Number(candidate.successBoostPercent ?? fallback.successBoostPercent ?? 0))),
      creatureRareBoost: Math.max(0, Math.min(2, Number(candidate.creatureRareBoost ?? fallback.creatureRareBoost ?? 0))),
      mugicRareBoost: Math.max(0, Math.min(2, Number(candidate.mugicRareBoost ?? fallback.mugicRareBoost ?? 0))),
    };
  });
  normalized.scanner.tribeLevelEffects = tribeEffects;

  return normalized;
}

function persistPerimDropTables(payload) {
  fs.mkdirSync(path.dirname(PERIM_DROP_TABLES_FILE), { recursive: true });
  fs.writeFileSync(PERIM_DROP_TABLES_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function loadPerimDropTables(forceReload = false) {
  if (perimDropTablesCache && !forceReload) {
    return perimDropTablesCache;
  }
  let normalized = cloneDefaultPerimDropTables();
  try {
    if (fs.existsSync(PERIM_DROP_TABLES_FILE)) {
      const raw = safeJsonParse(fs.readFileSync(PERIM_DROP_TABLES_FILE, "utf8"), null);
      normalized = normalizePerimDropTables(raw);
    } else {
      normalized = normalizePerimDropTables(cloneDefaultPerimDropTables());
      persistPerimDropTables(normalized);
    }
  } catch (error) {
    console.warn(`[PERIM] Falha ao carregar perim-drop-tables.json: ${error?.message || error}`);
    normalized = normalizePerimDropTables(cloneDefaultPerimDropTables());
  }
  perimDropTablesCache = normalized;
  return perimDropTablesCache;
}

function getPerimDropTables() {
  return loadPerimDropTables(false);
}

function getPerimRewardProfile(actionId) {
  const tables = getPerimDropTables();
  return tables.actions?.[actionId] || tables.actions?.explore || cloneDefaultPerimDropTables().actions.explore;
}

function getPerimClimateTypeModifier(climateRaw, rewardType) {
  const climateKey = normalizeClimateText(climateRaw);
  const tables = getPerimDropTables();
  const byClimate = tables.climateTypeModifiers?.[climateKey]
    || tables.climateTypeModifiers?.nublado
    || {};
  const value = Number(byClimate?.[String(rewardType || "")] || 1);
  return Number.isFinite(value) ? Math.max(0.1, value) : 1;
}

function getPerimCreatureBaseChanceByAction(actionId) {
  const profile = getPerimRewardProfile(actionId);
  return clampPercent(profile?.creatureBaseChance ?? 50);
}

function getPerimRarityCreatureDelta(rarityKey) {
  const tables = getPerimDropTables();
  return Number(tables.rarityCreatureDelta?.[rarityKey] || 0);
}

function getPerimCreatureRarityDropChance(rarityKey) {
  const tables = getPerimDropTables();
  return Math.max(0, Math.min(1, Number(tables.creatureRarityDropChance?.[rarityKey] || 0.15)));
}

function getPerimCreatureScanRarityMultiplier(rarityKey) {
  const tables = getPerimDropTables();
  return Math.max(0.05, Number(tables.creatureScanRarityMultiplier?.[rarityKey] || 1));
}

function getPerimLocationRarityDropChance(rarityKey) {
  const tables = getPerimDropTables();
  return Math.max(0, Math.min(1, Number(tables.locationRarityDropChance?.[rarityKey] || 0.1)));
}

function getPerimLocationRules() {
  const tables = getPerimDropTables();
  return tables.locationRules || cloneDefaultPerimDropTables().locationRules;
}

function listActivePerimDropEventsForLocation(locationCardIdRaw, nowDate = new Date()) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const locationCardId = String(locationCardIdRaw || "").trim();
  if (!locationCardId) {
    return [];
  }
  const nowIsoText = new Date(nowDate).toISOString();
  let rows = [];
  try {
    rows = sqliteDb
      .prepare(`
        SELECT id, event_text, card_type, card_id, location_card_id, chance_percent, start_at, end_at, enabled
        FROM perim_drop_events
        WHERE enabled = 1
          AND location_card_id = ?
          AND start_at <= ?
          AND end_at >= ?
        ORDER BY chance_percent DESC, id ASC
      `)
      .all(locationCardId, nowIsoText, nowIsoText);
  } catch (error) {
    console.warn(`[PERIM][EVENTS] Falha ao consultar eventos de drop: ${error?.message || error}`);
    return [];
  }
  return rows.map((row) => ({
    id: Number(row?.id || 0),
    eventText: String(row?.event_text || ""),
    cardType: String(row?.card_type || ""),
    cardId: String(row?.card_id || ""),
    locationCardId: String(row?.location_card_id || ""),
    chancePercent: Math.max(0, Math.min(100, Number(row?.chance_percent || 0))),
    startAt: String(row?.start_at || ""),
    endAt: String(row?.end_at || ""),
  }));
}

function listPerimBattlegearSpawnRules(enabledOnly = false) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const enabledClause = enabledOnly ? "AND enabled = 1" : "";
  let rows = [];
  try {
    rows = sqliteDb
      .prepare(`
        SELECT card_id, location_1_card_id, location_2_card_id, chance_percent, enabled, updated_at
        FROM perim_battlegear_spawn_rules
        WHERE trim(COALESCE(card_id, '')) <> ''
          AND trim(COALESCE(location_1_card_id, '')) <> ''
          AND trim(COALESCE(location_2_card_id, '')) <> ''
          ${enabledClause}
      `)
      .all();
  } catch (error) {
    console.warn(`[PERIM][BATTLEGEAR] Falha ao listar regras de spawn: ${error?.message || error}`);
    return [];
  }
  const cardsByType = Array.isArray(library?.cardsByType?.battlegear) ? library.cardsByType.battlegear : [];
  const battlegearById = new Map(cardsByType.map((card) => [String(card?.id || ""), card]));
  const { locationsById } = getLibraryIndexes();
  return rows
    .map((row) => {
      const cardId = String(row?.card_id || "").trim();
      const location1CardId = String(row?.location_1_card_id || "").trim();
      const location2CardId = String(row?.location_2_card_id || "").trim();
      if (!cardId || !location1CardId || !location2CardId || location1CardId === location2CardId) {
        return null;
      }
      if (!battlegearById.has(cardId)) {
        return null;
      }
      if (!locationsById.has(location1CardId) || !locationsById.has(location2CardId)) {
        return null;
      }
      return {
        cardId,
        location1CardId,
        location2CardId,
        chancePercent: clampPercent(row?.chance_percent, 0),
        enabled: Number(row?.enabled || 0) === 1,
        updatedAt: String(row?.updated_at || ""),
      };
    })
    .filter(Boolean);
}

function ensurePerimBattlegearDailySpawnsForDate(dateKeyRaw = "", forceRegenerate = false) {
  if (!sqliteDb) {
    return { dateKey: todayDateKey(), generated: 0, skippedExisting: 0, questExclusiveSkipped: 0 };
  }
  const dateKey = String(dateKeyRaw || todayDateKey()).trim() || todayDateKey();
  const rules = listPerimBattlegearSpawnRules(true);
  const questExclusiveRewardCardKeys = getPerimQuestExclusiveRewardCardKeySet();
  const existingRows = sqliteDb
    .prepare("SELECT card_id FROM perim_battlegear_daily_spawns WHERE date_key = ?")
    .all(dateKey);
  const existingCardIds = new Set(existingRows.map((row) => String(row?.card_id || "").trim()).filter(Boolean));

  let generated = 0;
  let skippedExisting = 0;
  let questExclusiveSkipped = 0;
  const generatedAt = nowIso();

  const upsert = sqliteDb.prepare(`
    INSERT INTO perim_battlegear_daily_spawns (
      date_key, card_id, selected_location_card_id, chance_percent, roll_value, is_available, generated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_key, card_id) DO UPDATE SET
      selected_location_card_id = excluded.selected_location_card_id,
      chance_percent = excluded.chance_percent,
      roll_value = excluded.roll_value,
      is_available = excluded.is_available,
      generated_at = excluded.generated_at
  `);

  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    if (forceRegenerate) {
      sqliteDb.prepare("DELETE FROM perim_battlegear_daily_spawns WHERE date_key = ?").run(dateKey);
      existingCardIds.clear();
    }
    for (const rule of rules) {
      const key = `battlegear:${rule.cardId}`;
      if (questExclusiveRewardCardKeys.has(key)) {
        questExclusiveSkipped += 1;
        sqliteDb
          .prepare("DELETE FROM perim_battlegear_daily_spawns WHERE date_key = ? AND card_id = ?")
          .run(dateKey, rule.cardId);
        continue;
      }
      if (!forceRegenerate && existingCardIds.has(rule.cardId)) {
        skippedExisting += 1;
        continue;
      }
      const chosenLocationCardId = Math.random() < 0.5 ? rule.location1CardId : rule.location2CardId;
      const chancePercent = clampPercent(rule.chancePercent, 0);
      const rollValue = Math.max(0, Math.min(100, Math.random() * 100));
      const isAvailable = rollValue <= chancePercent ? 1 : 0;
      upsert.run(dateKey, rule.cardId, chosenLocationCardId, chancePercent, rollValue, isAvailable, generatedAt);
      generated += 1;
    }
    sqliteDb.exec("COMMIT");
  } catch (error) {
    sqliteDb.exec("ROLLBACK");
    throw error;
  }

  return {
    dateKey,
    generated,
    skippedExisting,
    questExclusiveSkipped,
    rulesTotal: rules.length,
  };
}

function getPerimAvailableBattlegearCardIdsForLocation(locationCardIdRaw, dateKeyRaw = "") {
  const set = new Set();
  if (!sqliteDb) {
    return set;
  }
  const locationCardId = String(locationCardIdRaw || "").trim();
  if (!locationCardId) {
    return set;
  }
  const dateKey = String(dateKeyRaw || todayDateKey()).trim() || todayDateKey();
  try {
    ensurePerimBattlegearDailySpawnsForDate(dateKey, false);
  } catch (error) {
    console.warn(`[PERIM][BATTLEGEAR] Falha ao garantir snapshot diario (${dateKey}): ${error?.message || error}`);
  }
  let rows = [];
  try {
    rows = sqliteDb
      .prepare(`
        SELECT card_id
        FROM perim_battlegear_daily_spawns
        WHERE date_key = ?
          AND selected_location_card_id = ?
          AND is_available = 1
      `)
      .all(dateKey, locationCardId);
  } catch (error) {
    console.warn(`[PERIM][BATTLEGEAR] Falha ao consultar disponibilidade diaria (${dateKey}): ${error?.message || error}`);
    return set;
  }
  rows.forEach((row) => {
    const cardId = String(row?.card_id || "").trim();
    if (cardId) {
      set.add(cardId);
    }
  });
  return set;
}

function getPerimMaxCreatureDropsPerRun() {
  const tables = getPerimDropTables();
  const limit = Math.floor(Number(tables?.limits?.maxCreatureDropsPerRun || 1));
  return Math.max(0, Math.min(3, limit));
}

function getPerimMaxTotalDropsPerRun() {
  const tables = getPerimDropTables();
  const limit = Math.floor(Number(tables?.limits?.maxTotalDropsPerRun || 4));
  return Math.max(1, Math.min(12, limit));
}

function getPerimCampCreatureStackingSettings() {
  const tables = getPerimDropTables();
  const fallback = cloneDefaultPerimDropTables().campCreatureStacking || DEFAULT_PERIM_CAMP_CREATURE_STACKING;
  const raw = tables?.campCreatureStacking && typeof tables.campCreatureStacking === "object"
    ? tables.campCreatureStacking
    : fallback;
  const bonusPerWaitPercent = clampPercent(Number(raw?.bonusPerWaitPercent ?? fallback.bonusPerWaitPercent ?? 0));
  const maxBonusPercent = clampPercent(Number(raw?.maxBonusPercent ?? fallback.maxBonusPercent ?? 0));
  return {
    enabled: Boolean(raw?.enabled ?? fallback.enabled),
    bonusPerWaitPercent,
    maxBonusPercent: Math.max(maxBonusPercent, bonusPerWaitPercent),
    bonusMaxRarity: String(raw?.bonusMaxRarity || fallback.bonusMaxRarity || "super rare"),
  };
}

function calculatePerimCampCreatureBonusPercent(waitCountRaw) {
  const settings = getPerimCampCreatureStackingSettings();
  if (!settings.enabled) {
    return 0;
  }
  const waitCount = Math.max(0, Math.floor(Number(waitCountRaw || 0)));
  if (!waitCount) {
    return 0;
  }
  return clampPercent(Math.min(settings.maxBonusPercent, waitCount * settings.bonusPerWaitPercent));
}

function getScannerDurationMultiplierByTotalLevel(totalLevel) {
  const tables = getPerimDropTables();
  const ladder = Array.isArray(tables?.scanner?.globalDurationByTotalLevel)
    ? tables.scanner.globalDurationByTotalLevel
    : [];
  const normalizedTotal = Math.max(0, Number(totalLevel || 0));
  let multiplier = 1;
  ladder.forEach((entry) => {
    if (normalizedTotal >= Number(entry?.minTotalLevel || 0)) {
      multiplier = Math.max(0.55, Math.min(1, Number(entry?.multiplier || 1)));
    }
  });
  return multiplier;
}

function getScannerTribeLevelEffect(level) {
  const tables = getPerimDropTables();
  const normalizedLevel = Math.max(1, Math.min(4, Number(level || 1)));
  const effect = tables?.scanner?.tribeLevelEffects?.[normalizedLevel]
    || tables?.scanner?.tribeLevelEffects?.[String(normalizedLevel)]
    || { successBoostPercent: 0, creatureRareBoost: 0, mugicRareBoost: 0 };
  return {
    successBoostPercent: Math.max(0, Math.min(40, Number(effect?.successBoostPercent || 0))),
    creatureRareBoost: Math.max(0, Math.min(2, Number(effect?.creatureRareBoost || 0))),
    mugicRareBoost: Math.max(0, Math.min(2, Number(effect?.mugicRareBoost || 0))),
  };
}

function formatPerimWeightMap(weights) {
  return Object.entries(weights || {})
    .map(([key, value]) => `${key}=${Number(value || 0)}`)
    .join(", ");
}

function buildPerimActionsDropsReportText() {
  const lines = [];
  lines.push("PERIM - Acoes e Regras de Drops");
  lines.push(`Gerado em: ${nowIso()}`);
  lines.push("");
  lines.push("Acoes:");
  PERIM_ACTIONS.forEach((action) => {
    const profile = getPerimRewardProfile(action.id) || {};
    lines.push(`- ${action.name} (${action.id})`);
    lines.push(`  descricao: ${action.description}`);
    lines.push(`  duracao_base_ms: ${Number(action.durationMs || 0)}`);
    lines.push(`  chance_sucesso_base: ${Number(profile.baseSuccessChance || 0)}`);
    lines.push(`  chance_bonus: ${Number(profile.bonusChance || 0)}`);
    lines.push(`  chance_attacks_extra: ${Number(profile.attackChance || 0)}`);
    lines.push(`  pesos_primarios: ${formatPerimWeightMap(profile.primary)}`);
  });
  lines.push("");
  lines.push("Regras gerais de drops:");
  lines.push("- Tipos possiveis: creatures, attacks, battlegear, mugic, locations.");
  lines.push("- Inventory cap: max 3 copias por carta (por usuario).");
  lines.push("- Cartas Alpha/Unused sao excluidas de drops e grants iniciais.");
  lines.push("- Creature rewards podem receber variacao: E(-5..+5), C/P/W/S(-5..+5), passo 5.");
  lines.push("- Scanner impacta sucesso, raridade e duracao por nivel (1..4).");
  lines.push("- Chances de criatura variam por acao; nao ha criatura garantida em toda conclusao.");
  lines.push("- Drop de Location usa chance por raridade do local e prioriza locais ligados.");
  lines.push("- Se local ligado nao cair, pode dropar o proprio local atual.");
  lines.push("- Se carta ja estiver no cap, ela e ignorada no roll.");
  lines.push("- Roleta diaria de clima: 10 climas com 5 efeitos cada, sorteio uniforme e snapshot por run.");
  lines.push("- Ataques rarissimos especiais: chance final de 0.01% por slot de ataque no Perim.");
  lines.push("");
  lines.push("Efeitos de Scanner por nivel:");
  [1, 2, 3, 4].forEach((level) => {
    const fx = scannerEffectsByLevel(level);
    lines.push(
      `- Nivel ${level}: durationMultiplier=${fx.durationMultiplier}, successBoostPercent=${fx.successBoostPercent}, rareBoost=${fx.rareBoost}`
    );
  });
  const durationLadder = getPerimDropTables()?.scanner?.globalDurationByTotalLevel || [];
  lines.push("- Duracao por soma total dos scanners:");
  durationLadder.forEach((entry) => {
    lines.push(`  totalLevel>=${Number(entry?.minTotalLevel || 0)} => durationMultiplier=${Number(entry?.multiplier || 1)}`);
  });
  lines.push("");
  lines.push("Clima por local:");
  lines.push("- Definido por perfil de bioma/local (deserto, floresta, aquatico, congelado, etc.).");
  lines.push("- Locais de chuva eterna permanecem Chuvoso.");
  lines.push("- Estado global compartilhado nas janelas: 06:00, 12:00 e 18:00.");
  lines.push("- Clima influencia o tipo de criatura elegivel/peso (nao altera raridade base).");
  lines.push("");
  lines.push("Pool de cartas elegiveis por tipo (sem Alpha/Unused e respeitando cap):");
  ["creatures", "attacks", "battlegear", "mugic", "locations"].forEach((type) => {
    const cards = Array.isArray(library?.cardsByType?.[type]) ? library.cardsByType[type] : [];
    const eligible = cards.filter((card) => {
      const nameLower = String(card?.name || "").toLowerCase();
      return !nameLower.includes("unused") && !nameLower.includes("alpha");
    });
    lines.push(`- ${type}: ${eligible.length} cartas elegiveis`);
  });
  lines.push("");
  lines.push("Rede de drops de locations (por local de origem):");
  const metaByCardId = buildPerimLocationMetaByCardId();
  const locations = Array.isArray(library?.cardsByType?.locations) ? library.cardsByType.locations : [];
  locations.forEach((locationCard) => {
    const meta = metaByCardId.get(String(locationCard.id));
    const linkedIds = meta?.linkedLocationIds
      ? Array.from(meta.linkedLocationIds)
      : [];
    const linkedNames = linkedIds
      .map((id) => locations.find((candidate) => String(candidate.id) === String(id)))
      .filter(Boolean)
      .map((card) => card.name);
    const chanceByRarity = Math.round(locationDropChanceByRarity(locationCard.rarity || meta?.rarity || "") * 100);
    lines.push(
      `- ${locationCard.name} [${locationCard.id}] chance_location_por_raridade=${chanceByRarity}% links=${linkedNames.join(", ") || "nenhum"}`
    );
  });
  return `${lines.join("\n")}\n`;
}

function writePerimActionsDropsReport() {
  const content = buildPerimActionsDropsReportText();
  fs.mkdirSync(path.dirname(PERIM_ACTIONS_DROPS_REPORT_FILE), { recursive: true });
  fs.writeFileSync(PERIM_ACTIONS_DROPS_REPORT_FILE, content, "utf8");
}

function normalizePerimText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parsePerimPercent(rawValue, fallback = 0) {
  const token = String(rawValue ?? "").trim().replace(",", ".");
  if (!token) {
    return fallback;
  }
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100) / 100));
}

function logPerimPerf(label, startedAtMs, extra = "") {
  if (String(process.env.PERIM_PERF_LOG || "") !== "1") {
    return;
  }
  const elapsedMs = Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[PERIM][PERF] ${label} ${elapsedMs}ms${suffix}`);
}

function calculateCreatureChancePercent(rarityRaw, actionId) {
  const rarity = normalizePerimText(rarityRaw);
  const base = Number(getPerimCreatureBaseChanceByAction(actionId));
  const delta = Number(getPerimRarityCreatureDelta(rarity));
  return clampPercent(base + delta);
}

function loadPerimLocationsMatrix() {
  const fileExists = fs.existsSync(PERIM_LOCATIONS_FILE);
  const fileMtimeMs = fileExists ? Number(fs.statSync(PERIM_LOCATIONS_FILE).mtimeMs || 0) : 0;
  if (perimLocationsMatrixCache && perimLocationsMatrixCache.mtimeMs === fileMtimeMs) {
    return perimLocationsMatrixCache.rows;
  }
  const rows = [];
  if (!fileExists) {
    perimLocationsMatrixCache = { mtimeMs: 0, rows };
    return rows;
  }
  try {
    const workbook = safeReadWorkbookFromFile(PERIM_LOCATIONS_FILE);
    const sheet = workbook.Sheets.Planilha1 || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      perimLocationsMatrixCache = { mtimeMs: fileMtimeMs, rows };
      return rows;
    }
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    rawRows.forEach((row) => {
      if (normalizePerimText(row["Column1.type"]) !== "locations") {
        return;
      }
      const name = String(row["Column1.name"] || "").trim();
      if (!name) {
        return;
      }
      const set = String(row["Column1.set"] || "").trim();
      const rarity = String(row.rarity || "").trim();
      const chanceScanPercent = parsePerimPercent(row["chance de scan"], 0);
      const eventFlag = normalizePerimText(row["EVENTO:"]);
      const environment = String(row["SOBRE OU EMBAIXO DA TERRA"] || "").trim();
      const linkedLocationNames = [];
      for (let idx = 1; idx <= 11; idx += 1) {
        const linkedName = String(row[`LIGADO A LOCAL ${idx}`] || "").trim();
        if (linkedName) {
          linkedLocationNames.push(linkedName);
        }
      }
      rows.push({
        name,
        set,
        rarity,
        chanceScanPercent,
        eventFlag,
        environment,
        linkedLocationNames,
      });
    });
  } catch (error) {
    console.warn(`[PERIM] Falha ao ler locais.xlsx: ${error.message}`);
  }
  perimLocationsMatrixCache = { mtimeMs: fileMtimeMs, rows };
  return rows;
}

function getPerimLocationAdjacencyCacheToken() {
  if (!sqliteDb) {
    return "no_sql";
  }
  try {
    const row = sqliteDb
      .prepare(`
        SELECT COUNT(*) AS total, MAX(updated_at) AS max_updated_at
        FROM perim_location_adjacency
      `)
      .get();
    const total = Number(row?.total || 0);
    const maxUpdatedAt = String(row?.max_updated_at || "");
    return `${total}:${maxUpdatedAt}`;
  } catch (error) {
    console.warn(`[PERIM] Falha ao ler token de adjacencia: ${error?.message || error}`);
    return "read_error";
  }
}

function loadPerimLocationAdjacencyLinks() {
  const token = getPerimLocationAdjacencyCacheToken();
  if (perimLocationAdjacencyCache.token === token) {
    return perimLocationAdjacencyCache;
  }
  const byFromCardId = new Map();
  const links = [];
  if (sqliteDb) {
    try {
      const rows = sqliteDb
        .prepare(`
          SELECT from_location_card_id, to_location_card_id
          FROM perim_location_adjacency
        `)
        .all();
      rows.forEach((row) => {
        const fromId = String(row?.from_location_card_id || "").trim();
        const toId = String(row?.to_location_card_id || "").trim();
        if (!fromId || !toId || fromId === toId) {
          return;
        }
        if (!byFromCardId.has(fromId)) {
          byFromCardId.set(fromId, new Set());
        }
        byFromCardId.get(fromId).add(toId);
        links.push({ fromId, toId });
      });
    } catch (error) {
      console.warn(`[PERIM] Falha ao ler adjacencia SQL: ${error?.message || error}`);
    }
  }
  perimLocationAdjacencyCache = { token, byFromCardId, links };
  return perimLocationAdjacencyCache;
}

function importPerimLocationAdjacencyFromMatrix(options = {}) {
  if (!sqliteDb) {
    return { imported: 0, skipped: 0, unresolved: 0, linksBefore: 0, linksAfter: 0 };
  }
  const replace = options?.replace !== false;
  const { locationsById: cardById } = getLibraryIndexes();
  const rows = loadPerimLocationsMatrix();
  const nameSetKeyToIds = new Map();
  const nameOnlyKeyToIds = new Map();

  cardById.forEach((card) => {
    const nameKey = normalizePerimText(card?.name || "");
    const setKey = normalizePerimText(card?.set || "");
    if (!nameKey) {
      return;
    }
    const nameSetKey = `${nameKey}|${setKey}`;
    if (!nameSetKeyToIds.has(nameSetKey)) {
      nameSetKeyToIds.set(nameSetKey, []);
    }
    nameSetKeyToIds.get(nameSetKey).push(String(card.id));
    if (!nameOnlyKeyToIds.has(nameKey)) {
      nameOnlyKeyToIds.set(nameKey, []);
    }
    nameOnlyKeyToIds.get(nameKey).push(String(card.id));
  });

  const pairSet = new Set();
  let unresolvedSources = 0;
  let unresolvedTargets = 0;

  rows.forEach((row) => {
    const sourceNameKey = normalizePerimText(row?.name || "");
    const sourceSetKey = normalizePerimText(row?.set || "");
    if (!sourceNameKey) {
      return;
    }
    const sourceCandidates = [
      ...(nameSetKeyToIds.get(`${sourceNameKey}|${sourceSetKey}`) || []),
      ...(nameOnlyKeyToIds.get(sourceNameKey) || []),
    ];
    const sourceIds = [...new Set(sourceCandidates)].filter((cardId) => cardById.has(cardId));
    if (!sourceIds.length) {
      unresolvedSources += 1;
      return;
    }

    const linkedNames = Array.isArray(row?.linkedLocationNames) ? row.linkedLocationNames : [];
    linkedNames.forEach((linkedNameRaw) => {
      const linkedNameKey = normalizePerimText(linkedNameRaw);
      if (!linkedNameKey) {
        return;
      }
      const targetIds = [...new Set(nameOnlyKeyToIds.get(linkedNameKey) || [])].filter((cardId) => cardById.has(cardId));
      if (!targetIds.length) {
        unresolvedTargets += 1;
        return;
      }
      sourceIds.forEach((fromId) => {
        targetIds.forEach((toId) => {
          if (!fromId || !toId || fromId === toId) {
            return;
          }
          pairSet.add(`${fromId}=>${toId}`);
        });
      });
    });
  });

  const links = [...pairSet].map((entry) => {
    const [fromId, toId] = String(entry).split("=>");
    return { fromId, toId };
  });
  const linksBefore = Number(
    sqliteDb.prepare("SELECT COUNT(*) AS total FROM perim_location_adjacency").get()?.total || 0
  );

  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    if (replace) {
      sqliteDb.prepare("DELETE FROM perim_location_adjacency").run();
    }
    const upsert = sqliteDb.prepare(`
      INSERT INTO perim_location_adjacency (from_location_card_id, to_location_card_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(from_location_card_id, to_location_card_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `);
    const now = nowIso();
    links.forEach((link) => {
      upsert.run(link.fromId, link.toId, now);
    });
    sqliteDb.exec("COMMIT");
  } catch (error) {
    sqliteDb.exec("ROLLBACK");
    throw error;
  }
  const linksAfter = Number(
    sqliteDb.prepare("SELECT COUNT(*) AS total FROM perim_location_adjacency").get()?.total || 0
  );
  perimLocationAdjacencyCache = { token: "", byFromCardId: new Map(), links: [] };
  perimLocationMetaByCardIdCache = { token: "", value: null };
  perimLocationAdjacencyGraphCache = { token: "", value: null };
  return {
    imported: links.length,
    unresolvedSources,
    unresolvedTargets,
    matrixRows: rows.length,
    linksBefore,
    linksAfter,
  };
}

function ensurePerimLocationAdjacencySeedFromMatrix() {
  if (!sqliteDb) {
    return;
  }
  try {
    const currentCount = Number(
      sqliteDb.prepare("SELECT COUNT(*) AS total FROM perim_location_adjacency").get()?.total || 0
    );
    if (currentCount > 0) {
      return;
    }
    const summary = importPerimLocationAdjacencyFromMatrix({ replace: true });
    console.log(
      `[PERIM] Adjacencia de locais importada da planilha para SQL: imported=${summary.imported}, unresolvedSources=${summary.unresolvedSources}, unresolvedTargets=${summary.unresolvedTargets}, total=${summary.linksAfter}.`
    );
  } catch (error) {
    console.warn(`[PERIM] Falha ao importar adjacencia inicial da planilha: ${error?.message || error}`);
  }
}

function buildPerimLocationMetaByCardId() {
  const rows = loadPerimLocationsMatrix();
  const matrixMtime = Number(perimLocationsMatrixCache?.mtimeMs || 0);
  const adjacencySnapshot = loadPerimLocationAdjacencyLinks();
  const cacheToken = `${matrixMtime}:${adjacencySnapshot.token}`;
  if (perimLocationMetaByCardIdCache.value && perimLocationMetaByCardIdCache.token === cacheToken) {
    return perimLocationMetaByCardIdCache.value;
  }
  const byCardId = new Map();
  const { locationsById: cardById } = getLibraryIndexes();
  const nameSetKeyToIds = new Map();
  const nameOnlyKeyToIds = new Map();
  cardById.forEach((card) => {
    const nameKey = normalizePerimText(card?.name || "");
    const setKey = normalizePerimText(card?.set || "");
    const nameSetKey = `${nameKey}|${setKey}`;
    if (!nameSetKeyToIds.has(nameSetKey)) {
      nameSetKeyToIds.set(nameSetKey, []);
    }
    nameSetKeyToIds.get(nameSetKey).push(String(card.id));
    if (!nameOnlyKeyToIds.has(nameKey)) {
      nameOnlyKeyToIds.set(nameKey, []);
    }
    nameOnlyKeyToIds.get(nameKey).push(String(card.id));
  });

  rows.forEach((row) => {
    const nameKey = normalizePerimText(row.name);
    const setKey = normalizePerimText(row.set);
    const nameSetKey = `${nameKey}|${setKey}`;
    const sourceIds = [
      ...(nameSetKeyToIds.get(nameSetKey) || []),
      ...(nameOnlyKeyToIds.get(nameKey) || []),
    ];
    const sourceUniqueIds = [...new Set(sourceIds)].filter((cardId) => cardById.has(cardId));
    if (!sourceUniqueIds.length) {
      return;
    }

    sourceUniqueIds.forEach((cardId) => {
      const card = cardById.get(cardId);
      if (!card) {
        return;
      }
      const rarity = row.rarity || card.rarity || "Unknown";
      const perActionCreatureChance = {};
      PERIM_ACTIONS.map((action) => String(action.id || "")).forEach((actionId) => {
        perActionCreatureChance[actionId] = calculateCreatureChancePercent(rarity, actionId);
      });
      const linkedIds = new Set(adjacencySnapshot.byFromCardId.get(cardId) || []);
      const current = byCardId.get(cardId) || {
        linkedLocationIds: new Set(),
      };
      (current.linkedLocationIds || new Set()).forEach((targetId) => linkedIds.add(targetId));
      byCardId.set(cardId, {
        rarity,
        terrain: row.environment || null,
        eventFlag: row.eventFlag || "n",
        eventChancePercent: 0,
        locationDropChancePercent: clampPercent(row.chanceScanPercent),
        linkedLocationIds: linkedIds,
        perActionCreatureChance,
      });
    });
  });

  adjacencySnapshot.byFromCardId.forEach((targets, fromId) => {
    const card = cardById.get(fromId);
    if (!card || byCardId.has(fromId)) {
      return;
    }
    byCardId.set(fromId, {
      rarity: card.rarity || "Unknown",
      terrain: null,
      eventFlag: "n",
      eventChancePercent: 0,
      locationDropChancePercent: 0,
      linkedLocationIds: new Set(targets || []),
      perActionCreatureChance: {},
    });
  });

  perimLocationMetaByCardIdCache = {
    token: cacheToken,
    value: byCardId,
  };
  return byCardId;
}

function buildPerimLocationsFromScans(locationCards) {
  const seen = [];
  const seenCardIds = new Set();
  const locationIds = Array.isArray(locationCards) ? locationCards : [];
  const { locationsById: byId } = getLibraryIndexes();
  const metaByCardId = buildPerimLocationMetaByCardId();
  locationIds.forEach((entryValue, index) => {
    const cardId = scanEntryToCardId("locations", entryValue);
    if (!cardId || seenCardIds.has(cardId)) {
      return;
    }
    seenCardIds.add(cardId);
    const card = byId.get(cardId);
    if (!card) {
      return;
    }
    const meta = metaByCardId.get(String(cardId)) || null;
    const rarity = meta?.rarity || card.rarity || "Unknown";
    const creatureChanceByAction = meta?.perActionCreatureChance || {};
    seen.push({
      entryId: `${cardId}#${index}`,
      cardId,
      name: card.name,
      image: card.image || "",
      tribe: card.tribe || "Generic",
      set: card.set || "Unknown",
      rarity,
      ability: String(card.ability || ""),
      terrain: meta?.terrain || null,
      locationDropChancePercent: clampPercent(meta?.locationDropChancePercent ?? 0),
      eventChancePercent: clampPercent(meta?.eventChancePercent ?? 0),
      linkedLocationIds: [...(meta?.linkedLocationIds || [])],
      creatureChanceByAction: creatureChanceByAction,
      creatureChancePercent: clampPercent(
        creatureChanceByAction.explore ?? calculateCreatureChancePercent(rarity, "explore")
      ),
      stats: {
        initiative: String(card?.stats?.initiative || ""),
        courage: Number(card?.stats?.courage || 0),
        power: Number(card?.stats?.power || 0),
        wisdom: Number(card?.stats?.wisdom || 0),
        speed: Number(card?.stats?.speed || 0),
        fire: Number(card?.stats?.fire || 0),
        air: Number(card?.stats?.air || 0),
        earth: Number(card?.stats?.earth || 0),
        water: Number(card?.stats?.water || 0),
      },
    });
  });
  return seen;
}

function collectPerimLocationEntriesForPlayer(playerKeyRaw, preloadedCards = null) {
  const playerKey = normalizeUserKey(playerKeyRaw || "local-player");
  if (isSqlV2Ready()) {
    if (playerKey && playerKey !== "local-player") {
      const ownerlessDeckKeys = sqliteDb
        .prepare("SELECT deck_key FROM deck_headers WHERE owner_key = '' AND is_ownerless_legacy = 1")
        .all();
      ownerlessDeckKeys.forEach((row) => {
        claimOwnerlessDeckForUser(String(row?.deck_key || ""), playerKey);
      });
    }
    const rows = sqliteDb
      .prepare(`
        SELECT card_id FROM scan_entries
        WHERE owner_key = ? AND card_type = 'locations'
        UNION
        SELECT dc.card_id
        FROM deck_cards dc
        JOIN deck_headers dh ON dh.deck_key = dc.deck_key
        WHERE dc.card_type = 'locations'
          AND (
            dh.owner_key = ?
            OR (dh.owner_key = '' AND ? = 'local-player')
          )
      `)
      .all(playerKey, playerKey, playerKey);
    return rows
      .map((row) => String(row?.card_id || "").trim())
      .filter(Boolean);
  }
  const cards = preloadedCards && typeof preloadedCards === "object"
    ? preloadedCards
    : (() => {
        const scans = loadScansData();
        const { cards: userCards, changed } = getScansCardsForUser(scans, playerKey, true);
        if (changed) {
          writeScansData(scans, "perim_scans_bootstrap");
        }
        return userCards;
      })();
  const entries = [];
  const seenCardIds = new Set();

  const pushUnique = (entry) => {
    const cardId = scanEntryToCardId("locations", entry);
    if (!cardId || seenCardIds.has(cardId)) {
      return;
    }
    seenCardIds.add(cardId);
    entries.push(cardId);
  };

  (cards.locations || []).forEach((entry) => pushUnique(entry));

  listDeckFileNames().forEach((fileName) => {
    const deck = readDeckFileByName(fileName);
    if (!deck || typeof deck !== "object") {
      return;
    }
    let owner = deckOwnerKey(deck);
    if (!owner && playerKey && playerKey !== "local-player") {
      const claimed = claimOwnerlessDeckForUser(fileName, playerKey);
      if (claimed) {
        owner = playerKey;
      }
    }
    const isLegacyLocalDeck = !owner && playerKey === "local-player";
    if (!isLegacyLocalDeck && owner !== playerKey) {
      return;
    }
    const deckLocations = Array.isArray(deck?.cards?.locations) ? deck.cards.locations : [];
    deckLocations.forEach((entry) => {
      const cardId = deckCardIdFromEntry("locations", entry);
      if (cardId) {
        pushUnique(cardId);
      }
    });
  });

  return entries;
}

function buildPlayerLocationOwnershipCountMap(playerKeyRaw, preloadedCards = null) {
  const playerKey = normalizeUserKey(playerKeyRaw || "local-player");
  const counts = new Map();
  const addCount = (cardIdRaw, amountRaw = 1) => {
    const cardId = String(cardIdRaw || "").trim();
    if (!cardId) {
      return;
    }
    const amount = Math.max(0, Number(amountRaw || 0));
    if (!amount) {
      return;
    }
    counts.set(cardId, (counts.get(cardId) || 0) + amount);
  };

  if (isSqlV2Ready()) {
    const normalizedOwner = normalizeUserKey(playerKey, "");
    const scanRows = sqliteDb
      .prepare(`
        SELECT card_id, COUNT(*) AS total
        FROM scan_entries
        WHERE owner_key = ? AND card_type = 'locations'
        GROUP BY card_id
      `)
      .all(playerKey);
    scanRows.forEach((row) => addCount(row?.card_id, row?.total));
    const deckRows = sqliteDb
      .prepare(`
        SELECT dc.card_id, COUNT(*) AS total
        FROM deck_cards dc
        LEFT JOIN deck_headers dh
          ON dh.deck_key = dc.deck_key
        WHERE lower(dc.card_type) = 'locations'
          AND lower(COALESCE(NULLIF(dh.owner_key, ''), NULLIF(dc.owner_key_shadow, ''))) = ?
        GROUP BY dc.card_id
      `)
      .all(normalizedOwner);
    deckRows.forEach((row) => addCount(row?.card_id, row?.total));
    return counts;
  }

  const cards = preloadedCards && typeof preloadedCards === "object"
    ? preloadedCards
    : (() => {
        const scans = loadScansData();
        const { cards: userCards, changed } = getScansCardsForUser(scans, playerKey, true);
        if (changed) {
          writeScansData(scans, "perim_scans_bootstrap");
        }
        return userCards;
      })();

  (cards.locations || []).forEach((entry) => {
    addCount(scanEntryToCardId("locations", entry), 1);
  });
  listDeckFileNames().forEach((fileName) => {
    const deck = readDeckFileByName(fileName);
    if (!deck || typeof deck !== "object") {
      return;
    }
    const owner = deckOwnerKey(deck);
    const isLegacyLocalDeck = !owner && playerKey === "local-player";
    if (!isLegacyLocalDeck && owner !== playerKey) {
      return;
    }
    const deckLocations = Array.isArray(deck?.cards?.locations) ? deck.cards.locations : [];
    deckLocations.forEach((entry) => addCount(deckCardIdFromEntry("locations", entry), 1));
  });
  return counts;
}

function locationRarityLevel(rarityRaw) {
  const rarity = normalizePerimText(rarityRaw);
  if (rarity === "promo") return 6;
  if (rarity === "ultra rare") return 5;
  if (rarity === "super rare") return 4;
  if (rarity === "rare") return 3;
  if (rarity === "uncommon") return 2;
  return 1;
}

function hydrateCreatureDropSqlMetadata() {
  if (!sqliteDb) {
    return;
  }
  try {
    const graph = buildLocationAdjacencyGraph();
    const locations = loadPerimLocationsMatrix();
    locations.forEach((location) => {
      const key = normalizePerimText(location.name);
      if (!key) {
        return;
      }
      const neighbors = [...(graph.locNameToAdjacent.get(key) || new Set())];
      setLocationAdjacencies(
        sqliteDb,
        key,
        neighbors,
        normalizePerimText(location.environment || ""),
        locationRarityLevel(location.rarity)
      );
    });

    const creatures = loadPerimCreaturesMatrix();
    creatures.forEach((creature) => {
      const { possibleLocations } = resolveCreaturePossibleLocations(creature, graph);
      const rarityKey = String(creature.rarity || "").trim().toLowerCase();
      setCreatureDropSettings(sqliteDb, {
        loki: Number(creature.loki || 0),
        name: creature.name,
        rarity: creature.rarity,
        rarityPercent: Number(getPerimCreatureRarityDropChance(rarityKey) * 100),
        tribe: creature.tribe,
        types: creature.types,
        possibleLocations,
        nearbyLocation: creature.proximoLocal,
        onlyLocation1: creature.somenteLocal1,
        onlyLocation2: creature.somenteLocal2,
      });
    });
  } catch (error) {
    console.warn(`[PERIM] Falha ao hidratar metadados SQL de drops: ${error.message}`);
  }
}

function pickFromList(list) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] || null;
}

function weightedPick(weights) {
  const entries = Object.entries(weights || {}).filter(([, weight]) => Number(weight) > 0);
  if (!entries.length) {
    return null;
  }
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  let roll = Math.random() * total;
  for (let i = 0; i < entries.length; i += 1) {
    const [key, rawWeight] = entries[i];
    roll -= Number(rawWeight);
    if (roll <= 0) {
      return key;
    }
  }
  return entries[entries.length - 1][0];
}

function weightedPickWithClimate(weights, climateRaw) {
  const adjusted = {};
  Object.entries(weights || {}).forEach(([rewardType, rawWeight]) => {
    const baseWeight = Number(rawWeight || 0);
    if (baseWeight <= 0) {
      return;
    }
    const climateFactor = getPerimClimateTypeModifier(climateRaw, rewardType);
    adjusted[rewardType] = Math.max(0.01, baseWeight * climateFactor);
  });
  return weightedPick(adjusted);
}

function rarityTierScore(rarity) {
  const key = String(rarity || "").trim().toLowerCase();
  if (key === "ultra rare") return 5;
  if (key === "super rare") return 4;
  if (key === "rare") return 3;
  if (key === "uncommon") return 2;
  if (key === "common") return 1;
  return 0;
}

function perimRarityRank(rarityRaw) {
  const key = normalizePerimText(rarityRaw);
  if (key === "common") return 1;
  if (key === "uncommon") return 2;
  if (key === "rare") return 3;
  if (key === "super rare") return 4;
  if (key === "ultra rare") return 5;
  if (key === "promo") return 6;
  return 99;
}

function isPerimRarityAtMost(rarityRaw, maxRarityRaw) {
  const maxRank = perimRarityRank(maxRarityRaw);
  if (maxRank >= 99) {
    return true;
  }
  return perimRarityRank(rarityRaw) <= maxRank;
}

function isPerimSuperRareOrHigherRarity(rarityRaw) {
  return perimRarityRank(rarityRaw) >= perimRarityRank("super rare");
}

function locationDropChanceByRarity(rarityRaw) {
  const rarityKey = normalizePerimText(rarityRaw);
  return getPerimLocationRarityDropChance(rarityKey);
}

function rollStepFive(min, max) {
  const options = [];
  for (let value = min; value <= max; value += 5) {
    options.push(value);
  }
  return options[Math.floor(Math.random() * options.length)] || 0;
}

function buildCreatureScanVariant() {
  const variant = {
    energyDelta: rollStepFive(-5, 5),
    courageDelta: rollStepFive(-5, 5),
    powerDelta: rollStepFive(-5, 5),
    wisdomDelta: rollStepFive(-5, 5),
    speedDelta: rollStepFive(-5, 5),
  };
  variant.perfect =
    variant.energyDelta === 5
    && variant.courageDelta === 5
    && variant.powerDelta === 5
    && variant.wisdomDelta === 5
    && variant.speedDelta === 5;
  return variant;
}

function parseAttackElementProfile(card) {
  const fire = Number(card?.fire ?? card?.stats?.fire ?? 0);
  const air = Number(card?.air ?? card?.stats?.air ?? 0);
  const earth = Number(card?.earth ?? card?.stats?.earth ?? 0);
  const water = Number(card?.water ?? card?.stats?.water ?? 0);
  return {
    fire: fire > 0,
    air: air > 0,
    earth: earth > 0,
    water: water > 0,
    hasElement: fire > 0 || air > 0 || earth > 0 || water > 0,
  };
}

function parseInitiativeElementWeights(locationEntry = null) {
  const weights = { fire: 0, air: 0, earth: 0, water: 0 };
  const initiativeRaw = String(
    locationEntry?.initiative
    || locationEntry?.stats?.initiative
    || ""
  )
    .toLowerCase()
    .replace(/\bfogo\b/g, "fire")
    .replace(/\bfire\b/g, "fire")
    .replace(/\bar\b/g, "air")
    .replace(/\bair\b/g, "air")
    .replace(/\bterra\b/g, "earth")
    .replace(/\bearth\b/g, "earth")
    .replace(/\bagua\b/g, "water")
    .replace(/\bwater\b/g, "water")
    .replace(/[|,+/\\-]+/g, " ");
  if (!initiativeRaw) {
    return weights;
  }
  ["fire", "air", "earth", "water"].forEach((element) => {
    const regex = new RegExp(`\\b${element}\\b`, "i");
    if (regex.test(initiativeRaw)) {
      weights[element] += 1;
    }
  });
  return weights;
}

function normalizeElementWeightMap(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    fire: Math.max(0, Number(source.fire || 0)),
    air: Math.max(0, Number(source.air || 0)),
    earth: Math.max(0, Number(source.earth || 0)),
    water: Math.max(0, Number(source.water || 0)),
  };
  const total = normalized.fire + normalized.air + normalized.earth + normalized.water;
  if (total <= 0) {
    return { ...normalized, total: 0 };
  }
  return {
    fire: normalized.fire / total,
    air: normalized.air / total,
    earth: normalized.earth / total,
    water: normalized.water / total,
    total,
  };
}

function creatureElementWeightsAtLocation(locationEntry = null) {
  const weights = { fire: 0, air: 0, earth: 0, water: 0 };
  const creatures = getCreaturesAtLocation(String(locationEntry?.cardId || locationEntry?.id || locationEntry?.name || ""));
  if (!Array.isArray(creatures) || !creatures.length) {
    return weights;
  }
  const { creaturesById, creaturesByNormalizedName } = getLibraryIndexes();
  creatures.forEach((entry) => {
    const cardId = String(entry?.cardId || "");
    let card = cardId ? creaturesById.get(cardId) : null;
    if (!card && entry?.name) {
      card = creaturesByNormalizedName.get(normalizePerimText(entry.name)) || null;
    }
    if (!card) {
      return;
    }
    weights.fire += Math.max(0, Number(card?.stats?.fire || card?.fire || 0));
    weights.air += Math.max(0, Number(card?.stats?.air || card?.air || 0));
    weights.earth += Math.max(0, Number(card?.stats?.earth || card?.earth || 0));
    weights.water += Math.max(0, Number(card?.stats?.water || card?.water || 0));
  });
  return weights;
}

function buildAttackElementContext(locationEntry = null) {
  const initiativeShare = normalizeElementWeightMap(parseInitiativeElementWeights(locationEntry));
  const creatureShare = normalizeElementWeightMap(creatureElementWeightsAtLocation(locationEntry));
  if (!initiativeShare.total && !creatureShare.total) {
    return { fire: 0.25, air: 0.25, earth: 0.25, water: 0.25 };
  }
  return {
    fire: (initiativeShare.fire * 0.7) + (creatureShare.fire * 0.3),
    air: (initiativeShare.air * 0.7) + (creatureShare.air * 0.3),
    earth: (initiativeShare.earth * 0.7) + (creatureShare.earth * 0.3),
    water: (initiativeShare.water * 0.7) + (creatureShare.water * 0.3),
  };
}

function attackEnvironmentBiasWeight(card, locationEntry = null) {
  const elementProfile = parseAttackElementProfile(card);
  if (!elementProfile.hasElement || !locationEntry || typeof locationEntry !== "object") {
    return 1;
  }
  const context = buildAttackElementContext(locationEntry);
  const activeElements = ["fire", "air", "earth", "water"].filter((element) => Boolean(elementProfile[element]));
  if (!activeElements.length) {
    return 1;
  }
  const influence = activeElements.reduce((sum, element) => sum + Math.max(0, Number(context[element] || 0)), 0) / activeElements.length;
  return Math.max(0.35, 0.35 + (influence * 1.65));
}

function attackClimateElementBoostWeight(card, climateRaw) {
  const elementProfile = parseAttackElementProfile(card);
  if (!elementProfile.hasElement) {
    return 1;
  }
  const climateKey = normalizeClimateText(climateRaw);
  const boostedByClimate = {
    ensolarado: ["fire"],
    ventania: ["air"],
    tempestade: ["water", "air"],
    chuvoso: ["water"],
    nublado: ["earth"],
  };
  const targets = boostedByClimate[climateKey] || [];
  if (!targets.length) {
    return 1;
  }
  const hasMatch = targets.some((element) => Boolean(elementProfile[element]));
  return hasMatch ? 1.08 : 1;
}

function isRunicGroveLocationEntry(locationEntry) {
  const locationNameKey = normalizePerimText(locationEntry?.name || "");
  const locationIdKey = normalizePerimText(locationEntry?.cardId || locationEntry?.id || "");
  return locationNameKey.includes("runicgrove") || locationIdKey.includes("runicgrove");
}

function isPerimMugicGenericCard(card) {
  const tribeRaw = String(card?.tribe || "").trim();
  const normalizedTribe = normalizePerimLocationTribeKey(tribeRaw);
  if (normalizedTribe === "tribeless") {
    return true;
  }
  const fallback = String(tribeRaw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9?]+/g, "");
  return !fallback || fallback === "?" || fallback === "unknown";
}

function selectMugicTribeWeightsFromLocation(locationEntry = null, options = {}) {
  const result = new Map();
  if (!locationEntry || typeof locationEntry !== "object") {
    return result;
  }
  const locationTribeKey = normalizePerimLocationTribeKey(options.locationTribeKey || "");
  const { creaturesById, creaturesByNormalizedName } = getLibraryIndexes();
  const creatures = getCreaturesAtLocation(String(locationEntry?.cardId || locationEntry?.id || locationEntry?.name || ""));
  creatures.forEach((entry) => {
    const cardId = String(entry?.cardId || "");
    let card = cardId ? creaturesById.get(cardId) : null;
    if (!card && entry?.name) {
      card = creaturesByNormalizedName.get(normalizePerimText(entry.name)) || null;
    }
    if (!card) {
      return;
    }
    if (locationTribeKey && !isPerimTribeMatchForCard(card, locationTribeKey)) {
      return;
    }
    const mugicAbility = Number(card?.stats?.mugicability ?? card?.mugicability ?? 0);
    if (mugicAbility <= 0) {
      return;
    }
    const tribe = String(card?.tribe || "").trim().toLowerCase();
    if (!tribe) {
      return;
    }
    result.set(tribe, (result.get(tribe) || 0) + 1);
  });
  return result;
}

function buildCreatureCluesFromCandidate(candidate) {
  const card = candidate?.card || {};
  const matrixEntry = candidate?.entry || {};
  const clues = [];
  const tribe = String(card?.tribe || matrixEntry?.tribe || "").trim();
  if (tribe) {
    clues.push(`Sinal tribal detectado: ${tribe}.`);
  }
  const elementTokens = [];
  if (Number(card?.stats?.fire || card?.fire || 0) > 0) elementTokens.push("Fire");
  if (Number(card?.stats?.air || card?.air || 0) > 0) elementTokens.push("Air");
  if (Number(card?.stats?.earth || card?.earth || 0) > 0) elementTokens.push("Earth");
  if (Number(card?.stats?.water || card?.water || 0) > 0) elementTokens.push("Water");
  if (elementTokens.length) {
    clues.push(`Assinatura elemental: ${elementTokens.join(", ")}.`);
  }
  const stats = [
    { key: "Coragem", value: Number(card?.stats?.courage || card?.courage || 0) },
    { key: "Poder", value: Number(card?.stats?.power || card?.power || 0) },
    { key: "Sabedoria", value: Number(card?.stats?.wisdom || card?.wisdom || 0) },
    { key: "Velocidade", value: Number(card?.stats?.speed || card?.speed || 0) },
    { key: "Energia", value: Number(card?.stats?.energy || card?.energy || 0) },
  ].filter((entry) => Number.isFinite(entry.value));
  if (stats.length) {
    const strongest = [...stats].sort((a, b) => b.value - a.value)[0];
    clues.push(`Atributo dominante observado: ${strongest.key} (${strongest.value}).`);
  }
  const mugicability = Number(card?.stats?.mugicability ?? card?.mugicability ?? 0);
  clues.push(
    mugicability > 0
      ? `A criatura apresenta uso de Mugic Counters (${mugicability}).`
      : "Nenhum uso de Mugic Counters detectado."
  );
  const roleTags = String(matrixEntry?.types || card?.types || "").trim();
  if (roleTags) {
    clues.push(`Perfil de comportamento: ${roleTags}.`);
  }
  return clues;
}

function pickCreatureCandidateAtLocation(locationEntry, options = {}) {
  const pool = getCreaturesAtLocation(String(locationEntry?.cardId || locationEntry?.id || locationEntry?.name || ""));
  if (!Array.isArray(pool) || !pool.length) {
    return null;
  }
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : new Map();
  const rareBoost = Math.max(0, Number(options.rareBoost || 0));
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const locationTribeKey = normalizePerimLocationTribeKey(options.locationTribeKey || "");
  const { creaturesById, creaturesByNormalizedName } = getLibraryIndexes();
  const candidates = pool
    .map((entry) => {
      const cardId = String(entry.cardId || entry.card_id || "");
      let card = cardId ? creaturesById.get(cardId) : null;
      if (!card && entry.name) {
        card = creaturesByNormalizedName.get(normalizePerimText(entry.name)) || null;
      }
      if (!card) {
        return null;
      }
      if (locationTribeKey && !isPerimTribeMatchForCard(card, locationTribeKey)) {
        return null;
      }
      const stockKey = `creatures:${String(card.id || "")}`;
      const currentAmount = inventoryCounts.get(stockKey) || 0;
      if (!ignoreInventoryCap && currentAmount >= INVENTORY_MAX_COPIES) {
        return null;
      }
      const dropChance = Math.max(0, Math.min(1, Number(entry.dropChance || 0) + (rareBoost * 0.02)));
      return {
        entry,
        card,
        weight: Math.max(0.05, dropChance),
      };
    })
    .filter(Boolean);
  if (!candidates.length) {
    return null;
  }
  return weightedRandomChoice(candidates, Math.random) || null;
}

function buildPerimCluesForRun(actionId, locationEntry, rewards, options = {}) {
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : new Map();
  const scannerEffect = options.scannerEffect || scannerEffectsByLevel(1);
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const locationTribeKey = normalizePerimLocationTribeKey(options.locationTribeKey || "");
  const hasCreatureReward = Array.isArray(rewards) && rewards.some((reward) => String(reward?.type || "") === "creatures");
  if (String(actionId || "") === "track") {
    if (hasCreatureReward) {
      return [];
    }
    const candidate = pickCreatureCandidateAtLocation(locationEntry, {
      inventoryCounts,
      rareBoost: scannerEffect.rareBoost,
      ignoreInventoryCap,
      locationTribeKey,
    });
    if (!candidate) {
      return ["Nenhum sinal confiavel de criatura encontrado nesta area."];
    }
    const pool = buildCreatureCluesFromCandidate(candidate);
    return pool.length ? [pickFromList(pool)] : [];
  }
  if (String(actionId || "") !== "anomaly") {
    return [];
  }
  const candidate = pickCreatureCandidateAtLocation(locationEntry, {
    inventoryCounts,
    rareBoost: scannerEffect.rareBoost,
    ignoreInventoryCap,
    locationTribeKey,
  });
  if (!candidate) {
    return ["A anomalia nao estabilizou pistas suficientes sobre criaturas nesta area."];
  }
  if (Math.random() < PERIM_ANOMALY_DIRECT_REVEAL_CHANCE) {
    const revealedName = String(candidate?.card?.name || candidate?.entry?.name || "").trim();
    if (revealedName) {
      return [`Voce descobriu que uma das criaturas desta area e: ${revealedName}.`];
    }
  }
  const allClues = buildCreatureCluesFromCandidate(candidate);
  if (!allClues.length) {
    return ["A anomalia revelou sinais inconclusivos da criatura local."];
  }
  const targetCount = Math.max(1, Math.min(5, 1 + Math.floor(Math.random() * 5)));
  const shuffled = [...allClues];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const swap = Math.floor(Math.random() * (i + 1));
    const current = shuffled[i];
    shuffled[i] = shuffled[swap];
    shuffled[swap] = current;
  }
  return shuffled.slice(0, Math.min(targetCount, shuffled.length));
}

function rewardCardFromType(type, preferredTribe = "", options = {}) {
  const cards = Array.isArray(library?.cardsByType?.[type]) ? library.cardsByType[type] : [];
  if (!cards.length) {
    return null;
  }
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : new Map();
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const locationEntry = options.locationEntry && typeof options.locationEntry === "object"
    ? options.locationEntry
    : null;
  const activeClimate = String(options.activeClimate || "");
  const tribeScannerRareBoosts = options.tribeScannerRareBoosts instanceof Map
    ? options.tribeScannerRareBoosts
    : new Map();
  const locationTribeKey = normalizePerimLocationTribeKey(options.locationTribeKey || "");
  const requireLocalMugicEligible = Boolean(options.requireLocalMugicEligible);
  const excludedRewardCardKeys = options.excludedRewardCardKeys instanceof Set ? options.excludedRewardCardKeys : new Set();
  const battlegearAllowedCardIds = options.battlegearAllowedCardIds instanceof Set ? options.battlegearAllowedCardIds : null;
  const tribeKey = String(preferredTribe || "").trim().toLowerCase();
  let basePool = cards;
  let selectedTribeKey = tribeKey;
  if (type === "mugic" && locationEntry) {
    const genericPool = cards.filter((card) => isPerimMugicGenericCard(card));
    const runicGroveMultiplier = isRunicGroveLocationEntry(locationEntry)
      ? PERIM_GENERIC_MUGIC_RUNIC_GROVE_MULTIPLIER
      : 1;
    const baseLocalPool = locationTribeKey
      ? cards.filter((card) => isPerimTribeMatchForCard(card, locationTribeKey))
      : cards;
    if (baseLocalPool.length) {
      basePool = baseLocalPool;
    }
    const tribeWeights = selectMugicTribeWeightsFromLocation(locationEntry, { locationTribeKey });
    const weightedTribes = [...tribeWeights.entries()].map(([tribe, weight]) => ({ tribe, weight }));
    if (genericPool.length) {
      weightedTribes.push({
        tribe: "__generic__",
        weight: Math.max(0.05, PERIM_GENERIC_MUGIC_BASE_WEIGHT * runicGroveMultiplier),
      });
    }
    if (!weightedTribes.length && requireLocalMugicEligible) {
      return null;
    }
    if (weightedTribes.length) {
      const selected = weightedRandomChoice(weightedTribes, Math.random);
      const selectedTribe = String(selected?.tribe || "").trim().toLowerCase();
      const isGenericPick = selectedTribe === "__generic__";
      selectedTribeKey = isGenericPick ? "tribeless" : selectedTribe;
      const selectedPool = isGenericPick
        ? genericPool
        : (
          selectedTribe
            ? cards.filter((card) => String(card?.tribe || "").trim().toLowerCase() === selectedTribe)
            : []
        );
      if (selectedPool.length) {
        basePool = selectedPool;
      } else if (genericPool.length) {
        selectedTribeKey = "tribeless";
        basePool = genericPool;
      } else if (requireLocalMugicEligible && !basePool.length) {
        return null;
      }
    } else if (genericPool.length) {
      selectedTribeKey = "tribeless";
      basePool = genericPool;
    }
  } else {
    const tribePool = tribeKey
      ? cards.filter((card) => String(card?.tribe || "").trim().toLowerCase() === tribeKey)
      : [];
    basePool = tribePool.length ? tribePool : cards;
  }
  const pool = basePool.filter((card) => {
    const nameLower = String(card?.name || "").toLowerCase();
    if (nameLower.includes("unused") || nameLower.includes("alpha")) {
      return false;
    }
    if (!isPerimDropSetAllowed(card?.set || "")) {
      return false;
    }
    const stockKey = `${type}:${String(card?.id || "")}`;
    if (excludedRewardCardKeys.has(stockKey)) {
      return false;
    }
    if (type === "battlegear" && battlegearAllowedCardIds instanceof Set) {
      return battlegearAllowedCardIds.has(String(card?.id || ""));
    }
    const currentAmount = inventoryCounts.get(stockKey) || 0;
    return ignoreInventoryCap || currentAmount < INVENTORY_MAX_COPIES;
  });
  if (!pool.length) {
    return null;
  }
  const rareBoost = Math.max(0, Number(options.rareBoost || 0));
  const tribeBoostEntry = tribeScannerRareBoosts.get(selectedTribeKey) || null;
  const tribeRareBoost = Math.max(
    0,
    Number(
      type === "mugic"
        ? tribeBoostEntry?.mugicRareBoost
        : (type === "creatures" ? tribeBoostEntry?.creatureRareBoost : 0)
    ) || 0
  );
  const effectiveRareBoost = Math.max(0, rareBoost + tribeRareBoost);
  const weighted = pool.map((card) => {
    let weight = Math.max(0.2, 1 + (rarityTierScore(card?.rarity) * effectiveRareBoost));
    if (type === "attacks" && locationEntry) {
      weight *= attackEnvironmentBiasWeight(card, locationEntry);
      weight *= attackClimateElementBoostWeight(card, activeClimate);
    }
    return { card, weight: Math.max(0.05, weight) };
  });
  if (type === "attacks") {
    const ultraRareOverrides = pool.filter((card) => PERIM_ATTACK_SLOT_OVERRIDE_NAMES.has(normalizePerimText(card?.name || "")));
    if (ultraRareOverrides.length && Math.random() < PERIM_ATTACK_SLOT_OVERRIDE_CHANCE) {
      const pickedUltra = pickFromList(ultraRareOverrides);
      if (pickedUltra?.id) {
        return {
          type,
          cardId: pickedUltra.id,
          cardName: pickedUltra.name,
          rarity: pickedUltra.rarity || "Unknown",
          image: pickedUltra.image || "",
        };
      }
    }
  }
  const pickedEntry = weightedRandomChoice(weighted, Math.random);
  const picked = pickedEntry?.card || pickFromList(pool);
  if (!picked?.id) {
    return null;
  }
  const reward = {
    type,
    cardId: picked.id,
    cardName: picked.name,
    rarity: picked.rarity || "Unknown",
    image: picked.image || "",
  };
  if (type === "creatures" && options.includeCreatureVariant) {
    const variant = buildCreatureScanVariant();
    reward.variant = variant;
    reward.cardDisplayName = `${picked.name} (${creatureVariantBadge(variant)})`;
  }
  return reward;
}

function climateTypeWeight(climateKey, typesRaw, tribeRaw = "") {
  const climate = normalizeClimateText(climateKey);
  const types = normalizePerimText(typesRaw);
  const tribe = normalizePerimText(tribeRaw);
  let weight = 1;

  if (climate.includes("chuv")) {
    if (types.includes("danian") || types.includes("conjuror") || types.includes("mugic")) {
      weight += 0.35;
    }
    if (types.includes("mipedian") || tribe.includes("mipedian")) {
      weight -= 0.2;
    }
  } else if (climate.includes("ensolar")) {
    if (types.includes("mipedian") || types.includes("scout") || tribe.includes("mipedian")) {
      weight += 0.3;
    }
    if (types.includes("danian")) {
      weight -= 0.12;
    }
  } else if (climate.includes("nevand")) {
    if (types.includes("warrior") || types.includes("taskmaster") || tribe.includes("underworld")) {
      weight += 0.24;
    }
    if (types.includes("mipedian")) {
      weight -= 0.15;
    }
  } else if (climate.includes("tempest")) {
    if (types.includes("conjuror") || types.includes("elementalist") || types.includes("mugic")) {
      weight += 0.22;
    }
  } else if (climate.includes("ventan")) {
    if (types.includes("swift") || types.includes("scout")) {
      weight += 0.15;
    }
  }

  return Math.max(0.25, weight);
}

function pickCreatureRewardFromLocation(locationEntry, options = {}) {
  const locationId = String(locationEntry?.id || locationEntry?.cardId || "");
  const locationName = String(locationEntry?.name || "");
  const creaturePoolRaw = getCreaturesAtLocation(locationId || locationName);
  return pickCreatureRewardFromPool(creaturePoolRaw, locationEntry, options);
}

function hasCampSuperRarePlusEligibleAtLocation(locationEntry, options = {}) {
  const locationId = String(locationEntry?.id || locationEntry?.cardId || "");
  const locationName = String(locationEntry?.name || "");
  const creaturePoolRaw = getCreaturesAtLocation(locationId || locationName);
  if (!Array.isArray(creaturePoolRaw) || !creaturePoolRaw.length) {
    return false;
  }
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : new Map();
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const locationTribeKey = normalizePerimLocationTribeKey(options.locationTribeKey || "");
  const excludedRewardCardKeys = options.excludedRewardCardKeys instanceof Set ? options.excludedRewardCardKeys : new Set();
  const { creaturesById: libraryById, creaturesByNormalizedName } = getLibraryIndexes();
  for (let idx = 0; idx < creaturePoolRaw.length; idx += 1) {
    const entry = creaturePoolRaw[idx];
    const cardId = String(entry?.cardId || entry?.card_id || "");
    let card = cardId ? libraryById.get(cardId) : null;
    if (!card && entry?.name) {
      card = creaturesByNormalizedName.get(normalizePerimText(entry.name)) || null;
    }
    if (!card || !card.id) {
      continue;
    }
    if (locationTribeKey && !isPerimTribeMatchForCard(card, locationTribeKey)) {
      continue;
    }
    if (!isPerimDropSetAllowed(card?.set || "")) {
      continue;
    }
    if (excludedRewardCardKeys.has(`creatures:${String(card.id)}`)) {
      continue;
    }
    const cardNameLower = String(card.name || "").toLowerCase();
    if (cardNameLower.includes("unused") || cardNameLower.includes("alpha")) {
      continue;
    }
    const stockKey = `creatures:${String(card.id)}`;
    const currentAmount = inventoryCounts.get(stockKey) || 0;
    if (!ignoreInventoryCap && currentAmount >= INVENTORY_MAX_COPIES) {
      continue;
    }
    if (isPerimSuperRareOrHigherRarity(card?.rarity || entry?.rarity || "")) {
      return true;
    }
  }
  return false;
}

function pickCreatureRewardFromPool(creaturePoolRaw, locationEntry, options = {}) {
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : new Map();
  const includeCreatureVariant = Boolean(options.includeCreatureVariant);
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const forceDrop = Boolean(options.forceDrop);
  const maxRarity = String(options.maxRarity || "").trim();
  const rareBoost = Math.max(0, Number(options.rareBoost || 0));
  const locationTribeKey = normalizePerimLocationTribeKey(options.locationTribeKey || "");
  const excludedRewardCardKeys = options.excludedRewardCardKeys instanceof Set ? options.excludedRewardCardKeys : new Set();
  if (!Array.isArray(creaturePoolRaw) || !creaturePoolRaw.length) {
    return null;
  }
  const { creaturesById: libraryById, creaturesByNormalizedName } = getLibraryIndexes();
  const perimState = getPerimGlobalLocationState(locationEntry, new Date());
  const activeClimate = normalizeClimateText(perimState?.climate || "");
  const candidates = creaturePoolRaw
    .map((entry) => {
      const cardId = String(entry.cardId || entry.card_id || "");
      let card = cardId ? libraryById.get(cardId) : null;
      if (!card && entry.name) {
        card = creaturesByNormalizedName.get(normalizePerimText(entry.name)) || null;
      }
      if (!card || !card.id) {
        return null;
      }
      if (locationTribeKey && !isPerimTribeMatchForCard(card, locationTribeKey)) {
        return null;
      }
      if (!isPerimDropSetAllowed(card?.set || "")) {
        return null;
      }
      if (excludedRewardCardKeys.has(`creatures:${String(card.id)}`)) {
        return null;
      }
      const cardNameLower = String(card.name || "").toLowerCase();
      if (cardNameLower.includes("unused") || cardNameLower.includes("alpha")) {
        return null;
      }
      if (maxRarity && !isPerimRarityAtMost(card?.rarity || entry?.rarity || "", maxRarity)) {
        return null;
      }
      const stockKey = `creatures:${String(card.id)}`;
      const currentAmount = inventoryCounts.get(stockKey) || 0;
      if (!ignoreInventoryCap && currentAmount >= INVENTORY_MAX_COPIES) {
        return null;
      }
      const dropChance = Math.max(0, Math.min(1, Number(entry.dropChance || 0)));
      const rarityKey = normalizePerimText(card?.rarity || entry?.rarity || "");
      const rarityDropMultiplier = getPerimCreatureScanRarityMultiplier(rarityKey);
      const boostedDropChance = Math.max(0, Math.min(1, (dropChance + (rareBoost * 0.02)) * Math.max(0.05, rarityDropMultiplier)));
      const rarityWeight = Math.max(0.15, 1 + (rarityTierScore(card.rarity) * Math.max(0, rareBoost)));
      const climateWeight = climateTypeWeight(activeClimate, String(entry.types || card.types || ""), card.tribe || "");
      return {
        entry,
        card,
        dropChance: boostedDropChance,
        weight: Math.max(0.05, rarityWeight * climateWeight),
      };
    })
    .filter(Boolean);
  if (!candidates.length) {
    return null;
  }
  const weighted = weightedRandomChoice(candidates, Math.random);
  if (!weighted) {
    return null;
  }
  if (!forceDrop && Math.random() > weighted.dropChance) {
    return null;
  }
  const reward = {
    type: "creatures",
    cardId: weighted.card.id,
    cardName: weighted.card.name,
    rarity: weighted.card.rarity || weighted.entry.rarity || "Unknown",
    image: weighted.card.image || "",
  };
  if (includeCreatureVariant) {
    const variant = buildCreatureScanVariant();
    reward.variant = variant;
    reward.cardDisplayName = `${weighted.card.name} (${creatureVariantBadge(variant)})`;
  }
  return reward;
}

function increaseInventoryCountMap(map, reward) {
  if (!(map instanceof Map)) {
    return;
  }
  const type = String(reward?.type || "");
  const cardId = String(reward?.cardId || "");
  if (!type || !cardId) {
    return;
  }
  const stockKey = `${type}:${cardId}`;
  map.set(stockKey, (map.get(stockKey) || 0) + 1);
}

function normalizeRewardPayload(reward) {
  if (!reward || typeof reward !== "object") {
    return null;
  }
  const type = String(reward.type || "").trim();
  const cardId = String(reward.cardId || "").trim();
  if (!type || !cardId) {
    return null;
  }
  const payload = {
    type,
    cardId,
    cardName: String(reward.cardName || cardId),
    cardDisplayName: String(reward.cardDisplayName || reward.cardName || cardId),
    rarity: String(reward.rarity || "Unknown"),
    image: String(reward.image || ""),
  };
  if (type === "creatures" && reward.variant) {
    payload.variant = normalizeCreatureVariant(reward.variant);
    if (payload.variant) {
      payload.cardDisplayName = `${payload.cardName} (${creatureVariantBadge(payload.variant)})`;
    }
  }
  return payload;
}

function applyScannerProgressFromRewards(playerKeyRaw, rewards) {
  const rewardsList = Array.isArray(rewards) ? rewards : [];
  if (!rewardsList.length) {
    return;
  }
  const profilesState = loadProfilesData();
  const { profile } = getOrCreateProfile(profilesState, playerKeyRaw);
  let changed = false;
  rewardsList.forEach((reward) => {
    if (String(reward?.type || "") !== "creatures") {
      return;
    }
    const card = library?.cards?.find((entry) => entry.id === reward.cardId);
    const scannerKey = normalizeTribeToScannerKey(card?.tribe || "");
    if (!scannerKey) {
      return;
    }
    addScannerXp(profile, scannerKey, 5);
    changed = true;
  });
  if (changed) {
    profile.updatedAt = nowIso();
    writeProfilesData(profilesState, "profile_scanner_progress");
  }
}

function turnLabelFromHour(hour) {
  if (hour >= 5 && hour < 7) return "Amanhecer";
  if (hour >= 7 && hour < 11) return "Manha";
  if (hour >= 11 && hour < 13) return "Meio-dia";
  if (hour >= 13 && hour < 16) return "Inicio da tarde";
  if (hour >= 16 && hour < 19) return "Tarde";
  if (hour >= 19 && hour < 23) return "Noite";
  return "Madrugada";
}

function normalizeClimateText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PERIM_LOCATION_ALLOWED_CLIMATE_KEYS = new Set([
  "ensolarado",
  "chuvoso",
  "ventania",
  "tempestade",
  "nublado",
  "umido",
  "seco",
  "frio",
  "quente",
  "lugar_fechado",
]);

function normalizePerimClimateKey(rawValue) {
  const key = normalizeClimateText(rawValue)
    .replace(/[^a-z0-9]+/g, "");
  if (!key) {
    return "";
  }
  if (key.includes("ensolar")) return "ensolarado";
  if (key.includes("chuv")) return "chuvoso";
  if (key.includes("vent")) return "ventania";
  if (key.includes("tempest")) return "tempestade";
  if (key.includes("nublad")) return "nublado";
  if (key.includes("umid") || key.includes("humid")) return "umido";
  if (key.includes("sec")) return "seco";
  if (key.includes("fri")) return "frio";
  if (key.includes("quent") || key.includes("calor") || key.includes("hot")) return "quente";
  if (key.includes("lugarfechado") || key.includes("fechado") || key.includes("indoor") || key.includes("interno")) return "lugar_fechado";
  return "";
}

function perimClimateLabelFromKey(climateKeyRaw) {
  switch (normalizePerimClimateKey(climateKeyRaw)) {
    case "ensolarado":
      return "Ensolarado";
    case "chuvoso":
      return "Chuvoso";
    case "ventania":
      return "Ventania";
    case "tempestade":
      return "Tempestade";
    case "nublado":
      return "Nublado";
    case "umido":
      return "Umido";
    case "seco":
      return "Seco";
    case "frio":
      return "Frio";
    case "quente":
      return "Quente";
    case "lugar_fechado":
      return "Lugar Fechado";
    default:
      return "Nublado";
  }
}

function getPerimLocationAllowedClimateKeys(locationCardIdRaw) {
  if (!sqliteDb) {
    return [];
  }
  const locationCardId = String(locationCardIdRaw || "").trim();
  if (!locationCardId) {
    return [];
  }
  try {
    const row = sqliteDb
      .prepare("SELECT allowed_climates_json FROM perim_location_climate_rules WHERE location_card_id = ? LIMIT 1")
      .get(locationCardId);
    if (!row?.allowed_climates_json) {
      return [];
    }
    const parsed = JSON.parse(String(row.allowed_climates_json || "[]"));
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized = [...new Set(
      parsed
        .map((entry) => normalizePerimClimateKey(entry))
        .filter((entry) => PERIM_LOCATION_ALLOWED_CLIMATE_KEYS.has(entry))
    )];
    return normalized;
  } catch (error) {
    console.warn(`[PERIM] Falha ao consultar regras de clima do local ${locationCardId}: ${error?.message || error}`);
    return [];
  }
}

function isPerimClimateAllowed(climateRaw, allowedClimateKeys = []) {
  const normalizedAllowed = Array.isArray(allowedClimateKeys) ? allowedClimateKeys : [];
  if (!normalizedAllowed.length) {
    return true;
  }
  const climateKey = normalizePerimClimateKey(climateRaw);
  return climateKey ? normalizedAllowed.includes(climateKey) : false;
}

function filterPerimClimateProfileByAllowlist(profile, allowedClimateKeys = []) {
  const validProfile = Array.isArray(profile) ? profile : [];
  const allowed = Array.isArray(allowedClimateKeys) ? allowedClimateKeys.filter((entry) => PERIM_LOCATION_ALLOWED_CLIMATE_KEYS.has(entry)) : [];
  if (!allowed.length) {
    return validProfile;
  }
  const allowedSet = new Set(allowed);
  const filtered = validProfile
    .filter((entry) => allowedSet.has(normalizePerimClimateKey(entry?.climate || "")))
    .map((entry) => ({
      climate: perimClimateLabelFromKey(entry?.climate || "nublado"),
      weight: Number(entry?.weight || 0),
    }))
    .filter((entry) => Number(entry.weight || 0) > 0);
  if (filtered.length) {
    return filtered;
  }
  return allowed.map((entry) => ({
    climate: perimClimateLabelFromKey(entry),
    weight: 1,
  }));
}

function inferPerimClimateProfile(locationEntry) {
  const terrainKey = normalizeClimateText(locationEntry?.terrain || locationEntry?.environment || "");
  const nameKey = normalizeClimateText(locationEntry?.name || "");
  const tribeKey = normalizeClimateText(locationEntry?.tribe || "");

  if (nameKey.includes("chuva eterna") || nameKey.includes("eternal rain")) {
    return [{ climate: "Chuvoso", weight: 100 }];
  }
  if (nameKey.includes("geleira") || nameKey.includes("glacier") || nameKey.includes("frozen") || nameKey.includes("snow")) {
    return [
      { climate: "Nublado", weight: 54 },
      { climate: "Ventania", weight: 29 },
      { climate: "Chuvoso", weight: 12 },
      { climate: "Ensolarado", weight: 5 },
    ];
  }
  if (
    terrainKey.includes("deserto")
    || nameKey.includes("desert")
    || tribeKey.includes("mipedian")
    || tribeKey.includes("maipidian")
  ) {
    return [
      { climate: "Ensolarado", weight: 58 },
      { climate: "Ventania", weight: 24 },
      { climate: "Nublado", weight: 15 },
      { climate: "Chuvoso", weight: 2 },
      { climate: "Tempestade", weight: 1 },
    ];
  }
  if (
    terrainKey.includes("floresta")
    || terrainKey.includes("selva")
    || nameKey.includes("forest")
    || nameKey.includes("jungle")
    || nameKey.includes("rain")
  ) {
    return [
      { climate: "Chuvoso", weight: 54 },
      { climate: "Nublado", weight: 25 },
      { climate: "Tempestade", weight: 16 },
      { climate: "Ensolarado", weight: 5 },
    ];
  }
  if (
    terrainKey.includes("oceano")
    || terrainKey.includes("mar")
    || terrainKey.includes("lago")
    || nameKey.includes("sea")
    || nameKey.includes("reef")
    || nameKey.includes("bay")
  ) {
    return [
      { climate: "Nublado", weight: 35 },
      { climate: "Chuvoso", weight: 28 },
      { climate: "Ventania", weight: 22 },
      { climate: "Tempestade", weight: 12 },
      { climate: "Ensolarado", weight: 3 },
    ];
  }
  if (
    terrainKey.includes("submundo")
    || terrainKey.includes("underworld")
    || nameKey.includes("lava")
    || nameKey.includes("magma")
    || nameKey.includes("volcan")
  ) {
    return [
      { climate: "Ensolarado", weight: 44 },
      { climate: "Ventania", weight: 24 },
      { climate: "Nublado", weight: 18 },
      { climate: "Tempestade", weight: 10 },
      { climate: "Chuvoso", weight: 4 },
    ];
  }
  return [
    { climate: "Nublado", weight: 38 },
    { climate: "Ensolarado", weight: 26 },
    { climate: "Chuvoso", weight: 20 },
    { climate: "Ventania", weight: 10 },
    { climate: "Tempestade", weight: 4 },
  ];
}

function pickWeightedClimate(profile, seed) {
  const valid = Array.isArray(profile) ? profile.filter((entry) => Number(entry?.weight || 0) > 0) : [];
  if (!valid.length) {
    return "Nublado";
  }
  const totalWeight = valid.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  if (totalWeight <= 0) {
    return String(valid[0]?.climate || "Nublado");
  }
  let roll = seed % totalWeight;
  for (let idx = 0; idx < valid.length; idx += 1) {
    roll -= Number(valid[idx].weight || 0);
    if (roll < 0) {
      return String(valid[idx].climate || "Nublado");
    }
  }
  return String(valid[valid.length - 1]?.climate || "Nublado");
}

function perimClimateEventByName(climateRaw) {
  const key = normalizeClimateText(climateRaw);
  if (!key) {
    return PERIM_EVENTS_BY_CLIMATE.nublado;
  }
  if (key.includes("ensolar")) return PERIM_EVENTS_BY_CLIMATE.ensolarado;
  if (key.includes("chuv")) return PERIM_EVENTS_BY_CLIMATE.chuvoso;
  if (key.includes("vent")) return PERIM_EVENTS_BY_CLIMATE.ventania;
  if (key.includes("tempest")) return PERIM_EVENTS_BY_CLIMATE.tempestade;
  if (key.includes("umid") || key.includes("humid")) return PERIM_EVENTS_BY_CLIMATE.umido;
  if (key.includes("sec")) return PERIM_EVENTS_BY_CLIMATE.seco;
  if (key.includes("fri")) return PERIM_EVENTS_BY_CLIMATE.frio;
  if (key.includes("quent") || key.includes("calor") || key.includes("hot")) return PERIM_EVENTS_BY_CLIMATE.quente;
  if (key.includes("lugarfechado") || key.includes("fechado") || key.includes("indoor") || key.includes("interno")) {
    return PERIM_EVENTS_BY_CLIMATE.lugar_fechado;
  }
  return PERIM_EVENTS_BY_CLIMATE.nublado;
}

let perimClimateDailyEffectCache = { dateKey: "", byClimate: new Map() };

function sanitizePerimDailyClimateModifiers(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sanitizeMult = (value, fallback = 1) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(0.5, Math.min(1.5, numeric));
  };
  const sanitizeAdd = (value, min = -0.2, max = 0.2) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return Math.max(min, Math.min(max, numeric));
  };
  const typeWeightSource = source.typeWeightMultiplier && typeof source.typeWeightMultiplier === "object"
    ? source.typeWeightMultiplier
    : {};
  return {
    typeWeightMultiplier: {
      creatures: sanitizeMult(typeWeightSource.creatures, 1),
      attacks: sanitizeMult(typeWeightSource.attacks, 1),
      battlegear: sanitizeMult(typeWeightSource.battlegear, 1),
      mugic: sanitizeMult(typeWeightSource.mugic, 1),
      locations: sanitizeMult(typeWeightSource.locations, 1),
    },
    creatureDropChanceAdd: sanitizeAdd(source.creatureDropChanceAdd, -0.12, 0.12),
    attackChanceMultiplier: sanitizeMult(source.attackChanceMultiplier, 1),
    bonusChanceMultiplier: sanitizeMult(source.bonusChanceMultiplier, 1),
    locationDropChanceMultiplier: sanitizeMult(source.locationDropChanceMultiplier, 1),
    successChanceAdd: sanitizeAdd(source.successChanceAdd, -0.12, 0.12),
    rareBoostAdd: sanitizeAdd(source.rareBoostAdd, -0.4, 0.4),
  };
}

function buildPerimDailyEffectEntry(climateKeyRaw, effectSource, dateKeyRaw = "", rolledAtRaw = "") {
  const climateKey = normalizePerimClimateKey(climateKeyRaw) || "nublado";
  const fallback = Array.isArray(PERIM_DAILY_CLIMATE_EFFECTS[climateKey]) ? PERIM_DAILY_CLIMATE_EFFECTS[climateKey][0] : null;
  const source = effectSource && typeof effectSource === "object" ? effectSource : fallback || {};
  const modifiers = sanitizePerimDailyClimateModifiers(source.modifiers);
  return {
    climateKey,
    dateKey: String(dateKeyRaw || todayDateKey()).trim() || todayDateKey(),
    id: String(source.id || `${climateKey}_fallback`),
    label: String(source.label || "Efeito Diario"),
    description: String(source.description || "Efeito diario leve de Perim."),
    modifiers,
    rolledAt: String(rolledAtRaw || nowIso()),
  };
}

function pickPerimDailyClimateEffect(climateKeyRaw) {
  const climateKey = normalizePerimClimateKey(climateKeyRaw) || "nublado";
  const pool = Array.isArray(PERIM_DAILY_CLIMATE_EFFECTS[climateKey]) ? PERIM_DAILY_CLIMATE_EFFECTS[climateKey] : [];
  if (!pool.length) {
    return buildPerimDailyEffectEntry(climateKey, {
      id: `${climateKey}_neutral`,
      label: "Fluxo Neutro",
      description: "Sem alteracoes relevantes hoje.",
      modifiers: {},
    });
  }
  const picked = pool[Math.floor(Math.random() * pool.length)] || pool[0];
  return buildPerimDailyEffectEntry(climateKey, picked);
}

function readPerimClimateDailyEffectsForDate(dateKeyRaw = "") {
  const dateKey = String(dateKeyRaw || todayDateKey()).trim() || todayDateKey();
  const byClimate = new Map();
  if (isSqlV2Ready()) {
    const rows = sqliteDb
      .prepare(`
        SELECT date_key, climate_key, effect_id, effect_label, effect_description, modifiers_json, rolled_at
        FROM perim_climate_daily_effects
        WHERE date_key = ?
      `)
      .all(dateKey);
    rows.forEach((row) => {
      const climateKey = normalizePerimClimateKey(row?.climate_key || "");
      if (!climateKey) {
        return;
      }
      const parsedModifiers = parseJsonText(row?.modifiers_json, {});
      byClimate.set(
        climateKey,
        buildPerimDailyEffectEntry(
          climateKey,
          {
            id: String(row?.effect_id || ""),
            label: String(row?.effect_label || ""),
            description: String(row?.effect_description || ""),
            modifiers: parsedModifiers,
          },
          String(row?.date_key || dateKey),
          String(row?.rolled_at || nowIso())
        )
      );
    });
    return byClimate;
  }
  const cached = sqlGet("perim_climate_daily_effects", dateKey);
  const entries = Array.isArray(cached?.effects) ? cached.effects : [];
  entries.forEach((entry) => {
    const climateKey = normalizePerimClimateKey(entry?.climateKey || "");
    if (!climateKey) {
      return;
    }
    byClimate.set(
      climateKey,
      buildPerimDailyEffectEntry(
        climateKey,
        {
          id: entry?.id,
          label: entry?.label,
          description: entry?.description,
          modifiers: entry?.modifiers,
        },
        entry?.dateKey || dateKey,
        entry?.rolledAt || nowIso()
      )
    );
  });
  return byClimate;
}

function ensurePerimClimateDailyEffectsForDate(dateKeyRaw = "") {
  const dateKey = String(dateKeyRaw || todayDateKey()).trim() || todayDateKey();
  if (perimClimateDailyEffectCache.dateKey === dateKey && perimClimateDailyEffectCache.byClimate.size === PERIM_DAILY_CLIMATE_KEYS.length) {
    return perimClimateDailyEffectCache.byClimate;
  }
  const existing = readPerimClimateDailyEffectsForDate(dateKey);
  if (isSqlV2Ready()) {
    const insertStmt = sqliteDb.prepare(`
      INSERT INTO perim_climate_daily_effects (
        date_key, climate_key, effect_id, effect_label, effect_description, modifiers_json, rolled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date_key, climate_key) DO NOTHING
    `);
    PERIM_DAILY_CLIMATE_KEYS.forEach((climateKey) => {
      if (existing.has(climateKey)) {
        return;
      }
      const rolled = pickPerimDailyClimateEffect(climateKey);
      insertStmt.run(
        dateKey,
        climateKey,
        String(rolled.id || ""),
        String(rolled.label || ""),
        String(rolled.description || ""),
        JSON.stringify(rolled.modifiers || {}),
        String(rolled.rolledAt || nowIso())
      );
      existing.set(climateKey, buildPerimDailyEffectEntry(climateKey, rolled, dateKey, rolled.rolledAt));
    });
  } else {
    let changed = false;
    PERIM_DAILY_CLIMATE_KEYS.forEach((climateKey) => {
      if (existing.has(climateKey)) {
        return;
      }
      existing.set(climateKey, pickPerimDailyClimateEffect(climateKey));
      changed = true;
    });
    if (changed) {
      sqlSet("perim_climate_daily_effects", dateKey, {
        dateKey,
        effects: [...existing.values()],
      });
    }
  }
  const refreshed = readPerimClimateDailyEffectsForDate(dateKey);
  PERIM_DAILY_CLIMATE_KEYS.forEach((climateKey) => {
    if (!refreshed.has(climateKey)) {
      refreshed.set(climateKey, pickPerimDailyClimateEffect(climateKey));
    }
  });
  perimClimateDailyEffectCache = { dateKey, byClimate: refreshed };
  return refreshed;
}

function getPerimDailyClimateEffect(climateRaw, dateKeyRaw = "", nowDate = new Date()) {
  const climateKey = normalizePerimClimateKey(climateRaw) || "nublado";
  const dateKey = String(dateKeyRaw || todayDateKey(nowDate)).trim() || todayDateKey(nowDate);
  const byClimate = ensurePerimClimateDailyEffectsForDate(dateKey);
  const effect = byClimate.get(climateKey) || byClimate.get("nublado") || pickPerimDailyClimateEffect(climateKey);
  return buildPerimDailyEffectEntry(climateKey, effect, dateKey, effect?.rolledAt || nowIso());
}

function applyPerimTypeWeightMultipliers(baseWeightsRaw, dailyModifiersRaw) {
  const baseWeights = baseWeightsRaw && typeof baseWeightsRaw === "object" ? baseWeightsRaw : {};
  const dailyModifiers = sanitizePerimDailyClimateModifiers(dailyModifiersRaw);
  const typeMultipliers = dailyModifiers.typeWeightMultiplier;
  const output = {};
  ["creatures", "attacks", "battlegear", "mugic", "locations"].forEach((type) => {
    const base = Math.max(0, Number(baseWeights[type] || 0));
    output[type] = Math.max(0, base * Math.max(0.25, Number(typeMultipliers[type] || 1)));
  });
  return output;
}

function buildPerimContextSnapshot(locationEntry, actionId, scannerEffect = null, nowDate = new Date(), clues = []) {
  const globalState = getPerimGlobalLocationState(locationEntry, nowDate);
  const climateEvent = perimClimateEventByName(globalState.climate);
  const dailyEffect = getPerimDailyClimateEffect(globalState.climate, todayDateKey(nowDate), nowDate);
  const chosenAction = String(actionId || "explore");
  const creatureChanceByAction = locationEntry?.creatureChanceByAction || {};
  const creatureChancePercent = clampPercent(
    creatureChanceByAction[chosenAction] ?? locationEntry?.creatureChancePercent ?? getPerimCreatureBaseChanceByAction("explore")
  );
  const creaturesTodayCount = getDroppableCreatureCountAtLocation(
    String(locationEntry?.cardId || locationEntry?.id || locationEntry?.name || ""),
    todayDateKey(nowDate)
  );
  const successBoost = Math.max(0, Number(scannerEffect?.successBoostPercent || 0));
  const combinedEventEffect = String(climateEvent?.effect || "").trim();
  const dailyEventEffect = String(dailyEffect?.description || "").trim();
  return {
    capturedAt: nowDate.toISOString(),
    turnLabel: globalState.turnLabel,
    climate: globalState.climate,
    eventId: String(climateEvent?.id || ""),
    eventLabel: String(climateEvent?.label || ""),
    eventEffect: dailyEventEffect
      ? `${combinedEventEffect}${combinedEventEffect ? " | " : ""}${dailyEventEffect}`
      : combinedEventEffect,
    dailyEffectId: String(dailyEffect?.id || ""),
    dailyEffectLabel: String(dailyEffect?.label || ""),
    dailyEffectDescription: String(dailyEffect?.description || ""),
    dailyEffectDate: String(dailyEffect?.dateKey || todayDateKey(nowDate)),
    dailyEffectModifiers: sanitizePerimDailyClimateModifiers(dailyEffect?.modifiers),
    creatureChancePercent,
    creaturesTodayCount,
    hasCreaturesToday: creaturesTodayCount > 0,
    clues: Array.isArray(clues) ? clues.filter(Boolean) : [],
    scanSuccessBoostPercent: successBoost,
    eventChancePercent: (
      (climateEvent?.bonus && Object.keys(climateEvent.bonus).length ? 100 : 0)
      || (dailyEventEffect ? 100 : 0)
    ),
    locationDropChancePercent: Math.round(locationDropChanceByRarity(locationEntry?.rarity || "") * 100),
  };
}

function currentPerimHourToken(nowDate = new Date()) {
  const year = nowDate.getFullYear();
  const month = String(nowDate.getMonth() + 1).padStart(2, "0");
  const day = String(nowDate.getDate()).padStart(2, "0");
  const hour = Number(nowDate.getHours() || 0);
  let slot = PERIM_CLIMATE_SLOTS[0];
  PERIM_CLIMATE_SLOTS.forEach((boundary) => {
    if (hour >= boundary) {
      slot = boundary;
    }
  });
  return `${year}-${month}-${day}-${String(slot).padStart(2, "0")}`;
}

function getPerimGlobalLocationState(locationEntry, nowDate = new Date()) {
  const locationId = String(locationEntry?.cardId || locationEntry?.id || "").trim();
  const allowedClimateKeys = getPerimLocationAllowedClimateKeys(locationId);
  if (!locationId) {
    return {
      turnLabel: turnLabelFromHour(nowDate.getHours()),
      climate: "Nublado",
      hourToken: currentPerimHourToken(nowDate),
    };
  }
  const hourToken = currentPerimHourToken(nowDate);
  if (isSqlV2Ready()) {
    const row = sqliteDb
      .prepare(`
        SELECT turn_label, climate, hour_token, updated_at
        FROM perim_location_state
        WHERE location_id = ?
      `)
      .get(locationId);
    if (row && String(row?.hour_token || "") === hourToken) {
      if (!isPerimClimateAllowed(row?.climate || "", allowedClimateKeys)) {
        const weatherSeed = hashTokenToInt(`${locationId}:${hourToken}:allowlist`);
        const climateProfile = filterPerimClimateProfileByAllowlist(
          inferPerimClimateProfile(locationEntry || {}),
          allowedClimateKeys
        );
        const refreshedClimate = pickWeightedClimate(climateProfile, weatherSeed);
        const refreshedState = {
          hourToken,
          turnLabel: String(row?.turn_label || turnLabelFromHour(nowDate.getHours())),
          climate: perimClimateLabelFromKey(refreshedClimate || "nublado"),
          updatedAt: nowIso(),
        };
        sqliteDb.prepare(`
          UPDATE perim_location_state
          SET climate = ?, updated_at = ?
          WHERE location_id = ?
        `).run(
          String(refreshedState.climate || "Nublado"),
          String(refreshedState.updatedAt || nowIso()),
          locationId
        );
        return refreshedState;
      }
      return {
        hourToken: String(row?.hour_token || hourToken),
        turnLabel: String(row?.turn_label || turnLabelFromHour(nowDate.getHours())),
        climate: String(row?.climate || "Nublado"),
        updatedAt: String(row?.updated_at || nowIso()),
      };
    }
  } else {
    const cached = sqlGet("perim_location_state_global", locationId);
    if (cached && cached.hourToken === hourToken) {
      return cached;
    }
  }
  const weatherSeed = hashTokenToInt(`${locationId}:${hourToken}`);
  const climateProfile = filterPerimClimateProfileByAllowlist(
    inferPerimClimateProfile(locationEntry || {}),
    allowedClimateKeys
  );
  const climate = pickWeightedClimate(climateProfile, weatherSeed);
  const nextState = {
    hourToken,
    turnLabel: turnLabelFromHour(nowDate.getHours()),
    climate: perimClimateLabelFromKey(climate || "nublado"),
    updatedAt: nowIso(),
  };
  if (isSqlV2Ready()) {
    sqliteDb.prepare(`
      INSERT INTO perim_location_state (location_id, turn_label, climate, creatures_today_count, event_chance_percent, hour_token, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET
        turn_label = excluded.turn_label,
        climate = excluded.climate,
        hour_token = excluded.hour_token,
        updated_at = excluded.updated_at
    `).run(
      locationId,
      String(nextState.turnLabel || ""),
      String(nextState.climate || "Nublado"),
      0,
      0,
      String(nextState.hourToken || ""),
      String(nextState.updatedAt || nowIso())
    );
  } else {
    sqlSet("perim_location_state_global", locationId, nextState);
  }
  return nextState;
}

function computePerimDurationMs(locationId, actionId, baseDurationMs, scannerEffect = null) {
  const seed = hashTokenToInt(`${locationId}:${actionId}`);
  const randomMultiplier = 0.82 + ((seed % 53) / 100);
  const tribalDurationMultiplier = Math.max(0.55, Number(scannerEffect?.durationMultiplier || 1));
  const globalDurationMultiplier = Math.max(
    0.55,
    Number(scannerEffect?.globalDurationMultiplier ?? scannerEffect?.durationMultiplier ?? 1)
  );
  const multiplier = randomMultiplier * tribalDurationMultiplier * globalDurationMultiplier;
  return Math.max(60 * 60 * 1000, Math.round(baseDurationMs * multiplier));
}

function buildPerimRewards(locationEntry, actionId, options = {}) {
  const perfStart = Date.now();
  const tribe = String(locationEntry?.tribe || "").trim();
  const locationTribeKey = resolvePerimLocationEffectiveTribeKey(locationEntry);
  const rewards = [];
  const profile = getPerimRewardProfile(actionId);
  const scannerEffect = options.scannerEffect || scannerEffectsByLevel(1);
  const tribeScannerRareBoosts = options.tribeScannerRareBoosts instanceof Map ? options.tribeScannerRareBoosts : new Map();
  const inventoryCounts = options.inventoryCounts instanceof Map ? options.inventoryCounts : new Map();
  const locationOwnedTotalCounts = options.locationOwnedTotalCounts instanceof Map ? new Map(options.locationOwnedTotalCounts) : new Map();
  const includeCreatureVariant = Boolean(options.includeCreatureVariant);
  const ignoreInventoryCap = Boolean(options.ignoreInventoryCap);
  const locationRules = getPerimLocationRules();
  const adjacentFirstChance = clampUnitInterval(locationRules?.adjacentFirstChance, 0.72);
  const fallbackCurrentMinChance = clampUnitInterval(locationRules?.fallbackCurrentMinChance, 0.05);
  const maxCreatureDropsPerRun = getPerimMaxCreatureDropsPerRun();
  const maxTotalDropsPerRun = getPerimMaxTotalDropsPerRun();
  const contextSnapshot = options.contextSnapshot && typeof options.contextSnapshot === "object"
    ? options.contextSnapshot
    : null;
  const startDate = options.startDate instanceof Date
    ? options.startDate
    : new Date(
      Date.parse(
        String(
          contextSnapshot?.capturedAt
          || contextSnapshot?.startAt
          || options?.startAt
          || nowIso()
        )
      ) || Date.now()
    );
  const snapshotClimate = String(contextSnapshot?.climate || "").trim();
  const dailyEffectDateKey = String(contextSnapshot?.dailyEffectDate || todayDateKey(startDate));
  const dailyEffect = getPerimDailyClimateEffect(snapshotClimate, dailyEffectDateKey, startDate);
  const dailyEffectModifiers = sanitizePerimDailyClimateModifiers(
    contextSnapshot?.dailyEffectModifiers || dailyEffect?.modifiers || {}
  );
  let creatureDropsInRun = 0;
  const perimState = getPerimGlobalLocationState(locationEntry, startDate);
  const activeClimate = normalizeClimateText(perimState?.climate || "nublado");
  const primaryWeights = applyPerimTypeWeightMultipliers(profile.primary, dailyEffectModifiers);
  const effectiveRareBoostBase = Math.max(0, Number(scannerEffect.rareBoost || 0) + Number(dailyEffectModifiers.rareBoostAdd || 0));
  const locationScannerKey = normalizeTribeToScannerKey(locationTribeKey || tribe);
  const tribeBoostEntry = tribeScannerRareBoosts.get(locationScannerKey) || null;
  const creatureRareBoost = Math.max(0, Number(tribeBoostEntry?.creatureRareBoost ?? effectiveRareBoostBase ?? 0));
  const mugicRareBoost = Math.max(0, Number(tribeBoostEntry?.mugicRareBoost ?? scannerEffect.mugicRareBoost ?? effectiveRareBoostBase ?? 0));
  const campWaitCount = Math.max(0, Math.floor(Number(options?.campWaitCount || 0)));
  const excludedRewardCardKeys = options.excludedRewardCardKeys instanceof Set ? options.excludedRewardCardKeys : new Set();
  const battlegearAllowedCardIds = getPerimAvailableBattlegearCardIdsForLocation(
    String(locationEntry?.cardId || locationEntry?.id || ""),
    todayDateKey(startDate)
  );
  const campStacking = getPerimCampCreatureStackingSettings();
  const campBonusPercent = actionId === "camp"
    ? calculatePerimCampCreatureBonusPercent(campWaitCount)
    : 0;
  const campBonusChance = clampUnitInterval(campBonusPercent / 100, 0);
  const creatureDropChance = Math.max(
    0,
    Math.min(
      1,
      (Number(calculateCreatureChancePercent(locationEntry?.rarity, actionId) || 0) / 100)
      + Number(dailyEffectModifiers.creatureDropChanceAdd || 0)
    )
  );
  const { locationsById: locationCardsById } = getLibraryIndexes();
  const resolveOwnedLocationTotal = (cardIdRaw) => {
    const cardId = String(cardIdRaw || "").trim();
    if (!cardId) {
      return 0;
    }
    const byScanAndDeck = Math.max(0, Number(locationOwnedTotalCounts.get(cardId) || 0));
    const byInventory = Math.max(0, Number(inventoryCounts.get(`locations:${cardId}`) || 0));
    return Math.max(byScanAndDeck, byInventory);
  };
  const locationRepeatWeightByOwnedCopies = (ownedCopies) => {
    if (ownedCopies <= 0) return 1;
    if (ownedCopies === 1) return 0.72;
    if (ownedCopies === 2) return 0.45;
    return 0;
  };
  const buildLocationRewardCandidates = (locationIdList) => {
    const uniqueIds = [...new Set(
      (Array.isArray(locationIdList) ? locationIdList : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )];
    return uniqueIds
      .map((cardId) => locationCardsById.get(cardId))
      .filter(Boolean)
      .map((card) => {
        const id = String(card?.id || "").trim();
        if (!id) {
          return null;
        }
        if (!isPerimDropSetAllowed(card?.set || "")) {
          return null;
        }
        if (excludedRewardCardKeys.has(`locations:${id}`)) {
          return null;
        }
        const lowerName = String(card?.name || "").toLowerCase();
        if (lowerName.includes("unused") || lowerName.includes("alpha")) {
          return null;
        }
        const inventoryAmount = Math.max(0, Number(inventoryCounts.get(`locations:${id}`) || 0));
        if (!ignoreInventoryCap && inventoryAmount >= INVENTORY_MAX_COPIES) {
          return null;
        }
        const ownedTotal = resolveOwnedLocationTotal(id);
        if (ownedTotal >= PERIM_LOCATION_DROP_COPY_CAP) {
          return null;
        }
        const rarityChance = Math.max(0.01, locationDropChanceByRarity(card?.rarity || ""));
        const repeatWeight = Math.max(0, locationRepeatWeightByOwnedCopies(ownedTotal));
        if (repeatWeight <= 0) {
          return null;
        }
        return {
          card,
          weight: Math.max(0.01, rarityChance * repeatWeight),
        };
      })
      .filter(Boolean);
  };
  const pickLocationCardWithBias = (locationIdList, includeCurrentLocation = false) => {
    const currentLocationId = String(locationEntry?.cardId || locationEntry?.id || "").trim();
    const sourceIds = [...(Array.isArray(locationIdList) ? locationIdList : [])];
    if (includeCurrentLocation && currentLocationId) {
      sourceIds.push(currentLocationId);
    }
    const candidates = buildLocationRewardCandidates(sourceIds);
    if (!candidates.length) {
      return null;
    }
    const sameLocationId = String(currentLocationId || "");
    const adjacentCandidates = sameLocationId
      ? candidates.filter((entry) => String(entry?.card?.id || "") !== sameLocationId)
      : candidates;
    const basePool = adjacentCandidates.length && Math.random() < adjacentFirstChance
      ? adjacentCandidates
      : candidates;
    const picked = weightedRandomChoice(basePool, Math.random)
      || weightedRandomChoice(candidates, Math.random)
      || null;
    if (!picked?.card && sameLocationId && Math.random() < fallbackCurrentMinChance) {
      const sameLocationCandidate = candidates.find((entry) => String(entry?.card?.id || "") === sameLocationId) || null;
      return sameLocationCandidate?.card || null;
    }
    return picked?.card || null;
  };
  const pickCreatureForAction = () => {
    if (creatureDropsInRun >= maxCreatureDropsPerRun) {
      return null;
    }
    if (Math.random() <= creatureDropChance) {
      const normalRoll = pickCreatureRewardFromLocation(locationEntry, {
        inventoryCounts,
        rareBoost: creatureRareBoost,
        includeCreatureVariant,
        ignoreInventoryCap,
        locationTribeKey,
        excludedRewardCardKeys,
      });
      if (normalRoll) {
        return normalRoll;
      }
    }
    if (actionId !== "camp" || !campStacking.enabled || campBonusChance <= 0) {
      return null;
    }
    if (Math.random() > campBonusChance) {
      return null;
    }
    return pickCreatureRewardFromLocation(locationEntry, {
      inventoryCounts,
      rareBoost: creatureRareBoost,
      includeCreatureVariant,
      ignoreInventoryCap,
      maxRarity: String(campStacking.bonusMaxRarity || "super rare"),
      forceDrop: true,
      locationTribeKey,
      excludedRewardCardKeys,
    });
  };
  const pickRewardForType = (type) => {
    if (type === "creatures") {
      return pickCreatureForAction();
    }
    return rewardCardFromType(type, tribe, {
      inventoryCounts,
      rareBoost: type === "mugic" ? mugicRareBoost : effectiveRareBoostBase,
      includeCreatureVariant,
      ignoreInventoryCap,
      activeClimate,
      locationEntry,
      locationTribeKey,
      tribeScannerRareBoosts,
      requireLocalMugicEligible: type === "mugic",
      excludedRewardCardKeys,
      battlegearAllowedCardIds,
    });
  };

  const appendReward = (rewardLike) => {
    if (rewards.length >= maxTotalDropsPerRun) {
      return false;
    }
    const normalized = normalizeRewardPayload(rewardLike);
    if (!normalized) {
      return false;
    }
    if (normalized.type === "creatures") {
      if (creatureDropsInRun >= maxCreatureDropsPerRun) {
        return false;
      }
      creatureDropsInRun += 1;
    } else if (normalized.type === "locations") {
      const cardId = String(normalized?.cardId || "").trim();
      if (cardId) {
        const nextOwned = resolveOwnedLocationTotal(cardId) + 1;
        locationOwnedTotalCounts.set(cardId, nextOwned);
      }
    }
    rewards.push(normalized);
    increaseInventoryCountMap(inventoryCounts, normalized);
    return true;
  };

  const buildDropEventRewardFromEvent = (eventEntry) => {
    if (!eventEntry || typeof eventEntry !== "object") {
      return null;
    }
    const type = String(eventEntry.cardType || "").trim();
    const cardId = String(eventEntry.cardId || "").trim();
    if (!DECK_CARD_TYPES.includes(type) || !cardId) {
      return null;
    }
    if (excludedRewardCardKeys.has(`${type}:${cardId}`)) {
      return null;
    }
    const cardsByType = Array.isArray(library?.cardsByType?.[type]) ? library.cardsByType[type] : [];
    const card = cardsByType.find((entry) => String(entry?.id || "") === cardId) || null;
    if (!card) {
      return null;
    }
    if (!isPerimDropSetAllowed(card?.set || "")) {
      return null;
    }
    const lowerName = String(card?.name || "").toLowerCase();
    if (lowerName.includes("unused") || lowerName.includes("alpha")) {
      return null;
    }
    const stockKey = `${type}:${cardId}`;
    const currentAmount = Math.max(0, Number(inventoryCounts.get(stockKey) || 0));
    if (!ignoreInventoryCap && currentAmount >= INVENTORY_MAX_COPIES) {
      return null;
    }
    if (type === "locations") {
      const ownedTotal = resolveOwnedLocationTotal(cardId);
      if (ownedTotal >= PERIM_LOCATION_DROP_COPY_CAP) {
        return null;
      }
    }
    const reward = {
      type,
      cardId,
      cardName: String(card?.name || cardId),
      rarity: String(card?.rarity || "Unknown"),
      image: String(card?.image || ""),
      source: "perim_drop_event",
      eventText: String(eventEntry.eventText || ""),
      eventId: Number(eventEntry.id || 0),
    };
    if (type === "creatures" && includeCreatureVariant) {
      const variant = buildCreatureScanVariant();
      reward.variant = variant;
      reward.cardDisplayName = `${reward.cardName} (${creatureVariantBadge(variant)})`;
    }
    return reward;
  };

  const pickGuaranteedLocalReward = () => {
    const linked = Array.isArray(locationEntry?.linkedLocationIds) ? locationEntry.linkedLocationIds : [];
    const pickedLocation = pickLocationCardWithBias(linked, true);
    if (pickedLocation) {
      appendReward({
        type: "locations",
        cardId: pickedLocation.id,
        cardName: pickedLocation.name,
        rarity: pickedLocation.rarity || "Unknown",
        image: pickedLocation.image || "",
      });
    }
  };

  const successRoll = Math.random();
  const baseSuccessChance = Math.max(0, Math.min(1, Number(profile.baseSuccessChance || 0.65)));
  const boostedSuccessChance = Math.max(
    0,
    Math.min(
      1,
      baseSuccessChance
      + (Number(scannerEffect.successBoostPercent || 0) / 100)
      + Number(dailyEffectModifiers.successChanceAdd || 0)
    )
  );
  const success = successRoll <= boostedSuccessChance;
  if (!success) {
    const failFallback =
      rewardCardFromType("attacks", tribe, {
        inventoryCounts,
        rareBoost: effectiveRareBoostBase,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      }) ||
      rewardCardFromType("battlegear", tribe, {
        inventoryCounts,
        rareBoost: effectiveRareBoostBase,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      }) ||
      rewardCardFromType("mugic", tribe, {
        inventoryCounts,
        rareBoost: mugicRareBoost,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        requireLocalMugicEligible: true,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      }) ||
      pickCreatureForAction();
    if (failFallback) {
      appendReward(failFallback);
    }
    if (!rewards.length) {
      pickGuaranteedLocalReward();
    }
  } else {
    const primaryType = weightedPickWithClimate(primaryWeights, activeClimate) || "creatures";
    const primaryReward = pickRewardForType(primaryType);
    if (primaryReward) {
      appendReward(primaryReward);
    }
    const effectiveBonusChance = Math.max(
      0,
      Math.min(1, Number(profile.bonusChance || 0) * Number(dailyEffectModifiers.bonusChanceMultiplier || 1))
    );
    if (Math.random() < effectiveBonusChance) {
      const bonusType = weightedPickWithClimate(primaryWeights, activeClimate) || "attacks";
      const bonusReward = pickRewardForType(bonusType);
      if (bonusReward) {
        appendReward(bonusReward);
      }
    }
    let attackDrops = 0;
    const effectiveAttackChance = Math.max(
      0,
      Math.min(1, Number(profile.attackChance || 0) * Number(dailyEffectModifiers.attackChanceMultiplier || 1))
    );
    if (Math.random() < effectiveAttackChance) {
      attackDrops += 1;
    }
    if (attackDrops > 0 && Math.random() < 0.35) {
      attackDrops += 1;
    }
    attackDrops = Math.min(2, attackDrops);
    for (let i = 0; i < attackDrops; i += 1) {
      const attackReward = rewardCardFromType("attacks", tribe, {
        inventoryCounts,
        rareBoost: effectiveRareBoostBase,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      });
      if (attackReward) {
        appendReward(attackReward);
      }
    }
    const locationDropChance = Math.max(
      0,
      Math.min(
        1,
        locationDropChanceByRarity(locationEntry?.rarity || "")
        * Math.max(0.2, Number(profile.locationDropBias || 1))
        * PERIM_LOCATION_DROP_BASE_CHANCE_MULTIPLIER
        * Math.max(0.25, Number(dailyEffectModifiers.locationDropChanceMultiplier || 1))
      )
    );
    const linkedLocationIds = Array.isArray(locationEntry?.linkedLocationIds) ? locationEntry.linkedLocationIds : [];
    if (Math.random() < locationDropChance) {
      const picked = pickLocationCardWithBias(linkedLocationIds, true);
      if (picked?.id) {
        appendReward({
          type: "locations",
          cardId: picked.id,
          cardName: picked.name,
          rarity: picked.rarity || "Unknown",
          image: picked.image || "",
        });
      }
    }
  }
  if (!rewards.length) {
    pickGuaranteedLocalReward();
  }
  if (!rewards.length) {
    const fallback = rewardCardFromType("attacks", tribe, {
      inventoryCounts,
      rareBoost: effectiveRareBoostBase,
      ignoreInventoryCap,
      activeClimate,
      locationEntry,
      locationTribeKey,
      tribeScannerRareBoosts,
      excludedRewardCardKeys,
      battlegearAllowedCardIds,
    })
      || rewardCardFromType("battlegear", tribe, {
        inventoryCounts,
        rareBoost: effectiveRareBoostBase,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      })
      || rewardCardFromType("mugic", tribe, {
        inventoryCounts,
        rareBoost: mugicRareBoost,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        requireLocalMugicEligible: true,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      });
    if (fallback) {
      appendReward(fallback);
    }
  }
  const minRewardsByAction = String(actionId || "") === "anomaly" ? 1 : 2;
  const minRewardsTarget = Math.max(1, Math.min(maxTotalDropsPerRun, minRewardsByAction));
  let attempts = 0;
  while (rewards.length < minRewardsTarget && attempts < 10) {
    attempts += 1;
    if (rewards.length >= maxTotalDropsPerRun) {
      break;
    }
    const topUp =
      pickRewardForType(weightedPickWithClimate(primaryWeights, activeClimate) || "attacks")
      || rewardCardFromType("attacks", tribe, {
        inventoryCounts,
        rareBoost: effectiveRareBoostBase,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      })
      || rewardCardFromType("mugic", tribe, {
        inventoryCounts,
        rareBoost: mugicRareBoost,
        ignoreInventoryCap,
        activeClimate,
        locationEntry,
        locationTribeKey,
        tribeScannerRareBoosts,
        requireLocalMugicEligible: true,
        excludedRewardCardKeys,
        battlegearAllowedCardIds,
      });
    if (!topUp || !appendReward(topUp)) {
      break;
    }
  }
  if (rewards.length < maxTotalDropsPerRun) {
    const locationCardId = String(locationEntry?.cardId || locationEntry?.id || "").trim();
    const activeEvents = listActivePerimDropEventsForLocation(locationCardId, new Date());
    for (const eventEntry of activeEvents) {
      if (rewards.length >= maxTotalDropsPerRun) {
        break;
      }
      const chance = Math.max(0, Math.min(1, Number(eventEntry?.chancePercent || 0) / 100));
      if (chance <= 0 || Math.random() > chance) {
        continue;
      }
      const bonusReward = buildDropEventRewardFromEvent(eventEntry);
      if (bonusReward && appendReward(bonusReward)) {
        break;
      }
    }
  }
  if (rewards.length > maxTotalDropsPerRun) {
    rewards.length = maxTotalDropsPerRun;
  }
  logPerimPerf("buildPerimRewards", perfStart, `action=${String(actionId || "")} rewards=${rewards.length}`);
  return rewards.filter(Boolean);
}

// ────────────────────────────────────────────────────────────────
// Creature Daily Location System
// ────────────────────────────────────────────────────────────────

const PERIM_CLIMATE_SLOTS = [0, 6, 12, 18];

let perimCreaturesMatrixCache = null;

function loadPerimCreaturesMatrix() {
  const fileExists = fs.existsSync(PERIM_CREATURES_FILE);
  const fileMtimeMs = fileExists ? Number(fs.statSync(PERIM_CREATURES_FILE).mtimeMs || 0) : 0;
  if (perimCreaturesMatrixCache && perimCreaturesMatrixCache.mtimeMs === fileMtimeMs) {
    return perimCreaturesMatrixCache.rows;
  }
  const rows = [];
  if (!fileExists) {
    perimCreaturesMatrixCache = { mtimeMs: 0, rows };
    return rows;
  }
  try {
    const workbook = safeReadWorkbookFromFile(PERIM_CREATURES_FILE);
    const sheet = workbook.Sheets.Sheet1 || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      perimCreaturesMatrixCache = { mtimeMs: fileMtimeMs, rows };
      return rows;
    }
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    rawRows.forEach((row) => {
      const name = String(row["Column1.name"] || "").trim();
      if (!name) {
        return;
      }
      const rarity = String(row["Column1.rarity"] || "").trim();
      const tribe = String(row["Column1.tribe"] || "").trim();
      const types = String(row["Column1.types"] || "").trim();
      const loki = Number(row["Column1.loki"] || 0);
      const proximoLocal = String(row["ENCONTRADO PROXIMO A ESSE LOCAL"] || "").trim();
      const somenteLocal1 = String(row["ENCONTRADO SOMENTE NESSE LOCAL"] || "").trim();
      const somenteLocal2 = String(row["ENCONTRADO SOMENTE NESSE LOCAL 2"] || "").trim();
      rows.push({
        name,
        rarity,
        tribe,
        types,
        loki,
        proximoLocal,
        somenteLocal1,
        somenteLocal2,
      });
    });
  } catch (error) {
    console.warn(`[PERIM] Falha ao ler criaturas.xlsx: ${error.message}`);
  }
  perimCreaturesMatrixCache = { mtimeMs: fileMtimeMs, rows };
  return rows;
}

function locationAliasCandidates(rawValue) {
  const token = String(rawValue || "").trim();
  if (!token) {
    return [];
  }
  const parts = token
    .split(/[,;|/]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return [token, ...parts.filter((part) => part.toLowerCase() !== token.toLowerCase())];
}

function buildLocationAdjacencyGraph() {
  const locRows = loadPerimLocationsMatrix();
  const matrixMtime = Number(perimLocationsMatrixCache?.mtimeMs || 0);
  const adjacencySnapshot = loadPerimLocationAdjacencyLinks();
  const cacheToken = `${matrixMtime}:${adjacencySnapshot.token}`;
  if (perimLocationAdjacencyGraphCache.value && perimLocationAdjacencyGraphCache.token === cacheToken) {
    return perimLocationAdjacencyGraphCache.value;
  }
  const locNameToEnvironment = new Map();
  const locNameToAdjacent = new Map();
  const locationKeys = new Set();
  const displayNameByKey = new Map();

  const { locationsById: locationsByCardId } = getLibraryIndexes();
  locationsByCardId.forEach((card) => {
    const name = String(card?.name || "").trim();
    const nameKey = normalizePerimText(name);
    if (!nameKey) {
      return;
    }
    locationKeys.add(nameKey);
    if (!displayNameByKey.has(nameKey)) {
      displayNameByKey.set(nameKey, name);
    }
    if (!locNameToAdjacent.has(nameKey)) {
      locNameToAdjacent.set(nameKey, new Set());
    }
  });

  locRows.forEach((row) => {
    const name = String(row.name || "").trim();
    const nameKey = normalizePerimText(name);
    if (!nameKey) {
      return;
    }
    locationKeys.add(nameKey);
    displayNameByKey.set(nameKey, name);
    locNameToEnvironment.set(nameKey, normalizePerimText(row.environment || ""));
    if (!locNameToAdjacent.has(nameKey)) {
      locNameToAdjacent.set(nameKey, new Set());
    }
  });

  adjacencySnapshot.links.forEach((link) => {
    const fromCard = locationsByCardId.get(String(link.fromId || ""));
    const toCard = locationsByCardId.get(String(link.toId || ""));
    const fromKey = normalizePerimText(fromCard?.name || "");
    const toKey = normalizePerimText(toCard?.name || "");
    if (!fromKey || !toKey || fromKey === toKey) {
      return;
    }
    if (!locNameToAdjacent.has(fromKey)) {
      locNameToAdjacent.set(fromKey, new Set());
    }
    if (!locNameToAdjacent.has(toKey)) {
      locNameToAdjacent.set(toKey, new Set());
    }
    locNameToAdjacent.get(fromKey).add(toKey);
    locationKeys.add(fromKey);
    locationKeys.add(toKey);
    if (!displayNameByKey.has(fromKey) && fromCard?.name) {
      displayNameByKey.set(fromKey, String(fromCard.name));
    }
    if (!displayNameByKey.has(toKey) && toCard?.name) {
      displayNameByKey.set(toKey, String(toCard.name));
    }
  });

  const graph = { locNameToEnvironment, locNameToAdjacent, locationKeys, displayNameByKey };
  perimLocationAdjacencyGraphCache = { token: cacheToken, value: graph };
  return graph;
}

function expandAdjacentLocations(startKeyOrName, adjacencyMap, maxHops) {
  const startKey = normalizePerimText(startKeyOrName);
  const visited = new Set();
  if (!startKey || !adjacencyMap.has(startKey)) {
    return visited;
  }
  visited.add(startKey);
  let frontier = [startKey];
  for (let hop = 0; hop < maxHops; hop += 1) {
    const nextFrontier = [];
    frontier.forEach((locKey) => {
      const neighbors = adjacencyMap.get(locKey);
      if (!neighbors) {
        return;
      }
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      });
    });
    frontier = nextFrontier;
    if (!frontier.length) {
      break;
    }
  }
  return visited;
}

function getLocationsByEnvironment(environmentKey, envMap) {
  const result = [];
  envMap.forEach((env, locName) => {
    if (env === environmentKey) {
      result.push(locName);
    }
  });
  return result;
}

function resolveLocationTokens(rawValue, graph, mode = "direct") {
  const aliases = locationAliasCandidates(rawValue);
  const envFilters = new Set();
  const exactMatches = new Set();
  const familyMatches = new Set();
  const scoreByLocation = new Map();
  const resolutionDetails = [];
  const unresolvedTokens = [];

  const applyScore = (locationKey, score) => {
    const prev = Number(scoreByLocation.get(locationKey) || 0);
    if (score > prev) {
      scoreByLocation.set(locationKey, score);
    }
  };

  aliases.forEach((candidateRaw) => {
    const candidate = normalizePerimText(candidateRaw);
    if (!candidate) {
      return;
    }
    if (candidate === "overworld" || candidate === "underworld") {
      envFilters.add(candidate);
      resolutionDetails.push({
        token: candidateRaw,
        origin: "environment",
        matches: [candidate],
      });
      return;
    }
    if (candidate.includes("overworld")) {
      envFilters.add("overworld");
    }
    if (candidate.includes("underworld")) {
      envFilters.add("underworld");
    }
    if (graph.locationKeys.has(candidate)) {
      exactMatches.add(candidate);
      applyScore(candidate, 8);
      resolutionDetails.push({
        token: candidateRaw,
        origin: "exact",
        matches: [candidate],
      });
      return;
    }
    const family = [];
    graph.locationKeys.forEach((locationKey) => {
      if (locationKey.includes(candidate)) {
        family.push(locationKey);
      }
    });
    if (family.length) {
      family.forEach((locationKey) => {
        familyMatches.add(locationKey);
        applyScore(locationKey, 3);
      });
      resolutionDetails.push({
        token: candidateRaw,
        origin: "family",
        matches: family,
      });
      return;
    }
    unresolvedTokens.push(candidateRaw);
  });

  // Requested behavior: when token is specific and matched, also include close family variants.
  exactMatches.forEach((exactKey) => {
    graph.locationKeys.forEach((locationKey) => {
      if (locationKey !== exactKey && locationKey.includes(exactKey)) {
        familyMatches.add(locationKey);
        applyScore(locationKey, 2);
      }
    });
  });

  const matches = new Set([...exactMatches, ...familyMatches]);
  if (!matches.size && envFilters.size) {
    envFilters.forEach((envKey) => {
      getLocationsByEnvironment(envKey, graph.locNameToEnvironment).forEach((locKey) => {
        matches.add(locKey);
        applyScore(locKey, 2);
      });
    });
  }

  if (matches.size && envFilters.size) {
    const filtered = [...matches].filter((locKey) => envFilters.has(graph.locNameToEnvironment.get(locKey)));
    if (filtered.length) {
      matches.clear();
      filtered.forEach((locKey) => matches.add(locKey));
    }
  }

  if (mode === "proximo") {
    const expanded = new Set();
    const expandedScores = new Map();
    [...matches].forEach((locKey) => {
      const baseScore = Number(scoreByLocation.get(locKey) || 2);
      expandAdjacentLocations(locKey, graph.locNameToAdjacent, 2).forEach((adjKey) => {
        expanded.add(adjKey);
        const hopScore = adjKey === locKey ? baseScore : Math.max(1, baseScore - 1.5);
        const previous = Number(expandedScores.get(adjKey) || 0);
        if (hopScore > previous) {
          expandedScores.set(adjKey, hopScore);
        }
      });
    });
    return {
      locations: expanded,
      scoreByLocation: expandedScores,
      unresolvedTokens,
      resolutionDetails,
    };
  }

  return {
    locations: matches,
    scoreByLocation,
    unresolvedTokens,
    resolutionDetails,
  };
}

function resolveCreaturePossibleLocations(creature, graph) {
  const possibleLocations = new Set();
  const somenteLocations = new Set();
  const unresolvedRefs = [];
  const scoreByLocation = new Map();
  const resolutionDetails = [];

  const addResolved = (rawValue, mode, markSomente) => {
    const value = String(rawValue || "").trim();
    if (!value) {
      return;
    }
    const resolved = resolveLocationTokens(value, graph, mode);
    const resolvedLocations = resolved?.locations instanceof Set ? resolved.locations : new Set();
    if (!resolvedLocations.size) {
      unresolvedRefs.push(...(resolved?.unresolvedTokens?.length ? resolved.unresolvedTokens : [value]));
      return;
    }
    (Array.isArray(resolved?.resolutionDetails) ? resolved.resolutionDetails : []).forEach((detail) => {
      resolutionDetails.push({
        source: value,
        mode,
        markSomente: Boolean(markSomente),
        token: detail.token,
        origin: detail.origin,
        matches: Array.isArray(detail.matches) ? detail.matches : [],
      });
    });
    resolvedLocations.forEach((locKey) => {
      possibleLocations.add(locKey);
      const locationScore = Number(resolved?.scoreByLocation?.get(locKey) || 1);
      const currentScore = Number(scoreByLocation.get(locKey) || 0);
      if (locationScore > currentScore) {
        scoreByLocation.set(locKey, locationScore);
      }
      if (markSomente) {
        somenteLocations.add(locKey);
      }
    });
  };

  addResolved(creature.somenteLocal1, "direct", true);
  addResolved(creature.somenteLocal2, "direct", true);
  addResolved(creature.proximoLocal, "proximo", false);

  return {
    possibleLocations: [...possibleLocations],
    somenteLocations: [...somenteLocations],
    unresolvedRefs,
    scoreByLocation,
    resolutionDetails,
  };
}

function buildPerimFixedCreatureRuleRuntime(graph, questExclusiveRewardCardKeys = null) {
  const rules = Array.isArray(PERIM_FIXED_CREATURE_LOCATION_RULES) ? PERIM_FIXED_CREATURE_LOCATION_RULES : [];
  const creatureCards = Array.isArray(library?.cardsByType?.creatures) ? library.cardsByType.creatures : [];
  const creatureCardsByNameKey = new Map();
  creatureCards.forEach((card) => {
    const key = normalizePerimText(card?.name || "");
    if (!key) {
      return;
    }
    if (!creatureCardsByNameKey.has(key)) {
      creatureCardsByNameKey.set(key, []);
    }
    creatureCardsByNameKey.get(key).push(card);
  });

  const locationKeysByNameKey = new Map();
  if (graph?.locationKeys instanceof Set) {
    graph.locationKeys.forEach((locationKey) => {
      const normalized = normalizePerimText(locationKey);
      if (!normalized) {
        return;
      }
      if (!locationKeysByNameKey.has(normalized)) {
        locationKeysByNameKey.set(normalized, new Set());
      }
      locationKeysByNameKey.get(normalized).add(locationKey);
    });
  }
  if (graph?.displayNameByKey instanceof Map) {
    graph.displayNameByKey.forEach((displayName, locationKey) => {
      const normalized = normalizePerimText(displayName);
      if (!normalized) {
        return;
      }
      if (!locationKeysByNameKey.has(normalized)) {
        locationKeysByNameKey.set(normalized, new Set());
      }
      locationKeysByNameKey.get(normalized).add(locationKey);
    });
  }

  const questExclusiveSet = questExclusiveRewardCardKeys instanceof Set
    ? questExclusiveRewardCardKeys
    : getPerimQuestExclusiveRewardCardKeySet();

  const byAliasKey = new Map();
  const pendingMissingLocations = [];
  const pendingMissingCreatures = [];
  const questExclusiveIgnored = [];
  let aliasBindings = 0;
  const seenQuestExclusiveKeys = new Set();

  rules.forEach((rule) => {
    const creatureNames = [...new Set(
      (Array.isArray(rule?.creatureNames) ? rule.creatureNames : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )];
    const aliasNames = [...new Set(
      (Array.isArray(rule?.aliases) ? rule.aliases : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )];
    const locationNames = [...new Set(
      (Array.isArray(rule?.locations) ? rule.locations : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )];
    if (!creatureNames.length) {
      return;
    }
    const creatureNameKeys = [...new Set(creatureNames.map((name) => normalizePerimText(name)).filter(Boolean))];
    const matchedCards = [];
    creatureNameKeys.forEach((nameKey) => {
      (creatureCardsByNameKey.get(nameKey) || []).forEach((card) => matchedCards.push(card));
    });
    const isQuestExclusive = matchedCards.some((card) => questExclusiveSet.has(`creatures:${String(card?.id || "")}`));
    if (!matchedCards.length) {
      pendingMissingCreatures.push({
        creatureNames,
        aliases: aliasNames,
        locations: locationNames,
      });
      return;
    }
    if (isQuestExclusive) {
      const questKey = creatureNameKeys.join("|");
      if (!seenQuestExclusiveKeys.has(questKey)) {
        seenQuestExclusiveKeys.add(questKey);
        questExclusiveIgnored.push({
          creatureNames,
          locations: locationNames,
          cardIds: [...new Set(matchedCards.map((card) => String(card?.id || "")).filter(Boolean))],
        });
      }
      return;
    }

    const resolvedLocationKeys = new Set();
    const unresolvedLocationNames = [];
    locationNames.forEach((locationName) => {
      const locationNameKey = normalizePerimText(locationName);
      const candidates = locationKeysByNameKey.get(locationNameKey) || null;
      if (candidates && candidates.size) {
        candidates.forEach((candidate) => resolvedLocationKeys.add(candidate));
      } else {
        unresolvedLocationNames.push(locationName);
      }
    });
    if (!resolvedLocationKeys.size) {
      pendingMissingLocations.push({
        creatureNames,
        locations: locationNames,
        unresolvedLocations: unresolvedLocationNames.length ? unresolvedLocationNames : locationNames,
      });
      return;
    }

    const bindNames = [...new Set([...creatureNames, ...aliasNames])];
    bindNames.forEach((name) => {
      const aliasKey = normalizePerimText(name);
      if (!aliasKey) {
        return;
      }
      const existing = byAliasKey.get(aliasKey);
      if (existing) {
        resolvedLocationKeys.forEach((locationKey) => existing.locationKeys.add(locationKey));
        creatureNames.forEach((creatureName) => existing.creatureNames.add(creatureName));
        aliasNames.forEach((aliasName) => existing.aliases.add(aliasName));
        locationNames.forEach((locationName) => existing.locationNames.add(locationName));
        existing.cardIds = [...new Set([...existing.cardIds, ...matchedCards.map((card) => String(card?.id || "")).filter(Boolean)])];
        return;
      }
      aliasBindings += 1;
      byAliasKey.set(aliasKey, {
        creatureNames: new Set(creatureNames),
        aliases: new Set(aliasNames),
        locationNames: new Set(locationNames),
        locationKeys: new Set(resolvedLocationKeys),
        cardIds: [...new Set(matchedCards.map((card) => String(card?.id || "")).filter(Boolean))],
      });
    });
  });

  return {
    byAliasKey,
    summary: {
      totalRules: rules.length,
      aliasBindings,
      pendingMissingLocations,
      pendingMissingCreatures,
      questExclusiveIgnored,
    },
  };
}

function writePerimFixedCreatureSpawnReport(payload) {
  const report = payload && typeof payload === "object" ? payload : {};
  const lines = [];
  lines.push("Perim Fixed Creature Spawn Report");
  lines.push(`generated_at=${nowIso()}`);
  lines.push(`date_key=${String(report.dateKey || todayDateKey())}`);
  lines.push(`total_rules=${Number(report.totalRules || 0)}`);
  lines.push(`alias_bindings=${Number(report.aliasBindings || 0)}`);
  lines.push(`applied_rows=${Number(report.appliedRows || 0)}`);
  lines.push(`ignored_quest_rows=${Number(report.ignoredQuestRows || 0)}`);
  lines.push(`pending_missing_creatures=${Array.isArray(report.pendingMissingCreatures) ? report.pendingMissingCreatures.length : 0}`);
  lines.push(`pending_missing_locations=${Array.isArray(report.pendingMissingLocations) ? report.pendingMissingLocations.length : 0}`);
  lines.push("");

  const questExclusiveIgnored = Array.isArray(report.questExclusiveIgnored) ? report.questExclusiveIgnored : [];
  if (questExclusiveIgnored.length) {
    lines.push("[quest_exclusive_ignored]");
    questExclusiveIgnored.forEach((entry) => {
      const creatureNames = Array.isArray(entry?.creatureNames) ? entry.creatureNames.join(" | ") : "";
      const locations = Array.isArray(entry?.locations) ? entry.locations.join(" | ") : "";
      const cardIds = Array.isArray(entry?.cardIds) ? entry.cardIds.join(", ") : "";
      lines.push(`creatures=${creatureNames}`);
      lines.push(`locations=${locations}`);
      lines.push(`card_ids=${cardIds}`);
      lines.push("");
    });
  }

  const pendingMissingCreatures = Array.isArray(report.pendingMissingCreatures) ? report.pendingMissingCreatures : [];
  if (pendingMissingCreatures.length) {
    lines.push("[pending_missing_creatures]");
    pendingMissingCreatures.forEach((entry) => {
      const creatureNames = Array.isArray(entry?.creatureNames) ? entry.creatureNames.join(" | ") : "";
      const aliases = Array.isArray(entry?.aliases) ? entry.aliases.join(" | ") : "";
      const locations = Array.isArray(entry?.locations) ? entry.locations.join(" | ") : "";
      lines.push(`creatures=${creatureNames}`);
      if (aliases) {
        lines.push(`aliases=${aliases}`);
      }
      lines.push(`locations=${locations}`);
      lines.push("");
    });
  }

  const pendingMissingLocations = Array.isArray(report.pendingMissingLocations) ? report.pendingMissingLocations : [];
  if (pendingMissingLocations.length) {
    lines.push("[pending_missing_locations]");
    pendingMissingLocations.forEach((entry) => {
      const creatureNames = Array.isArray(entry?.creatureNames) ? entry.creatureNames.join(" | ") : "";
      const locations = Array.isArray(entry?.locations) ? entry.locations.join(" | ") : "";
      const unresolvedLocations = Array.isArray(entry?.unresolvedLocations) ? entry.unresolvedLocations.join(" | ") : "";
      lines.push(`creatures=${creatureNames}`);
      lines.push(`locations=${locations}`);
      lines.push(`unresolved=${unresolvedLocations}`);
      lines.push("");
    });
  }

  fs.mkdirSync(path.dirname(PERIM_FIXED_CREATURE_SPAWN_REPORT_FILE), { recursive: true });
  fs.writeFileSync(PERIM_FIXED_CREATURE_SPAWN_REPORT_FILE, lines.join("\n"), "utf8");
}

function todayDateKey(nowDate = new Date()) {
  const year = nowDate.getFullYear();
  const month = String(nowDate.getMonth() + 1).padStart(2, "0");
  const day = String(nowDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveLocationCardId(locationNameKey) {
  const { locationsByNormalizedName } = getLibraryIndexes();
  const match = locationsByNormalizedName.get(normalizePerimText(locationNameKey));
  return match ? String(match.id) : "";
}

function resolveCreatureFlavortext(creatureName) {
  const { creaturesByNormalizedName } = getLibraryIndexes();
  const match = creaturesByNormalizedName.get(normalizePerimText(creatureName));
  return match?.flavortext || "";
}

function resolveCreatureCardId(creatureName) {
  const { creaturesByNormalizedName } = getLibraryIndexes();
  const match = creaturesByNormalizedName.get(normalizePerimText(creatureName));
  return match ? String(match.id) : "";
}

function writeCreatureLocationAliasReport(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  let unresolvedTotal = 0;
  const originCounters = {
    exact: 0,
    family: 0,
    environment: 0,
  };
  let multiVariantRefs = 0;
  safeEntries.forEach((entry) => {
    unresolvedTotal += Array.isArray(entry.unresolvedRefs) ? entry.unresolvedRefs.length : 0;
    (Array.isArray(entry.resolutionDetails) ? entry.resolutionDetails : []).forEach((detail) => {
      const origin = String(detail?.origin || "");
      if (Object.prototype.hasOwnProperty.call(originCounters, origin)) {
        originCounters[origin] += 1;
      }
      const matches = Array.isArray(detail?.matches) ? detail.matches : [];
      if (matches.length > 1) {
        multiVariantRefs += 1;
      }
    });
  });
  const lines = [
    "Creature Drop Alias Report",
    `generated_at=${nowIso()}`,
    `creature_entries=${safeEntries.length}`,
    `unresolved_refs=${unresolvedTotal}`,
    `resolved_exact=${originCounters.exact}`,
    `resolved_family=${originCounters.family}`,
    `resolved_environment=${originCounters.environment}`,
    `resolved_multi_variant_refs=${multiVariantRefs}`,
    "",
  ];
  safeEntries
    .sort((a, b) => String(a.creatureName || "").localeCompare(String(b.creatureName || "")))
    .forEach((entry) => {
      const unresolved = Array.isArray(entry.unresolvedRefs) ? entry.unresolvedRefs : [];
      const details = Array.isArray(entry.resolutionDetails) ? entry.resolutionDetails : [];
      if (!unresolved.length && !details.length) {
        return;
      }
      lines.push(`${entry.creatureName || "Unknown"}`);
      if (unresolved.length) {
        lines.push(`  unresolved: ${unresolved.join(" | ")}`);
      }
      details.forEach((detail) => {
        const matches = Array.isArray(detail.matches) ? detail.matches.join(", ") : "";
        lines.push(
          `  resolved [${detail.origin || "unknown"}] source="${detail.source || ""}" token="${detail.token || ""}" mode=${detail.mode || "direct"} somente=${detail.markSomente ? "yes" : "no"} -> ${matches}`
        );
      });
      lines.push("");
    });
  fs.mkdirSync(path.dirname(CREATURE_DROPS_ALIAS_REPORT_FILE), { recursive: true });
  fs.writeFileSync(CREATURE_DROPS_ALIAS_REPORT_FILE, lines.join("\n"), "utf8");
  return {
    creatureEntries: safeEntries.length,
    unresolvedRefs: unresolvedTotal,
    resolvedExact: originCounters.exact,
    resolvedFamily: originCounters.family,
    resolvedEnvironment: originCounters.environment,
    multiVariantRefs,
  };
}

function rarityPlacementWeight(rarity) {
  const key = String(rarity || "").trim().toLowerCase();
  if (key === "ultra rare") return 1;
  if (key === "super rare") return 1.2;
  if (key === "rare") return 1.35;
  if (key === "uncommon") return 1.5;
  if (key === "promo") return 0.9;
  return 1.7;
}

function createSeededRng(seedToken) {
  let seed = hashTokenToInt(seedToken || "seed") || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const normalized = Math.abs(seed % 1000000);
    return normalized / 1000000;
  };
}

function weightedRandomChoice(items, rng) {
  const valid = Array.isArray(items) ? items.filter((item) => Number(item?.weight || 0) > 0) : [];
  if (!valid.length) {
    return null;
  }
  const total = valid.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  let roll = (typeof rng === "function" ? rng() : Math.random()) * total;
  for (let i = 0; i < valid.length; i += 1) {
    roll -= Number(valid[i].weight || 0);
    if (roll <= 0) {
      return valid[i];
    }
  }
  return valid[valid.length - 1] || null;
}

function creatureMatrixByLoki() {
  const map = new Map();
  loadPerimCreaturesMatrix().forEach((entry) => {
    const loki = Number(entry?.loki || 0);
    if (loki > 0 && !map.has(loki)) {
      map.set(loki, entry);
    }
  });
  return map;
}

function readDailyCreatureRowsFromSql(dateKey) {
  if (!sqliteDb) {
    return [];
  }
  try {
    return sqliteDb
      .prepare(`
        SELECT location_date, creature_loki, current_location, rotated_at, created_at
        FROM creature_daily_locations
        WHERE location_date = ?
      `)
      .all(String(dateKey || ""));
  } catch (error) {
    console.warn(`[PERIM] Falha ao ler creature_daily_locations SQL: ${error.message}`);
    return [];
  }
}

function writeDailyCreatureRowsToSql(payload) {
  if (!sqliteDb || !payload || !Array.isArray(payload.creatures)) {
    return;
  }
  const dateKey = String(payload.dateKey || "").trim();
  if (!dateKey) {
    return;
  }
  const now = nowIso();
  try {
    const deleteStmt = sqliteDb.prepare("DELETE FROM creature_daily_locations WHERE location_date = ?");
    const insertStmt = sqliteDb.prepare(`
      INSERT INTO creature_daily_locations (location_date, creature_loki, current_location, rotated_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(location_date, creature_loki)
      DO UPDATE SET current_location = excluded.current_location, rotated_at = excluded.rotated_at
    `);
    sqliteDb.exec("BEGIN TRANSACTION");
    try {
      deleteStmt.run(dateKey);
      const seenLoki = new Set();
      payload.creatures.forEach((entry) => {
        const loki = Number(entry?.loki || 0);
        const locationNameKey = normalizePerimText(entry?.locationNameKey || "");
        if (!loki || !locationNameKey) {
          return;
        }
        if (seenLoki.has(loki)) {
          return;
        }
        seenLoki.add(loki);
        insertStmt.run(dateKey, loki, locationNameKey, now, now);
      });
      sqliteDb.exec("COMMIT");
    } catch (txError) {
      sqliteDb.exec("ROLLBACK");
      throw txError;
    }
  } catch (error) {
    console.warn(`[PERIM] Falha ao persistir creature_daily_locations SQL: ${error.message}`);
  }
}

function buildDailyPayloadFromSqlRows(dateKey, rows) {
  const validRows = Array.isArray(rows) ? rows : [];
  if (!validRows.length) {
    return null;
  }
  const graph = buildLocationAdjacencyGraph();
  const byLoki = creatureMatrixByLoki();
  const creatures = [];
  validRows.forEach((row) => {
    const loki = Number(row?.creature_loki || 0);
    const locationNameKey = normalizePerimText(row?.current_location || "");
    if (!loki || !locationNameKey) {
      return;
    }
    const creature = byLoki.get(loki);
    if (!creature) {
      return;
    }
    const rarityKey = String(creature.rarity || "").trim().toLowerCase();
    creatures.push({
      loki,
      name: creature.name,
      locationNameKey,
      locationDisplayName: graph.displayNameByKey.get(locationNameKey) || creature.proximoLocal || "",
      locationCardId: resolveLocationCardId(locationNameKey),
      types: creature.types,
      tribe: creature.tribe,
      rarity: creature.rarity,
      sourceRule: "sql_daily",
      flavortext: resolveCreatureFlavortext(creature.name),
      cardId: resolveCreatureCardId(creature.name),
      dropChance: getPerimCreatureRarityDropChance(rarityKey),
    });
  });
  return {
    dateKey: String(dateKey || ""),
    generatedAt: nowIso(),
    algoVersion: CREATURE_DAILY_ALGO_VERSION,
    creatures,
  };
}

function getDailyCreatureLocationsCanonical(dateKey) {
  const key = String(dateKey || "").trim() || todayDateKey();
  const fromKv = sqlGet("creature_daily_locations", key);
  const kvCount = Array.isArray(fromKv?.creatures) ? fromKv.creatures.length : 0;
  const sqlRows = readDailyCreatureRowsFromSql(key);
  if (sqlRows.length) {
    if (kvCount && sqlRows.length < kvCount) {
      writeDailyCreatureRowsToSql(fromKv);
      return fromKv;
    }
    const fromSql = buildDailyPayloadFromSqlRows(key, sqlRows);
    if (fromSql && Array.isArray(fromSql.creatures) && fromSql.creatures.length) {
      return fromSql;
    }
  }
  if (fromKv && kvCount) {
    writeDailyCreatureRowsToSql(fromKv);
    return fromKv;
  }
  return null;
}

function getDailyCreatureIndex(dateKey = null) {
  const key = String(dateKey || todayDateKey());
  const daily = ensureDailyCreatureLocations(key);
  const generatedAt = String(daily?.generatedAt || "");
  if (
    dailyCreatureIndexCache.value
    && dailyCreatureIndexCache.dateKey === key
    && dailyCreatureIndexCache.generatedAt === generatedAt
  ) {
    return dailyCreatureIndexCache.value;
  }
  const graph = buildLocationAdjacencyGraph();
  const creatures = Array.isArray(daily?.creatures) ? daily.creatures : [];
  const byLocationKey = new Map();
  const byLocationCardId = new Map();
  const byWorldType = new Map();
  creatures.forEach((entry) => {
    const locationKey = normalizePerimText(entry?.locationNameKey || "");
    const locationCardId = String(entry?.locationCardId || "");
    const env = graph.locNameToEnvironment.get(locationKey) || "";
    if (locationKey) {
      if (!byLocationKey.has(locationKey)) {
        byLocationKey.set(locationKey, []);
      }
      byLocationKey.get(locationKey).push(entry);
    }
    if (locationCardId) {
      if (!byLocationCardId.has(locationCardId)) {
        byLocationCardId.set(locationCardId, []);
      }
      byLocationCardId.get(locationCardId).push(entry);
    }
    if (env) {
      if (!byWorldType.has(env)) {
        byWorldType.set(env, []);
      }
      byWorldType.get(env).push(entry);
    }
  });
  const index = { creatures, byLocationKey, byLocationCardId, byWorldType };
  dailyCreatureIndexCache = {
    dateKey: key,
    generatedAt,
    value: index,
  };
  return index;
}

function generateDailyCreatureLocations(dateKey = null, forceRegenerate = false) {
  const nowDate = new Date();
  const key = dateKey || todayDateKey(nowDate);
  const existing = getDailyCreatureLocationsCanonical(key);
  if (!forceRegenerate && existing && Array.isArray(existing.creatures) && existing.creatures.length > 0) {
    const existingVersion = Number(existing.algoVersion || 0);
    if (existingVersion === CREATURE_DAILY_ALGO_VERSION) {
    const expectedRows = loadPerimCreaturesMatrix().length;
    const minimumHealthy = expectedRows > 0 ? Math.max(1, Math.floor(expectedRows * 0.7)) : 1;
    if (existing.creatures.length >= minimumHealthy) {
      return existing;
    }
    console.warn(
      `[PERIM] Daily creature map for ${key} looked incomplete (${existing.creatures.length}/${expectedRows}). Regenerating...`
    );
    } else {
      console.log(
        `[PERIM] Daily creature map for ${key} is using old algorithm version (${existingVersion}). Regenerating...`
      );
    }
  }
  if (forceRegenerate && existing && Array.isArray(existing.creatures) && existing.creatures.length > 0) {
    console.log(`[PERIM] Forcing regeneration of daily creature map for ${key}.`);
  }

  if (existing && Array.isArray(existing.creatures) && existing.creatures.length > 0) {
    try {
      if (sqliteDb) {
        sqliteDb.prepare("DELETE FROM creature_daily_locations WHERE location_date = ?").run(String(key));
      }
    } catch (_error) {
      // ignore table cleanup failures and continue with regeneration
    }
  }

  const previousByLoki = new Map();
  const previousSource = (existing && Array.isArray(existing.creatures) && existing.creatures.length)
    ? existing
    : (() => {
      const previousDate = new Date(nowDate.getTime());
      previousDate.setDate(previousDate.getDate() - 1);
      const previousDateKey = todayDateKey(previousDate);
      return getDailyCreatureLocationsCanonical(previousDateKey);
    })();
  if (previousSource && Array.isArray(previousSource.creatures)) {
    previousSource.creatures.forEach((entry) => {
      previousByLoki.set(Number(entry.loki || 0), entry);
    });
  }

  console.log(`[PERIM] Generating daily creature locations for ${key}...`);
  const creatureRows = loadPerimCreaturesMatrix();
  const graph = buildLocationAdjacencyGraph();
  const aliasReportEntries = [];
  const dailyPlacements = [];
  const seenLoki = new Set();
  let duplicateLokiCount = 0;
  const { locationsByNormalizedName } = getLibraryIndexes();
  const locationTribeKeyByNameKey = new Map();
  let tribeFilteredLocationCandidates = 0;
  let tribeBlockedCreatureRows = 0;
  let tribeNoAdjacentStayCount = 0;
  const questExclusiveRewardCardKeys = getPerimQuestExclusiveRewardCardKeySet();
  const fixedRuleRuntime = buildPerimFixedCreatureRuleRuntime(graph, questExclusiveRewardCardKeys);
  const fixedRuleSummary = {
    appliedRows: 0,
    ignoredQuestRows: 0,
    totalRules: Number(fixedRuleRuntime?.summary?.totalRules || 0),
    aliasBindings: Number(fixedRuleRuntime?.summary?.aliasBindings || 0),
    pendingMissingCreatures: Array.isArray(fixedRuleRuntime?.summary?.pendingMissingCreatures)
      ? fixedRuleRuntime.summary.pendingMissingCreatures
      : [],
    pendingMissingLocations: Array.isArray(fixedRuleRuntime?.summary?.pendingMissingLocations)
      ? fixedRuleRuntime.summary.pendingMissingLocations
      : [],
    questExclusiveIgnored: Array.isArray(fixedRuleRuntime?.summary?.questExclusiveIgnored)
      ? fixedRuleRuntime.summary.questExclusiveIgnored
      : [],
  };

  const resolveEffectiveLocationTribeForNameKey = (locationNameKeyRaw) => {
    const locationNameKey = normalizePerimText(locationNameKeyRaw);
    if (!locationNameKey) {
      return "";
    }
    if (locationTribeKeyByNameKey.has(locationNameKey)) {
      return locationTribeKeyByNameKey.get(locationNameKey) || "";
    }
    const locationCard = locationsByNormalizedName.get(locationNameKey) || null;
    const locationCardId = String(locationCard?.id || resolveLocationCardId(locationNameKey) || "").trim();
    const tribeKey = resolvePerimLocationEffectiveTribeKey({
      cardId: locationCardId,
      id: locationCardId,
      tribe: locationCard?.tribe || "",
    });
    locationTribeKeyByNameKey.set(locationNameKey, tribeKey || "");
    return tribeKey || "";
  };

  creatureRows.forEach((creature) => {
    const creatureLoki = Number(creature?.loki || 0);
    if (!creatureLoki) {
      return;
    }
    if (seenLoki.has(creatureLoki)) {
      duplicateLokiCount += 1;
      return;
    }
    seenLoki.add(creatureLoki);

    const { possibleLocations, somenteLocations, unresolvedRefs, scoreByLocation, resolutionDetails } = resolveCreaturePossibleLocations(creature, graph);
    aliasReportEntries.push({
      creatureName: creature.name,
      unresolvedRefs,
      resolutionDetails,
    });
    const creatureNameKey = normalizePerimText(creature?.name || "");
    const fixedRuleEntry = creatureNameKey
      ? fixedRuleRuntime?.byAliasKey?.get(creatureNameKey) || null
      : null;
    const forcedLocations = fixedRuleEntry?.locationKeys instanceof Set
      ? [...fixedRuleEntry.locationKeys].filter((locationNameKey) => graph.locationKeys.has(locationNameKey))
      : [];

    if (!possibleLocations.length && !forcedLocations.length) {
      return;
    }

    let filteredPossibleLocations = possibleLocations.filter((locationNameKey) => {
      const locationTribeKey = resolveEffectiveLocationTribeForNameKey(locationNameKey);
      return isPerimTribeMatchForCard(creature, locationTribeKey);
    });
    const filteredOutCount = Math.max(0, possibleLocations.length - filteredPossibleLocations.length);
    if (filteredOutCount > 0) {
      tribeFilteredLocationCandidates += filteredOutCount;
    }

    if (forcedLocations.length) {
      filteredPossibleLocations = forcedLocations;
      fixedRuleSummary.appliedRows += 1;
    }

    if (!filteredPossibleLocations.length) {
      tribeBlockedCreatureRows += 1;
      return;
    }

    const rng = createSeededRng(`${key}:${creature.loki}:${creature.name}`);
    const possibleSet = new Set(filteredPossibleLocations);
    const somenteSet = new Set(somenteLocations.filter((locationNameKey) => possibleSet.has(locationNameKey)));
    const previousPlacement = previousByLoki.get(Number(creature.loki || 0));
    const previousLocationKey = normalizePerimText(previousPlacement?.locationNameKey || "");

    const rarityFactor = rarityPlacementWeight(creature.rarity);
    let sourceRule = forcedLocations.length
      ? "fixed_spawn_rule"
      : "weighted_pool";
    let candidates = [];

    if (previousLocationKey && graph.locNameToAdjacent.has(previousLocationKey)) {
      if (forcedLocations.length) {
        // fixed rules keep the creature inside the fixed set only
      } else {
      const adjacentCandidates = [...graph.locNameToAdjacent.get(previousLocationKey)]
        .filter((locKey) => possibleSet.has(locKey))
        .filter((locKey) => locKey !== previousLocationKey);
      if (adjacentCandidates.length) {
        sourceRule = "adjacent_rotation";
        candidates = adjacentCandidates.map((locKey) => ({
          locationKey: locKey,
          weight: ((somenteSet.has(locKey) ? 6 : 2) + Number(scoreByLocation?.get(locKey) || 0)) * rarityFactor,
        }));
      }
      }
    }

    if (!candidates.length) {
      if (previousLocationKey && possibleSet.has(previousLocationKey)) {
        if (!forcedLocations.length) {
          sourceRule = "adjacent_hold";
          tribeNoAdjacentStayCount += 1;
        }
        candidates = [{
          locationKey: previousLocationKey,
          weight: Math.max(0.1, rarityFactor),
        }];
      } else {
        sourceRule = forcedLocations.length
          ? "fixed_spawn_rule"
          : (previousLocationKey ? "adjacent_relocate_by_tribe" : "weighted_pool");
        candidates = filteredPossibleLocations.map((locKey) => ({
          locationKey: locKey,
          weight: ((somenteSet.has(locKey) ? 8 : 2.5) + Number(scoreByLocation?.get(locKey) || 0)) * rarityFactor,
        }));
      }
    }

    const selected = weightedRandomChoice(candidates, rng);
    if (!selected?.locationKey) {
      return;
    }

    const locationNameKey = selected.locationKey;
    const flavortext = resolveCreatureFlavortext(creature.name);
    const cardId = resolveCreatureCardId(creature.name);
    const rarityKey = String(creature.rarity || "").trim().toLowerCase();

    dailyPlacements.push({
      loki: creatureLoki,
      name: creature.name,
      locationNameKey,
      locationDisplayName: graph.displayNameByKey.get(locationNameKey) || creature.proximoLocal || "",
      locationCardId: resolveLocationCardId(locationNameKey),
      types: creature.types,
      tribe: creature.tribe,
      rarity: creature.rarity,
      sourceRule,
      flavortext,
      cardId,
      dropChance: getPerimCreatureRarityDropChance(rarityKey),
    });
  });

  const aliasSummary = writeCreatureLocationAliasReport(aliasReportEntries);
  writePerimFixedCreatureSpawnReport({
    dateKey: key,
    ...fixedRuleSummary,
  });

  const payload = {
    dateKey: key,
    generatedAt: nowIso(),
    algoVersion: CREATURE_DAILY_ALGO_VERSION,
    creatures: dailyPlacements,
  };
  writeDailyCreatureRowsToSql(payload);
  sqlSet("creature_daily_locations", key, payload);
  console.log(
    `[PERIM] Alias resolution summary (${key}): entries=${aliasSummary.creatureEntries}, unresolved=${aliasSummary.unresolvedRefs}, exact=${aliasSummary.resolvedExact}, family=${aliasSummary.resolvedFamily}, environment=${aliasSummary.resolvedEnvironment}, multi=${aliasSummary.multiVariantRefs}`
  );
  if (duplicateLokiCount > 0) {
    console.log(`[PERIM] Skipped ${duplicateLokiCount} duplicate creature rows with repeated loki in criaturas.xlsx.`);
  }
  if (tribeFilteredLocationCandidates > 0 || tribeBlockedCreatureRows > 0 || tribeNoAdjacentStayCount > 0) {
    console.log(
      `[PERIM] Tribe-by-location filter (${key}): filteredCandidates=${tribeFilteredLocationCandidates}, blockedCreatures=${tribeBlockedCreatureRows}, heldByNoAdjacent=${tribeNoAdjacentStayCount}.`
    );
  }
  if (
    fixedRuleSummary.appliedRows > 0
    || fixedRuleSummary.pendingMissingCreatures.length
    || fixedRuleSummary.pendingMissingLocations.length
    || fixedRuleSummary.questExclusiveIgnored.length
  ) {
    console.log(
      `[PERIM] Fixed creature rules (${key}): appliedRows=${fixedRuleSummary.appliedRows}, ` +
      `pendingCreatures=${fixedRuleSummary.pendingMissingCreatures.length}, ` +
      `pendingLocations=${fixedRuleSummary.pendingMissingLocations.length}, ` +
      `questExclusiveIgnored=${fixedRuleSummary.questExclusiveIgnored.length}.`
    );
  }
  console.log(`[PERIM] Generated ${dailyPlacements.length} creature placements for ${key}.`);
  return payload;
}

function queuePerimDailyGeneration(reason = "scheduled", forcedDateKey = "", forceRegenerate = false) {
  const dateKey = String(forcedDateKey || todayDateKey());
  if (runtimeMetrics.perimJobs.queued && runtimeMetrics.perimJobs.dateKey === dateKey) {
    return;
  }
  runtimeMetrics.perimJobs.queued = true;
  runtimeMetrics.perimJobs.dateKey = dateKey;
  runtimeMetrics.perimJobs.lastRunAt = nowIso();
  if (perimDailyJobTimer) {
    clearTimeout(perimDailyJobTimer);
  }
  perimDailyJobTimer = setTimeout(() => {
    try {
      const payload = generateDailyCreatureLocations(dateKey, Boolean(forceRegenerate));
      if (payload && Array.isArray(payload.creatures) && payload.creatures.length) {
        lastKnownDailyCreaturePayload = payload;
        runtimeMetrics.perimJobs.lastSuccessAt = nowIso();
        runtimeMetrics.perimJobs.degraded = false;
        runtimeMetrics.perimJobs.degradedReason = "";
      } else {
        runtimeMetrics.perimJobs.degraded = true;
        runtimeMetrics.perimJobs.degradedReason = "empty_daily_payload";
      }
      console.log(`[PERIM][JOB] daily_generation ok date=${dateKey} reason=${reason}`);
    } catch (error) {
      runtimeMetrics.perimJobs.lastErrorAt = nowIso();
      runtimeMetrics.perimJobs.lastError = String(error?.message || error);
      runtimeMetrics.perimJobs.degraded = true;
      runtimeMetrics.perimJobs.degradedReason = "generation_error";
      console.error(`[PERIM][JOB] Falha ao gerar mapa diario (${dateKey}): ${error?.message || error}`);
    } finally {
      runtimeMetrics.perimJobs.queued = false;
    }
  }, 10);
}

function ensureDailyCreatureLocations(forcedDateKey = "") {
  const key = String(forcedDateKey || todayDateKey());
  const existing = getDailyCreatureLocationsCanonical(key);
  if (existing && Array.isArray(existing.creatures) && existing.creatures.length) {
    lastKnownDailyCreaturePayload = existing;
    runtimeMetrics.perimJobs.degraded = false;
    runtimeMetrics.perimJobs.degradedReason = "";
    return existing;
  }
  runtimeMetrics.perimJobs.degraded = true;
  runtimeMetrics.perimJobs.degradedReason = "using_last_snapshot";
  queuePerimDailyGeneration("on_demand_missing", key);
  return lastKnownDailyCreaturePayload;
}

function getCreaturesAtLocation(locationNameOrId, dateKey = null) {
  const index = getDailyCreatureIndex(dateKey);
  if (!index) {
    return [];
  }
  const queryKey = normalizePerimText(locationNameOrId);
  const byKey = index.byLocationKey.get(queryKey) || [];
  const byCardId = index.byLocationCardId.get(String(locationNameOrId)) || [];
  if (!byKey.length) {
    return byCardId;
  }
  if (!byCardId.length) {
    return byKey;
  }
  const merged = new Map();
  byKey.forEach((entry) => merged.set(String(entry?.loki || "") + ":" + String(entry?.cardId || ""), entry));
  byCardId.forEach((entry) => merged.set(String(entry?.loki || "") + ":" + String(entry?.cardId || ""), entry));
  return [...merged.values()];
}

function getCreatureCountAtLocation(locationNameOrId, dateKey = null) {
  return getCreaturesAtLocation(locationNameOrId, dateKey).length;
}

function isPerimDailyCreatureEntryDroppable(entry, indexes = null, questExclusiveCreatureCardIds = null) {
  const libraryIndexes = indexes || getLibraryIndexes();
  const creaturesById = libraryIndexes?.creaturesById || new Map();
  const creaturesByNormalizedName = libraryIndexes?.creaturesByNormalizedName || new Map();
  const cardId = String(entry?.cardId || entry?.card_id || "").trim();
  let card = cardId ? creaturesById.get(cardId) : null;
  if (!card && entry?.name) {
    card = creaturesByNormalizedName.get(normalizePerimText(entry.name)) || null;
  }
  if (!card || !card.id) {
    return false;
  }
  if (questExclusiveCreatureCardIds instanceof Set && questExclusiveCreatureCardIds.has(String(card.id))) {
    return false;
  }
  return isPerimDropSetAllowed(card?.set || "");
}

function getDroppableCreatureCountAtLocation(locationNameOrId, dateKey = null, questExclusiveCreatureCardIds = null) {
  const pool = getCreaturesAtLocation(locationNameOrId, dateKey);
  if (!pool.length) {
    return 0;
  }
  const indexes = getLibraryIndexes();
  let effectiveQuestExclusiveCreatureCardIds = questExclusiveCreatureCardIds instanceof Set
    ? questExclusiveCreatureCardIds
    : null;
  if (!(effectiveQuestExclusiveCreatureCardIds instanceof Set)) {
    effectiveQuestExclusiveCreatureCardIds = new Set();
    const questExclusiveRewardKeys = getPerimQuestExclusiveRewardCardKeySet();
    questExclusiveRewardKeys.forEach((entry) => {
      const text = String(entry || "");
      if (!text.startsWith("creatures:")) {
        return;
      }
      const cardId = text.slice("creatures:".length).trim();
      if (cardId) {
        effectiveQuestExclusiveCreatureCardIds.add(cardId);
      }
    });
  }
  let total = 0;
  pool.forEach((entry) => {
    if (isPerimDailyCreatureEntryDroppable(entry, indexes, effectiveQuestExclusiveCreatureCardIds)) {
      total += 1;
    }
  });
  return total;
}

function getCreaturesForWorldType(worldType, dateKey = null) {
  const index = getDailyCreatureIndex(dateKey);
  const expected = normalizePerimText(worldType);
  if (!expected) {
    return [];
  }
  return index?.byWorldType?.get(expected) || [];
}

let dailyCreatureCheckInterval = null;
let perimDailyWalkSchedulerState = { dateKey: "", executedSlots: new Set() };
let battlegearDailySpawnSchedulerState = { dateKey: "", generatedAtMidnight: false };
let battlegearDailySpawnCheckInterval = null;
let perimClimateDailyEffectSchedulerState = { dateKey: "", generatedAtMidnight: false };
let perimClimateDailyEffectCheckInterval = null;

function startDailyCreatureLocationScheduler() {
  ensureDailyCreatureLocations();
  const evaluateWalkSchedule = () => {
    const now = new Date();
    const dateKey = todayDateKey(now);
    const slot = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (perimDailyWalkSchedulerState.dateKey !== dateKey) {
      perimDailyWalkSchedulerState = { dateKey, executedSlots: new Set() };
    }
    const walkTimes = getPerimDailyWalkTimes();
    if (!walkTimes.includes(slot)) {
      return;
    }
    if (perimDailyWalkSchedulerState.executedSlots.has(slot)) {
      return;
    }
    perimDailyWalkSchedulerState.executedSlots.add(slot);
    console.log(`[PERIM] Scheduled walk slot reached (${slot}), regenerating daily creature locations for ${dateKey}...`);
    queuePerimDailyGeneration(`walk_schedule_${slot}`, dateKey, true);
  };

  evaluateWalkSchedule();
  dailyCreatureCheckInterval = setInterval(evaluateWalkSchedule, 30 * 1000);
}

function startPerimBattlegearDailySpawnScheduler() {
  ensurePerimBattlegearDailySpawnsForDate(todayDateKey(), false);
  const evaluateSchedule = () => {
    const now = new Date();
    const dateKey = todayDateKey(now);
    const slot = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (battlegearDailySpawnSchedulerState.dateKey !== dateKey) {
      battlegearDailySpawnSchedulerState = { dateKey, generatedAtMidnight: false };
    }
    if (slot !== "00:00" || battlegearDailySpawnSchedulerState.generatedAtMidnight) {
      return;
    }
    battlegearDailySpawnSchedulerState.generatedAtMidnight = true;
    try {
      const summary = ensurePerimBattlegearDailySpawnsForDate(dateKey, true);
      console.log(
        `[PERIM][BATTLEGEAR] Sorteio diario ${dateKey}: generated=${summary.generated}, ` +
        `skippedExisting=${summary.skippedExisting}, questExclusiveSkipped=${summary.questExclusiveSkipped}, rules=${summary.rulesTotal}.`
      );
    } catch (error) {
      console.error(`[PERIM][BATTLEGEAR] Falha ao gerar sorteio diario (${dateKey}): ${error?.message || error}`);
    }
  };

  evaluateSchedule();
  battlegearDailySpawnCheckInterval = setInterval(evaluateSchedule, 30 * 1000);
  battlegearDailySpawnCheckInterval.unref?.();
}

function startPerimClimateDailyEffectScheduler() {
  ensurePerimClimateDailyEffectsForDate(todayDateKey());
  const evaluateSchedule = () => {
    const now = new Date();
    const dateKey = todayDateKey(now);
    const slot = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (perimClimateDailyEffectSchedulerState.dateKey !== dateKey) {
      perimClimateDailyEffectSchedulerState = { dateKey, generatedAtMidnight: false };
      perimClimateDailyEffectCache = { dateKey: "", byClimate: new Map() };
    }
    if (slot !== "00:00" || perimClimateDailyEffectSchedulerState.generatedAtMidnight) {
      return;
    }
    perimClimateDailyEffectSchedulerState.generatedAtMidnight = true;
    try {
      const byClimate = ensurePerimClimateDailyEffectsForDate(dateKey);
      console.log(`[PERIM][CLIMATE] Rotacao diaria aplicada: date=${dateKey}, entries=${byClimate.size}`);
    } catch (error) {
      console.error(`[PERIM][CLIMATE] Falha ao aplicar roleta diaria (${dateKey}): ${error?.message || error}`);
    }
  };
  evaluateSchedule();
  perimClimateDailyEffectCheckInterval = setInterval(evaluateSchedule, 30 * 1000);
  perimClimateDailyEffectCheckInterval.unref?.();
}

function cleanupOldDbBackups(retentionDays = DB_BACKUP_RETENTION_DAYS) {
  const files = fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^chaotic-\d{8}-\d{6}\.db$/i.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(BACKUPS_DIR, entry.name),
      mtimeMs: Number(fs.statSync(path.join(BACKUPS_DIR, entry.name)).mtimeMs || 0),
    }));
  const cutoffMs = Date.now() - (Math.max(1, Number(retentionDays || 1)) * 24 * 60 * 60 * 1000);
  files.forEach((file) => {
    if (file.mtimeMs < cutoffMs) {
      try {
        fs.unlinkSync(file.path);
      } catch {}
    }
  });
}

function createRuntimeDbSnapshot(reason = "manual") {
  runtimeMetrics.backups.lastRunAt = nowIso();
  try {
    if (!fs.existsSync(SQLITE_FILE)) {
      throw new Error(`SQLite nao encontrado em ${SQLITE_FILE}`);
    }
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+$/, "")
      .replace("T", "-");
    const backupPath = path.join(BACKUPS_DIR, `chaotic-${stamp}.db`);
    fs.copyFileSync(SQLITE_FILE, backupPath);
    cleanupOldDbBackups(DB_BACKUP_RETENTION_DAYS);
    runtimeMetrics.backups.lastSuccessAt = nowIso();
    runtimeMetrics.backups.lastError = "";
    console.log(`[BACKUP] Snapshot criado: ${backupPath} (reason=${reason})`);
    return { ok: true, backupPath };
  } catch (error) {
    runtimeMetrics.backups.lastErrorAt = nowIso();
    runtimeMetrics.backups.lastError = String(error?.message || error);
    console.error(`[BACKUP] Falha ao criar snapshot (${reason}): ${error?.message || error}`);
    return { ok: false, error: String(error?.message || error) };
  }
}

function startDbBackupScheduler() {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() !== DB_BACKUP_HOUR) {
      return;
    }
    const dateKey = now.toISOString().slice(0, 10);
    if (dateKey === lastDailyBackupDateKey) {
      return;
    }
    lastDailyBackupDateKey = dateKey;
    createRuntimeDbSnapshot("daily_scheduler");
  }, 60 * 1000).unref?.();
}

const PERIM_DUPLICATE_CHOICE_TYPES = new Set(["creatures", "battlegear", "mugic", "locations"]);

function normalizePerimChoiceSelections(rawSelections) {
  const out = {};
  const source = rawSelections && typeof rawSelections === "object" ? rawSelections : {};
  Object.entries(source).forEach(([groupIdRaw, valueRaw]) => {
    const groupId = String(groupIdRaw || "").trim();
    if (!groupId) {
      return;
    }
    const numeric = Number(valueRaw);
    if (!Number.isFinite(numeric)) {
      return;
    }
    out[groupId] = Math.max(0, Math.floor(numeric));
  });
  return out;
}

function buildPerimDuplicateChoiceGroups(rewards, rawSelections = {}) {
  const rewardList = Array.isArray(rewards) ? rewards.map((entry) => normalizeRewardPayload(entry)).filter(Boolean) : [];
  const byType = new Map();
  rewardList.forEach((reward, index) => {
    const type = String(reward?.type || "");
    if (!PERIM_DUPLICATE_CHOICE_TYPES.has(type)) {
      return;
    }
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type).push({ index, reward });
  });
  const selections = normalizePerimChoiceSelections(rawSelections);
  const groups = [];
  byType.forEach((entries, type) => {
    if (!Array.isArray(entries) || entries.length <= 1) {
      return;
    }
    const groupId = `${type}:0`;
    const selectedIndex = Number.isFinite(Number(selections[groupId])) ? Number(selections[groupId]) : null;
    const selectedEntryIndex = selectedIndex !== null && entries[selectedIndex] ? entries[selectedIndex].index : null;
    groups.push({
      groupId,
      type,
      selectedOptionIndex: selectedIndex !== null && entries[selectedIndex] ? selectedIndex : null,
      selectedRewardIndex: selectedEntryIndex,
      options: entries.map((entry, optionIndex) => ({
        optionIndex,
        rewardIndex: entry.index,
        reward: entry.reward,
      })),
    });
  });
  return groups;
}

function resolvePerimRewardsWithChoices(rewards, rawSelections = {}) {
  const rewardList = Array.isArray(rewards) ? rewards.map((entry) => normalizeRewardPayload(entry)).filter(Boolean) : [];
  const groups = buildPerimDuplicateChoiceGroups(rewardList, rawSelections);
  const unresolvedGroups = groups.filter((group) => group.selectedRewardIndex === null);
  if (unresolvedGroups.length) {
    return { ok: false, unresolvedGroups, rewards: rewardList };
  }
  const selectedRewardIndexes = new Set(groups.map((group) => group.selectedRewardIndex));
  const groupedTypes = new Set(groups.map((group) => String(group.type || "")));
  const resolvedRewards = rewardList.filter((reward, rewardIndex) => {
    const type = String(reward?.type || "");
    if (!PERIM_DUPLICATE_CHOICE_TYPES.has(type) || !groupedTypes.has(type)) {
      return true;
    }
    return selectedRewardIndexes.has(rewardIndex);
  });
  return { ok: true, unresolvedGroups: [], rewards: resolvedRewards, groups };
}

function setPerimClaimChoiceSelections(playerState, runId, selectionsRaw = {}) {
  const pending = Array.isArray(playerState?.pendingRewards) ? playerState.pendingRewards : [];
  const target = runId
    ? pending.find((entry) => String(entry?.runId || "") === String(runId))
    : pending.find((entry) => !entry?.claimedAt);
  if (!target) {
    return { ok: false, error: "Run pendente nao encontrado para atualizar escolhas." };
  }
  if (target.claimedAt) {
    return { ok: false, error: "Esta recompensa ja foi coletada." };
  }
  const groups = buildPerimDuplicateChoiceGroups(target.rewards || [], target.choiceSelections || {});
  if (!groups.length) {
    target.choiceSelections = {};
    return { ok: true, runId: target.runId, choiceGroups: [], choiceSelections: {} };
  }
  const normalized = normalizePerimChoiceSelections(selectionsRaw);
  const nextSelections = {};
  for (const group of groups) {
    const groupId = String(group.groupId || "");
    if (!groupId) {
      continue;
    }
    const selectedOptionIndex = Number(normalized[groupId]);
    if (!Number.isFinite(selectedOptionIndex) || !group.options?.[selectedOptionIndex]) {
      return { ok: false, error: `Escolha invalida para ${group.type}.` };
    }
    nextSelections[groupId] = selectedOptionIndex;
  }
  target.choiceSelections = nextSelections;
  target.updatedAt = nowIso();
  const hydratedGroups = buildPerimDuplicateChoiceGroups(target.rewards || [], nextSelections);
  return {
    ok: true,
    runId: target.runId,
    choiceSelections: nextSelections,
    choiceGroups: hydratedGroups,
  };
}

function normalizeChatLanguage(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (value === "pt-br" || value === "pt") return "pt";
  if (value === "en" || value.startsWith("en-")) return "en";
  if (value === "es" || value.startsWith("es-")) return "es";
  return "pt";
}

function cacheChatTranslation(key, translatedText) {
  chatTranslationCache.set(String(key || ""), {
    translatedText: String(translatedText || ""),
    expiresAt: Date.now() + CHAT_TRANSLATION_CACHE_TTL_MS,
  });
}

function getCachedChatTranslation(key) {
  const item = chatTranslationCache.get(String(key || ""));
  if (!item) {
    return null;
  }
  if (Number(item.expiresAt || 0) <= Date.now()) {
    chatTranslationCache.delete(String(key || ""));
    return null;
  }
  return String(item.translatedText || "");
}

function clearExpiredChatTranslationCache() {
  const nowMs = Date.now();
  chatTranslationCache.forEach((value, key) => {
    if (Number(value?.expiresAt || 0) <= nowMs) {
      chatTranslationCache.delete(key);
    }
  });
}

async function translateChatText(textRaw, targetLangRaw) {
  const text = String(textRaw || "").trim();
  const targetLang = normalizeChatLanguage(targetLangRaw);
  if (!text || targetLang === "pt") {
    return { text, translated: false, translationError: null };
  }
  const cacheKey = `${targetLang}:${text}`;
  const cached = getCachedChatTranslation(cacheKey);
  if (cached !== null) {
    return { text: cached || text, translated: cached !== text, translationError: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TRANSLATION_HTTP_TIMEOUT_MS);
  try {
    const body = {
      q: text,
      source: "auto",
      target: targetLang,
      format: "text",
    };
    if (LIBRETRANSLATE_API_KEY) {
      body.api_key = LIBRETRANSLATE_API_KEY;
    }
    const response = await fetch(LIBRETRANSLATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { text, translated: false, translationError: `translation_http_${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    const translatedText = String(payload?.translatedText || "").trim();
    if (!translatedText) {
      return { text, translated: false, translationError: "translation_empty" };
    }
    cacheChatTranslation(cacheKey, translatedText);
    return { text: translatedText, translated: translatedText !== text, translationError: null };
  } catch {
    return { text, translated: false, translationError: "translation_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

async function translateChatMessageForViewer(message, viewerOwnerKeyRaw, targetLangRaw, contextPrefix = "chat") {
  const viewerOwnerKey = normalizeUserKey(viewerOwnerKeyRaw || "", "");
  const ownerKey = normalizeUserKey(message?.ownerKey || "", "");
  const originalMessage = String(message?.message || "");
  const targetLang = normalizeChatLanguage(targetLangRaw);
  if (!originalMessage) {
    return { ...message, originalMessage, translated: false, translationError: null, language: targetLang };
  }
  if (!viewerOwnerKey || !ownerKey || viewerOwnerKey === ownerKey || targetLang === "pt") {
    return { ...message, originalMessage, translated: false, translationError: null, language: targetLang };
  }
  const cacheKey = `${contextPrefix}:${message?.id || 0}:${targetLang}:${originalMessage}`;
  const cached = getCachedChatTranslation(cacheKey);
  if (cached !== null) {
    return {
      ...message,
      originalMessage,
      message: cached || originalMessage,
      translated: cached !== originalMessage,
      translationError: null,
      language: targetLang,
    };
  }
  const translatedResult = await translateChatText(originalMessage, targetLang);
  cacheChatTranslation(cacheKey, translatedResult.text || originalMessage);
  return {
    ...message,
    originalMessage,
    message: translatedResult.text || originalMessage,
    translated: Boolean(translatedResult.translated),
    translationError: translatedResult.translationError || null,
    language: targetLang,
  };
}

async function translateChatMessagesForViewer(messages, viewerOwnerKeyRaw, targetLangRaw, contextPrefix = "chat") {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    return [];
  }
  const translated = [];
  for (const message of list) {
    translated.push(await translateChatMessageForViewer(message, viewerOwnerKeyRaw, targetLangRaw, contextPrefix));
  }
  return translated;
}

function canAccessPerimLocationChat(playerKeyRaw, locationIdRaw, nowMsValue = Date.now()) {
  const playerKey = normalizePerimPlayerKey(playerKeyRaw);
  const locationId = String(locationIdRaw || "").trim();
  if (!playerKey || !locationId) {
    return false;
  }
  const rootState = loadPerimStateFile();
  const playerState = rootState?.players?.[playerKey];
  const activeRun = playerState?.activeRun;
  if (!activeRun || String(activeRun.locationId || "") !== locationId) {
    return false;
  }
  const endMs = Date.parse(String(activeRun.endAt || ""));
  if (Number.isFinite(endMs) && endMs <= nowMsValue) {
    return false;
  }
  return true;
}

function countActivePerimChattersAtLocation(rootState, locationIdRaw, nowMsValue = Date.now()) {
  const locationId = String(locationIdRaw || "").trim();
  if (!locationId) {
    return 0;
  }
  const players = rootState?.players && typeof rootState.players === "object"
    ? rootState.players
    : {};
  let count = 0;
  Object.values(players).forEach((playerState) => {
    const activeRun = playerState?.activeRun;
    if (!activeRun || String(activeRun.locationId || "") !== locationId) {
      return;
    }
    const endMs = Date.parse(String(activeRun.endAt || ""));
    if (Number.isFinite(endMs) && endMs <= nowMsValue) {
      return;
    }
    count += 1;
  });
  return count;
}

function cleanupPerimLocationChatHistory(dayKey = todayDateKey()) {
  if (!sqliteDb) {
    return;
  }
  clearExpiredChatTranslationCache();
  sqliteDb
    .prepare("DELETE FROM perim_location_chat WHERE day_key < ?")
    .run(String(dayKey || todayDateKey()));
}

function listPerimLocationChatMessages(locationIdRaw, options = {}) {
  if (!sqliteDb) {
    return [];
  }
  const locationId = String(locationIdRaw || "").trim();
  if (!locationId) {
    return [];
  }
  const limitRaw = Number(options.limit || 80);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 80));
  const dayKey = String(options.dayKey || todayDateKey());
  const rows = sqliteDb
    .prepare(`
      SELECT id, owner_key, username, message, created_at
      FROM perim_location_chat
      WHERE location_id = ? AND day_key = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(locationId, dayKey, limit);
  return rows.reverse().map((row) => ({
    id: Number(row?.id || 0),
    ownerKey: String(row?.owner_key || ""),
    username: String(row?.username || ""),
    message: String(row?.message || ""),
    createdAt: String(row?.created_at || ""),
  }));
}

async function broadcastPerimLocationChatEvent(locationIdRaw, payload) {
  const locationId = String(locationIdRaw || "").trim();
  if (!locationId) {
    return;
  }
  const clients = perimLocationChatClients.get(locationId);
  if (!clients || !clients.size) {
    return;
  }
  const clientsList = [...clients];
  for (const client of clientsList) {
    let nextPayload = payload;
    if (payload?.type === "perim_location_chat_message" && payload.message) {
      const translatedMessage = await translateChatMessageForViewer(
        payload.message,
        client?.ownerKey || "",
        client?.lang || "pt",
        "perim_location"
      );
      nextPayload = {
        ...payload,
        message: translatedMessage,
      };
    } else if (payload?.type === "perim_location_chat_snapshot" && Array.isArray(payload.messages)) {
      const translatedMessages = await translateChatMessagesForViewer(
        payload.messages,
        client?.ownerKey || "",
        client?.lang || "pt",
        "perim_location_snapshot"
      );
      nextPayload = {
        ...payload,
        messages: translatedMessages,
      };
    }
    const message = `data: ${JSON.stringify(nextPayload)}\n\n`;
    try {
      client.res.write(message);
    } catch {
      clients.delete(client);
    }
  }
  if (!clients.size) {
    perimLocationChatClients.delete(locationId);
  }
}

async function postPerimLocationChatMessage(locationIdRaw, ownerKeyRaw, usernameRaw, messageRaw) {
  if (!sqliteDb) {
    return { ok: false, error: "Chat de local indisponivel sem banco SQL." };
  }
  cleanupPerimLocationChatHistory(todayDateKey());
  const locationId = String(locationIdRaw || "").trim();
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  const username = String(usernameRaw || ownerKey || "Jogador").trim() || "Jogador";
  const message = String(messageRaw || "").replace(/\s+/g, " ").trim();
  if (!locationId) {
    return { ok: false, error: "Local invalido para enviar mensagem." };
  }
  if (!ownerKey) {
    return { ok: false, error: "Usuario invalido para enviar mensagem." };
  }
  if (!message) {
    return { ok: false, error: "Digite uma mensagem antes de enviar." };
  }
  if (message.length > 240) {
    return { ok: false, error: "Mensagem muito longa (maximo de 240 caracteres)." };
  }
  const createdAt = nowIso();
  const insert = sqliteDb
    .prepare(`
      INSERT INTO perim_location_chat (location_id, owner_key, username, message, day_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(locationId, ownerKey, username, message, todayDateKey(), createdAt);
  const chatMessage = {
    id: Number(insert?.lastInsertRowid || 0),
    ownerKey,
    username,
    message,
    createdAt,
  };
  await broadcastPerimLocationChatEvent(locationId, {
    type: "perim_location_chat_message",
    locationId,
    message: chatMessage,
  });
  return { ok: true, message: chatMessage };
}

function normalizeGlobalChatLimit(limitRaw, fallback = 80) {
  const limitNumber = Number(limitRaw);
  return Math.max(1, Math.min(200, Number.isFinite(limitNumber) ? limitNumber : fallback));
}

function pruneGlobalChatHistory(referenceDate = new Date()) {
  if (!sqliteDb) {
    return;
  }
  clearExpiredChatTranslationCache();
  const cutoff = new Date(referenceDate.getTime() - (GLOBAL_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  sqliteDb
    .prepare("DELETE FROM global_chat_messages WHERE day_key < ?")
    .run(todayDateKey(cutoff));
}

function toGlobalChatPayload(row) {
  return {
    id: Number(row?.id || 0),
    ownerKey: String(row?.owner_key || ""),
    username: String(row?.username || ""),
    avatar: String(row?.avatar || ""),
    message: String(row?.message || ""),
    createdAt: String(row?.created_at || ""),
  };
}

function listGlobalChatMessages(limitRaw = 80) {
  if (!sqliteDb) {
    return [];
  }
  pruneGlobalChatHistory(new Date());
  const limit = normalizeGlobalChatLimit(limitRaw, 80);
  const rows = sqliteDb
    .prepare(`
      SELECT id, owner_key, username, avatar, message, created_at
      FROM global_chat_messages
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(limit);
  return rows.reverse().map((row) => toGlobalChatPayload(row));
}

function sanitizeGlobalChatMessage(rawValue) {
  return String(rawValue || "").replace(/\s+/g, " ").trim();
}

function writeGlobalChatSsePayload(client, payload) {
  try {
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

async function broadcastGlobalChatEvent(payload) {
  if (!globalChatClients.size) {
    return;
  }
  const staleClients = [];
  const clientsList = [...globalChatClients];
  for (const client of clientsList) {
    let nextPayload = payload;
    if (payload?.type === "global_chat_message" && payload.message) {
      const translatedMessage = await translateChatMessageForViewer(
        payload.message,
        client?.ownerKey || "",
        client?.lang || "pt",
        "global_chat"
      );
      nextPayload = {
        ...payload,
        message: translatedMessage,
      };
    } else if (payload?.type === "global_chat_snapshot" && Array.isArray(payload.messages)) {
      const translatedMessages = await translateChatMessagesForViewer(
        payload.messages,
        client?.ownerKey || "",
        client?.lang || "pt",
        "global_chat_snapshot"
      );
      nextPayload = {
        ...payload,
        messages: translatedMessages,
      };
    }
    if (!writeGlobalChatSsePayload(client, nextPayload)) {
      staleClients.push(client);
    }
  }
  staleClients.forEach((client) => {
    globalChatClients.delete(client);
  });
}

function persistGlobalChatMessage(ownerKey, username, avatar, message) {
  if (!sqliteDb) {
    return null;
  }
  const createdAt = nowIso();
  const insert = sqliteDb
    .prepare(`
      INSERT INTO global_chat_messages (owner_key, username, avatar, message, day_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(ownerKey, username, avatar, message, todayDateKey(), createdAt);
  return {
    id: Number(insert?.lastInsertRowid || 0),
    ownerKey,
    username,
    avatar,
    message,
    createdAt,
  };
}

async function postGlobalChatMessage(ownerKeyRaw, usernameRaw, avatarRaw, messageRaw) {
  if (!sqliteDb) {
    return { ok: false, error: "Chat global indisponivel sem banco SQL." };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  const username = String(usernameRaw || ownerKey || "Jogador").trim() || "Jogador";
  const avatar = String(avatarRaw || "").trim();
  const message = sanitizeGlobalChatMessage(messageRaw);
  if (!ownerKey) {
    return { ok: false, error: "Usuario invalido para enviar mensagem." };
  }
  if (!message) {
    return { ok: false, error: "Digite uma mensagem antes de enviar." };
  }
  if (message.length > GLOBAL_CHAT_MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Mensagem muito longa (maximo de ${GLOBAL_CHAT_MAX_MESSAGE_LENGTH} caracteres).` };
  }
  pruneGlobalChatHistory(new Date());
  const chatMessage = persistGlobalChatMessage(ownerKey, username, avatar, message);
  if (!chatMessage) {
    return { ok: false, error: "Falha ao gravar mensagem do chat global." };
  }
  await broadcastGlobalChatEvent({
    type: "global_chat_message",
    message: chatMessage,
  });
  return { ok: true, message: chatMessage };
}

function promotePerimFinishedRuns(playerState, timestampMs = Date.now()) {
  const active = playerState?.activeRun;
  if (!active || !active.endAt) {
    return false;
  }
  const endMs = Date.parse(active.endAt);
  if (!Number.isFinite(endMs) || endMs > timestampMs) {
    return false;
  }
  const pendingRewards = Array.isArray(playerState.pendingRewards) ? playerState.pendingRewards : [];
  const exists = pendingRewards.some((entry) => String(entry?.runId || "") === String(active.runId || ""));
  if (!exists) {
    pendingRewards.push({
      runId: active.runId,
      locationId: active.locationId,
      locationName: active.locationName,
      actionId: active.actionId,
      actionName: active.actionLabel,
      completedAt: new Date(timestampMs).toISOString(),
      rewards: Array.isArray(active.rewards) ? active.rewards : [],
      contextSnapshot: active.contextSnapshot && typeof active.contextSnapshot === "object"
        ? { ...active.contextSnapshot }
        : {},
      choiceSelections: {},
      claimedAt: null,
    });
  }
  playerState.pendingRewards = pendingRewards;
  playerState.activeRun = null;
  playerState.updatedAt = nowIso();
  return true;
}

function claimPerimRewardsForRun(playerState, runId, playerKeyRaw) {
  const pending = Array.isArray(playerState.pendingRewards) ? playerState.pendingRewards : [];
  const target = runId
    ? pending.find((entry) => String(entry?.runId || "") === String(runId))
    : pending.find((entry) => !entry?.claimedAt);
  if (!target) {
    return { ok: false, error: "Nenhuma recompensa pendente para coletar." };
  }
  if (target.claimedAt) {
    return { ok: false, error: "Esta recompensa ja foi coletada." };
  }
  const choiceSelections = normalizePerimChoiceSelections(target.choiceSelections || {});
  const resolvedChoices = resolvePerimRewardsWithChoices(target.rewards || [], choiceSelections);
  if (!resolvedChoices.ok) {
    return {
      ok: false,
      error: "Voce precisa escolher 1 carta por tipo duplicado antes de coletar.",
      needsChoices: true,
      runId: target.runId,
      choiceGroups: resolvedChoices.unresolvedGroups,
      choiceSelections,
    };
  }

  const scans = loadScansData();
  const { key: playerKey, cards } = getScansCardsForUser(scans, playerKeyRaw, true);
  const profilesState = loadProfilesData();
  const { profile } = getOrCreateProfile(profilesState, playerKeyRaw);
  const nextCards = cloneCardBuckets(cards);
  const inventoryCounts = buildInventoryCountMap(nextCards);
  const questExclusiveRewardCardKeys = getPerimQuestExclusiveRewardCardKeySet();
  const ignoreInventoryCap = isPerimInstantAdmin(playerKeyRaw);
  const collected = [];
  const skippedByCap = [];
  (resolvedChoices.rewards || []).forEach((reward) => {
    const type = String(reward?.type || "");
    const cardId = String(reward?.cardId || "");
    if (!nextCards[type] || !cardId) {
      return;
    }
    const stockKey = `${type}:${cardId}`;
    const currentAmount = inventoryCounts.get(stockKey) || 0;
    const maxCopies = getPerimRewardMaxCopies(type, cardId, questExclusiveRewardCardKeys);
    if (!ignoreInventoryCap && currentAmount >= maxCopies) {
      skippedByCap.push({
        type,
        cardId,
        cardName: reward?.cardName || cardId,
        maxCopies,
      });
      return;
    }
    if (type === "creatures" && reward?.variant) {
      nextCards[type].push({
        cardId,
        scanEntryId: generateScanEntryId(),
        variant: normalizeCreatureVariant(reward.variant),
        source: "perim",
        obtainedAt: nowIso(),
      });
    } else {
      nextCards[type].push(cardId);
    }
    inventoryCounts.set(stockKey, currentAmount + 1);
    const normalizedReward = normalizeRewardPayload(reward);
    if (normalizedReward) {
      normalizedReward.isNew = !isCardDiscovered(profile, normalizedReward);
      markCardDiscovered(profile, normalizedReward);
      collected.push(normalizedReward);
    }
  });
  scans.players[playerKey] = {
    cards: ignoreInventoryCap ? nextCards : trimCardsToInventoryCap(nextCards, INVENTORY_MAX_COPIES),
  };
  writeScansData(scans, "perim_claim_reward");
  if (String(target?.actionId || "") === "camp") {
    const hasCreatureReward = collected.some((reward) => String(reward?.type || "") === "creatures");
    let campHasSuperRarePlusEligible = null;
    const snapshotFlag = target?.contextSnapshot?.campHasSuperRarePlusEligible;
    if (typeof snapshotFlag === "boolean") {
      campHasSuperRarePlusEligible = snapshotFlag;
    } else {
      const locationId = String(target?.locationId || "").trim();
      const locationCard = (library?.cardsByType?.locations || []).find((card) => String(card?.id || "") === locationId) || null;
      campHasSuperRarePlusEligible = hasCampSuperRarePlusEligibleAtLocation({
        cardId: locationId,
        id: locationId,
        name: String(target?.locationName || locationCard?.name || ""),
        tribe: String(locationCard?.tribe || ""),
      }, {
        inventoryCounts,
        ignoreInventoryCap,
        locationTribeKey: resolvePerimLocationEffectiveTribeKey({
          cardId: locationId,
          id: locationId,
          tribe: String(locationCard?.tribe || ""),
        }),
      });
    }
    if (!hasCreatureReward) {
      incrementPerimCampWaitCount(playerState, target?.locationId || "");
    } else {
      const hasSuperRarePlusDrop = collected.some(
        (reward) => String(reward?.type || "") === "creatures" && isPerimSuperRareOrHigherRarity(reward?.rarity || "")
      );
      if (!campHasSuperRarePlusEligible || hasSuperRarePlusDrop) {
        setPerimCampWaitCount(playerState, target?.locationId || "", 0);
      }
    }
  }
  target.claimedAt = nowIso();
  playerState.history = Array.isArray(playerState.history) ? playerState.history : [];
  playerState.history.push({
    runId: target.runId,
    locationName: target.locationName,
    actionName: target.actionName,
    claimedAt: target.claimedAt,
    rewards: collected,
  });
  playerState.history = playerState.history.slice(-30);
  playerState.updatedAt = nowIso();
  profile.updatedAt = nowIso();
  writeProfilesData(profilesState, "perim_claim_discovery");
  upsertSeasonPlayerDelta(playerKeyRaw, {
    score: Math.max(5, collected.length * 6),
    perimClaims: 1,
  });
  incrementPerimMissionProgress(playerKeyRaw, 1, new Date());
  incrementWeeklyPerimMissionProgress(playerKeyRaw, 1, new Date());
  applyScannerProgressFromRewards(playerKeyRaw, collected);
  const questGrant = grantReservedQuestByRun(playerKeyRaw, target.runId, collected, {
    inventoryCounts,
    questExclusiveRewardCardKeys,
  });
  invalidateUserCaches(playerKeyRaw);
  return {
    ok: true,
    runId: target.runId,
    rewards: collected,
    skippedByCap,
    choiceSelections,
    choiceGroups: resolvedChoices.groups || [],
    questGrant,
  };
}

function buildPerimStatePayload(playerKeyRaw) {
  const perfStart = Date.now();
  const rootState = loadPerimStateFile();
  const { key: playerKey, state: playerState } = getOrCreatePerimPlayerState(rootState, playerKeyRaw);
  const changed = promotePerimFinishedRuns(playerState, Date.now());
  if (changed) {
    writePerimStateFile(rootState);
  }
  const profilesState = loadProfilesData();
  const { profile, changed: profileChanged } = getOrCreateProfile(profilesState, playerKey);
  if (profileChanged) {
    writeProfilesData(profilesState, "perim_profile_bootstrap");
  }
  const nowDate = new Date();
  const activeRunNewsItems = playerState?.activeRun
    ? buildTickerNewsItems(getGlobalDailyCreatures(), 32)
    : [];
  const locationEntries = collectPerimLocationEntriesForPlayer(playerKey);
  const creatureCountByLocation = new Map();
  const questExclusiveCreatureCardIds = new Set();
  getPerimQuestExclusiveRewardCardKeySet().forEach((entry) => {
    const text = String(entry || "");
    if (!text.startsWith("creatures:")) {
      return;
    }
    const cardId = text.slice("creatures:".length).trim();
    if (cardId) {
      questExclusiveCreatureCardIds.add(cardId);
    }
  });
  const perimCountDateKey = todayDateKey(nowDate);
  const campStackingSettings = getPerimCampCreatureStackingSettings();
  const baseLocations = buildPerimLocationsFromScans(locationEntries);
  const ownedLocationIds = new Set(
    baseLocations
      .map((entry) => String(entry?.cardId || "").trim())
      .filter(Boolean)
  );
  const locations = baseLocations.map((entry) => {
    const scannerState = resolveScannerStateForLocation(profile, entry);
    const campWaitCount = getPerimCampWaitCount(playerState, entry.cardId);
    const campCreatureBonusPercent = calculatePerimCampCreatureBonusPercent(campWaitCount);
    const linkedLocationIds = [...new Set(
      (Array.isArray(entry?.linkedLocationIds) ? entry.linkedLocationIds : [])
        .map((id) => String(id || "").trim())
        .filter((id) => id && id !== String(entry?.cardId || ""))
    )];
    const nearbyTotalCount = linkedLocationIds.length;
    const nearbyOwnedCount = linkedLocationIds.reduce(
      (count, cardId) => count + (ownedLocationIds.has(cardId) ? 1 : 0),
      0
    );
    const nearbyProgressPercent = nearbyTotalCount
      ? Math.max(0, Math.min(100, Math.round((nearbyOwnedCount / nearbyTotalCount) * 100)))
      : 0;
    let creaturesTodayCount = creatureCountByLocation.get(entry.cardId);
    if (typeof creaturesTodayCount !== "number") {
      creaturesTodayCount = getDroppableCreatureCountAtLocation(
        entry.cardId || entry.name,
        perimCountDateKey,
        questExclusiveCreatureCardIds
      );
      creatureCountByLocation.set(entry.cardId, creaturesTodayCount);
    }
    return {
      ...entry,
      creaturesTodayCount,
      campWaitCount,
      campCreatureBonusPercent,
      campCreatureBonusMaxRarity: String(campStackingSettings?.bonusMaxRarity || "super rare"),
      nearbyTotalCount,
      nearbyOwnedCount,
      nearbyProgressPercent,
      scanner: {
        key: scannerState.scannerKey,
        level: scannerState.level,
      },
      contextPreview: buildPerimContextSnapshot(entry, "explore", scannerState.effect, nowDate),
    };
  });
  const activeEvents = listPerimGlobalEvents(locations);
  const pendingRewards = (Array.isArray(playerState.pendingRewards) ? playerState.pendingRewards : []).map((entry) => {
    const choiceSelections = normalizePerimChoiceSelections(entry?.choiceSelections || {});
    const choiceGroups = buildPerimDuplicateChoiceGroups(entry?.rewards || [], choiceSelections);
    const unresolvedChoices = choiceGroups.filter((group) => group.selectedRewardIndex === null).length;
    return {
      ...entry,
      choiceSelections,
      choiceGroups,
      unresolvedChoices,
      needsChoice: unresolvedChoices > 0,
    };
  });
  const activeRunLocationId = String(playerState?.activeRun?.locationId || "").trim();
  const activeRunLocationNameRaw = String(playerState?.activeRun?.locationName || "").trim();
  const activeRunEndMs = Date.parse(String(playerState?.activeRun?.endAt || ""));
  const canUseLocationChat = Boolean(
    activeRunLocationId
    && (!Number.isFinite(activeRunEndMs) || activeRunEndMs > Date.now())
  );
  const fallbackActiveLocation = activeRunLocationId
    ? locations.find((entry) => String(entry?.cardId || "") === activeRunLocationId)
    : null;
  const activeRunLocationName = activeRunLocationNameRaw
    || String(fallbackActiveLocation?.name || "").trim();
  const activeChatterCount = canUseLocationChat
    ? countActivePerimChattersAtLocation(rootState, activeRunLocationId, Date.now())
    : 0;
  const payload = {
    playerKey,
    locations,
    actions: PERIM_ACTIONS,
    eventsSummary: {
      activeCount: activeEvents.length,
      activeEvents,
    },
    activeRun: playerState.activeRun,
    activeRunNewsItems,
    pendingRewards,
    pendingChoicesRequired: pendingRewards.some((entry) => Boolean(entry?.needsChoice)),
    history: playerState.history,
    chat: {
      locationId: canUseLocationChat ? activeRunLocationId : "",
      locationName: canUseLocationChat ? activeRunLocationName : "",
      activeChatterCount,
      canChat: canUseLocationChat,
    },
    updatedAt: playerState.updatedAt,
    now: nowIso(),
  };
  logPerimPerf("buildPerimStatePayload", perfStart, `player=${normalizePerimPlayerKey(playerKeyRaw)} locations=${locations.length}`);
  return payload;
}

function listPerimGlobalEvents(locationEntries = []) {
  const eventsById = new Map();
  (Array.isArray(locationEntries) ? locationEntries : []).forEach((entry) => {
    const context = entry?.contextPreview || buildPerimContextSnapshot(entry, "explore", null, new Date(), []);
    const climate = String(context?.climate || "");
    const dailyEffectId = String(context?.dailyEffectId || "");
    const event = perimClimateEventByName(climate);
    if (!event) return;
    const mapKey = `${String(event.id)}:${dailyEffectId || "none"}`;
    eventsById.set(mapKey, {
      id: String(event.id),
      label: String(event.label),
      effect: String(event.effect),
      climate,
      dailyEffectId,
      dailyEffectLabel: String(context?.dailyEffectLabel || ""),
      dailyEffectDescription: String(context?.dailyEffectDescription || ""),
      dailyEffectDate: String(context?.dailyEffectDate || ""),
      dailyEffectModifiers: sanitizePerimDailyClimateModifiers(context?.dailyEffectModifiers || {}),
    });
  });
  if (!eventsById.size) {
    const fallback = perimClimateEventByName("nublado");
    const fallbackDaily = getPerimDailyClimateEffect("nublado", todayDateKey(), new Date());
    return [{
      id: String(fallback.id),
      label: String(fallback.label),
      effect: String(fallback.effect),
      climate: "Nublado",
      dailyEffectId: String(fallbackDaily?.id || ""),
      dailyEffectLabel: String(fallbackDaily?.label || ""),
      dailyEffectDescription: String(fallbackDaily?.description || ""),
      dailyEffectDate: String(fallbackDaily?.dateKey || todayDateKey()),
      dailyEffectModifiers: sanitizePerimDailyClimateModifiers(fallbackDaily?.modifiers || {}),
    }];
  }
  return [...eventsById.values()];
}

function buildPerimClimateEventCards(locationEntries = []) {
  return listPerimGlobalEvents(locationEntries).map((event) => ({
    id: `climate:${String(event?.id || "")}`,
    source: "climate",
    climate: String(event?.climate || ""),
    title: String(event?.label || "Evento climatico"),
    description: String(event?.dailyEffectDescription || "")
      ? `${String(event?.effect || "")}${String(event?.effect || "") ? " | " : ""}${String(event?.dailyEffectDescription || "")}`
      : String(event?.effect || ""),
    dailyEffectId: String(event?.dailyEffectId || ""),
    dailyEffectLabel: String(event?.dailyEffectLabel || ""),
    dailyEffectDescription: String(event?.dailyEffectDescription || ""),
    dailyEffectDate: String(event?.dailyEffectDate || ""),
    dailyEffectModifiers: sanitizePerimDailyClimateModifiers(event?.dailyEffectModifiers || {}),
    startAt: "",
    endAt: "",
    locationId: "",
    locationName: "",
    chancePercent: null,
    cardId: "",
    cardName: "",
    cardType: "",
  }));
}

function listPerimDropEventCards(locationEntries = [], nowDate = new Date()) {
  const entries = Array.isArray(locationEntries) ? locationEntries : [];
  if (!entries.length) {
    return [];
  }
  const indexes = getLibraryCardIndexes();
  const eventsById = new Map();
  entries.forEach((entry) => {
    const locationId = String(entry?.cardId || entry?.id || "").trim();
    if (!locationId) {
      return;
    }
    const activeEvents = listActivePerimDropEventsForLocation(locationId, nowDate);
    activeEvents.forEach((eventEntry) => {
      const eventId = Number(eventEntry?.id || 0);
      const mapKey = eventId > 0
        ? `drop:${eventId}`
        : `drop:${locationId}:${String(eventEntry?.cardId || "")}:${String(eventEntry?.startAt || "")}`;
      if (eventsById.has(mapKey)) {
        return;
      }
      const cardId = String(eventEntry?.cardId || "").trim();
      const card = cardId ? indexes.byId.get(cardId) : null;
      const locationName = String(entry?.name || eventEntry?.locationCardId || locationId);
      eventsById.set(mapKey, {
        id: mapKey,
        source: "drop_admin",
        climate: "",
        title: card?.name
          ? `Drop especial: ${card.name}`
          : `Drop especial: ${cardId || "Carta do evento"}`,
        description: String(eventEntry?.eventText || "Evento de drop especial ativo."),
        startAt: String(eventEntry?.startAt || ""),
        endAt: String(eventEntry?.endAt || ""),
        locationId: String(eventEntry?.locationCardId || locationId),
        locationName,
        chancePercent: Number(eventEntry?.chancePercent || 0),
        cardId,
        cardName: String(card?.name || cardId),
        cardType: String(eventEntry?.cardType || ""),
      });
    });
  });
  return [...eventsById.values()].sort((a, b) => {
    const chanceA = Number(a?.chancePercent || 0);
    const chanceB = Number(b?.chancePercent || 0);
    if (chanceB !== chanceA) {
      return chanceB - chanceA;
    }
    return String(a?.title || "").localeCompare(String(b?.title || ""), "pt-BR");
  });
}

function getGlobalDailyCreatures(dateKey = null) {
  return getDailyCreatureIndex(dateKey)?.creatures || [];
}

function buildTickerNewsItems(creaturePool, maxItems = 32) {
  const items = [];
  const seen = new Set();
  const sourceList = Array.isArray(creaturePool) ? creaturePool : [];
  sourceList.forEach((creature) => {
    const types = String(creature?.types || "").trim();
    const flavortext = String(
      creature?.flavortext || resolveCreatureFlavortext(creature?.name || "")
    ).trim();
    if (!types && !flavortext) {
      return;
    }
    const key = `${types.toLowerCase()}|${flavortext.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({
      types: types || "Unknown type",
      flavortext: flavortext || "Sinais misteriosos ecoam por Perim.",
    });
  });
  if (items.length <= maxItems) {
    return items;
  }
  const dayKey = todayDateKey();
  return items
    .map((entry) => ({
      entry,
      weight: hashTokenToInt(`${dayKey}:${entry.types}:${entry.flavortext}`),
    }))
    .sort((a, b) => a.weight - b.weight)
    .slice(0, maxItems)
    .map((wrapped) => wrapped.entry);
}

function normalizeTribeToScannerKey(rawTribe) {
  const tribe = String(rawTribe || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
  if (!tribe) {
    return "";
  }
  if (tribe.includes("danian")) {
    return "danian";
  }
  if (tribe.includes("underworld") || tribe.includes("submundo")) {
    return "underworld";
  }
  if (tribe.includes("overworld") || tribe.includes("outromundo")) {
    return "overworld";
  }
  if (tribe.includes("mipedian") || tribe.includes("maipidian")) {
    return "mipedian";
  }
  if (tribe.includes("marrillian")) {
    return "marrillian";
  }
  return "";
}

function createDefaultScanners() {
  const out = {};
  SCANNER_KEYS.forEach((key) => {
    out[key] = { level: 1, xp: 0 };
  });
  return out;
}

function normalizeScannersPayload(rawScanners) {
  const scanners = createDefaultScanners();
  const source = rawScanners && typeof rawScanners === "object" ? rawScanners : {};
  SCANNER_KEYS.forEach((key) => {
    const scanner = source[key];
    if (!scanner || typeof scanner !== "object") {
      return;
    }
    const xp = Math.max(0, Number(scanner.xp || 0));
    let level = Math.max(1, Math.min(4, Number(scanner.level || 1)));
    if (!Number.isFinite(level)) {
      level = 1;
    }
    scanners[key] = { level, xp };
  });
  return scanners;
}

function scannerLevelFromXp(xpValue) {
  const xp = Math.max(0, Number(xpValue || 0));
  if (xp >= SCANNER_XP_THRESHOLDS[3]) return 4;
  if (xp >= SCANNER_XP_THRESHOLDS[2]) return 3;
  if (xp >= SCANNER_XP_THRESHOLDS[1]) return 2;
  return 1;
}

function scannerProgressPayload(scanner) {
  const xp = Math.max(0, Number(scanner?.xp || 0));
  const level = scannerLevelFromXp(xp);
  const currentThreshold = SCANNER_XP_THRESHOLDS[level - 1];
  const nextThreshold = level >= 4 ? SCANNER_XP_THRESHOLDS[3] : SCANNER_XP_THRESHOLDS[level];
  return {
    level,
    xp,
    currentLevelXpThreshold: currentThreshold,
    nextLevelXpThreshold: nextThreshold,
  };
}

function addScannerXp(profile, scannerKey, xpAmount) {
  if (!SCANNER_KEYS.includes(scannerKey)) {
    return;
  }
  profile.scanners = normalizeScannersPayload(profile.scanners);
  const scanner = profile.scanners[scannerKey];
  scanner.xp = Math.max(0, Number(scanner.xp || 0) + Math.max(0, Number(xpAmount || 0)));
  scanner.level = scannerLevelFromXp(scanner.xp);
}

function scannerEffectsByLevel(level) {
  const normalized = Math.max(1, Math.min(4, Number(level || 1)));
  const effect = getScannerTribeLevelEffect(normalized);
  return {
    durationMultiplier: 1,
    successBoostPercent: effect.successBoostPercent,
    rareBoost: effect.creatureRareBoost,
    mugicRareBoost: effect.mugicRareBoost,
  };
}

function getScannerTotalLevel(profile) {
  const scanners = normalizeScannersPayload(profile?.scanners);
  return SCANNER_KEYS.reduce((sum, key) => {
    const scanner = scanners[key] || { xp: 0 };
    return sum + scannerLevelFromXp(scanner?.xp || 0);
  }, 0);
}

function buildScannerTribeRareBoostMap(profile) {
  const scanners = normalizeScannersPayload(profile?.scanners);
  const boostMap = new Map();
  SCANNER_KEYS.forEach((scannerKey) => {
    const scanner = scanners[scannerKey] || { xp: 0 };
    const level = scannerLevelFromXp(scanner?.xp || 0);
    const effect = getScannerTribeLevelEffect(level);
    boostMap.set(scannerKey, {
      creatureRareBoost: Math.max(0, Number(effect?.creatureRareBoost || 0)),
      mugicRareBoost: Math.max(0, Number(effect?.mugicRareBoost || 0)),
      successBoostPercent: Math.max(0, Number(effect?.successBoostPercent || 0)),
    });
  });
  return boostMap;
}

function resolveScannerStateForLocation(profile, locationEntry) {
  const scannerKey = normalizeTribeToScannerKey(locationEntry?.tribe || "");
  const scanners = normalizeScannersPayload(profile?.scanners);
  const scanner = scannerKey ? scanners[scannerKey] : null;
  const level = scannerLevelFromXp(scanner?.xp || 0);
  const totalScannerLevel = getScannerTotalLevel(profile);
  const globalDurationMultiplier = getScannerDurationMultiplierByTotalLevel(totalScannerLevel);
  return {
    scannerKey: scannerKey || "",
    level,
    totalScannerLevel,
    globalDurationMultiplier,
    effect: scannerEffectsByLevel(level),
    tribeRareBoostMap: buildScannerTribeRareBoostMap(profile),
  };
}

function normalizePerimCampWaitMap(rawMap) {
  const source = rawMap && typeof rawMap === "object" ? rawMap : {};
  const normalized = {};
  Object.entries(source).forEach(([locationIdRaw, countRaw]) => {
    const locationId = String(locationIdRaw || "").trim();
    if (!locationId) {
      return;
    }
    const count = Math.max(0, Math.floor(Number(countRaw || 0)));
    if (count > 0) {
      normalized[locationId] = Math.min(999, count);
    }
  });
  return normalized;
}

function getPerimCampWaitCount(stateHolder, locationIdRaw) {
  const locationId = String(locationIdRaw || "").trim();
  if (!locationId || !stateHolder || typeof stateHolder !== "object") {
    return 0;
  }
  const map = normalizePerimCampWaitMap(stateHolder.campWaitByLocation);
  return Math.max(0, Math.floor(Number(map[locationId] || 0)));
}

function setPerimCampWaitCount(stateHolder, locationIdRaw, nextCountRaw) {
  const locationId = String(locationIdRaw || "").trim();
  if (!locationId || !stateHolder || typeof stateHolder !== "object") {
    return false;
  }
  const map = normalizePerimCampWaitMap(stateHolder.campWaitByLocation);
  const nextCount = Math.max(0, Math.floor(Number(nextCountRaw || 0)));
  const prevCount = Math.max(0, Math.floor(Number(map[locationId] || 0)));
  if (nextCount <= 0) {
    if (!(locationId in map)) {
      return false;
    }
    delete map[locationId];
  } else {
    const capped = Math.min(999, nextCount);
    if (prevCount === capped) {
      return false;
    }
    map[locationId] = capped;
  }
  stateHolder.campWaitByLocation = map;
  return true;
}

function incrementPerimCampWaitCount(stateHolder, locationIdRaw) {
  const current = getPerimCampWaitCount(stateHolder, locationIdRaw);
  return setPerimCampWaitCount(stateHolder, locationIdRaw, current + 1);
}

const PROFILE_HISTORY_LIMIT = 50;

function createDefaultProfile(usernameKey) {
  return {
    username: usernameKey,
    favoriteTribe: "",
    starterPackGrantedAt: "",
    starterPackTribe: "",
    adminScannerMaxedAt: "",
    avatar: "",
    score: 1200,
    wins: 0,
    losses: 0,
    winRate: 0,
    battleHistory: [],
    creatureUsage: {},
    discoveredCards: {},
    scanners: createDefaultScanners(),
    mostPlayedCreature: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeProfilePayload(key, rawProfile) {
  const base = createDefaultProfile(key);
  const profile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const wins = Math.max(0, Number(profile.wins || 0));
  const losses = Math.max(0, Number(profile.losses || 0));
  const totalBattles = wins + losses;
  const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 10000) / 100 : 0;
  const usage = profile.creatureUsage && typeof profile.creatureUsage === "object" ? profile.creatureUsage : {};
  const sanitizedUsage = {};
  Object.values(usage).forEach((entry) => {
    const cardId = String(entry?.cardId || "").trim();
    if (!cardId) {
      return;
    }
    const name = String(entry?.name || "").trim();
    const count = Math.max(0, Number(entry?.count || 0));
    if (count <= 0) {
      return;
    }
    sanitizedUsage[cardId] = { cardId, name: name || cardId, count };
  });
  const history = Array.isArray(profile.battleHistory)
    ? profile.battleHistory
        .map((entry) => ({
          mode: String(entry?.mode || "unknown"),
          result: String(entry?.result || "unknown"),
          opponent: String(entry?.opponent || "Oponente"),
          timestamp: entry?.timestamp || nowIso(),
        }))
        .slice(-PROFILE_HISTORY_LIMIT)
    : [];
  const rawDiscovered = profile.discoveredCards && typeof profile.discoveredCards === "object" ? profile.discoveredCards : {};
  const discoveredCards = {};
  Object.keys(rawDiscovered).forEach((cardKey) => {
    const normalizedKey = String(cardKey || "").trim();
    if (!normalizedKey) {
      return;
    }
    discoveredCards[normalizedKey] = Boolean(rawDiscovered[cardKey]);
  });
  return {
    ...base,
    favoriteTribe: String(profile.favoriteTribe || base.favoriteTribe || ""),
    starterPackGrantedAt: String(profile.starterPackGrantedAt || ""),
    starterPackTribe: String(profile.starterPackTribe || ""),
    adminScannerMaxedAt: String(profile.adminScannerMaxedAt || ""),
    avatar: String(profile.avatar || ""),
    score: Math.max(0, Number(profile.score || base.score)),
    wins,
    losses,
    winRate,
    battleHistory: history,
    creatureUsage: sanitizedUsage,
    discoveredCards,
    scanners: normalizeScannersPayload(profile.scanners),
    mostPlayedCreature: profile?.mostPlayedCreature && typeof profile.mostPlayedCreature === "object"
      ? {
          cardId: String(profile.mostPlayedCreature.cardId || ""),
          name: String(profile.mostPlayedCreature.name || ""),
          count: Math.max(0, Number(profile.mostPlayedCreature.count || 0)),
        }
      : null,
    createdAt: profile.createdAt || base.createdAt,
    updatedAt: profile.updatedAt || base.updatedAt,
  };
}

function buildProfilesStateFromUsers() {
  const profiles = {};
  if (sqliteDb) {
    try {
      const rows = sqliteDb.prepare("SELECT username, tribe FROM users").all();
      rows.forEach((row) => {
        const key = normalizeUserKey(row?.username);
        if (!key) {
          return;
        }
        const profile = createDefaultProfile(key);
        profile.favoriteTribe = String(row?.tribe || "");
        profile.updatedAt = nowIso();
        profiles[key] = profile;
      });
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        captureSqliteCorruption("profilesFallbackUsers", "profiles", "state", error);
      } else {
        console.warn(`[DB] Falha ao montar profiles a partir de users: ${error?.message || error}`);
      }
    }
  }
  return {
    createdAt: nowIso(),
    updatedAt: nowIso(),
    profiles,
  };
}

function loadProfilesData() {
  if (isSqlV2Ready()) {
    const profiles = {};
    const profileRows = sqliteDb
      .prepare(`
        SELECT owner_key, favorite_tribe, starter_pack_granted_at, starter_pack_tribe, admin_scanner_maxed_at,
               avatar, score, wins, losses, win_rate, most_played_card_id, most_played_name, most_played_count,
               created_at, updated_at
        FROM player_profiles
      `)
      .all();
    profileRows.forEach((row) => {
      const key = normalizeUserKey(row?.owner_key);
      const baseProfile = createDefaultProfile(key);
      baseProfile.favoriteTribe = String(row?.favorite_tribe || "");
      baseProfile.starterPackGrantedAt = String(row?.starter_pack_granted_at || "");
      baseProfile.starterPackTribe = String(row?.starter_pack_tribe || "");
      baseProfile.adminScannerMaxedAt = String(row?.admin_scanner_maxed_at || "");
      baseProfile.avatar = String(row?.avatar || "");
      baseProfile.score = Math.max(0, Number(row?.score || 1200));
      baseProfile.wins = Math.max(0, Number(row?.wins || 0));
      baseProfile.losses = Math.max(0, Number(row?.losses || 0));
      baseProfile.winRate = Number(row?.win_rate || 0);
      if (String(row?.most_played_card_id || "").trim()) {
        baseProfile.mostPlayedCreature = {
          cardId: String(row?.most_played_card_id || ""),
          name: String(row?.most_played_name || row?.most_played_card_id || ""),
          count: Math.max(0, Number(row?.most_played_count || 0)),
        };
      }
      baseProfile.createdAt = String(row?.created_at || nowIso());
      baseProfile.updatedAt = String(row?.updated_at || nowIso());
      profiles[key] = baseProfile;
    });

    const scannerRows = sqliteDb
      .prepare("SELECT owner_key, scanner_key, level, xp FROM profile_scanners")
      .all();
    scannerRows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key);
      if (!profiles[ownerKey]) {
        profiles[ownerKey] = createDefaultProfile(ownerKey);
      }
      profiles[ownerKey].scanners[String(row?.scanner_key || "")] = {
        level: Math.max(1, Number(row?.level || 1)),
        xp: Math.max(0, Number(row?.xp || 0)),
      };
    });

    const historyRows = sqliteDb
      .prepare("SELECT owner_key, mode, result, opponent, timestamp FROM profile_history ORDER BY timestamp ASC")
      .all();
    historyRows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key);
      if (!profiles[ownerKey]) {
        profiles[ownerKey] = createDefaultProfile(ownerKey);
      }
      profiles[ownerKey].battleHistory.push({
        mode: String(row?.mode || "unknown"),
        result: String(row?.result || "unknown"),
        opponent: String(row?.opponent || "Oponente"),
        timestamp: String(row?.timestamp || nowIso()),
      });
      if (profiles[ownerKey].battleHistory.length > PROFILE_HISTORY_LIMIT) {
        profiles[ownerKey].battleHistory = profiles[ownerKey].battleHistory.slice(-PROFILE_HISTORY_LIMIT);
      }
    });

    const usageRows = sqliteDb
      .prepare("SELECT owner_key, card_id, name, count FROM profile_creature_usage")
      .all();
    usageRows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key);
      if (!profiles[ownerKey]) {
        profiles[ownerKey] = createDefaultProfile(ownerKey);
      }
      const cardId = String(row?.card_id || "").trim();
      if (!cardId) {
        return;
      }
      profiles[ownerKey].creatureUsage[cardId] = {
        cardId,
        name: String(row?.name || cardId),
        count: Math.max(0, Number(row?.count || 0)),
      };
    });

    const discoveredRows = sqliteDb
      .prepare("SELECT owner_key, card_id, discovered FROM profile_discoveries WHERE discovered = 1")
      .all();
    discoveredRows.forEach((row) => {
      const ownerKey = normalizeUserKey(row?.owner_key);
      if (!profiles[ownerKey]) {
        profiles[ownerKey] = createDefaultProfile(ownerKey);
      }
      const cardId = String(row?.card_id || "").trim();
      if (!cardId) {
        return;
      }
      profiles[ownerKey].discoveredCards[cardId] = true;
    });

    const users = sqliteDb.prepare("SELECT username, tribe FROM users").all();
    users.forEach((row) => {
      const key = normalizeUserKey(row?.username);
      if (!profiles[key]) {
        const profile = createDefaultProfile(key);
        profile.favoriteTribe = String(row?.tribe || "");
        profiles[key] = profile;
      }
    });

    const normalizedProfiles = {};
    Object.entries(profiles).forEach(([key, profile]) => {
      normalizedProfiles[key] = normalizeProfilePayload(key, profile);
    });
    return {
      createdAt: nowIso(),
      updatedAt: nowIso(),
      profiles: normalizedProfiles,
    };
  }
  let fromSql = null;
  try {
    fromSql = sqlGet("profiles", "state");
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      captureSqliteCorruption("loadProfilesData.sqlGet", "profiles", "state", error);
    } else {
      console.warn(`[DB] Falha ao ler profiles do SQLite: ${error?.message || error}`);
    }
  }
  if (fromSql && typeof fromSql === "object") {
    const profiles = {};
    const sourceProfiles = fromSql?.profiles && typeof fromSql.profiles === "object" ? fromSql.profiles : {};
    Object.entries(sourceProfiles).forEach(([username, profile]) => {
      const key = normalizeUserKey(username);
      profiles[key] = normalizeProfilePayload(key, profile);
    });
    return {
      createdAt: fromSql?.createdAt || nowIso(),
      updatedAt: fromSql?.updatedAt || nowIso(),
      profiles,
    };
  }
  if (!fs.existsSync(PROFILES_FILE)) {
    const base = buildProfilesStateFromUsers();
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(base, null, 2), "utf8");
    sqlSet("profiles", "state", base);
    return base;
  }
  try {
    const parsed = safeJsonParse(fs.readFileSync(PROFILES_FILE, "utf8"), {});
    const profiles = {};
    const sourceProfiles = parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
    Object.entries(sourceProfiles).forEach(([username, profile]) => {
      const key = normalizeUserKey(username);
      profiles[key] = normalizeProfilePayload(key, profile);
    });
    const payload = {
      createdAt: parsed?.createdAt || nowIso(),
      updatedAt: parsed?.updatedAt || nowIso(),
      profiles,
    };
    sqlSet("profiles", "state", payload);
    return payload;
  } catch {
    const recovered = buildProfilesStateFromUsers();
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(recovered, null, 2), "utf8");
    sqlSet("profiles", "state", recovered);
    return recovered;
  }
}

function writeProfilesData(state, source = "manual") {
  const existing = fs.existsSync(PROFILES_FILE) ? safeJsonParse(fs.readFileSync(PROFILES_FILE, "utf8"), {}) : {};
  const profiles = {};
  const sourceProfiles = state?.profiles && typeof state.profiles === "object" ? state.profiles : {};
  Object.entries(sourceProfiles).forEach(([username, profile]) => {
    const key = normalizeUserKey(username);
    profiles[key] = normalizeProfilePayload(key, profile);
  });
  const payload = {
    createdAt: existing?.createdAt || state?.createdAt || nowIso(),
    updatedAt: nowIso(),
    source,
    profiles,
  };
  if (isSqlV2Ready()) {
    sqliteDb.exec("BEGIN IMMEDIATE");
    try {
      sqliteDb.prepare("DELETE FROM player_profiles").run();
      sqliteDb.prepare("DELETE FROM profile_scanners").run();
      sqliteDb.prepare("DELETE FROM profile_history").run();
      sqliteDb.prepare("DELETE FROM profile_creature_usage").run();
      sqliteDb.prepare("DELETE FROM profile_discoveries").run();
      const insertProfile = sqliteDb.prepare(`
        INSERT INTO player_profiles (
          owner_key, favorite_tribe, starter_pack_granted_at, starter_pack_tribe, admin_scanner_maxed_at, avatar,
          score, wins, losses, win_rate, most_played_card_id, most_played_name, most_played_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertScanner = sqliteDb.prepare(`
        INSERT INTO profile_scanners (owner_key, scanner_key, level, xp)
        VALUES (?, ?, ?, ?)
      `);
      const insertHistory = sqliteDb.prepare(`
        INSERT INTO profile_history (owner_key, mode, result, opponent, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertUsage = sqliteDb.prepare(`
        INSERT INTO profile_creature_usage (owner_key, card_id, name, count)
        VALUES (?, ?, ?, ?)
      `);
      const insertDiscovery = sqliteDb.prepare(`
        INSERT INTO profile_discoveries (owner_key, card_id, discovered)
        VALUES (?, ?, 1)
      `);
      Object.entries(payload.profiles || {}).forEach(([username, profileRaw]) => {
        const ownerKey = normalizeUserKey(username);
        const profile = normalizeProfilePayload(ownerKey, profileRaw);
        insertProfile.run(
          ownerKey,
          String(profile.favoriteTribe || ""),
          String(profile.starterPackGrantedAt || ""),
          String(profile.starterPackTribe || ""),
          String(profile.adminScannerMaxedAt || ""),
          String(profile.avatar || ""),
          Math.max(0, Number(profile.score || 1200)),
          Math.max(0, Number(profile.wins || 0)),
          Math.max(0, Number(profile.losses || 0)),
          Number(profile.winRate || 0),
          String(profile?.mostPlayedCreature?.cardId || ""),
          String(profile?.mostPlayedCreature?.name || ""),
          Math.max(0, Number(profile?.mostPlayedCreature?.count || 0)),
          String(profile.createdAt || nowIso()),
          String(profile.updatedAt || nowIso())
        );
        const scanners = normalizeScannersPayload(profile.scanners);
        SCANNER_KEYS.forEach((scannerKey) => {
          const scanner = scanners[scannerKey] || { level: 1, xp: 0 };
          insertScanner.run(ownerKey, scannerKey, Number(scanner.level || 1), Number(scanner.xp || 0));
        });
        (profile.battleHistory || []).forEach((entry) => {
          insertHistory.run(
            ownerKey,
            String(entry?.mode || "unknown"),
            String(entry?.result || "unknown"),
            String(entry?.opponent || "Oponente"),
            String(entry?.timestamp || nowIso())
          );
        });
        Object.values(profile.creatureUsage || {}).forEach((entry) => {
          const cardId = String(entry?.cardId || "").trim();
          if (!cardId) {
            return;
          }
          insertUsage.run(
            ownerKey,
            cardId,
            String(entry?.name || cardId),
            Math.max(0, Number(entry?.count || 0))
          );
        });
        Object.entries(profile.discoveredCards || {}).forEach(([cardId, discovered]) => {
          if (!cardId || !discovered) {
            return;
          }
          insertDiscovery.run(ownerKey, String(cardId));
        });
      });
      sqliteDb.exec("COMMIT");
      return payload;
    } catch (error) {
      try {
        sqliteDb.exec("ROLLBACK");
      } catch {}
      console.error(`[DB] Falha ao persistir profiles SQL v2: ${error?.message || error}`);
      throw error;
    }
  }
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(payload, null, 2), "utf8");
  sqlSet("profiles", "state", payload);
  invalidateUserCaches("", { all: true });
  return payload;
}

function ensureAdminScannersMaxed(profile, usernameKey) {
  if (normalizeUserKey(usernameKey) !== "admin") {
    return false;
  }
  profile.scanners = normalizeScannersPayload(profile.scanners);
  let changed = false;
  SCANNER_KEYS.forEach((key) => {
    const scanner = profile.scanners[key] || { level: 1, xp: 0 };
    if (Number(scanner.xp || 0) !== SCANNER_XP_THRESHOLDS[3] || Number(scanner.level || 0) !== 4) {
      profile.scanners[key] = { level: 4, xp: SCANNER_XP_THRESHOLDS[3] };
      changed = true;
    }
  });
  if (!profile.adminScannerMaxedAt || changed) {
    profile.adminScannerMaxedAt = nowIso();
    changed = true;
  }
  if (changed) {
    profile.updatedAt = nowIso();
  }
  return changed;
}

function getOrCreateProfile(state, usernameRaw) {
  const key = normalizeUserKey(usernameRaw);
  let changed = false;
  if (!state.profiles[key]) {
    state.profiles[key] = createDefaultProfile(key);
    changed = true;
  } else {
    const current = state.profiles[key];
    const scanners = current?.scanners && typeof current.scanners === "object" ? current.scanners : null;
    const looksNormalized = Boolean(
      current
      && typeof current === "object"
      && typeof current.username === "string"
      && Array.isArray(current.battleHistory)
      && current.creatureUsage && typeof current.creatureUsage === "object"
      && current.discoveredCards && typeof current.discoveredCards === "object"
      && scanners && typeof scanners === "object"
    );
    if (!looksNormalized) {
      state.profiles[key] = normalizeProfilePayload(key, current);
      changed = true;
    }
  }
  if (ensureAdminScannersMaxed(state.profiles[key], key)) {
    changed = true;
  }
  return { key, profile: state.profiles[key], changed };
}

function resolveMostPlayedCreature(profile) {
  const usage = profile?.creatureUsage && typeof profile.creatureUsage === "object" ? profile.creatureUsage : {};
  let top = null;
  Object.values(usage).forEach((entry) => {
    const count = Math.max(0, Number(entry?.count || 0));
    if (!count) {
      return;
    }
    if (!top || count > top.count) {
      top = {
        cardId: String(entry.cardId || ""),
        name: String(entry.name || entry.cardId || ""),
        count,
      };
    }
  });
  profile.mostPlayedCreature = top;
}

function discoveryKeyFromReward(reward) {
  const type = String(reward?.type || "").trim();
  const cardId = String(reward?.cardId || "").trim();
  if (!type || !cardId) {
    return "";
  }
  return `${type}:${cardId}`;
}

function isCardDiscovered(profile, reward) {
  const key = discoveryKeyFromReward(reward);
  if (!key) {
    return false;
  }
  const discovered = profile?.discoveredCards && typeof profile.discoveredCards === "object"
    ? profile.discoveredCards
    : {};
  return Boolean(discovered[key]);
}

function markCardDiscovered(profile, reward) {
  const key = discoveryKeyFromReward(reward);
  if (!key) {
    return;
  }
  profile.discoveredCards = profile.discoveredCards && typeof profile.discoveredCards === "object"
    ? profile.discoveredCards
    : {};
  profile.discoveredCards[key] = true;
}

function applyBattleResultToProfile(profile, payload, options = {}) {
  const result = String(payload?.result || "").toLowerCase();
  const affectScore = options?.affectScore !== false;
  const scoreWin = Number.isFinite(Number(options?.scoreWin)) ? Number(options.scoreWin) : 20;
  const scoreLoss = Number.isFinite(Number(options?.scoreLoss)) ? Number(options.scoreLoss) : 10;
  if (result === "win") {
    profile.wins += 1;
    if (affectScore) {
      profile.score = Math.max(0, Number(profile.score || 0) + scoreWin);
    }
  } else if (result === "loss") {
    profile.losses += 1;
    if (affectScore) {
      profile.score = Math.max(0, Number(profile.score || 0) - Math.abs(scoreLoss));
    }
  } else {
    return;
  }
  const total = profile.wins + profile.losses;
  profile.winRate = total > 0 ? Math.round((profile.wins / total) * 10000) / 100 : 0;
  profile.battleHistory = Array.isArray(profile.battleHistory) ? profile.battleHistory : [];
  profile.battleHistory.push({
    mode: String(payload?.mode || "unknown"),
    result,
    opponent: String(payload?.opponent || "Oponente"),
    timestamp: payload?.timestamp || nowIso(),
  });
  profile.battleHistory = profile.battleHistory.slice(-PROFILE_HISTORY_LIMIT);
  profile.updatedAt = nowIso();
}

function applyCreatureUsageToProfile(profile, payload) {
  const cardId = String(payload?.cardId || "").trim();
  if (!cardId) {
    return false;
  }
  const cardName = String(payload?.cardName || cardId).trim();
  const increment = Math.max(1, Number(payload?.count || 1));
  profile.creatureUsage = profile.creatureUsage && typeof profile.creatureUsage === "object" ? profile.creatureUsage : {};
  if (!profile.creatureUsage[cardId]) {
    profile.creatureUsage[cardId] = { cardId, name: cardName, count: 0 };
  }
  profile.creatureUsage[cardId].count += increment;
  profile.creatureUsage[cardId].name = cardName || profile.creatureUsage[cardId].name;
  resolveMostPlayedCreature(profile);
  profile.updatedAt = nowIso();
  return true;
}

function seasonKeyFromDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function seasonBoundsFromDate(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

function ensureCurrentSeasonRow(nowDate = new Date()) {
  if (!sqliteDb) {
    return null;
  }
  const key = seasonKeyFromDate(nowDate);
  const bounds = seasonBoundsFromDate(nowDate);
  const now = nowIso();
  sqliteDb
    .prepare(`
      INSERT INTO seasons (season_key, starts_at, ends_at, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
      ON CONFLICT(season_key) DO UPDATE SET
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        updated_at = excluded.updated_at
    `)
    .run(key, bounds.startsAt, bounds.endsAt, now, now);
  return {
    seasonKey: key,
    startsAt: bounds.startsAt,
    endsAt: bounds.endsAt,
  };
}

function upsertSeasonPlayerDelta(ownerKeyRaw, delta = {}) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  if (!ownerKey) {
    return null;
  }
  const season = ensureCurrentSeasonRow(new Date());
  if (!season) {
    return null;
  }
  const scoreDelta = Number(delta.score || 0);
  const winsDelta = Number(delta.wins || 0);
  const lossesDelta = Number(delta.losses || 0);
  const perimClaimsDelta = Number(delta.perimClaims || 0);
  sqliteDb
    .prepare(`
      INSERT INTO season_player_stats (season_key, owner_key, score, wins, losses, perim_claims, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_key, owner_key) DO UPDATE SET
        score = season_player_stats.score + excluded.score,
        wins = season_player_stats.wins + excluded.wins,
        losses = season_player_stats.losses + excluded.losses,
        perim_claims = season_player_stats.perim_claims + excluded.perim_claims,
        updated_at = excluded.updated_at
    `)
    .run(
      season.seasonKey,
      ownerKey,
      scoreDelta,
      winsDelta,
      lossesDelta,
      perimClaimsDelta,
      nowIso()
    );
  return season;
}

function buildDailyPerimMissionKey(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `perim_claims:${day}`;
}

function ensureDailyPerimMission(date = new Date()) {
  if (!sqliteDb) {
    return null;
  }
  const missionDate = date.toISOString().slice(0, 10);
  const missionKey = buildDailyPerimMissionKey(date);
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO daily_missions (mission_key, mission_date, mission_type, target_value, created_at)
      VALUES (?, ?, 'perim_claims', 3, ?)
    `)
    .run(missionKey, missionDate, nowIso());
  return sqliteDb
    .prepare("SELECT mission_key, mission_date, mission_type, target_value, created_at FROM daily_missions WHERE mission_key = ?")
    .get(missionKey);
}

function incrementPerimMissionProgress(ownerKeyRaw, increment = 1, date = new Date()) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  if (!ownerKey) {
    return null;
  }
  const mission = ensureDailyPerimMission(date);
  if (!mission) {
    return null;
  }
  sqliteDb
    .prepare(`
      INSERT INTO daily_mission_progress (mission_key, owner_key, progress_value, completed_at, claimed_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(mission_key, owner_key) DO UPDATE SET
        progress_value = daily_mission_progress.progress_value + excluded.progress_value,
        updated_at = excluded.updated_at
    `)
    .run(String(mission.mission_key), ownerKey, Math.max(0, Number(increment || 0)), nowIso());
  const progress = sqliteDb
    .prepare(`
      SELECT mission_key, owner_key, progress_value, completed_at, claimed_at, updated_at
      FROM daily_mission_progress
      WHERE mission_key = ? AND owner_key = ?
    `)
    .get(String(mission.mission_key), ownerKey);
  const target = Math.max(1, Number(mission?.target_value || 1));
  if (progress && !progress.completed_at && Number(progress.progress_value || 0) >= target) {
    const completedAt = nowIso();
    sqliteDb
      .prepare("UPDATE daily_mission_progress SET completed_at = ?, updated_at = ? WHERE mission_key = ? AND owner_key = ?")
      .run(completedAt, completedAt, String(mission.mission_key), ownerKey);
  }
  return {
    missionKey: String(mission.mission_key),
    missionDate: String(mission.mission_date),
    missionType: String(mission.mission_type),
    targetValue: target,
  };
}

function claimDailyMissionReward(ownerKeyRaw, missionKeyRaw) {
  if (!sqliteDb) {
    return { ok: false, error: "Banco de dados indisponivel." };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const missionKey = String(missionKeyRaw || "").trim();
  if (!ownerKey || !missionKey) {
    return { ok: false, error: "Missao invalida." };
  }
  const mission = sqliteDb
    .prepare("SELECT mission_key, target_value FROM daily_missions WHERE mission_key = ?")
    .get(missionKey);
  if (!mission) {
    return { ok: false, error: "Missao nao encontrada." };
  }
  const progress = sqliteDb
    .prepare("SELECT progress_value, completed_at, claimed_at FROM daily_mission_progress WHERE mission_key = ? AND owner_key = ?")
    .get(missionKey, ownerKey);
  if (!progress) {
    return { ok: false, error: "Sem progresso nessa missao." };
  }
  if (progress.claimed_at) {
    return { ok: false, error: "Missao ja coletada." };
  }
  const target = Math.max(1, Number(mission?.target_value || 1));
  if (Number(progress?.progress_value || 0) < target) {
    return { ok: false, error: "Missao ainda nao concluida." };
  }
  const claimedAt = nowIso();
  sqliteDb
    .prepare("UPDATE daily_mission_progress SET claimed_at = ?, updated_at = ? WHERE mission_key = ? AND owner_key = ?")
    .run(claimedAt, claimedAt, missionKey, ownerKey);
  const season = ensureCurrentSeasonRow(new Date());
  const rewardBadge = `perim-hunter-${season?.seasonKey || seasonKeyFromDate(new Date())}`;
  const rewardTitle = "Rastreador de PERIM";
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO season_rewards (season_key, owner_key, reward_type, reward_value, granted_at)
      VALUES (?, ?, 'badge', ?, ?)
    `)
    .run(season?.seasonKey || seasonKeyFromDate(new Date()), ownerKey, rewardBadge, claimedAt);
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO season_rewards (season_key, owner_key, reward_type, reward_value, granted_at)
      VALUES (?, ?, 'title', ?, ?)
    `)
    .run(season?.seasonKey || seasonKeyFromDate(new Date()), ownerKey, rewardTitle, claimedAt);
  return {
    ok: true,
    claimedAt,
    rewards: [
      { type: "badge", value: rewardBadge },
      { type: "title", value: rewardTitle },
    ],
  };
}

function weekStartIsoDate(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // monday-based
  utc.setUTCDate(utc.getUTCDate() - diff);
  return utc.toISOString().slice(0, 10);
}

function buildWeeklyPerimMissionKey(date = new Date()) {
  return `perim_weekly_claims:${weekStartIsoDate(date)}`;
}

function ensureWeeklyPerimMission(date = new Date()) {
  if (!sqliteDb) {
    return null;
  }
  const weekStart = weekStartIsoDate(date);
  const missionKey = buildWeeklyPerimMissionKey(date);
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO weekly_missions (mission_key, week_start, mission_type, target_value, created_at)
      VALUES (?, ?, 'perim_claims_weekly', 15, ?)
    `)
    .run(missionKey, weekStart, nowIso());
  return sqliteDb
    .prepare("SELECT mission_key, week_start, mission_type, target_value, created_at FROM weekly_missions WHERE mission_key = ?")
    .get(missionKey);
}

function incrementWeeklyPerimMissionProgress(ownerKeyRaw, increment = 1, date = new Date()) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  if (!ownerKey) {
    return null;
  }
  const mission = ensureWeeklyPerimMission(date);
  if (!mission) {
    return null;
  }
  sqliteDb
    .prepare(`
      INSERT INTO weekly_mission_progress (mission_key, owner_key, progress_value, completed_at, claimed_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(mission_key, owner_key) DO UPDATE SET
        progress_value = weekly_mission_progress.progress_value + excluded.progress_value,
        updated_at = excluded.updated_at
    `)
    .run(String(mission.mission_key), ownerKey, Math.max(0, Number(increment || 0)), nowIso());
  const progress = sqliteDb
    .prepare(`
      SELECT progress_value, completed_at, claimed_at
      FROM weekly_mission_progress
      WHERE mission_key = ? AND owner_key = ?
    `)
    .get(String(mission.mission_key), ownerKey);
  const target = Math.max(1, Number(mission?.target_value || 1));
  if (progress && !progress.completed_at && Number(progress.progress_value || 0) >= target) {
    const completedAt = nowIso();
    sqliteDb
      .prepare("UPDATE weekly_mission_progress SET completed_at = ?, updated_at = ? WHERE mission_key = ? AND owner_key = ?")
      .run(completedAt, completedAt, String(mission.mission_key), ownerKey);
  }
  return {
    missionKey: String(mission.mission_key),
    weekStart: String(mission.week_start),
    targetValue: target,
  };
}

function claimWeeklyMissionReward(ownerKeyRaw, missionKeyRaw) {
  if (!sqliteDb) {
    return { ok: false, error: "Banco de dados indisponivel." };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const missionKey = String(missionKeyRaw || "").trim();
  if (!ownerKey || !missionKey) {
    return { ok: false, error: "Missao invalida." };
  }
  const mission = sqliteDb
    .prepare("SELECT mission_key, week_start, target_value FROM weekly_missions WHERE mission_key = ?")
    .get(missionKey);
  if (!mission) {
    return { ok: false, error: "Missao semanal nao encontrada." };
  }
  const progress = sqliteDb
    .prepare("SELECT progress_value, completed_at, claimed_at FROM weekly_mission_progress WHERE mission_key = ? AND owner_key = ?")
    .get(missionKey, ownerKey);
  if (!progress) {
    return { ok: false, error: "Sem progresso nessa missao semanal." };
  }
  if (progress.claimed_at) {
    return { ok: false, error: "Missao semanal ja coletada." };
  }
  const target = Math.max(1, Number(mission?.target_value || 1));
  if (Number(progress?.progress_value || 0) < target) {
    return { ok: false, error: "Missao semanal ainda nao concluida." };
  }
  const claimedAt = nowIso();
  sqliteDb
    .prepare("UPDATE weekly_mission_progress SET claimed_at = ?, updated_at = ? WHERE mission_key = ? AND owner_key = ?")
    .run(claimedAt, claimedAt, missionKey, ownerKey);
  const season = ensureCurrentSeasonRow(new Date());
  const weekSuffix = String(mission?.week_start || weekStartIsoDate(new Date()));
  const rewardBadge = `perim-weekly-${weekSuffix}`;
  const rewardTitle = "Veterano de Expedicao";
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO season_rewards (season_key, owner_key, reward_type, reward_value, granted_at)
      VALUES (?, ?, 'badge', ?, ?)
    `)
    .run(season?.seasonKey || seasonKeyFromDate(new Date()), ownerKey, rewardBadge, claimedAt);
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO season_rewards (season_key, owner_key, reward_type, reward_value, granted_at)
      VALUES (?, ?, 'title', ?, ?)
    `)
    .run(season?.seasonKey || seasonKeyFromDate(new Date()), ownerKey, rewardTitle, claimedAt);
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO achievements (owner_key, achievement_key, category, unlocked_at, payload_json)
      VALUES (?, ?, 'perim', ?, ?)
    `)
    .run(ownerKey, rewardBadge, claimedAt, JSON.stringify({ missionKey }));
  return {
    ok: true,
    claimedAt,
    rewards: [
      { type: "badge", value: rewardBadge },
      { type: "title", value: rewardTitle },
    ],
  };
}

function listSeasonRewards(ownerKeyRaw, seasonKeyRaw = "") {
  if (!sqliteDb) {
    return [];
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  if (!ownerKey) {
    return [];
  }
  const seasonKey = String(seasonKeyRaw || seasonKeyFromDate(new Date()));
  return sqliteDb
    .prepare(`
      SELECT reward_type, reward_value, granted_at
      FROM season_rewards
      WHERE owner_key = ? AND season_key = ?
      ORDER BY granted_at DESC
    `)
    .all(ownerKey, seasonKey)
    .map((row) => ({
      type: String(row?.reward_type || ""),
      value: String(row?.reward_value || ""),
      grantedAt: String(row?.granted_at || ""),
    }));
}

function previousSeasonKeyFromDate(date = new Date()) {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1, 0, 0, 0, 0);
  return seasonKeyFromDate(previous);
}

function normalizeTribeTagKey(rawValue) {
  const token = String(rawValue || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (token.includes("danian")) return "danian";
  if (token.includes("mipedian")) return "mipedian";
  if (token.includes("over")) return "overworld";
  if (token.includes("outro")) return "overworld";
  if (token.includes("under")) return "underworld";
  if (token.includes("sub")) return "underworld";
  return "";
}

function tribeTagLabel(rawValue) {
  const normalized = normalizeTribeTagKey(rawValue);
  return DROME_TRIBE_TAGS[normalized] || "Sem Tribo";
}

function titleForDromePlacement(rank, dromeName, tribeRaw = "") {
  const safeDrome = String(dromeName || "Dromo");
  const tribe = tribeTagLabel(tribeRaw);
  if (rank === 1) return `CodeMaster ${safeDrome}`;
  if (rank === 2) return `Conquistador dos/do ${tribe}`;
  if (rank === 3) return `Veterano dos/do ${tribe}`;
  if (rank === 4) return `Guardiao dos/do ${tribe}`;
  if (rank === 5) return `Explorador dos/do ${tribe}`;
  return "";
}

function normalizeDromeId(rawValue) {
  const token = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "");
  if (!token) return "";
  const found = DROME_CATALOG.find((entry) => entry.id === token);
  return found ? found.id : "";
}

function dromeNameById(dromeIdRaw) {
  const normalized = normalizeDromeId(dromeIdRaw);
  const found = DROME_CATALOG.find((entry) => entry.id === normalized);
  return found ? found.name : "";
}

function dromeTagPrefixById(dromeIdRaw) {
  const normalized = normalizeDromeId(dromeIdRaw);
  const map = {
    crellan: "Cr",
    hotekk: "Ho",
    amzen: "Am",
    oron: "Or",
    tirasis: "Ti",
    imthor: "Im",
    chirrul: "Ch",
    beta: "Be",
  };
  return map[normalized] || "Dr";
}

function getDromeRankPosition(seasonKeyRaw, dromeIdRaw, ownerKeyRaw) {
  if (!sqliteDb) {
    return null;
  }
  const seasonKey = String(seasonKeyRaw || "").trim();
  const dromeId = normalizeDromeId(dromeIdRaw);
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!seasonKey || !dromeId || !ownerKey) {
    return null;
  }
  const rows = sqliteDb
    .prepare(`
      SELECT owner_key
      FROM ranked_drome_stats
      WHERE season_key = ? AND drome_id = ?
      ORDER BY score DESC, wins DESC, losses ASC, owner_key ASC
    `)
    .all(seasonKey, dromeId);
  if (!rows.length) {
    return null;
  }
  const index = rows.findIndex((entry) => normalizeUserKey(entry?.owner_key || "", "") === ownerKey);
  if (index < 0) {
    return null;
  }
  return index + 1;
}

function buildFallbackDromeTag(ownerKeyRaw, seasonKeyRaw = seasonKeyFromDate(new Date())) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!ownerKey || !seasonKey) {
    return "";
  }
  const selection = getDromeSelectionForSeason(ownerKey, seasonKey);
  if (!selection?.dromeId) {
    return "";
  }
  ensureDromeBaselineRow(ownerKey, selection.dromeId, seasonKey);
  const rank = getDromeRankPosition(seasonKey, selection.dromeId, ownerKey);
  if (!Number.isFinite(Number(rank)) || Number(rank) <= 0) {
    return "";
  }
  return `${dromeTagPrefixById(selection.dromeId)}${Number(rank)}`;
}

function getCurrentDromeScore(ownerKeyRaw, seasonKeyRaw = seasonKeyFromDate(new Date()), dromeIdRaw = "") {
  if (!sqliteDb) {
    return DROME_BASE_SCORE;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!ownerKey || !seasonKey) {
    return DROME_BASE_SCORE;
  }
  const dromeId = normalizeDromeId(dromeIdRaw || getDromeSelectionForSeason(ownerKey, seasonKey)?.dromeId || "");
  if (!dromeId) {
    return DROME_BASE_SCORE;
  }
  ensureDromeBaselineRow(ownerKey, dromeId, seasonKey);
  const row = sqliteDb
    .prepare(`
      SELECT score
      FROM ranked_drome_stats
      WHERE season_key = ? AND drome_id = ? AND owner_key = ?
      LIMIT 1
    `)
    .get(seasonKey, dromeId, ownerKey);
  return Math.max(0, Number(row?.score || DROME_BASE_SCORE));
}

function getDromeSelectionForSeason(ownerKeyRaw, seasonKeyRaw = seasonKeyFromDate(new Date())) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!ownerKey || !seasonKey) {
    return null;
  }
  const row = sqliteDb
    .prepare("SELECT season_key, owner_key, drome_id, locked_at FROM ranked_drome_selection WHERE season_key = ? AND owner_key = ?")
    .get(seasonKey, ownerKey);
  if (!row) {
    return null;
  }
  return {
    seasonKey: String(row.season_key || seasonKey),
    ownerKey,
    dromeId: String(row.drome_id || ""),
    dromeName: dromeNameById(row.drome_id),
    lockedAt: String(row.locked_at || ""),
  };
}

function ensureDromeSeasonCycle(nowDate = new Date()) {
  if (!sqliteDb) {
    return;
  }
  const currentSeasonKey = seasonKeyFromDate(nowDate);
  const previousSeasonKey = previousSeasonKeyFromDate(nowDate);
  if (!currentSeasonKey || !previousSeasonKey || currentSeasonKey === previousSeasonKey) {
    return;
  }
  const alreadyFinalized = sqliteDb
    .prepare("SELECT season_key FROM drome_season_rollups WHERE season_key = ? LIMIT 1")
    .get(previousSeasonKey);
  if (alreadyFinalized) {
    return;
  }
  const finalizedAt = nowIso();
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    const checkAgain = sqliteDb
      .prepare("SELECT season_key FROM drome_season_rollups WHERE season_key = ? LIMIT 1")
      .get(previousSeasonKey);
    if (checkAgain) {
      sqliteDb.exec("COMMIT");
      return;
    }
    DROME_CATALOG.forEach((entry) => {
      const dromeId = String(entry.id || "");
      const dromeName = String(entry.name || dromeId || "Dromo");
      const rows = sqliteDb
        .prepare(`
          SELECT owner_key, score, wins, losses
          FROM ranked_drome_stats
          WHERE season_key = ? AND drome_id = ?
          ORDER BY score DESC, wins DESC, losses ASC
          LIMIT 5
        `)
        .all(previousSeasonKey, dromeId);
      rows.forEach((row, index) => {
        const rank = index + 1;
        const ownerKey = normalizeUserKey(row?.owner_key, "");
        if (!ownerKey) {
          return;
        }
        const tribeRaw = resolveFavoriteTribeFromUserRecord(ownerKey);
        const title = titleForDromePlacement(rank, dromeName, tribeRaw);
        if (!title) {
          return;
        }
        sqliteDb
          .prepare(`
            INSERT OR IGNORE INTO season_rewards (season_key, owner_key, reward_type, reward_value, granted_at)
            VALUES (?, ?, 'title', ?, ?)
          `)
          .run(previousSeasonKey, ownerKey, title, finalizedAt);
        sqliteDb
          .prepare(`
            INSERT OR REPLACE INTO drome_season_titles
              (season_key, drome_id, owner_key, rank, title_text, tribe_key, source_season_key, granted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            currentSeasonKey,
            dromeId,
            ownerKey,
            rank,
            title,
            normalizeTribeTagKey(tribeRaw),
            previousSeasonKey,
            finalizedAt
          );
        if (rank === 1) {
          sqliteDb
            .prepare(`
              INSERT OR REPLACE INTO drome_codemasters
                (season_key, drome_id, owner_key, deck_key, declared_at, deck_locked_at, source_season_key)
              VALUES (?, ?, ?, COALESCE((SELECT deck_key FROM drome_codemasters WHERE season_key = ? AND drome_id = ?), ''), ?, NULL, ?)
            `)
            .run(currentSeasonKey, dromeId, ownerKey, currentSeasonKey, dromeId, finalizedAt, previousSeasonKey);
        }
      });
    });
    sqliteDb
      .prepare(`
        INSERT INTO drome_season_rollups (season_key, next_season_key, finalized_at)
        VALUES (?, ?, ?)
      `)
      .run(previousSeasonKey, currentSeasonKey, finalizedAt);
    sqliteDb.exec("COMMIT");
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    console.error(`[DROMOS][SEASON] Falha ao finalizar temporada ${previousSeasonKey}: ${error?.message || error}`);
  }
}

function ensureDromeBaselineRow(ownerKeyRaw, dromeIdRaw, seasonKeyRaw = seasonKeyFromDate(new Date())) {
  if (!sqliteDb) {
    return;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const dromeId = normalizeDromeId(dromeIdRaw);
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!ownerKey || !dromeId || !seasonKey) {
    return;
  }
  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO ranked_drome_stats (season_key, drome_id, owner_key, score, wins, losses, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `)
    .run(seasonKey, dromeId, ownerKey, DROME_BASE_SCORE, nowIso());
}

function selectDromeForSeason(ownerKeyRaw, dromeIdRaw, nowDate = new Date()) {
  if (!sqliteDb) {
    return { ok: false, error: "Banco de dados indisponivel." };
  }
  ensureDromeSeasonCycle(nowDate);
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const dromeId = normalizeDromeId(dromeIdRaw);
  if (!ownerKey || !dromeId) {
    return { ok: false, error: "Dromo invalido." };
  }
  const seasonKey = seasonKeyFromDate(nowDate);
  const existing = getDromeSelectionForSeason(ownerKey, seasonKey);
  if (existing) {
    return {
      ok: false,
      error: "Dromo ja selecionado neste mes. A troca so e permitida no proximo ciclo mensal.",
      selection: existing,
    };
  }
  const lockedAt = nowIso();
  sqliteDb
    .prepare(`
      INSERT INTO ranked_drome_selection (season_key, owner_key, drome_id, locked_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(seasonKey, ownerKey, dromeId, lockedAt);
  ensureDromeBaselineRow(ownerKey, dromeId, seasonKey);
  const selection = getDromeSelectionForSeason(ownerKey, seasonKey);
  return { ok: true, selection };
}

function upsertGlobalRankDelta(ownerKeyRaw, result) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  if (!ownerKey) {
    return null;
  }
  const isWin = String(result || "").toLowerCase() === "win";
  const isLoss = String(result || "").toLowerCase() === "loss";
  const eloDelta = isWin ? 16 : isLoss ? -12 : 0;
  const winsDelta = isWin ? 1 : 0;
  const lossesDelta = isLoss ? 1 : 0;
  sqliteDb
    .prepare(`
      INSERT INTO ranked_global (owner_key, elo, wins, losses, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        elo = MAX(100, ranked_global.elo + excluded.elo - 1200),
        wins = ranked_global.wins + excluded.wins,
        losses = ranked_global.losses + excluded.losses,
        updated_at = excluded.updated_at
    `)
    .run(ownerKey, 1200 + eloDelta, winsDelta, lossesDelta, nowIso());
  const row = sqliteDb.prepare("SELECT owner_key, elo, wins, losses, updated_at FROM ranked_global WHERE owner_key = ?").get(ownerKey);
  const elo = Math.max(100, Number(row?.elo || 1200));
  sqliteDb
    .prepare(`
      INSERT INTO player_profiles (owner_key, created_at, updated_at, score)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        score = excluded.score,
        updated_at = excluded.updated_at
    `)
    .run(ownerKey, nowIso(), nowIso(), elo);
  return row;
}

function upsertDromeRankDelta(ownerKeyRaw, result, nowDate = new Date(), options = {}) {
  if (!sqliteDb) {
    return null;
  }
  ensureDromeSeasonCycle(nowDate);
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  if (!ownerKey) {
    return null;
  }
  const seasonKey = seasonKeyFromDate(nowDate);
  const selected = getDromeSelectionForSeason(ownerKey, seasonKey);
  if (!selected?.dromeId) {
    return null;
  }
  const forcedDromeId = normalizeDromeId(options?.forcedDromeId || "");
  if (forcedDromeId && forcedDromeId !== selected.dromeId) {
    return null;
  }
  ensureDromeBaselineRow(ownerKey, selected.dromeId, seasonKey);
  const isWin = String(result || "").toLowerCase() === "win";
  const isLoss = String(result || "").toLowerCase() === "loss";
  const defaultWin = Number(options?.winScore ?? DROME_RANKED_WIN_SCORE);
  const defaultLoss = Number(options?.lossScore ?? DROME_RANKED_LOSS_SCORE);
  const scoreDelta = isWin ? defaultWin : isLoss ? defaultLoss : 0;
  const winsDelta = isWin ? 1 : 0;
  const lossesDelta = isLoss ? 1 : 0;
  sqliteDb
    .prepare(`
      UPDATE ranked_drome_stats
      SET
        score = MAX(0, score + ?),
        wins = wins + ?,
        losses = losses + ?,
        updated_at = ?
      WHERE season_key = ? AND drome_id = ? AND owner_key = ?
    `)
    .run(scoreDelta, winsDelta, lossesDelta, nowIso(), seasonKey, selected.dromeId, ownerKey);

  const streakRow = sqliteDb
    .prepare(`
      SELECT current_streak, best_streak
      FROM ranked_drome_streaks
      WHERE season_key = ? AND drome_id = ? AND owner_key = ?
    `)
    .get(seasonKey, selected.dromeId, ownerKey);
  const prevCurrentStreak = Math.max(0, Number(streakRow?.current_streak || 0));
  const prevBestStreak = Math.max(0, Number(streakRow?.best_streak || 0));
  const nextCurrentStreak = isWin ? (prevCurrentStreak + 1) : isLoss ? 0 : prevCurrentStreak;
  const nextBestStreak = Math.max(prevBestStreak, nextCurrentStreak);
  sqliteDb
    .prepare(`
      INSERT INTO ranked_drome_streaks (season_key, drome_id, owner_key, current_streak, best_streak, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_key, drome_id, owner_key) DO UPDATE SET
        current_streak = excluded.current_streak,
        best_streak = excluded.best_streak,
        updated_at = excluded.updated_at
    `)
    .run(seasonKey, selected.dromeId, ownerKey, nextCurrentStreak, nextBestStreak, nowIso());
  return sqliteDb
    .prepare("SELECT season_key, drome_id, owner_key, score, wins, losses, updated_at FROM ranked_drome_stats WHERE season_key = ? AND drome_id = ? AND owner_key = ?")
    .get(seasonKey, selected.dromeId, ownerKey);
}

function dromeRankRowWithTitle(row, rank, dromeName) {
  const ownerKey = normalizeUserKey(row?.owner_key || "", "");
  const tribe = resolveFavoriteTribeFromUserRecord(ownerKey);
  return {
    rank,
    username: ownerKey,
    score: Math.max(0, Number(row?.score || 0)),
    wins: Math.max(0, Number(row?.wins || 0)),
    losses: Math.max(0, Number(row?.losses || 0)),
    title: titleForDromePlacement(rank, dromeName, tribe),
    favoriteTribe: tribe || "",
    updatedAt: String(row?.updated_at || ""),
  };
}

function getCurrentSeasonTagForOwner(ownerKeyRaw, seasonKeyRaw = seasonKeyFromDate(new Date())) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!ownerKey || !seasonKey) {
    return null;
  }
  const row = sqliteDb
    .prepare(`
      SELECT season_key, drome_id, owner_key, rank, title_text, tribe_key, source_season_key, granted_at
      FROM drome_season_titles
      WHERE season_key = ? AND owner_key = ?
      ORDER BY rank ASC
      LIMIT 1
    `)
    .get(seasonKey, ownerKey);
  if (!row) {
    return null;
  }
  return {
    seasonKey: String(row.season_key || seasonKey),
    dromeId: String(row.drome_id || ""),
    dromeName: dromeNameById(row.drome_id),
    rank: Number(row.rank || 0),
    title: String(row.title_text || ""),
    tribeKey: String(row.tribe_key || ""),
    sourceSeasonKey: String(row.source_season_key || ""),
    grantedAt: String(row.granted_at || ""),
  };
}

function getCurrentCodemasterByDrome(dromeIdRaw, seasonKeyRaw = seasonKeyFromDate(new Date())) {
  if (!sqliteDb) {
    return null;
  }
  const dromeId = normalizeDromeId(dromeIdRaw);
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!dromeId || !seasonKey) {
    return null;
  }
  const row = sqliteDb
    .prepare(`
      SELECT season_key, drome_id, owner_key, deck_key, declared_at, deck_locked_at, source_season_key
      FROM drome_codemasters
      WHERE season_key = ? AND drome_id = ?
      LIMIT 1
    `)
    .get(seasonKey, dromeId);
  if (!row) {
    return null;
  }
  const ownerKey = normalizeUserKey(row?.owner_key || "", "");
  const summary = getProfileSummaryByOwnerKey(ownerKey) || {};
  return {
    seasonKey: String(row.season_key || seasonKey),
    dromeId,
    dromeName: dromeNameById(dromeId),
    ownerKey,
    username: String(summary?.username || ownerKey),
    favoriteTribe: String(summary?.favoriteTribe || resolveFavoriteTribeFromUserRecord(ownerKey) || ""),
    deckKey: String(row?.deck_key || ""),
    deckLocked: Boolean(String(row?.deck_key || "").trim()),
    declaredAt: String(row?.declared_at || ""),
    deckLockedAt: row?.deck_locked_at ? String(row.deck_locked_at) : null,
    sourceSeasonKey: String(row?.source_season_key || ""),
  };
}

function isUserSessionOnline(ownerKeyRaw) {
  if (!sqliteDb) {
    return false;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return false;
  }
  const row = sqliteDb
    .prepare(`
      SELECT 1 AS ok
      FROM users
      WHERE lower(username) = ?
        AND session_token IS NOT NULL
        AND session_token != ''
        AND session_expires_at IS NOT NULL
        AND session_expires_at > ?
      LIMIT 1
    `)
    .get(ownerKey, nowIso());
  return Boolean(row?.ok);
}

function cleanupExpiredDromeChallengeInvites() {
  if (!sqliteDb) {
    return;
  }
  sqliteDb
    .prepare(`
      UPDATE drome_challenge_invites
      SET status = 'expired', updated_at = ?
      WHERE status = 'pending' AND expires_at <= ?
    `)
    .run(nowIso(), nowIso());
}

function getDromeStreak(ownerKeyRaw, dromeIdRaw, seasonKeyRaw = seasonKeyFromDate(new Date())) {
  if (!sqliteDb) {
    return { current: 0, best: 0 };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const dromeId = normalizeDromeId(dromeIdRaw);
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!ownerKey || !dromeId || !seasonKey) {
    return { current: 0, best: 0 };
  }
  const row = sqliteDb
    .prepare(`
      SELECT current_streak, best_streak
      FROM ranked_drome_streaks
      WHERE season_key = ? AND drome_id = ? AND owner_key = ?
      LIMIT 1
    `)
    .get(seasonKey, dromeId, ownerKey);
  return {
    current: Math.max(0, Number(row?.current_streak || 0)),
    best: Math.max(0, Number(row?.best_streak || 0)),
  };
}

function normalizeChallengeInviteRow(row, ownerKeyRaw) {
  if (!row) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const codemasterKey = normalizeUserKey(row?.codemaster_key || "", "");
  const challengerKey = normalizeUserKey(row?.challenger_key || "", "");
  const isIncoming = ownerKey === challengerKey;
  const roomId = String(row?.room_id || "");
  const room = roomId ? multiplayerRooms.get(roomId) : null;
  const roomPhase = room?.phase || "";
  const roomMatchType = normalizeMatchType(room?.matchType || "");
  const seatToken = isIncoming ? String(room?.players?.guest?.seatToken || "") : String(room?.players?.host?.seatToken || "");
  return {
    inviteId: String(row?.invite_id || ""),
    seasonKey: String(row?.season_key || ""),
    dromeId: String(row?.drome_id || ""),
    dromeName: dromeNameById(row?.drome_id),
    status: String(row?.status || "pending"),
    codemasterKey,
    challengerKey,
    codemasterUsername: String(getProfileSummaryByOwnerKey(codemasterKey)?.username || codemasterKey),
    challengerUsername: String(getProfileSummaryByOwnerKey(challengerKey)?.username || challengerKey),
    createdAt: String(row?.created_at || ""),
    updatedAt: String(row?.updated_at || ""),
    expiresAt: String(row?.expires_at || ""),
    expiresInMs: Math.max(0, Date.parse(String(row?.expires_at || "")) - Date.now()),
    room: roomId
      ? {
          roomId,
          phase: roomPhase || "unknown",
          matchType: roomMatchType || MATCH_TYPE_CODEMASTER_CHALLENGE,
          seatToken,
        }
      : null,
  };
}

function listDromeChallengeInvitesForOwner(ownerKeyRaw) {
  if (!sqliteDb) {
    return { incoming: [], outgoing: [] };
  }
  cleanupExpiredDromeChallengeInvites();
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return { incoming: [], outgoing: [] };
  }
  const rows = sqliteDb
    .prepare(`
      SELECT invite_id, season_key, drome_id, codemaster_key, challenger_key, status, room_id, created_at, updated_at, expires_at
      FROM drome_challenge_invites
      WHERE codemaster_key = ? OR challenger_key = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `)
    .all(ownerKey, ownerKey);
  const incoming = [];
  const outgoing = [];
  rows.forEach((row) => {
    const normalized = normalizeChallengeInviteRow(row, ownerKey);
    if (!normalized) {
      return;
    }
    if (normalizeUserKey(normalized.challengerKey, "") === ownerKey) {
      incoming.push(normalized);
    } else {
      outgoing.push(normalized);
    }
  });
  return { incoming, outgoing };
}

function grantCodemasterUltraRareReward({ codemasterKeyRaw, challengerKeyRaw, dromeIdRaw, seasonKeyRaw, roomIdRaw }) {
  if (!sqliteDb) {
    return { ok: false, error: "Banco SQL indisponivel." };
  }
  const codemasterKey = normalizeUserKey(codemasterKeyRaw, "");
  const challengerKey = normalizeUserKey(challengerKeyRaw, "");
  const dromeId = normalizeDromeId(dromeIdRaw);
  const seasonKey = String(seasonKeyRaw || seasonKeyFromDate(new Date()));
  const roomId = String(roomIdRaw || "").trim();
  if (!codemasterKey || !challengerKey || !dromeId || !roomId) {
    return { ok: false, error: "Parametros de recompensa invalidos." };
  }
  const existingOutcome = sqliteDb
    .prepare("SELECT reward_granted_at FROM drome_challenge_outcomes WHERE room_id = ? LIMIT 1")
    .get(roomId);
  if (existingOutcome?.reward_granted_at) {
    return { ok: true, alreadyGranted: true };
  }
  const sourceRows = sqliteDb
    .prepare(`
      SELECT scan_entry_id, card_type, card_id, variant_json, obtained_at
      FROM scan_entries
      WHERE owner_key = ?
      ORDER BY RANDOM()
      LIMIT 200
    `)
    .all(codemasterKey);
  if (!sourceRows.length) {
    return { ok: false, error: "CodeMaster sem scans disponiveis para premio." };
  }
  const selected = sourceRows[Math.floor(Math.random() * sourceRows.length)];
  const grantedAt = nowIso();
  const rewardScanEntryId = generateScanEntryId();
  let variantJson = null;
  if (String(selected?.card_type || "") === "creatures") {
    const baseVariant = normalizeCreatureVariant(parseJsonText(selected?.variant_json, null)) || {};
    variantJson = JSON.stringify({
      ...baseVariant,
      ultraRareReward: true,
      codemasterSource: codemasterKey,
      challengeRoomId: roomId,
    });
  }
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    sqliteDb
      .prepare(`
        INSERT INTO scan_entries (scan_entry_id, owner_key, card_type, card_id, variant_json, obtained_at, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        rewardScanEntryId,
        challengerKey,
        String(selected?.card_type || ""),
        String(selected?.card_id || ""),
        variantJson,
        grantedAt,
        "codemaster_ultrarare_reward",
        grantedAt
      );
    sqliteDb
      .prepare(`
        INSERT INTO drome_challenge_outcomes
          (room_id, season_key, drome_id, codemaster_key, challenger_key, winner_key, loser_key, reward_granted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          winner_key = excluded.winner_key,
          loser_key = excluded.loser_key,
          reward_granted_at = COALESCE(drome_challenge_outcomes.reward_granted_at, excluded.reward_granted_at),
          updated_at = excluded.updated_at
      `)
      .run(roomId, seasonKey, dromeId, codemasterKey, challengerKey, challengerKey, codemasterKey, grantedAt, grantedAt);
    sqliteDb.exec("COMMIT");
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    return { ok: false, error: error?.message || "Falha ao conceder premio ultrararo." };
  }
  invalidateUserCaches(challengerKey);
  createProfileNotification(
    challengerKey,
    "codemaster_reward",
    "Premio de desafio CodeMaster",
    `Voce venceu um CodeMaster e recebeu uma copia ultrarara: ${String(selected?.card_id || "carta")}!`,
    {
      dromeId,
      roomId,
      sourceCodemaster: codemasterKey,
      rewardScanEntryId,
      cardType: String(selected?.card_type || ""),
      cardId: String(selected?.card_id || ""),
    }
  );
  createProfileNotification(
    codemasterKey,
    "codemaster_defeat",
    "Derrota em desafio CodeMaster",
    `Voce perdeu o desafio e ${challengerKey} recebeu uma copia ultrarara do seu catalogo de scans.`,
    { dromeId, roomId, challengerKey }
  );
  return {
    ok: true,
    reward: {
      scanEntryId: rewardScanEntryId,
      cardType: String(selected?.card_type || ""),
      cardId: String(selected?.card_id || ""),
      source: "codemaster_ultrarare_reward",
    },
  };
}

function resolveFavoriteTribeFromUserRecord(usernameRaw) {
  if (!sqliteDb) {
    return "";
  }
  const username = normalizeUserKey(usernameRaw);
  if (!username) {
    return "";
  }
  try {
    const row = sqliteDb
      .prepare("SELECT tribe FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
      .get(username);
    return String(row?.tribe || "").trim();
  } catch {
    return "";
  }
}

function createEmptyScansByType() {
  return {
    creatures: 0,
    attacks: 0,
    battlegear: 0,
    locations: 0,
    mugic: 0,
  };
}

function aggregateProfileScans(ownerKeyRaw, fallbackCards = null) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const fallbackStats = countBucketCards(fallbackCards || createEmptyCardBuckets());
  if (!ownerKey || !sqliteDb) {
    return {
      total: Math.max(0, Number(fallbackStats.total || 0)),
      byType: { ...createEmptyScansByType(), ...(fallbackStats.counts || {}) },
    };
  }
  const byType = createEmptyScansByType();
  let total = 0;

  const addRowCount = (rawType, rawTotal) => {
    const type = String(rawType || "").trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(byType, type)) {
      return;
    }
    const amount = Math.max(0, Number(rawTotal || 0));
    byType[type] += amount;
  };

  const inventoryRows = sqliteDb
    .prepare(`
      SELECT lower(card_type) AS card_type, COUNT(*) AS total
      FROM scan_entries
      WHERE owner_key = ?
      GROUP BY lower(card_type)
    `)
    .all(ownerKey);
  inventoryRows.forEach((row) => addRowCount(row?.card_type, row?.total));

  const deckRows = sqliteDb
    .prepare(`
      SELECT
        lower(dc.card_type) AS card_type,
        COUNT(*) AS total
      FROM deck_cards dc
      LEFT JOIN deck_headers dh
        ON dh.deck_key = dc.deck_key
      WHERE lower(COALESCE(NULLIF(dh.owner_key, ''), NULLIF(dc.owner_key_shadow, ''))) = ?
      GROUP BY lower(dc.card_type)
    `)
    .all(ownerKey);
  deckRows.forEach((row) => addRowCount(row?.card_type, row?.total));

  Object.values(byType).forEach((value) => {
    total += Math.max(0, Number(value || 0));
  });
  return {
    total,
    byType,
  };
}

function buildProfilePayload(usernameRaw) {
  ensureDromeSeasonCycle(new Date());
  const profilesState = loadProfilesData();
  const { key, profile } = getOrCreateProfile(profilesState, usernameRaw);
  const recordTribe = resolveFavoriteTribeFromUserRecord(key);
  if (!profile.favoriteTribe && recordTribe) {
    profile.favoriteTribe = recordTribe;
    profile.updatedAt = nowIso();
    writeProfilesData(profilesState, "profile_tribe_sync");
  }
  const scans = loadScansData();
  const starterResult = applyStarterPackIfEligible(key, profile, scans, profile.favoriteTribe || recordTribe);
  if (starterResult.profileChanged) {
    writeProfilesData(profilesState, "profile_bootstrap");
  }
  if (starterResult.scansChanged) {
    writeScansData(scans, "profile_starter_pack_autogrant");
  }
  const { cards } = getScansCardsForUser(scans, key, true);
  if (!starterResult.scansChanged) {
    writeScansData(scans, "profile_scans_bootstrap");
  }
  if (!starterResult.profileChanged) {
    writeProfilesData(profilesState, "profile_bootstrap");
  }
  const scansStats = aggregateProfileScans(key, cards);
  const rankedGlobalRow = sqliteDb
    ? sqliteDb.prepare("SELECT elo FROM ranked_global WHERE owner_key = ? LIMIT 1").get(key)
    : null;
  const unifiedScore = Math.max(0, Number(rankedGlobalRow?.elo || profile.score || 1200));
  const currentSeasonKey = seasonKeyFromDate(new Date());
  const currentDromeSelection = getDromeSelectionForSeason(key, currentSeasonKey);
  const currentTag = getCurrentSeasonTagForOwner(key, currentSeasonKey);
  const fallbackTag = currentTag?.title ? "" : buildFallbackDromeTag(key, currentSeasonKey);
  const currentTagTitle = String(currentTag?.title || fallbackTag || "");
  return {
    username: key,
    favoriteTribe: profile.favoriteTribe || "",
    avatar: profile.avatar || "",
    score: unifiedScore,
    wins: Number(profile.wins || 0),
    losses: Number(profile.losses || 0),
    winRate: Number(profile.winRate || 0),
    totalBattles: Number(profile.wins || 0) + Number(profile.losses || 0),
    scans: {
      total: scansStats.total,
      byType: scansStats.byType,
    },
    scanners: SCANNER_KEYS.reduce((acc, key) => {
      acc[key] = scannerProgressPayload(profile?.scanners?.[key]);
      return acc;
    }, {}),
    mostPlayedCreature: profile.mostPlayedCreature || null,
    seasonRewards: listSeasonRewards(key, currentSeasonKey),
    currentDrome: currentDromeSelection
      ? {
          id: currentDromeSelection.dromeId,
          name: currentDromeSelection.dromeName || dromeNameById(currentDromeSelection.dromeId),
          lockedAt: currentDromeSelection.lockedAt || "",
        }
      : null,
    currentTagTitle,
    currentTag: currentTag || null,
    battleHistory: Array.isArray(profile.battleHistory) ? profile.battleHistory.slice(-PROFILE_HISTORY_LIMIT).reverse() : [],
    updatedAt: profile.updatedAt || nowIso(),
  };
}

function buildProfileQuestsPayload(usernameRaw) {
  const ownerKey = normalizeUserKey(usernameRaw, "");
  if (!ownerKey || !isSqlV2Ready()) {
    return {
      quests: [],
      counts: { active: 0, readyToRedeem: 0, reserved: 0, granted: 0 },
      updatedAt: nowIso(),
    };
  }
  ensurePerimQuestTemplatesSeed();
  const scans = loadScansData();
  const { cards } = getScansCardsForUser(scans, ownerKey, true);
  const questsRaw = computePerimQuestProgress(ownerKey, cards);
  const quests = questsRaw.map((quest) => ({
    questKey: quest.questKey,
    title: quest.title,
    description: quest.description,
    status: quest.status,
    assignedAt: quest.assignedAt,
    updatedAt: quest.updatedAt,
    grantedAt: quest.grantedAt,
    reward: quest.reward,
    targetLocation: quest.targetLocation,
    requirements: quest.requirements,
    readyByInventory: Boolean(quest.readyByInventory),
  }));
  const counts = {
    active: quests.filter((quest) => quest.status === "active").length,
    readyToRedeem: quests.filter((quest) => quest.status === "ready_to_redeem").length,
    reserved: quests.filter((quest) => quest.status === "reward_reserved").length,
    granted: quests.filter((quest) => quest.status === "reward_granted").length,
  };
  return {
    quests,
    counts,
    updatedAt: nowIso(),
  };
}

function normalizeStarterTribe(rawValue) {
  const token = String(rawValue || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!token) return "";
  if (token.includes("outromundo") || token.includes("overworld")) return "overworld";
  if (token.includes("submundo") || token.includes("underworld")) return "underworld";
  if (token.includes("mipedian") || token.includes("maipidian")) return "mipedian";
  if (token.includes("danian")) return "danian";
  return "";
}

function starterPackConfigByTribe(tribeKey) {
  const normalized = normalizeStarterTribe(tribeKey);
  if (normalized === "overworld") {
    return { tribe: "OverWorld", locationName: "Kiru City" };
  }
  if (normalized === "underworld") {
    return { tribe: "UnderWorld", locationName: "UnderWorld City" };
  }
  if (normalized === "mipedian") {
    return { tribe: "Mipedian", locationName: "Mipedim Oasis" };
  }
  if (normalized === "danian") {
    return { tribe: "Danian", locationName: "Mount Pillar" };
  }
  return null;
}

function isDropEligibleCard(card) {
  const nameLower = String(card?.name || "").toLowerCase();
  const cardId = String(card?.id || "").trim();
  if (!cardId) {
    return false;
  }
  if (!isPlayerCardSetAllowedByCardId(cardId)) {
    return false;
  }
  return !nameLower.includes("unused") && !nameLower.includes("alpha");
}

function pickEligibleCardWithCap(cards, currentCounts, maxAttempts = 64) {
  if (!Array.isArray(cards) || !cards.length) {
    return null;
  }
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    const picked = cards[Math.floor(Math.random() * cards.length)];
    if (!picked?.id) {
      continue;
    }
    const cardId = String(picked.id);
    const currentAmount = currentCounts.get(cardId) || 0;
    if (currentAmount >= INVENTORY_MAX_COPIES) {
      continue;
    }
    return picked;
  }
  return null;
}

function applyStarterPackIfEligible(usernameKey, profile, scansData, favoriteTribeInput = "") {
  const result = {
    applied: false,
    reason: "",
    items: {
      locations: [],
      creatures: [],
      battlegear: [],
      mugic: [],
    },
    profileChanged: false,
    scansChanged: false,
  };
  if (!profile || typeof profile !== "object") {
    result.reason = "invalid_profile";
    return result;
  }
  if (profile.starterPackGrantedAt) {
    result.reason = "already_granted";
    return result;
  }
  const starterConfig = starterPackConfigByTribe(favoriteTribeInput || profile.favoriteTribe);
  if (!starterConfig) {
    result.reason = "invalid_tribe";
    return result;
  }

  const { key: ownerKey, cards: currentCards } = getScansCardsForUser(scansData, usernameKey, true);
  const byType = {
    locations: Array.isArray(library?.cardsByType?.locations) ? library.cardsByType.locations : [],
    creatures: Array.isArray(library?.cardsByType?.creatures) ? library.cardsByType.creatures : [],
    battlegear: Array.isArray(library?.cardsByType?.battlegear) ? library.cardsByType.battlegear : [],
    mugic: Array.isArray(library?.cardsByType?.mugic) ? library.cardsByType.mugic : [],
  };
  const locationCard = byType.locations.find(
    (card) => isDropEligibleCard(card) && normalizePerimText(card?.name || "") === normalizePerimText(starterConfig.locationName)
  ) || null;
  const creaturePool = byType.creatures.filter(
    (card) => isDropEligibleCard(card) && normalizePerimText(card?.tribe || "") === normalizePerimText(starterConfig.tribe)
  );
  const mugicPool = byType.mugic.filter(
    (card) => isDropEligibleCard(card) && normalizePerimText(card?.tribe || "") === normalizePerimText(starterConfig.tribe)
  );
  const battlegearPool = byType.battlegear.filter((card) => isDropEligibleCard(card));

  const nextCards = cloneCardBuckets(currentCards);
  const locationCounts = countCardEntriesByType(nextCards.locations, "locations");
  const creatureCounts = countCardEntriesByType(nextCards.creatures, "creatures");
  const battlegearCounts = countCardEntriesByType(nextCards.battlegear, "battlegear");
  const mugicCounts = countCardEntriesByType(nextCards.mugic, "mugic");

  const addSimpleCard = (bucketName, countsMap, card, grantList) => {
    if (!card?.id) {
      return false;
    }
    const cardId = String(card.id);
    const currentAmount = countsMap.get(cardId) || 0;
    if (currentAmount >= INVENTORY_MAX_COPIES) {
      return false;
    }
    nextCards[bucketName].push(cardId);
    countsMap.set(cardId, currentAmount + 1);
    grantList.push({ cardId, name: card.name, image: card.image || "" });
    return true;
  };

  const addCreatureCard = (card) => {
    if (!card?.id) {
      return false;
    }
    const cardId = String(card.id);
    const currentAmount = creatureCounts.get(cardId) || 0;
    if (currentAmount >= INVENTORY_MAX_COPIES) {
      return false;
    }
    const variant = buildCreatureScanVariant();
    nextCards.creatures.push({
      cardId,
      scanEntryId: generateScanEntryId(),
      variant,
      source: "starter_pack",
      obtainedAt: nowIso(),
    });
    creatureCounts.set(cardId, currentAmount + 1);
    result.items.creatures.push({
      cardId,
      name: `${card.name} (${creatureVariantBadge(variant)})`,
      baseName: card.name,
      image: card.image || "",
      variant,
    });
    return true;
  };

  let anyGranted = false;
  if (locationCard && addSimpleCard("locations", locationCounts, locationCard, result.items.locations)) {
    anyGranted = true;
  }
  const pickedCreature = pickEligibleCardWithCap(creaturePool, creatureCounts);
  if (pickedCreature && addCreatureCard(pickedCreature)) {
    anyGranted = true;
  }
  const pickedGear = pickEligibleCardWithCap(battlegearPool, battlegearCounts);
  if (pickedGear && addSimpleCard("battlegear", battlegearCounts, pickedGear, result.items.battlegear)) {
    anyGranted = true;
  }
  const pickedMugic = pickEligibleCardWithCap(mugicPool, mugicCounts);
  if (pickedMugic && addSimpleCard("mugic", mugicCounts, pickedMugic, result.items.mugic)) {
    anyGranted = true;
  }

  if (!anyGranted) {
    result.reason = "no_eligible_cards";
    console.log(
      `[PROFILE][STARTER] user=${ownerKey} tribe="${starterConfig.tribe}" applied=false reason=no_eligible_cards`
    );
    return result;
  }

  scansData.players[ownerKey] = { cards: trimCardsToInventoryCap(nextCards, INVENTORY_MAX_COPIES) };
  profile.starterPackGrantedAt = nowIso();
  profile.starterPackTribe = starterConfig.tribe;
  profile.updatedAt = nowIso();

  result.applied = true;
  result.reason = "applied";
  result.profileChanged = true;
  result.scansChanged = true;

  console.log(
    `[PROFILE][STARTER] user=${ownerKey} tribeInput="${favoriteTribeInput}" starterTribe="${starterConfig.tribe}" applied=true loc=${result.items.locations.length} creature=${result.items.creatures.length} gear=${result.items.battlegear.length} mugic=${result.items.mugic.length}`
  );
  return result;
}

function resolveAvatarForUsername(usernameRaw) {
  const key = normalizeUserKey(usernameRaw);
  if (!key) {
    return "";
  }
  const profilesState = loadProfilesData();
  const { profile } = getOrCreateProfile(profilesState, key);
  return String(profile?.avatar || "");
}

function createProfileNotification(ownerKeyRaw, typeRaw, titleRaw, messageRaw, payload = null) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return null;
  }
  const type = String(typeRaw || "info").trim().slice(0, 80) || "info";
  const title = String(titleRaw || "").trim().slice(0, 140);
  const message = String(messageRaw || "").trim().slice(0, 500);
  if (!title || !message) {
    return null;
  }
  const createdAt = nowIso();
  const payloadJson = payload && typeof payload === "object" ? JSON.stringify(payload) : null;
  const result = sqliteDb.prepare(`
    INSERT INTO profile_notifications (owner_key, type, title, message, payload_json, is_read, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
  `).run(ownerKey, type, title, message, payloadJson, createdAt);
  return Number(result?.lastInsertRowid || 0) || null;
}

function normalizeFriendProfileSummaryRow(row) {
  if (!row) {
    return null;
  }
  const wins = Math.max(0, Number(row.wins || 0));
  const losses = Math.max(0, Number(row.losses || 0));
  const total = wins + losses;
  const winRateRaw = Number(row.win_rate);
  const winRate = Number.isFinite(winRateRaw)
    ? Math.max(0, Math.min(100, winRateRaw))
    : (total > 0 ? Math.round((wins / total) * 10000) / 100 : 0);
  return {
    username: String(row.username || ""),
    ownerKey: normalizeUserKey(row.owner_key || row.username || "", ""),
    avatar: String(row.avatar || ""),
    score: Math.max(0, Number(row.score || 0)),
    wins,
    losses,
    winRate,
    favoriteTribe: String(row.favorite_tribe || row.tribe || ""),
    updatedAt: String(row.updated_at || ""),
    addedAt: String(row.created_at || ""),
  };
}

function getProfileSummaryByOwnerKey(ownerKeyRaw) {
  if (!sqliteDb) {
    return null;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return null;
  }
  const row = sqliteDb.prepare(`
    SELECT
      u.username AS username,
      ? AS owner_key,
      COALESCE(p.avatar, '') AS avatar,
      COALESCE(rg.elo, p.score, 1200) AS score,
      COALESCE(p.wins, 0) AS wins,
      COALESCE(p.losses, 0) AS losses,
      COALESCE(p.win_rate, 0) AS win_rate,
      COALESCE(p.favorite_tribe, u.tribe, '') AS favorite_tribe,
      COALESCE(p.updated_at, u.updated_at, u.created_at, '') AS updated_at
    FROM users u
    LEFT JOIN player_profiles p ON p.owner_key = lower(u.username)
    LEFT JOIN ranked_global rg ON rg.owner_key = lower(u.username)
    WHERE lower(u.username) = ?
    LIMIT 1
  `).get(ownerKey, ownerKey);
  if (!row) {
    return null;
  }
  return normalizeFriendProfileSummaryRow(row);
}

function getProfileSummaryByUsername(usernameRaw) {
  if (!sqliteDb) {
    return null;
  }
  const username = String(usernameRaw || "").trim();
  if (!username) {
    return null;
  }
  const userRow = sqliteDb.prepare("SELECT username, verified FROM users WHERE username = ? COLLATE NOCASE LIMIT 1").get(username);
  if (!userRow?.username || Number(userRow?.verified || 0) !== 1) {
    return null;
  }
  const ownerKey = normalizeUserKey(userRow.username, "");
  return getProfileSummaryByOwnerKey(ownerKey);
}

function listFriendSummaries(ownerKeyRaw) {
  if (!sqliteDb) {
    return [];
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return [];
  }
  const rows = sqliteDb.prepare(`
    SELECT
      f.friend_key AS owner_key,
      f.created_at AS created_at,
      u.username AS username,
      u.tribe AS tribe,
      p.avatar AS avatar,
      COALESCE(rg.elo, p.score, 1200) AS score,
      p.wins AS wins,
      p.losses AS losses,
      p.win_rate AS win_rate,
      p.favorite_tribe AS favorite_tribe,
      p.updated_at AS updated_at
    FROM friends f
    LEFT JOIN users u ON lower(u.username) = f.friend_key
    LEFT JOIN player_profiles p ON p.owner_key = f.friend_key
    LEFT JOIN ranked_global rg ON rg.owner_key = f.friend_key
    WHERE f.owner_key = ?
    ORDER BY datetime(f.created_at) DESC, f.friend_key ASC
  `).all(ownerKey);
  return rows
    .map((row) => normalizeFriendProfileSummaryRow(row))
    .filter(Boolean);
}

function listTopPlayers(metricRaw = "score", limitRaw = 50) {
  if (!sqliteDb) {
    return [];
  }
  const metric = String(metricRaw || "").trim().toLowerCase() === "scans" ? "scans" : "score";
  const limit = Math.max(1, Math.min(100, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50));
  const seasonKey = seasonKeyFromDate(new Date());
  const rows = sqliteDb
    .prepare(`
      SELECT
        lower(u.username) AS owner_key,
        u.username AS username,
        COALESCE(p.avatar, '') AS avatar,
        COALESCE(rg.elo, p.score, 1200) AS score,
        COALESCE(scans.total_scans, 0) AS total_scans,
        sel.drome_id AS drome_id
      FROM users u
      LEFT JOIN player_profiles p
        ON p.owner_key = lower(u.username)
      LEFT JOIN ranked_global rg
        ON rg.owner_key = lower(u.username)
      LEFT JOIN (
        SELECT owner_key, SUM(total_cards) AS total_scans
        FROM (
          SELECT lower(owner_key) AS owner_key, COUNT(*) AS total_cards
          FROM scan_entries
          GROUP BY lower(owner_key)
          UNION ALL
          SELECT
            lower(COALESCE(NULLIF(dh.owner_key, ''), NULLIF(dc.owner_key_shadow, ''))) AS owner_key,
            COUNT(*) AS total_cards
          FROM deck_cards dc
          LEFT JOIN deck_headers dh
            ON dh.deck_key = dc.deck_key
          GROUP BY lower(COALESCE(NULLIF(dh.owner_key, ''), NULLIF(dc.owner_key_shadow, '')))
        ) scan_totals
        WHERE owner_key IS NOT NULL AND owner_key != ''
        GROUP BY owner_key
      ) scans ON scans.owner_key = lower(u.username)
      LEFT JOIN ranked_drome_selection sel
        ON sel.owner_key = lower(u.username) AND sel.season_key = ?
      WHERE COALESCE(u.verified, 0) = 1
      ORDER BY
        CASE WHEN ? = 'scans' THEN COALESCE(scans.total_scans, 0) ELSE COALESCE(rg.elo, p.score, 1200) END DESC,
        lower(u.username) ASC
      LIMIT ?
    `)
    .all(seasonKey, metric, limit);
  return rows.map((row, index) => ({
    rank: index + 1,
    username: String(row?.username || row?.owner_key || ""),
    ownerKey: normalizeUserKey(row?.owner_key || "", ""),
    avatar: String(row?.avatar || ""),
    score: Math.max(0, Number(row?.score || 0)),
    totalScans: Math.max(0, Number(row?.total_scans || 0)),
    currentDrome: {
      id: normalizeDromeId(row?.drome_id || ""),
      name: dromeNameById(row?.drome_id || ""),
    },
  }));
}

function listFriendRequests(ownerKeyRaw) {
  if (!sqliteDb) {
    return { incoming: [], outgoing: [] };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return { incoming: [], outgoing: [] };
  }
  const incomingRows = sqliteDb.prepare(`
    SELECT fr.id, fr.from_owner_key, fr.to_owner_key, fr.status, fr.created_at, fr.updated_at,
           u.username AS from_username
    FROM friend_requests fr
    LEFT JOIN users u ON lower(u.username) = fr.from_owner_key
    WHERE fr.to_owner_key = ? AND fr.status = 'pending'
    ORDER BY fr.id DESC
  `).all(ownerKey);
  const outgoingRows = sqliteDb.prepare(`
    SELECT fr.id, fr.from_owner_key, fr.to_owner_key, fr.status, fr.created_at, fr.updated_at,
           u.username AS to_username
    FROM friend_requests fr
    LEFT JOIN users u ON lower(u.username) = fr.to_owner_key
    WHERE fr.from_owner_key = ? AND fr.status = 'pending'
    ORDER BY fr.id DESC
  `).all(ownerKey);
  return {
    incoming: incomingRows.map((row) => ({
      requestId: Number(row?.id || 0),
      fromOwnerKey: String(row?.from_owner_key || ""),
      fromUsername: String(row?.from_username || row?.from_owner_key || ""),
      createdAt: String(row?.created_at || ""),
    })),
    outgoing: outgoingRows.map((row) => ({
      requestId: Number(row?.id || 0),
      toOwnerKey: String(row?.to_owner_key || ""),
      toUsername: String(row?.to_username || row?.to_owner_key || ""),
      createdAt: String(row?.created_at || ""),
    })),
  };
}

function listProfileNotifications(ownerKeyRaw, limitRaw = 50) {
  if (!sqliteDb) {
    return { entries: [], unreadCount: 0 };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return { entries: [], unreadCount: 0 };
  }
  const limit = Math.max(1, Math.min(200, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50));
  const rows = sqliteDb.prepare(`
    SELECT id, type, title, message, payload_json, is_read, created_at, read_at
    FROM profile_notifications
    WHERE owner_key = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(ownerKey, limit);
  const unreadRow = sqliteDb.prepare(`
    SELECT COUNT(*) AS total
    FROM profile_notifications
    WHERE owner_key = ? AND is_read = 0
  `).get(ownerKey);
  return {
    entries: rows.map((row) => ({
      id: Number(row?.id || 0),
      type: String(row?.type || ""),
      title: String(row?.title || ""),
      message: String(row?.message || ""),
      payload: safeJsonParse(row?.payload_json, null),
      isRead: Number(row?.is_read || 0) === 1,
      createdAt: String(row?.created_at || ""),
      readAt: row?.read_at ? String(row.read_at) : null,
    })),
    unreadCount: Math.max(0, Number(unreadRow?.total || 0)),
  };
}

async function getBattleEngine() {
  if (!engineModulePromise) {
    engineModulePromise = import(pathToFileURL(ENGINE_FILE).href);
  }
  return engineModulePromise;
}

function encodeRichValue(value) {
  if (value instanceof Set) {
    return { __chaoticType: "Set", values: [...value].map((entry) => encodeRichValue(entry)) };
  }
  if (value instanceof Map) {
    return {
      __chaoticType: "Map",
      entries: [...value.entries()].map(([key, entryValue]) => [encodeRichValue(key), encodeRichValue(entryValue)]),
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encodeRichValue(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = encodeRichValue(value[key]);
    });
    return out;
  }
  return value;
}

function decodeRichValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => decodeRichValue(entry));
  }
  if (value.__chaoticType === "Set" && Array.isArray(value.values)) {
    return new Set(value.values.map((entry) => decodeRichValue(entry)));
  }
  if (value.__chaoticType === "Map" && Array.isArray(value.entries)) {
    return new Map(value.entries.map(([key, entryValue]) => [decodeRichValue(key), decodeRichValue(entryValue)]));
  }
  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = decodeRichValue(value[key]);
  });
  return out;
}

let tradeCardMetaCache = { versionToken: "", map: new Map() };

function getTradeCardMetaMap() {
  const cards = Array.isArray(library?.cards) ? library.cards : [];
  const versionToken = `${cards.length}:${library?.generatedAt || ""}`;
  if (tradeCardMetaCache.versionToken === versionToken) {
    return tradeCardMetaCache.map;
  }
  const map = new Map();
  cards.forEach((card) => {
    const cardId = String(card?.id || "").trim();
    if (!cardId) {
      return;
    }
    map.set(cardId, {
      name: String(card?.name || cardId),
      rarity: String(card?.rarity || "Unknown"),
      set: String(card?.set || "Unknown"),
      tribe: String(card?.tribe || ""),
      image: String(card?.image || ""),
    });
  });
  tradeCardMetaCache = { versionToken, map };
  return map;
}

function mapTradeEntryRow(row) {
  const cardId = String(row?.card_id || "").trim();
  const cardType = String(row?.card_type || "").trim();
  const metadata = getTradeCardMetaMap().get(cardId) || {};
  const variant = normalizeCreatureVariant(parseJsonText(row?.variant_json, null));
  return {
    scanEntryId: String(row?.scan_entry_id || ""),
    ownerKey: normalizeUserKey(row?.owner_key),
    cardType,
    cardId,
    cardName: String(metadata?.name || cardId),
    rarity: String(metadata?.rarity || "Unknown"),
    set: String(metadata?.set || "Unknown"),
    tribe: String(metadata?.tribe || ""),
    image: String(metadata?.image || ""),
    variant: variant || null,
    obtainedAt: row?.obtained_at ? String(row.obtained_at) : null,
  };
}

function fetchTradeInventoryEntries(ownerKeyRaw) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const rows = sqliteDb
    .prepare(`
      SELECT scan_entry_id, owner_key, card_type, card_id, variant_json, obtained_at
      FROM scan_entries
      WHERE owner_key = ?
      ORDER BY card_type ASC, rowid ASC
    `)
    .all(ownerKey);
  return rows.map((row) => mapTradeEntryRow(row));
}

function fetchTradeEntriesByIds(scanEntryIds) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const ids = Array.isArray(scanEntryIds)
    ? scanEntryIds.map((entryId) => String(entryId || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(", ");
  const rows = sqliteDb
    .prepare(`
      SELECT scan_entry_id, owner_key, card_type, card_id, variant_json, obtained_at
      FROM scan_entries
      WHERE scan_entry_id IN (${placeholders})
    `)
    .all(...ids);
  const byId = new Map();
  rows.forEach((row) => {
    const mapped = mapTradeEntryRow(row);
    if (mapped.scanEntryId) {
      byId.set(mapped.scanEntryId, mapped);
    }
  });
  return ids
    .map((entryId) => byId.get(entryId))
    .filter(Boolean);
}

function normalizeTradeWishlistEntries(rawEntries) {
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  const seen = new Set();
  const normalized = [];
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }
    const cardType = String(rawEntry.cardType || rawEntry.type || "").trim().toLowerCase();
    const cardId = String(rawEntry.cardId || rawEntry.id || "").trim();
    if (!cardType || !cardId) {
      continue;
    }
    const dedupeKey = `${cardType}:${cardId}`.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({
      cardType,
      cardId,
      note: String(rawEntry.note || "").trim().slice(0, 120),
      priority: Math.max(1, Math.min(5, Number(rawEntry.priority || 3))),
    });
    if (normalized.length >= 200) {
      break;
    }
  }
  return normalized;
}

function readTradeWishlist(ownerKeyRaw) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const rows = sqliteDb
    .prepare(`
      SELECT card_type, card_id, note, priority, updated_at
      FROM trade_wishlist
      WHERE owner_key = ?
      ORDER BY priority DESC, updated_at DESC, id DESC
    `)
    .all(ownerKey);
  return rows.map((row) => ({
    cardType: String(row?.card_type || ""),
    cardId: String(row?.card_id || ""),
    note: String(row?.note || ""),
    priority: Math.max(1, Math.min(5, Number(row?.priority || 3))),
    updatedAt: String(row?.updated_at || ""),
  }));
}

function writeTradeWishlist(ownerKeyRaw, entriesRaw) {
  if (!isSqlV2Ready()) {
    return { ok: false, error: "Trocas indisponiveis: banco SQL ainda nao inicializado." };
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const entries = normalizeTradeWishlistEntries(entriesRaw);
  const updatedAt = nowIso();
  const tx = sqliteDb.transaction(() => {
    sqliteDb.prepare("DELETE FROM trade_wishlist WHERE owner_key = ?").run(ownerKey);
    if (!entries.length) {
      return;
    }
    const insertStmt = sqliteDb.prepare(`
      INSERT INTO trade_wishlist (owner_key, card_type, card_id, note, priority, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    entries.forEach((entry) => {
      insertStmt.run(ownerKey, entry.cardType, entry.cardId, entry.note, entry.priority, updatedAt);
    });
  });
  tx();
  return { ok: true, entries };
}

function listTradeOnlinePlayersForRequester(ownerKeyRaw) {
  if (!isSqlV2Ready()) {
    return [];
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw);
  const now = nowIso();
  const rows = sqliteDb
    .prepare(`
      SELECT username, tribe, session_expires_at
      FROM users
      WHERE session_token IS NOT NULL
        AND session_token != ''
        AND session_expires_at IS NOT NULL
        AND session_expires_at > ?
      ORDER BY username ASC
    `)
    .all(now);
  const scoreStmt = sqliteDb.prepare(`
    SELECT COALESCE(rg.elo, p.score, 1200) AS score
    FROM users u
    LEFT JOIN player_profiles p ON p.owner_key = lower(u.username)
    LEFT JOIN ranked_global rg ON rg.owner_key = lower(u.username)
    WHERE lower(u.username) = ?
    LIMIT 1
  `);
  return rows
    .map((row) => {
      const username = normalizeUserKey(row?.username || "");
      if (!username || username === ownerKey) {
        return null;
      }
      const scoreRow = scoreStmt.get(username) || {};
      return {
        username,
        tribe: String(row?.tribe || ""),
        score: Math.max(0, Number(scoreRow?.score || 0)),
        sessionExpiresAt: String(row?.session_expires_at || ""),
      };
    })
    .filter(Boolean);
}

function isUserOnlineForTrades(ownerKeyRaw) {
  if (!isSqlV2Ready()) {
    return false;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return false;
  }
  const now = nowIso();
  const row = sqliteDb
    .prepare(`
      SELECT 1
      FROM users
      WHERE lower(username) = ?
        AND session_token IS NOT NULL
        AND session_token != ''
        AND session_expires_at IS NOT NULL
        AND session_expires_at > ?
      LIMIT 1
    `)
    .get(ownerKey, now);
  return Boolean(row);
}

function isPlayerInActiveTrade(ownerKeyRaw, options = {}) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return false;
  }
  const ignoreRoomCode = String(options?.ignoreRoomCode || "").trim().toUpperCase();
  for (const room of tradeRooms.values()) {
    if (!room || room.status === "completed" || room.status === "cancelled") {
      continue;
    }
    if (ignoreRoomCode && String(room.code || "").toUpperCase() === ignoreRoomCode) {
      continue;
    }
    const hostKey = normalizeUserKey(room.host?.username, "");
    const guestKey = normalizeUserKey(room.guest?.username, "");
    if (hostKey === ownerKey || guestKey === ownerKey) {
      return true;
    }
  }
  return false;
}

function createTradeRoomForHost(usernameRaw, displayNameRaw, options = {}) {
  const username = normalizeUserKey(usernameRaw || "local-player");
  const displayName = String(displayNameRaw || username || "Host").trim() || username;
  const roomCode = generateTradeRoomCode();
  const room = {
    code: roomCode,
    status: "waiting",
    visibility: options?.visibility === "hidden" ? "hidden" : "public",
    host: {
      username,
      displayName,
      seatToken: generateSeatToken(),
    },
    guest: null,
    offers: { host: [], guest: [] },
    accepted: { host: false, guest: false },
    confirmFinalize: { host: false, guest: false },
    clients: new Set(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastActivityAt: Date.now(),
    completedAt: null,
    tradeSummary: null,
  };
  tradeRooms.set(roomCode, room);
  return room;
}

function joinTradeRoomAsGuest(room, authUsernameRaw, playerNameRaw) {
  if (!room) {
    throw new Error("Sala de troca nao encontrada.");
  }
  if (room.status === "completed") {
    throw new Error("Sala de troca ja foi concluida.");
  }
  if (room.status === "cancelled") {
    throw new Error("Sala de troca cancelada.");
  }
  if (room.guest) {
    throw new Error("Sala de troca ja esta cheia.");
  }
  const username = normalizeUserKey(authUsernameRaw || "guest");
  if (username === normalizeUserKey(room.host?.username, "")) {
    throw new Error("Nao e possivel entrar na sala com o mesmo usuario do host.");
  }
  const displayName = String(playerNameRaw || authUsernameRaw || username || "Guest").trim() || username;
  room.guest = {
    username,
    displayName,
    seatToken: generateSeatToken(),
  };
  room.status = "ready";
  room.accepted = { host: false, guest: false };
  room.confirmFinalize = { host: false, guest: false };
  room.updatedAt = nowIso();
  room.lastActivityAt = Date.now();
  return {
    roomCode: room.code,
    seat: "guest",
    seatToken: room.guest.seatToken,
    guestKey: username,
  };
}

function cleanupExpiredTradeInvites() {
  const nowMs = Date.now();
  tradeInvites.forEach((invite, inviteId) => {
    if (!invite || String(invite.status || "") !== "pending") {
      tradeInvites.delete(inviteId);
      return;
    }
    const expiresAtMs = Number(invite.expiresAtMs || 0);
    const roomCode = normalizeTradeCode(invite.roomCode);
    const room = roomCode ? tradeRooms.get(roomCode) : null;
    const expired = !expiresAtMs || nowMs >= expiresAtMs;
    const roomInvalid = !room || room.status === "completed" || room.status === "cancelled" || Boolean(room.guest);
    if (!expired && !roomInvalid) {
      return;
    }
    if (room && room.status === "waiting" && !room.guest) {
      room.status = "cancelled";
      room.updatedAt = nowIso();
      room.lastActivityAt = Date.now();
      releaseTradeRoomLocks(room);
      sendTradeRoomEvent(room, {
        type: "trade_room_event",
        event: "trade_cancelled",
        roomCode: room.code,
        by: "system",
      });
      broadcastTradeRoomSnapshot(room, "cancel");
    }
    tradeInvites.delete(inviteId);
  });
}

function normalizeTradeInvitePayload(invite) {
  if (!invite) {
    return null;
  }
  const expiresAtMs = Number(invite.expiresAtMs || 0);
  return {
    inviteId: String(invite.id || ""),
    roomCode: String(invite.roomCode || ""),
    hostKey: normalizeUserKey(invite.hostKey || "", ""),
    hostUsername: String(invite.hostUsername || invite.hostKey || ""),
    guestKey: normalizeUserKey(invite.guestKey || "", ""),
    guestUsername: String(invite.guestUsername || invite.guestKey || ""),
    createdAt: String(invite.createdAt || ""),
    updatedAt: String(invite.updatedAt || ""),
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    expiresInMs: Math.max(0, expiresAtMs - Date.now()),
  };
}

function listTradeInvitesForOwner(ownerKeyRaw) {
  cleanupExpiredTradeInvites();
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  if (!ownerKey) {
    return { incoming: [], outgoing: [] };
  }
  const incoming = [];
  const outgoing = [];
  tradeInvites.forEach((invite) => {
    if (!invite || String(invite.status || "") !== "pending") {
      return;
    }
    const normalized = normalizeTradeInvitePayload(invite);
    if (!normalized) {
      return;
    }
    if (normalized.guestKey === ownerKey) {
      incoming.push(normalized);
      return;
    }
    if (normalized.hostKey === ownerKey) {
      outgoing.push(normalized);
    }
  });
  incoming.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  outgoing.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { incoming, outgoing };
}

function hasPendingTradeInviteBetweenPlayers(hostKeyRaw, guestKeyRaw) {
  const hostKey = normalizeUserKey(hostKeyRaw, "");
  const guestKey = normalizeUserKey(guestKeyRaw, "");
  if (!hostKey || !guestKey) {
    return false;
  }
  cleanupExpiredTradeInvites();
  for (const invite of tradeInvites.values()) {
    if (!invite || String(invite.status || "") !== "pending") {
      continue;
    }
    if (
      normalizeUserKey(invite.hostKey, "") === hostKey
      && normalizeUserKey(invite.guestKey, "") === guestKey
    ) {
      return true;
    }
  }
  return false;
}

function getFriendPresenceMap(ownerKeyRaw, friendKeysRaw) {
  const ownerKey = normalizeUserKey(ownerKeyRaw, "");
  const friendKeys = Array.isArray(friendKeysRaw)
    ? friendKeysRaw
      .map((value) => normalizeUserKey(value, ""))
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index && value !== ownerKey)
    : [];
  const out = {};
  if (!friendKeys.length || !isSqlV2Ready()) {
    return out;
  }
  const placeholders = friendKeys.map(() => "?").join(", ");
  const activePresenceSet = new Set(listActivePresenceOwnerKeys(friendKeys));

  const perimRows = sqliteDb
    .prepare(`
      SELECT owner_key, location_name, action_label, updated_at
      FROM perim_runs
      WHERE status = 'active' AND owner_key IN (${placeholders})
      ORDER BY datetime(updated_at) DESC
    `)
    .all(...friendKeys);
  const perimByOwner = new Map();
  perimRows.forEach((row) => {
    const key = normalizeUserKey(row?.owner_key || "", "");
    if (!key || perimByOwner.has(key)) {
      return;
    }
    perimByOwner.set(key, {
      locationName: String(row?.location_name || ""),
      actionLabel: String(row?.action_label || ""),
      updatedAt: String(row?.updated_at || ""),
    });
  });

  const tradeSet = new Set();
  tradeRooms.forEach((room) => {
    if (!room || room.status === "completed" || room.status === "cancelled") {
      return;
    }
    const hostKey = normalizeUserKey(room.host?.username, "");
    const guestKey = normalizeUserKey(room.guest?.username, "");
    if (hostKey && friendKeys.includes(hostKey)) {
      tradeSet.add(hostKey);
    }
    if (guestKey && friendKeys.includes(guestKey)) {
      tradeSet.add(guestKey);
    }
  });

  friendKeys.forEach((key) => {
    if (tradeSet.has(key) && activePresenceSet.has(key)) {
      out[key] = { status: "em_troca" };
      return;
    }
    const perim = perimByOwner.get(key);
    if (perim && activePresenceSet.has(key)) {
      out[key] = {
        status: "em_perim",
        locationName: perim.locationName,
        actionLabel: perim.actionLabel,
        updatedAt: perim.updatedAt,
      };
      return;
    }
    if (activePresenceSet.has(key)) {
      out[key] = { status: "online" };
      return;
    }
    out[key] = { status: "offline" };
  });
  return out;
}

function normalizeTradeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, TRADE_ROOM_CODE_LENGTH);
}

function generateTradeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < TRADE_ROOM_CODE_LENGTH; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!tradeRooms.has(code)) {
      return code;
    }
  }
  return crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, TRADE_ROOM_CODE_LENGTH);
}

function getTradeSeatByToken(room, seatToken) {
  const token = String(seatToken || "");
  if (!room || !token) {
    return { seat: "spectator", playerKey: "" };
  }
  if (room.host?.seatToken === token) {
    return { seat: "host", playerKey: normalizeUserKey(room.host?.username) };
  }
  if (room.guest?.seatToken === token) {
    return { seat: "guest", playerKey: normalizeUserKey(room.guest?.username) };
  }
  return { seat: "spectator", playerKey: "" };
}

function sendTradeRoomEvent(room, payload) {
  const message = JSON.stringify(payload);
  room.clients.forEach((client) => {
    try {
      client.res.write(`data: ${message}\n\n`);
    } catch {
      room.clients.delete(client);
    }
  });
}

function buildTradeRoomStatePayload(room, seatToken = "") {
  const seatInfo = getTradeSeatByToken(room, seatToken);
  const hostOfferIds = Array.isArray(room.offers?.host) ? room.offers.host : [];
  const guestOfferIds = Array.isArray(room.offers?.guest) ? room.offers.guest : [];
  const hostOffer = fetchTradeEntriesByIds(hostOfferIds);
  const guestOffer = fetchTradeEntriesByIds(guestOfferIds);
  let myInventory = [];
  if (seatInfo.seat === "host" || seatInfo.seat === "guest") {
    const offeredIds = new Set([...hostOfferIds, ...guestOfferIds]);
    myInventory = fetchTradeInventoryEntries(seatInfo.playerKey).map((entry) => ({
      ...entry,
      offered: offeredIds.has(String(entry.scanEntryId || "")),
      lockedByOtherRoom: (() => {
        const lock = tradeCardLocks.get(String(entry.scanEntryId || ""));
        if (!lock) return false;
        return String(lock.roomCode || "") !== String(room.code || "");
      })(),
    }));
  }
  return {
    roomCode: room.code,
    status: room.status,
    seat: seatInfo.seat,
    players: {
      host: room.host
        ? {
            username: normalizeUserKey(room.host.username),
            displayName: String(room.host.displayName || room.host.username || "Host"),
          }
        : null,
      guest: room.guest
        ? {
            username: normalizeUserKey(room.guest.username),
            displayName: String(room.guest.displayName || room.guest.username || "Guest"),
          }
        : null,
    },
    accepted: {
      host: Boolean(room.accepted?.host),
      guest: Boolean(room.accepted?.guest),
    },
    confirmFinalize: {
      host: Boolean(room.confirmFinalize?.host),
      guest: Boolean(room.confirmFinalize?.guest),
    },
    offers: {
      host: hostOffer,
      guest: guestOffer,
    },
    myInventory,
    canFinalize:
      room.status === "ready"
      && Boolean(room.accepted?.host)
      && Boolean(room.accepted?.guest)
      && Boolean(room.confirmFinalize?.host)
      && Boolean(room.confirmFinalize?.guest),
    updatedAt: room.updatedAt || nowIso(),
  };
}

function broadcastTradeRoomSnapshot(room, reason = "update") {
  room.updatedAt = nowIso();
  room.lastActivityAt = Date.now();
  room.clients.forEach((client) => {
    const snapshot = buildTradeRoomStatePayload(room, client.seatToken);
    const payload = {
      type: "trade_room_snapshot",
      reason,
      snapshot,
    };
    try {
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      room.clients.delete(client);
    }
  });
}

function requireTradeRoomOr404(response, roomCodeRaw) {
  const roomCode = normalizeTradeCode(roomCodeRaw);
  const room = tradeRooms.get(roomCode);
  if (!room) {
    sendJson(response, 404, { error: "Sala de troca nao encontrada." });
    return null;
  }
  return room;
}

function clearTradeRoomConnections(room) {
  room.clients.forEach((client) => {
    try {
      client.res.end();
    } catch {}
  });
  room.clients.clear();
}

function lockTradeCard(roomCode, seat, scanEntryId) {
  const key = String(scanEntryId || "").trim();
  if (!key) {
    return false;
  }
  const current = tradeCardLocks.get(key);
  if (current && !(String(current.roomCode) === String(roomCode) && String(current.seat) === String(seat))) {
    return false;
  }
  tradeCardLocks.set(key, {
    roomCode: String(roomCode),
    seat: String(seat),
    updatedAt: Date.now(),
  });
  return true;
}

function unlockTradeCard(roomCode, seat, scanEntryId) {
  const key = String(scanEntryId || "").trim();
  if (!key) {
    return;
  }
  const current = tradeCardLocks.get(key);
  if (!current) {
    return;
  }
  if (String(current.roomCode) !== String(roomCode) || String(current.seat) !== String(seat)) {
    return;
  }
  tradeCardLocks.delete(key);
}

function releaseTradeRoomLocks(room) {
  if (!room) {
    return;
  }
  (Array.isArray(room.offers?.host) ? room.offers.host : []).forEach((scanEntryId) => {
    unlockTradeCard(room.code, "host", scanEntryId);
  });
  (Array.isArray(room.offers?.guest) ? room.offers.guest : []).forEach((scanEntryId) => {
    unlockTradeCard(room.code, "guest", scanEntryId);
  });
}

function cleanupExpiredTradeRooms() {
  const now = Date.now();
  tradeRooms.forEach((room, code) => {
    const lastActivityAt = Number(room?.lastActivityAt || 0);
    if (!lastActivityAt) {
      return;
    }
    if (now - lastActivityAt < TRADE_ROOM_IDLE_TTL_MS) {
      return;
    }
    releaseTradeRoomLocks(room);
    clearTradeRoomConnections(room);
    tradeRooms.delete(code);
    console.log(`[TRADES][GC] Sala ${code} removida por inatividade.`);
  });
}

function resolveTradeScanEntryId(room, seat, action) {
  const actor = seat === "host" ? room.host : room.guest;
  const actorKey = normalizeUserKey(actor?.username);
  if (!actorKey) {
    return "";
  }
  const offered = new Set([
    ...(Array.isArray(room.offers?.host) ? room.offers.host : []),
    ...(Array.isArray(room.offers?.guest) ? room.offers.guest : []),
  ]);
  const requestedScanEntryId = String(action?.scanEntryId || "").trim();
  if (requestedScanEntryId) {
    const lock = tradeCardLocks.get(requestedScanEntryId);
    if (lock && String(lock.roomCode || "") !== String(room.code || "")) {
      return "";
    }
    const owned = fetchTradeInventoryEntries(actorKey).some(
      (entry) => entry.scanEntryId === requestedScanEntryId
    );
    if (owned && !offered.has(requestedScanEntryId)) {
      return requestedScanEntryId;
    }
    return "";
  }
  const requestedCardId = String(action?.cardId || "").trim();
  if (!requestedCardId) {
    return "";
  }
  const requestedType = String(action?.cardType || "").trim().toLowerCase();
  const match = fetchTradeInventoryEntries(actorKey).find((entry) => {
    const lock = tradeCardLocks.get(String(entry.scanEntryId || ""));
    if (lock && String(lock.roomCode || "") !== String(room.code || "")) {
      return false;
    }
    if (offered.has(entry.scanEntryId)) {
      return false;
    }
    if (entry.cardId !== requestedCardId) {
      return false;
    }
    if (requestedType && entry.cardType !== requestedType) {
      return false;
    }
    return true;
  });
  return String(match?.scanEntryId || "");
}

function transferTradeEntriesAtomic(room) {
  if (!isSqlV2Ready()) {
    throw new Error("Sistema de trocas requer banco SQL ativo.");
  }
  const hostKey = normalizeUserKey(room?.host?.username);
  const guestKey = normalizeUserKey(room?.guest?.username);
  if (!hostKey || !guestKey) {
    throw new Error("Sala de troca sem jogadores validos.");
  }
  const hostIds = Array.isArray(room.offers?.host) ? room.offers.host.map((id) => String(id || "").trim()).filter(Boolean) : [];
  const guestIds = Array.isArray(room.offers?.guest) ? room.offers.guest.map((id) => String(id || "").trim()).filter(Boolean) : [];
  const allIds = [...hostIds, ...guestIds];
  if (!allIds.length) {
    throw new Error("Nenhuma carta ofertada para concluir a troca.");
  }
  const uniqueIds = [...new Set(allIds)];
  if (uniqueIds.length !== allIds.length) {
    throw new Error("Oferta contem entradas duplicadas.");
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    const rows = sqliteDb
      .prepare(`
        SELECT scan_entry_id, owner_key, card_type, card_id, variant_json
        FROM scan_entries
        WHERE scan_entry_id IN (${placeholders})
      `)
      .all(...uniqueIds);
    const ownerById = new Map(rows.map((row) => [String(row.scan_entry_id || ""), normalizeUserKey(row.owner_key)]));
    const rowById = new Map(rows.map((row) => [String(row.scan_entry_id || ""), row]));
    uniqueIds.forEach((scanEntryId) => {
      if (!ownerById.has(scanEntryId)) {
        throw new Error(`Carta da oferta nao encontrada: ${scanEntryId}`);
      }
    });
    hostIds.forEach((scanEntryId) => {
      if (ownerById.get(scanEntryId) !== hostKey) {
        throw new Error("Uma carta ofertada pelo host nao pertence mais ao host.");
      }
    });
    guestIds.forEach((scanEntryId) => {
      if (ownerById.get(scanEntryId) !== guestKey) {
        throw new Error("Uma carta ofertada pelo guest nao pertence mais ao guest.");
      }
    });

    const updateOwner = sqliteDb.prepare("UPDATE scan_entries SET owner_key = ? WHERE scan_entry_id = ?");
    hostIds.forEach((scanEntryId) => updateOwner.run(guestKey, scanEntryId));
    guestIds.forEach((scanEntryId) => updateOwner.run(hostKey, scanEntryId));

    sqliteDb.exec("COMMIT");
    const hostToGuest = hostIds.map((scanEntryId) => {
      const entry = rowById.get(scanEntryId) || {};
      return {
        scanEntryId: String(scanEntryId),
        fromOwnerKey: hostKey,
        toOwnerKey: guestKey,
        cardType: String(entry?.card_type || ""),
        cardId: String(entry?.card_id || ""),
        variant: normalizeCreatureVariant(parseJsonText(entry?.variant_json, null)),
      };
    });
    const guestToHost = guestIds.map((scanEntryId) => {
      const entry = rowById.get(scanEntryId) || {};
      return {
        scanEntryId: String(scanEntryId),
        fromOwnerKey: guestKey,
        toOwnerKey: hostKey,
        cardType: String(entry?.card_type || ""),
        cardId: String(entry?.card_id || ""),
        variant: normalizeCreatureVariant(parseJsonText(entry?.variant_json, null)),
      };
    });
    return {
      hostToGuest,
      guestToHost,
    };
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function persistTradeHistory(room, summary) {
  if (!sqliteDb || !room || !summary) {
    return null;
  }
  const tradeId = `trade_${crypto.randomBytes(8).toString("hex")}`;
  const completedAt = nowIso();
  const hostKey = normalizeUserKey(room?.host?.username);
  const guestKey = normalizeUserKey(room?.guest?.username);
  sqliteDb.exec("BEGIN IMMEDIATE");
  try {
    sqliteDb
      .prepare(`
        INSERT INTO trade_history (trade_id, room_code, host_key, guest_key, completed_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(tradeId, String(room.code || ""), hostKey, guestKey, completedAt);
    const insertItem = sqliteDb.prepare(`
      INSERT INTO trade_history_items (trade_id, from_owner_key, to_owner_key, scan_entry_id, card_type, card_id, variant_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const entries = [
      ...(Array.isArray(summary.hostToGuest) ? summary.hostToGuest : []),
      ...(Array.isArray(summary.guestToHost) ? summary.guestToHost : []),
    ];
    entries.forEach((entry) => {
      insertItem.run(
        tradeId,
        String(entry?.fromOwnerKey || ""),
        String(entry?.toOwnerKey || ""),
        String(entry?.scanEntryId || ""),
        String(entry?.cardType || ""),
        String(entry?.cardId || ""),
        entry?.variant ? JSON.stringify(entry.variant) : null
      );
    });
    sqliteDb.exec("COMMIT");
    return {
      tradeId,
      completedAt,
    };
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {}
    console.error(`[TRADES][HISTORY][ERROR] room=${String(room?.code || "")} error=${error?.message || error}`);
    return null;
  }
}

function currentMonthWindow(nowDate = new Date()) {
  const start = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1, 0, 0, 0, 0);
  return {
    monthKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    resetsAt: end.toISOString(),
  };
}

function getMonthlyCompletedTradeCount(ownerKeyRaw, nowDate = new Date()) {
  if (!sqliteDb) {
    return 0;
  }
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  if (!ownerKey) {
    return 0;
  }
  const window = currentMonthWindow(nowDate);
  const row = sqliteDb
    .prepare(`
      SELECT COUNT(1) AS total
      FROM trade_history
      WHERE (host_key = ? OR guest_key = ?)
        AND completed_at >= ?
        AND completed_at < ?
    `)
    .get(ownerKey, ownerKey, window.startIso, window.endIso);
  return Math.max(0, Number(row?.total || 0));
}

function buildTradeMonthlyUsage(ownerKeyRaw, nowDate = new Date()) {
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  const window = currentMonthWindow(nowDate);
  const used = getMonthlyCompletedTradeCount(ownerKey, nowDate);
  return {
    ownerKey,
    monthKey: window.monthKey,
    limit: TRADE_MONTHLY_COMPLETED_LIMIT,
    used,
    remaining: Math.max(0, TRADE_MONTHLY_COMPLETED_LIMIT - used),
    resetsAt: window.resetsAt,
  };
}

function assertMonthlyTradeQuota(ownerKeyRaw) {
  const usage = buildTradeMonthlyUsage(ownerKeyRaw, new Date());
  if (usage.used >= TRADE_MONTHLY_COMPLETED_LIMIT) {
    return {
      ok: false,
      usage,
      error: `Limite mensal de trocas conclu�das atingido (${usage.used}/${usage.limit}). Novo ciclo em ${usage.resetsAt}.`,
    };
  }
  return { ok: true, usage };
}

function applyTradeRoomAction(room, action, seat) {
  const type = String(action?.type || "");
  if (seat !== "host" && seat !== "guest") {
    throw new Error("Somente jogadores da sala podem agir na troca.");
  }
  if (room.status === "completed") {
    throw new Error("Troca ja foi concluida.");
  }
  if (room.status === "cancelled") {
    throw new Error("Sala de troca cancelada.");
  }
  const seatOffer = seat === "host" ? room.offers.host : room.offers.guest;
  if (type === "offer_add") {
    const scanEntryId = resolveTradeScanEntryId(room, seat, action);
    if (!scanEntryId) {
      throw new Error("Carta indisponivel para oferta.");
    }
    if (!lockTradeCard(room.code, seat, scanEntryId)) {
      throw new Error("Carta bloqueada em outra negociacao.");
    }
    if (seatOffer.includes(scanEntryId)) {
      throw new Error("Carta ja esta na sua oferta.");
    }
    seatOffer.push(scanEntryId);
    room.accepted.host = false;
    room.accepted.guest = false;
    room.confirmFinalize = { host: false, guest: false };
    room.status = room.guest ? "ready" : "waiting";
    return { reason: "offer_add" };
  }
  if (type === "offer_remove") {
    const scanEntryId = String(action?.scanEntryId || "").trim();
    const index = seatOffer.indexOf(scanEntryId);
    if (index === -1) {
      throw new Error("Carta nao esta na sua oferta.");
    }
    unlockTradeCard(room.code, seat, scanEntryId);
    seatOffer.splice(index, 1);
    room.accepted.host = false;
    room.accepted.guest = false;
    room.confirmFinalize = { host: false, guest: false };
    room.status = room.guest ? "ready" : "waiting";
    return { reason: "offer_remove" };
  }
  if (type === "accept_set") {
    if (!room.guest) {
      throw new Error("Aguardando o segundo jogador entrar na sala.");
    }
    const accepted = Boolean(action?.accepted);
    room.accepted[seat] = accepted;
    if (!accepted) {
      room.confirmFinalize[seat] = false;
    }
    return { reason: accepted ? "accept_true" : "accept_false" };
  }
  if (type === "confirm_set") {
    if (!room.guest) {
      throw new Error("Aguardando o segundo jogador entrar na sala.");
    }
    if (!room.accepted.host || !room.accepted.guest) {
      throw new Error("Ambos precisam aceitar a oferta antes da confirmacao final.");
    }
    const confirmed = Boolean(action?.confirmed);
    room.confirmFinalize[seat] = confirmed;
    return { reason: confirmed ? "confirm_true" : "confirm_false" };
  }
  if (type === "cancel") {
    room.status = "cancelled";
    room.accepted.host = false;
    room.accepted.guest = false;
    room.confirmFinalize = { host: false, guest: false };
    releaseTradeRoomLocks(room);
    return { reason: "cancel" };
  }
  if (type === "finalize") {
    if (!room.guest) {
      throw new Error("Aguardando o segundo jogador entrar na sala.");
    }
    if (!room.accepted.host || !room.accepted.guest) {
      throw new Error("Ambos os jogadores precisam aceitar a troca.");
    }
    if (!room.confirmFinalize?.host || !room.confirmFinalize?.guest) {
      throw new Error("Ambos os jogadores precisam confirmar a finalizacao.");
    }
    const hostQuota = assertMonthlyTradeQuota(room.host?.username || "");
    const guestQuota = assertMonthlyTradeQuota(room.guest?.username || "");
    if (!hostQuota.ok || !guestQuota.ok) {
      throw new Error(
        hostQuota.error || guestQuota.error || "Limite mensal de trocas atingido para um dos jogadores."
      );
    }
    const summary = transferTradeEntriesAtomic(room);
    const history = persistTradeHistory(room, summary);
    room.status = "completed";
    room.completedAt = nowIso();
    room.tradeSummary = {
      ...summary,
      history: history || null,
    };
    releaseTradeRoomLocks(room);
    runtimeMetrics.tradeCompletedCount += 1;
    invalidateUserCaches(room.host?.username || "");
    invalidateUserCaches(room.guest?.username || "");
    return { reason: "finalize", summary: room.tradeSummary };
  }
  throw new Error("Acao de troca invalida.");
}

setInterval(() => {
  cleanupExpiredTradeRooms();
  cleanupExpiredTradeInvites();
  cleanupExpiredDromeChallengeInvites();
}, 60 * 1000).unref?.();

function getRoomSeatByToken(room, seatToken) {
  const token = String(seatToken || "");
  if (!room || !token) {
    return { seat: "spectator", playerIndex: null };
  }
  if (room.players?.host?.seatToken === token) {
    return { seat: "host", playerIndex: 0 };
  }
  if (room.players?.guest?.seatToken === token) {
    return { seat: "guest", playerIndex: 1 };
  }
  return { seat: "spectator", playerIndex: null };
}

function requireAuthenticatedRoomAccess(request, response, room, options = {}) {
  const authUser = requireAuthenticatedUser(request, response);
  if (!authUser) {
    return null;
  }
  const ownerKey = normalizeUserKey(authUser.username || "", "");
  if (!ownerKey) {
    sendJson(response, 403, { error: "Sessao invalida para acessar sala multiplayer." });
    return null;
  }

  const allowSpectator = Boolean(options.allowSpectator);
  const seatToken = String(options.seatToken || "").trim();
  const seatInfo = getRoomSeatByToken(room, seatToken);
  const hostKey = normalizeUserKey(room?.players?.host?.username || "", "");
  const guestKey = normalizeUserKey(room?.players?.guest?.username || "", "");

  if (seatInfo.seat === "host" || seatInfo.seat === "guest") {
    const seatOwner = seatInfo.seat === "host" ? hostKey : guestKey;
    if (!seatOwner || seatOwner !== ownerKey) {
      sendJson(response, 403, { error: "Seat token nao pertence ao usuario autenticado." });
      return null;
    }
    return { authUser, ownerKey, seatInfo };
  }

  if (allowSpectator) {
    return {
      authUser,
      ownerKey,
      seatInfo: { seat: "spectator", playerIndex: null },
    };
  }

  sendJson(response, 403, { error: "Seat token obrigatorio para esta operacao." });
  return null;
}

function seatPresence(room, seatName) {
  if (!room || (seatName !== "host" && seatName !== "guest")) {
    return null;
  }
  if (!room.presence) {
    room.presence = {
      host: { connections: 0, connected: false, timeoutAt: null, timeoutTimer: null, seenConnected: false },
      guest: { connections: 0, connected: false, timeoutAt: null, timeoutTimer: null, seenConnected: false },
    };
  }
  return room.presence[seatName];
}

function clearSeatDisconnectTimer(room, seatName) {
  const presence = seatPresence(room, seatName);
  if (!presence) {
    return;
  }
  if (presence.timeoutTimer) {
    clearTimeout(presence.timeoutTimer);
    presence.timeoutTimer = null;
  }
  presence.timeoutAt = null;
}

function clearAllDisconnectTimers(room) {
  clearSeatDisconnectTimer(room, "host");
  clearSeatDisconnectTimer(room, "guest");
}

function buildConnectionState(room) {
  const host = seatPresence(room, "host");
  const guest = seatPresence(room, "guest");
  const hostTimeoutAt = host?.timeoutAt ? new Date(host.timeoutAt).toISOString() : null;
  const guestTimeoutAt = guest?.timeoutAt ? new Date(guest.timeoutAt).toISOString() : null;
  const timeoutSeat = hostTimeoutAt ? "host" : (guestTimeoutAt ? "guest" : null);
  const timeoutAt = hostTimeoutAt || guestTimeoutAt || null;
  return {
    hostConnected: Boolean(host?.connected),
    guestConnected: Boolean(guest?.connected),
    timeoutSeat,
    timeoutAt,
    timeoutMs: MULTIPLAYER_DISCONNECT_FORFEIT_MS,
  };
}

function buildRoomSummary(room) {
  const occupancyCount = room.players?.guest ? 2 : 1;
  const matchType = normalizeMatchType(room?.matchType || "");
  const dromeId = normalizeDromeId(room?.dromeId || room?.challengeMeta?.dromeId || "");
  return {
    id: room.id,
    status: `${occupancyCount}/2 jogadores`,
    occupancy: `${occupancyCount}/2`,
    hostName: room.players?.host?.name || "Host",
    hostUsername: normalizeUserKey(room.players?.host?.username || room.players?.host?.name || "host"),
    rulesMode: room.rulesMode || "competitive",
    matchType,
    dromeId,
    dromeName: dromeNameById(dromeId),
    phase: room.phase || "lobby",
    highlight: matchType === MATCH_TYPE_CODEMASTER_CHALLENGE,
    updatedAt: room.updatedAt || nowIso(),
  };
}

function markRoomAsFinished(room, reason = "battle_finished") {
  if (!room || typeof room !== "object") {
    return;
  }
  room.phase = "finished";
  room.rematch = { pending: false, requestedBy: null, requestedAt: null };
  room.finishedAt = nowIso();
  room.finishedAtMs = Date.now();
  room.finishedReason = String(reason || "battle_finished");
}

function cleanupFinishedMultiplayerRooms(nowMs = Date.now()) {
  multiplayerRooms.forEach((room, roomId) => {
    if (!room || String(room.phase || "") !== "finished") {
      return;
    }
    const finishedAtMsRaw = Number(room?.finishedAtMs || 0);
    const finishedAtMs = finishedAtMsRaw > 0
      ? finishedAtMsRaw
      : (parseIsoToMs(room?.finishedAt || "") || parseIsoToMs(room?.updatedAt || "") || 0);
    if (!finishedAtMs) {
      room.finishedAtMs = nowMs;
      room.finishedAt = room.finishedAt || nowIso();
      return;
    }
    if ((nowMs - finishedAtMs) < MULTIPLAYER_FINISHED_ROOM_TTL_MS) {
      return;
    }
    clearAllDisconnectTimers(room);
    room.clients?.forEach((client) => {
      try {
        client?.res?.end();
      } catch {}
    });
    multiplayerRooms.delete(String(roomId || ""));
  });
}

function startMultiplayerRoomGcScheduler() {
  try {
    const timer = setInterval(() => {
      cleanupFinishedMultiplayerRooms(Date.now());
    }, MULTIPLAYER_ROOM_GC_INTERVAL_MS);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
  } catch (error) {
    console.error(`[MP][GC] Falha ao iniciar scheduler de limpeza de salas: ${error?.message || error}`);
  }
}

function cleanupExpiredCasualInvites(nowMs = Date.now()) {
  casualBattleInvites.forEach((invite, inviteId) => {
    const expiresAtMs = Number(invite?.expiresAtMs || 0);
    const status = String(invite?.status || "pending");
    const updatedAtMs = Number(invite?.updatedAtMs || invite?.createdAtMs || 0);
    if ((status === "pending" && expiresAtMs > 0 && expiresAtMs <= nowMs) || (status !== "pending" && (nowMs - updatedAtMs) > (10 * 60 * 1000))) {
      casualBattleInvites.delete(inviteId);
    }
  });
}

function listCasualInvitesForOwner(ownerKeyRaw, nowMs = Date.now()) {
  cleanupExpiredCasualInvites(nowMs);
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  if (!ownerKey) {
    return { incoming: [], outgoing: [] };
  }
  const incoming = [];
  const outgoing = [];
  casualBattleInvites.forEach((invite) => {
    const hostKey = normalizeUserKey(invite?.hostKey || "", "");
    const targetKey = normalizeUserKey(invite?.targetKey || "", "");
    if (!hostKey || !targetKey) {
      return;
    }
    const payload = {
      inviteId: String(invite.inviteId || ""),
      status: String(invite.status || "pending"),
      hostKey,
      targetKey,
      hostUsername: String(invite.hostUsername || hostKey),
      targetUsername: String(invite.targetUsername || targetKey),
      hostAvatar: String(invite.hostAvatar || ""),
      rulesMode: String(invite.rulesMode || "competitive"),
      createdAt: String(invite.createdAt || ""),
      expiresInMs: Math.max(0, Number(invite.expiresAtMs || 0) - nowMs),
      room: invite?.room ? { ...invite.room } : null,
    };
    if (targetKey === ownerKey) {
      incoming.push(payload);
    }
    if (hostKey === ownerKey) {
      outgoing.push(payload);
    }
  });
  incoming.sort((a, b) => Number(b.expiresInMs || 0) - Number(a.expiresInMs || 0));
  outgoing.sort((a, b) => Number(b.expiresInMs || 0) - Number(a.expiresInMs || 0));
  return { incoming, outgoing };
}

function hasPendingCasualInvite(hostKeyRaw, targetKeyRaw) {
  const hostKey = normalizeUserKey(hostKeyRaw || "", "");
  const targetKey = normalizeUserKey(targetKeyRaw || "", "");
  if (!hostKey || !targetKey) {
    return false;
  }
  cleanupExpiredCasualInvites(Date.now());
  for (const invite of casualBattleInvites.values()) {
    const status = String(invite?.status || "pending");
    const from = normalizeUserKey(invite?.hostKey || "", "");
    const to = normalizeUserKey(invite?.targetKey || "", "");
    if (status !== "pending") {
      continue;
    }
    if ((from === hostKey && to === targetKey) || (from === targetKey && to === hostKey)) {
      return true;
    }
  }
  return false;
}

function rankedQueueRangeForWait(waitMs = 0) {
  const safeMs = Math.max(0, Number(waitMs || 0));
  const steps = Math.floor(safeMs / RANKED_QUEUE_RANGE_STEP_MS);
  return Math.min(RANKED_QUEUE_RANGE_MAX, RANKED_QUEUE_BASE_RANGE + (steps * RANKED_QUEUE_RANGE_STEP));
}

function cleanupRankedQueue(nowMs = Date.now()) {
  rankedQueueByOwner.forEach((entry, ownerKey) => {
    const enqueuedAtMs = Number(entry?.enqueuedAtMs || 0);
    if (!enqueuedAtMs || (nowMs - enqueuedAtMs) > RANKED_QUEUE_STALE_MS) {
      rankedQueueByOwner.delete(ownerKey);
      const dromeId = normalizeDromeId(entry?.dromeId || "");
      const queue = rankedQueueByDrome.get(dromeId);
      if (queue) {
        rankedQueueByDrome.set(dromeId, queue.filter((item) => normalizeUserKey(item?.ownerKey || "", "") !== ownerKey));
      }
    }
  });
}

function removeRankedQueueEntry(ownerKeyRaw) {
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  if (!ownerKey) {
    return;
  }
  const existing = rankedQueueByOwner.get(ownerKey);
  rankedQueueByOwner.delete(ownerKey);
  if (!existing) {
    return;
  }
  const dromeId = normalizeDromeId(existing?.dromeId || "");
  if (!dromeId) {
    return;
  }
  const queue = rankedQueueByDrome.get(dromeId);
  if (!queue) {
    return;
  }
  rankedQueueByDrome.set(dromeId, queue.filter((item) => normalizeUserKey(item?.ownerKey || "", "") !== ownerKey));
}

function clearRankedQueueSession(ownerKeyRaw) {
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  if (!ownerKey) {
    return;
  }
  removeRankedQueueEntry(ownerKey);
  rankedQueueMatches.delete(ownerKey);
}

function getRankedQueueState(ownerKeyRaw, nowMs = Date.now()) {
  const ownerKey = normalizeUserKey(ownerKeyRaw || "", "");
  if (!ownerKey) {
    return { queued: false, matchedRoom: null, queue: null };
  }
  cleanupRankedQueue(nowMs);
  const matchedRoom = rankedQueueMatches.get(ownerKey) || null;
  const entry = rankedQueueByOwner.get(ownerKey) || null;
  if (!entry) {
    return { queued: false, matchedRoom, queue: null };
  }
  const queue = rankedQueueByDrome.get(normalizeDromeId(entry?.dromeId || "")) || [];
  const position = Math.max(1, queue.findIndex((candidate) => normalizeUserKey(candidate?.ownerKey || "", "") === ownerKey) + 1);
  return {
    queued: true,
    matchedRoom,
    queue: {
      dromeId: normalizeDromeId(entry?.dromeId || ""),
      dromeName: dromeNameById(entry?.dromeId || ""),
      enqueuedAt: String(entry?.enqueuedAt || ""),
      waitMs: Math.max(0, nowMs - Number(entry?.enqueuedAtMs || nowMs)),
      range: rankedQueueRangeForWait(nowMs - Number(entry?.enqueuedAtMs || nowMs)),
      position,
    },
  };
}

async function tryMatchRankedQueue(dromeIdRaw, seasonKeyRaw, nowDate = new Date()) {
  const dromeId = normalizeDromeId(dromeIdRaw);
  const seasonKey = String(seasonKeyRaw || "").trim();
  if (!dromeId || !seasonKey) {
    return null;
  }
  cleanupRankedQueue(nowDate.getTime());
  const queue = rankedQueueByDrome.get(dromeId) || [];
  if (queue.length < 2) {
    return null;
  }
  let bestPair = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < queue.length; i += 1) {
    const left = queue[i];
    const leftOwner = normalizeUserKey(left?.ownerKey || "", "");
    if (!leftOwner) continue;
    const leftWaitMs = Math.max(0, nowDate.getTime() - Number(left?.enqueuedAtMs || nowDate.getTime()));
    const leftRange = rankedQueueRangeForWait(leftWaitMs);
    const leftScore = getCurrentDromeScore(leftOwner, seasonKey, dromeId);
    for (let j = i + 1; j < queue.length; j += 1) {
      const right = queue[j];
      const rightOwner = normalizeUserKey(right?.ownerKey || "", "");
      if (!rightOwner || rightOwner === leftOwner) continue;
      const rightWaitMs = Math.max(0, nowDate.getTime() - Number(right?.enqueuedAtMs || nowDate.getTime()));
      const rightRange = rankedQueueRangeForWait(rightWaitMs);
      const rightScore = getCurrentDromeScore(rightOwner, seasonKey, dromeId);
      const diff = Math.abs(leftScore - rightScore);
      if (diff > leftRange || diff > rightRange) {
        continue;
      }
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPair = { left, right, leftScore, rightScore, diff };
      }
    }
  }
  if (!bestPair) {
    return null;
  }
  removeRankedQueueEntry(bestPair.left.ownerKey);
  removeRankedQueueEntry(bestPair.right.ownerKey);
  const host = bestPair.left;
  const guest = bestPair.right;
  const hostAvatar = resolveAvatarForUsername(host.ownerKey);
  const guestAvatar = resolveAvatarForUsername(guest.ownerKey);
  const { room, roomId, hostToken } = createMultiplayerRoomRecord({
    hostUsername: host.ownerKey,
    hostName: host.playerName || host.ownerKey,
    hostAvatar,
    rulesMode: "competitive",
    matchType: MATCH_TYPE_RANKED_DROME,
    dromeId,
  });
  const guestToken = generateSeatToken();
  room.players.guest = {
    name: String(guest.playerName || guest.ownerKey),
    username: normalizeUserKey(guest.ownerKey),
    avatar: guestAvatar,
    deck: null,
    deckName: "",
    seatToken: guestToken,
  };
  room.phase = "deck_select";
  resetRoomDeckSelectState(room);
  room.updatedAt = nowIso();
  sendRoomEvent(room, { type: "player_joined", roomId: room.id });
  broadcastRoomSnapshot(room, "ranked_queue_match");
  const hostMatch = {
    roomId,
    seat: "host",
    seatToken: hostToken,
    matchType: MATCH_TYPE_RANKED_DROME,
    dromeId,
  };
  const guestMatch = {
    roomId,
    seat: "guest",
    seatToken: guestToken,
    matchType: MATCH_TYPE_RANKED_DROME,
    dromeId,
  };
  rankedQueueMatches.set(normalizeUserKey(host.ownerKey || "", ""), hostMatch);
  rankedQueueMatches.set(normalizeUserKey(guest.ownerKey || "", ""), guestMatch);
  return {
    host: hostMatch,
    guest: guestMatch,
    scoreDiff: bestPair.diff,
  };
}

function createMultiplayerRoomRecord({
  hostUsername,
  hostName,
  hostAvatar,
  hostDeck = null,
  hostDeckName,
  rulesMode,
  matchType,
  dromeId = "",
  challengeMeta = null,
  reservedGuestKey = "",
}) {
  const hostToken = generateSeatToken();
  const roomId = generateMultiplayerRoomId();
  const normalizedMatchType = normalizeMatchType(matchType);
  const normalizedDromeId = normalizeDromeId(dromeId);
  const rankedBanlistSnapshot =
    normalizedMatchType === MATCH_TYPE_RANKED_DROME || normalizedMatchType === MATCH_TYPE_CODEMASTER_CHALLENGE
      ? getActiveRankedBanlistSnapshot()
      : null;
  const room = {
    id: roomId,
    rulesMode: isValidRulesMode(rulesMode) ? rulesMode : "competitive",
    matchType: normalizedMatchType,
    dromeId: normalizedDromeId,
    challengeMeta: challengeMeta && typeof challengeMeta === "object"
      ? {
          inviteId: String(challengeMeta.inviteId || ""),
          codemasterKey: normalizeUserKey(challengeMeta.codemasterKey || ""),
          challengerKey: normalizeUserKey(challengeMeta.challengerKey || ""),
          dromeId: normalizeDromeId(challengeMeta.dromeId || normalizedDromeId),
        }
      : null,
    rankedBanlistSnapshot,
    reservedGuestKey: normalizeUserKey(reservedGuestKey || "", ""),
    phase: "lobby",
    players: {
      host: {
        name: String(hostName || "Host"),
        username: normalizeUserKey(hostUsername || "host"),
        avatar: String(hostAvatar || ""),
        deck: hostDeck,
        deckName: String(hostDeckName || hostDeck?.name || ""),
        seatToken: hostToken,
      },
      guest: null,
    },
    deckSelect: {
      host: { ready: false, deckName: String(hostDeckName || hostDeck?.name || ""), valid: false, errors: [] },
      guest: { ready: false, deckName: "", valid: false, errors: [] },
    },
    battleState: null,
    clients: new Set(),
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    finishedAtMs: 0,
    finishedReason: "",
    updatedAt: nowIso(),
    lastActionSeq: 0,
    rematch: {
      pending: false,
      requestedBy: null,
      requestedAt: null,
    },
  };
  multiplayerRooms.set(roomId, room);
  return {
    room,
    roomId,
    hostToken,
  };
}

function resetRoomDeckSelectState(room) {
  if (!room || typeof room !== "object") {
    return;
  }
  if (!room.deckSelect || typeof room.deckSelect !== "object") {
    room.deckSelect = {};
  }
  const hostDeck = room.players?.host?.deck || null;
  const guestDeck = room.players?.guest?.deck || null;
  room.deckSelect.host = {
    ready: false,
    deckName: String(room.players?.host?.deckName || hostDeck?.name || ""),
    valid: Boolean(hostDeck),
    errors: [],
  };
  room.deckSelect.guest = {
    ready: false,
    deckName: String(room.players?.guest?.deckName || guestDeck?.name || ""),
    valid: Boolean(guestDeck),
    errors: [],
  };
}

function cloneDeckSnapshot(deckRaw) {
  if (!deckRaw || typeof deckRaw !== "object") {
    return null;
  }
  return safeJsonParse(JSON.stringify(deckRaw), null);
}

function setRoomDeckForSeat(room, seat, deckName, deckSnapshot, rulesModeRaw) {
  if (!room || (seat !== "host" && seat !== "guest")) {
    return { ok: false, error: "Assento invalido para deck." };
  }
  const mode = isValidRulesMode(rulesModeRaw) ? rulesModeRaw : (room.rulesMode || "competitive");
  const snapshot = cloneDeckSnapshot(deckSnapshot);
  if (!snapshot) {
    return { ok: false, error: "Deck invalido." };
  }
  const validation = validateDeckForRulesMode(snapshot, mode);
  const enforceBanlist = normalizeMatchType(room?.matchType || "") === MATCH_TYPE_RANKED_DROME
    || normalizeMatchType(room?.matchType || "") === MATCH_TYPE_CODEMASTER_CHALLENGE;
  const banlistValidation = enforceBanlist
    ? validateDeckAgainstRankedBanlist(snapshot, room?.rankedBanlistSnapshot || null)
    : { ok: true, bannedCards: [] };
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  if (!banlistValidation.ok) {
    const bannedLabels = banlistValidation.bannedCards
      .slice(0, 5)
      .map((entry) => String(entry?.cardName || entry?.cardId || "").trim())
      .filter(Boolean);
    const suffix = banlistValidation.bannedCards.length > 5
      ? ` (+${banlistValidation.bannedCards.length - 5} outras)`
      : "";
    errors.push(`Deck contem carta(s) banida(s): ${bannedLabels.join(", ")}${suffix}.`);
  }
  const isValid = Boolean(validation?.ok) && Boolean(banlistValidation.ok);
  if (!room.deckSelect || typeof room.deckSelect !== "object") {
    room.deckSelect = {};
  }
  if (!room.deckSelect.host || typeof room.deckSelect.host !== "object") {
    room.deckSelect.host = { ready: false, deckName: "", valid: false, errors: [] };
  }
  if (!room.deckSelect.guest || typeof room.deckSelect.guest !== "object") {
    room.deckSelect.guest = { ready: false, deckName: "", valid: false, errors: [] };
  }
  room.players[seat].deck = snapshot;
  room.players[seat].deckName = String(deckName || snapshot?.name || room.players?.[seat]?.deckName || "").trim();
  room.deckSelect[seat] = {
    ready: false,
    deckName: String(room.players[seat].deckName || ""),
    valid: isValid,
    errors: errors.slice(0, 3),
  };
  return {
    ok: isValid,
    validation,
    error: isValid ? "" : `Deck invalido para modo ${mode}: ${errors.slice(0, 3).join(" | ")}`,
  };
}

async function tryStartRoomBattleFromDeckSelect(room) {
  if (!room || room.phase !== "deck_select") {
    return { started: false };
  }
  const hasGuest = Boolean(room.players?.guest);
  if (!hasGuest) {
    return { started: false };
  }
  const hostReady = Boolean(room.deckSelect?.host?.ready);
  const guestReady = Boolean(room.deckSelect?.guest?.ready);
  if (!hostReady || !guestReady) {
    return { started: false };
  }
  const hostDeck = room.players?.host?.deck;
  const guestDeck = room.players?.guest?.deck;
  if (!hostDeck || !guestDeck) {
    return { started: false, error: "Ambos os jogadores precisam selecionar um deck." };
  }
  const hostValidation = validateDeckForRulesMode(hostDeck, room.rulesMode || "competitive");
  const guestValidation = validateDeckForRulesMode(guestDeck, room.rulesMode || "competitive");
  const enforceBanlist = normalizeMatchType(room?.matchType || "") === MATCH_TYPE_RANKED_DROME
    || normalizeMatchType(room?.matchType || "") === MATCH_TYPE_CODEMASTER_CHALLENGE;
  const hostBanlistValidation = enforceBanlist
    ? validateDeckAgainstRankedBanlist(hostDeck, room?.rankedBanlistSnapshot || null)
    : { ok: true, bannedCards: [] };
  const guestBanlistValidation = enforceBanlist
    ? validateDeckAgainstRankedBanlist(guestDeck, room?.rankedBanlistSnapshot || null)
    : { ok: true, bannedCards: [] };
  if (!hostValidation.ok || !guestValidation.ok || !hostBanlistValidation.ok || !guestBanlistValidation.ok) {
    const hostErrors = Array.isArray(hostValidation.errors) ? hostValidation.errors.slice(0, 3) : [];
    const guestErrors = Array.isArray(guestValidation.errors) ? guestValidation.errors.slice(0, 3) : [];
    if (!hostBanlistValidation.ok) {
      const hostBanned = hostBanlistValidation.bannedCards
        .slice(0, 5)
        .map((entry) => String(entry?.cardName || entry?.cardId || ""))
        .filter(Boolean);
      hostErrors.push(`Banlist: ${hostBanned.join(", ")}`);
    }
    if (!guestBanlistValidation.ok) {
      const guestBanned = guestBanlistValidation.bannedCards
        .slice(0, 5)
        .map((entry) => String(entry?.cardName || entry?.cardId || ""))
        .filter(Boolean);
      guestErrors.push(`Banlist: ${guestBanned.join(", ")}`);
    }
    room.deckSelect.host = {
      ...(room.deckSelect?.host || {}),
      ready: false,
      valid: Boolean(hostValidation.ok),
      errors: hostErrors.slice(0, 3),
    };
    room.deckSelect.guest = {
      ...(room.deckSelect?.guest || {}),
      ready: false,
      valid: Boolean(guestValidation.ok),
      errors: guestErrors.slice(0, 3),
    };
    return { started: false, error: "Deck invalido para iniciar combate." };
  }
  await startRoomBattle(room);
  return { started: true };
}

function buildSpectatorSafeBattleState(battleState) {
  if (!battleState || typeof battleState !== "object") {
    return battleState;
  }
  const safe = decodeRichValue(encodeRichValue(battleState));
  const players = safe?.board?.players;
  if (Array.isArray(players)) {
    players.forEach((player) => {
      if (!player || typeof player !== "object") {
        return;
      }
      player.attackHand = [];
      player.mugicHand = [];
      player.mugicDeck = [];
      player.mugicSlots = [];
      player.mugicDiscard = [];
      if (Array.isArray(player.creatures)) {
        player.creatures.forEach((unit) => {
          if (!unit || typeof unit !== "object") {
            return;
          }
          if (unit.gearState === "face_down") {
            unit.gearCard = null;
            unit.gearPassiveMods = {};
          }
        });
      }
    });
  }
  // Spectator does not need actionable windows/options.
  safe.pendingAction = null;
  return safe;
}

function buildRoomStatePayload(room, seatToken = "") {
  const seatInfo = getRoomSeatByToken(room, seatToken);
  const phase = String(room.phase || "lobby");
  const battleState =
    seatInfo.seat === "spectator"
      ? buildSpectatorSafeBattleState(room.battleState)
      : room.battleState;
  const showDeckLists = seatInfo.seat !== "spectator" && (phase === "in_game" || phase === "finished");
  return {
    roomId: room.id,
    rulesMode: room.rulesMode || "competitive",
    matchType: normalizeMatchType(room?.matchType || ""),
    dromeId: normalizeDromeId(room?.dromeId || room?.challengeMeta?.dromeId || ""),
    phase,
    status: buildRoomSummary(room).status,
    occupancy: buildRoomSummary(room).occupancy,
    players: {
      host: {
        name: room.players?.host?.name || "Host",
        username: room.players?.host?.username || normalizeUserKey(room.players?.host?.name || "host"),
        avatar: room.players?.host?.avatar || "",
        deckName: room.players?.host?.deckName || "",
      },
      guest: room.players?.guest
        ? {
            name: room.players.guest.name || "Guest",
            username: room.players?.guest?.username || normalizeUserKey(room.players?.guest?.name || "guest"),
            avatar: room.players?.guest?.avatar || "",
            deckName: room.players.guest.deckName || "",
          }
        : null,
    },
    player1: room.players?.host && showDeckLists ? { deck: room.players.host.deck } : null,
    player2: room.players?.guest && showDeckLists ? { deck: room.players.guest.deck } : null,
    deckSelect: {
      host: {
        ready: Boolean(room?.deckSelect?.host?.ready),
        deckName: String(room?.deckSelect?.host?.deckName || room?.players?.host?.deckName || ""),
        valid: Boolean(room?.deckSelect?.host?.valid),
        errors: Array.isArray(room?.deckSelect?.host?.errors) ? room.deckSelect.host.errors.slice(0, 3) : [],
      },
      guest: {
        ready: Boolean(room?.deckSelect?.guest?.ready),
        deckName: String(room?.deckSelect?.guest?.deckName || room?.players?.guest?.deckName || ""),
        valid: Boolean(room?.deckSelect?.guest?.valid),
        errors: Array.isArray(room?.deckSelect?.guest?.errors) ? room.deckSelect.guest.errors.slice(0, 3) : [],
      },
    },
    seat: seatInfo.seat,
    localPlayerIndex: seatInfo.playerIndex,
    connection: buildConnectionState(room),
    rematch: room.rematch && typeof room.rematch === "object"
      ? {
          pending: Boolean(room.rematch.pending),
          requestedBy: room.rematch.requestedBy || null,
          requestedAt: room.rematch.requestedAt || null,
        }
      : { pending: false, requestedBy: null, requestedAt: null },
    challengeMeta: room?.challengeMeta && typeof room.challengeMeta === "object"
      ? {
          inviteId: String(room.challengeMeta.inviteId || ""),
          codemasterKey: normalizeUserKey(room.challengeMeta.codemasterKey || ""),
          challengerKey: normalizeUserKey(room.challengeMeta.challengerKey || ""),
          dromeId: normalizeDromeId(room.challengeMeta.dromeId || ""),
        }
      : null,
    rankedBanlist: room?.rankedBanlistSnapshot && typeof room.rankedBanlistSnapshot === "object"
      ? {
          banlistId: Number(room.rankedBanlistSnapshot.banlistId || 0),
          name: String(room.rankedBanlistSnapshot.name || ""),
          updatedAt: String(room.rankedBanlistSnapshot.updatedAt || ""),
          cardsCount: Array.isArray(room.rankedBanlistSnapshot.cards) ? room.rankedBanlistSnapshot.cards.length : 0,
        }
      : null,
    battleState: battleState ? encodeRichValue(battleState) : null,
    updatedAt: room.updatedAt || nowIso(),
    lastActionSeq: Number(room.lastActionSeq || 0),
  };
}

function sendRoomEvent(room, payload) {
  const eventPayload = JSON.stringify(payload);
  room.clients.forEach((client) => {
    try {
      client.res.write(`data: ${eventPayload}\n\n`);
    } catch {
      room.clients.delete(client);
    }
  });
}

function createBattleTelemetrySnapshot(battleState) {
  if (!battleState || typeof battleState !== "object") {
    return null;
  }
  const board = battleState.board || {};
  const activePlayerIndex = Number.isInteger(board.activePlayerIndex) ? board.activePlayerIndex : null;
  const engagement = board.engagement || {};
  return {
    phase: battleState.phase || null,
    turnStep: battleState.turnStep || null,
    activePlayerIndex,
    pendingActionType: battleState.pendingAction?.type || null,
    burstSize: Array.isArray(battleState.burstStack) ? battleState.burstStack.length : 0,
    combatStep: battleState.combatState?.step || null,
    engagement: {
      attackerSlot: Number.isInteger(engagement.attackerSlot) ? engagement.attackerSlot : null,
      defenderSlot: Number.isInteger(engagement.defenderSlot) ? engagement.defenderSlot : null,
      attackerLetter: engagement.attackerLetter || null,
      defenderLetter: engagement.defenderLetter || null,
    },
    finished: Boolean(battleState.finished),
    winner: battleState.winner || null,
  };
}

function appendBattleActionTelemetry(room, payload = {}) {
  if (!room || !room.id) {
    return;
  }
  const logPayload = {
    roomId: room.id,
    rulesMode: room.rulesMode || "competitive",
    matchType: normalizeMatchType(room?.matchType || ""),
    ...payload,
  };
  appendAuditLog("battle_action_intent", {
    userKey: payload?.actorKey || "",
    metadata: logPayload,
  });
}

function broadcastRoomSnapshot(room, reason = "update") {
  room.updatedAt = nowIso();
  room.clients.forEach((client) => {
    const snapshot = buildRoomStatePayload(room, client.seatToken);
    const payload = {
      type: "room_snapshot",
      reason,
      snapshot,
    };
    try {
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (snapshot?.battleState) {
        const battleDecoded = decodeRichValue(snapshot.battleState);
        const gameStatePayload = {
          type: "game_state_update",
          reason,
          seq: Number(room.lastActionSeq || 0),
          phase: snapshot?.phase || room.phase || "lobby",
          battleStateView: buildBattleStateView(battleDecoded),
          snapshot,
        };
        client.res.write(`data: ${JSON.stringify(gameStatePayload)}\n\n`);
      }
    } catch {
      room.clients.delete(client);
    }
  });
}

function finalizeDisconnectForfeit(room, seatName) {
  if (!room || room.phase !== "in_game" || !room.battleState || room.battleState.finished) {
    return;
  }
  const loserIndex = seatName === "host" ? 0 : 1;
  const winnerIndex = loserIndex === 0 ? 1 : 0;
  const loser = room.battleState.board?.players?.[loserIndex];
  const winner = room.battleState.board?.players?.[winnerIndex];
  if (!winner) {
    return;
  }
  room.battleState.finished = true;
  room.battleState.pendingAction = null;
  room.battleState.winner = winner.label || (winnerIndex === 0 ? "Jogador 1" : "Jogador 2");
  const loserLabel = loser?.label || (loserIndex === 0 ? "Jogador 1" : "Jogador 2");
  room.battleState.log?.push(
    `${loserLabel} desconectou por mais de ${Math.floor(MULTIPLAYER_DISCONNECT_FORFEIT_MS / 1000)}s. ${room.battleState.winner} vence por forfeit.`
  );
  markRoomAsFinished(room, "disconnect_forfeit");
  room.lastActionSeq = Number(room.lastActionSeq || 0) + 1;
  clearAllDisconnectTimers(room);
  sendRoomEvent(room, {
    type: "room_event",
    event: "disconnect_forfeit",
    seat: seatName,
    winner: room.battleState.winner,
  });
  broadcastRoomSnapshot(room, "disconnect_forfeit");
}

function startDisconnectForfeitTimer(room, seatName) {
  const presence = seatPresence(room, seatName);
  if (!presence || presence.timeoutTimer || !presence.seenConnected) {
    return;
  }
  if (room.phase !== "in_game" || !room.battleState || room.battleState.finished) {
    return;
  }
  const timeoutAt = Date.now() + MULTIPLAYER_DISCONNECT_FORFEIT_MS;
  presence.timeoutAt = timeoutAt;
  presence.timeoutTimer = setTimeout(() => {
    presence.timeoutTimer = null;
    finalizeDisconnectForfeit(room, seatName);
  }, MULTIPLAYER_DISCONNECT_FORFEIT_MS);
  sendRoomEvent(room, {
    type: "room_event",
    event: "disconnect_timeout_started",
    seat: seatName,
    timeoutAt: new Date(timeoutAt).toISOString(),
  });
  broadcastRoomSnapshot(room, "disconnect_timeout_started");
}

function markSeatConnected(room, seatName) {
  const presence = seatPresence(room, seatName);
  if (!presence) {
    return;
  }
  presence.connections = Number(presence.connections || 0) + 1;
  presence.connected = true;
  presence.seenConnected = true;
  if (presence.timeoutTimer || presence.timeoutAt) {
    clearSeatDisconnectTimer(room, seatName);
    sendRoomEvent(room, {
      type: "room_event",
      event: "disconnect_timeout_cleared",
      seat: seatName,
    });
    broadcastRoomSnapshot(room, "disconnect_timeout_cleared");
  }
}

function markSeatDisconnected(room, seatName) {
  const presence = seatPresence(room, seatName);
  if (!presence) {
    return;
  }
  presence.connections = Math.max(0, Number(presence.connections || 0) - 1);
  presence.connected = presence.connections > 0;
  if (presence.connected) {
    return;
  }
  sendRoomEvent(room, {
    type: "room_event",
    event: "player_disconnected",
    seat: seatName,
  });
  broadcastRoomSnapshot(room, "player_disconnected");
  startDisconnectForfeitTimer(room, seatName);
}

function requireRoomOr404(response, roomId) {
  const room = multiplayerRooms.get(String(roomId || ""));
  if (!room) {
    sendJson(response, 404, { error: "Room not found" });
    return null;
  }
  return room;
}

async function startRoomBattle(room) {
  const engine = await getBattleEngine();
  const hostDeck = toBattleDeckFromStoredDeck(room.players?.host?.deck);
  const guestDeck = toBattleDeckFromStoredDeck(room.players?.guest?.deck);
  room.battleState = engine.createBattleState(hostDeck, guestDeck, room.rulesMode || "competitive");
  room.battleState.ai = {
    player0: false,
    player1: false,
  };
  if (room.battleState?.board?.players?.[0]) {
    room.battleState.board.players[0].label = room.players?.host?.name || "Host";
  }
  if (room.battleState?.board?.players?.[1]) {
    room.battleState.board.players[1].label = room.players?.guest?.name || "Guest";
  }
  room.phase = "in_game";
  room.finishedAt = null;
  room.finishedAtMs = 0;
  room.finishedReason = "";
  if (!room.deckSelect || typeof room.deckSelect !== "object") {
    room.deckSelect = {};
  }
  room.deckSelect.host = {
    ...(room.deckSelect.host || {}),
    ready: false,
  };
  room.deckSelect.guest = {
    ...(room.deckSelect.guest || {}),
    ready: false,
  };
  room.rematch = { pending: false, requestedBy: null, requestedAt: null };
  room.startedAt = nowIso();
  room.lastActionSeq = Number(room.lastActionSeq || 0);
  clearAllDisconnectTimers(room);
  engine.advanceBattle(room.battleState, false);
}

function settleRoomForfeit(room, loserSeat) {
  if (!room || room.phase !== "in_game" || !room.battleState || room.battleState.finished) {
    return false;
  }
  const loserIndex = loserSeat === "host" ? 0 : 1;
  const winnerIndex = loserIndex === 0 ? 1 : 0;
  const loser = room.battleState.board?.players?.[loserIndex];
  const winner = room.battleState.board?.players?.[winnerIndex];
  if (!winner) {
    return false;
  }
  room.battleState.finished = true;
  room.battleState.pendingAction = null;
  room.battleState.winner = winner.label || (winnerIndex === 0 ? "Jogador 1" : "Jogador 2");
  room.battleState.log?.push(
    `Desistencia: ${loser?.label || "Jogador"} concedeu a partida. ${room.battleState.winner} vence.`
  );
  markRoomAsFinished(room, "match_forfeit");
  room.lastActionSeq = Number(room.lastActionSeq || 0) + 1;
  clearAllDisconnectTimers(room);
  sendRoomEvent(room, {
    type: "room_event",
    event: "match_forfeit",
    seat: loserSeat,
    winner: room.battleState.winner,
  });
  broadcastRoomSnapshot(room, "match_forfeit");
  return true;
}

async function applyRoomAction(room, action, actingPlayerIndex, actingSeat) {
  const engine = await getBattleEngine();
  const battle = room.battleState;
  const mappedProtocol = mapProtocolIntentToLegacyAction(action, battle, actingPlayerIndex);
  const resolvedAction = mappedProtocol || action;
  const type = String(resolvedAction?.type || "");
  const allowsFinishedPhase = type === "request_rematch" || type === "respond_rematch";
  if (!battle || (room.phase !== "in_game" && !(allowsFinishedPhase && room.phase === "finished"))) {
    throw new Error("Partida ainda nao iniciou.");
  }
  if (type === "forfeit") {
    if (actingSeat !== "host" && actingSeat !== "guest") {
      throw new Error("Somente jogadores da sala podem desistir.");
    }
    settleRoomForfeit(room, actingSeat);
    return;
  }
  if (type === "request_rematch") {
    if (!battle.finished) {
      throw new Error("Revanche so pode ser solicitada apos o fim da partida.");
    }
    if (actingSeat !== "host" && actingSeat !== "guest") {
      throw new Error("Somente jogadores da sala podem solicitar revanche.");
    }
    if (room.rematch?.pending) {
      throw new Error("Ja existe um pedido de revanche pendente.");
    }
    room.rematch = {
      pending: true,
      requestedBy: actingSeat,
      requestedAt: nowIso(),
    };
    room.lastActionSeq = Number(room.lastActionSeq || 0) + 1;
    sendRoomEvent(room, {
      type: "room_event",
      event: "rematch_requested",
      seat: actingSeat,
    });
    broadcastRoomSnapshot(room, "rematch_requested");
    return;
  }
  if (type === "respond_rematch") {
    if (!battle.finished) {
      throw new Error("A partida ainda nao terminou.");
    }
    if (actingSeat !== "host" && actingSeat !== "guest") {
      throw new Error("Somente jogadores da sala podem responder a revanche.");
    }
    if (!room.rematch?.pending) {
      throw new Error("Nao ha pedido de revanche pendente.");
    }
    if (room.rematch.requestedBy === actingSeat) {
      throw new Error("Aguarde a resposta do oponente.");
    }
    if (Boolean(resolvedAction.accept)) {
      await startRoomBattle(room);
      room.lastActionSeq = Number(room.lastActionSeq || 0) + 1;
      sendRoomEvent(room, {
        type: "room_event",
        event: "rematch_started",
        seat: actingSeat,
      });
      broadcastRoomSnapshot(room, "rematch_started");
      return;
    }
    room.rematch = { pending: false, requestedBy: null, requestedAt: null };
    room.lastActionSeq = Number(room.lastActionSeq || 0) + 1;
    sendRoomEvent(room, {
      type: "room_event",
      event: "rematch_declined",
      seat: actingSeat,
    });
    broadcastRoomSnapshot(room, "rematch_declined");
    return;
  }
  if (battle.finished) {
    return;
  }

  switch (type) {
    case "choose_attack":
      engine.chooseAttack(battle, actingPlayerIndex, Number(resolvedAction.index));
      break;
    case "confirm_attack":
      engine.advanceBattle(battle, false);
      break;
    case "pass_priority":
      engine.passPriority(battle);
      engine.advanceBattle(battle, false);
      break;
    case "choose_mugic":
      if (resolvedAction?.value && typeof resolvedAction.value === "object") {
        engine.chooseMugic(
          battle,
          Number.isInteger(Number(resolvedAction.value.mugicIndex)) ? Number(resolvedAction.value.mugicIndex) : null,
          resolvedAction.value.casterUnitId || null
        );
      } else {
        engine.chooseMugic(battle, resolvedAction.value ?? null, null);
      }
      engine.advanceBattle(battle, false);
      break;
    case "choose_mugic_caster":
      engine.chooseMugic(battle, resolvedAction.value ?? null, null);
      engine.advanceBattle(battle, false);
      break;
    case "choose_ability":
      if (resolvedAction?.value && typeof resolvedAction.value === "object") {
        engine.chooseActivatedAbility(
          battle,
          Number.isInteger(Number(resolvedAction.value.optionIndex)) ? Number(resolvedAction.value.optionIndex) : null
        );
      } else {
        engine.chooseActivatedAbility(battle, resolvedAction.value ?? null);
      }
      engine.advanceBattle(battle, false);
      break;
    case "choose_target":
      if (Array.isArray(resolvedAction.value) && resolvedAction.value.length && battle.pendingAction?.type === "target_select") {
        const matchCandidateId = (selection) => {
          const step = battle.pendingAction?.targetSteps?.[battle.pendingAction?.currentStep];
          const candidates = Array.isArray(step?.candidates) ? step.candidates : [];
          const rawKind = String(selection?.kind || "").toLowerCase();
          const rawId = String(selection?.id || "");
          const numericId = Number(selection?.numericId);
          const direct = candidates.find((candidate) => String(candidate?.id || "") === rawId);
          if (direct?.id) {
            return direct.id;
          }
          const matched = candidates.find((candidate) => {
            if (rawKind && String(candidate?.type || "").toLowerCase() !== rawKind) {
              return false;
            }
            if (rawId && String(candidate?.unitId || "") === rawId) return true;
            if (rawId && String(candidate?.slot || "") === rawId) return true;
            if (rawId && String(candidate?.stackIndex || "") === rawId) return true;
            if (rawId && String(candidate?.playerIndex || "") === rawId) return true;
            if (rawId && String(candidate?.mugicIndex || "") === rawId) return true;
            if (rawId && String(candidate?.discardIndex || "") === rawId) return true;
            if (rawId && String(candidate?.id || "").endsWith(`:${rawId}`)) return true;
            if (Number.isInteger(numericId) && Number(candidate?.unitId) === numericId) return true;
            if (Number.isInteger(numericId) && Number(candidate?.slot) === numericId) return true;
            if (Number.isInteger(numericId) && Number(candidate?.stackIndex) === numericId) return true;
            if (Number.isInteger(numericId) && Number(candidate?.mugicIndex) === numericId) return true;
            if (Number.isInteger(numericId) && Number(candidate?.discardIndex) === numericId) return true;
            return false;
          });
          return matched?.id || null;
        };
        for (const selection of resolvedAction.value) {
          if (battle.pendingAction?.type !== "target_select") {
            break;
          }
          const candidateId = matchCandidateId(selection);
          if (!candidateId) {
            continue;
          }
          engine.chooseEffectTarget(battle, candidateId);
        }
      } else {
        engine.chooseEffectTarget(battle, resolvedAction.value ?? null);
      }
      engine.advanceBattle(battle, false);
      break;
    case "choose_choice":
      engine.chooseEffectChoice(battle, resolvedAction.value ?? null);
      engine.advanceBattle(battle, false);
      break;
    case "choose_defender":
      engine.chooseDefenderRedirect(battle, resolvedAction.value ?? null);
      engine.advanceBattle(battle, false);
      break;
    case "declare_move": {
      const moved = engine.declareMove(battle, Number(resolvedAction.fromSlot), resolvedAction.toLetter);
      if (moved) {
        const attacker = battle.board?.engagement?.attackerSlot;
        const defender = battle.board?.engagement?.defenderSlot;
        if (attacker !== null && defender !== null) {
          engine.advanceBattle(battle, false);
        }
      }
      break;
    }
    case "confirm_action_button": {
      if (battle.phase === "additional_movement") {
        engine.confirmEndPostCombatMove(battle);
        engine.advanceBattle(battle, false);
      } else if (battle.phase === "move_action") {
        const attacker = battle.board?.engagement?.attackerSlot;
        const defender = battle.board?.engagement?.defenderSlot;
        if (attacker !== null && defender !== null) {
          battle.resolveDeclareNow = true;
        } else {
          engine.endActionWithoutCombat(battle);
        }
        engine.advanceBattle(battle, false);
      }
      break;
    }
    case "cancel_target":
      engine.chooseEffectTarget(battle, null);
      engine.advanceBattle(battle, false);
      break;
    case "cancel_choice":
      engine.chooseEffectChoice(battle, null);
      engine.advanceBattle(battle, false);
      break;
    case "cancel_mugic":
      engine.chooseMugic(battle, null);
      engine.advanceBattle(battle, false);
      break;
    case "cancel_ability":
      engine.chooseActivatedAbility(battle, null);
      engine.advanceBattle(battle, false);
      break;
    default:
      throw new Error("Acao multiplayer nao suportada.");
  }
}

function readSettingsFromDisk() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSettingsToDisk(payload) {
  const settingsBody =
    payload?.settings && typeof payload.settings === "object"
      ? payload.settings
      : (payload && typeof payload === "object" ? payload : {});
  const body = {
    schemaVersion: Number(payload?.schemaVersion || 1),
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    settings: settingsBody,
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(body, null, 2), "utf8");
  return body;
}

function formatLogTimestamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function sanitizeDebugLines(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .slice(0, 5000)
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (entry && typeof entry === "object") {
        return JSON.stringify(entry);
      }
      return String(entry || "");
    })
    .filter(Boolean);
}

function appendDebugLines(filePath, entries) {
  const lines = sanitizeDebugLines(entries);
  if (!lines.length) {
    return 0;
  }
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return lines.length;
}

function normalizePendingToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractQuotedKindsFromSet(engineText, setName) {
  const matcher = new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, "m");
  const match = matcher.exec(engineText);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => String(item[1] || "").trim()).filter(Boolean);
}

function collectAttackSupportedKindsFromEngine() {
  if (!fs.existsSync(ENGINE_FILE)) {
    return new Set();
  }
  const engineText = fs.readFileSync(ENGINE_FILE, "utf8");
  const supported = new Set([
    ...extractQuotedKindsFromSet(engineText, "ATTACK_DAMAGE_FORMULA_EFFECT_KINDS"),
    ...extractQuotedKindsFromSet(engineText, "ATTACK_TEMP_EFFECT_KINDS"),
    ...extractQuotedKindsFromSet(engineText, "ATTACK_STACK_EFFECT_KINDS"),
  ]);
  const registryKinds = [...engineText.matchAll(/\["([a-zA-Z0-9_]+)"\s*,\s*\{/g)].map((item) => String(item[1] || "").trim());
  registryKinds.forEach((kind) => {
    if (kind) {
      supported.add(kind);
    }
  });
  return supported;
}

function collectCreatureSupportedKindsFromEngine() {
  if (!fs.existsSync(ENGINE_FILE)) {
    return new Set();
  }
  const engineText = fs.readFileSync(ENGINE_FILE, "utf8");
  const setNames = [
    "CORE_EFFECT_KINDS",
    "PASSIVE_EFFECT_KINDS",
    "BATTLEGEAR_PHASE_EFFECT_KINDS",
    "LOCATION_PHASE_EFFECT_KINDS",
  ];
  const supported = new Set();
  setNames.forEach((setName) => {
    extractQuotedKindsFromSet(engineText, setName).forEach((kind) => supported.add(kind));
  });
  const registryKinds = [...engineText.matchAll(/\["([a-zA-Z0-9_]+)"\s*,\s*\{/g)].map((item) => String(item[1] || "").trim());
  registryKinds.forEach((kind) => {
    if (kind) {
      supported.add(kind);
    }
  });
  [
    "keyword",
    "invisibilityStrike",
    "invisibilitySurprise",
    "invisibilityDisarm",
    "outperform",
    "intimidate",
    "hiveGranted",
    "incomingDamageReduction",
    "attackDamageVsLowerMugicCounters",
    "attackDamageIfAlliesHaveElement",
    "statCheckAutoSuccessForElement",
  ].forEach((kind) => supported.add(kind));
  return supported;
}

function pendingAttackEntryKey(entry) {
  return [
    normalizePendingToken(entry?.reason || ""),
    normalizePendingToken(entry?.cardType || ""),
    normalizePendingToken(entry?.cardName || ""),
    normalizePendingToken(entry?.effectKind || ""),
    normalizePendingToken(entry?.sourceText || ""),
  ].join("|");
}

function resolveSourceTextForEffectKind(card, effectKind) {
  if (!card || !effectKind) {
    return "";
  }
  const kinds = Array.isArray(card.parsedEffects) ? card.parsedEffects : [];
  const effect = kinds.find((item) => String(item?.kind || "") === String(effectKind));
  if (effect?.sourceText) {
    return String(effect.sourceText).trim();
  }
  return String(card.ability || "").trim();
}

function buildEffectPendingEntries(currentLibrary, supportedKinds, cardTypeFilter = "attacks") {
  const entries = [];
  const cards = currentLibrary?.cards || [];
  cards.forEach((card) => {
    if (String(card?.type || "").toLowerCase() !== String(cardTypeFilter || "").toLowerCase()) {
      return;
    }
    const ability = String(card?.ability || "").trim();
    if (!ability) {
      return;
    }
    const parsedEffects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
    const cardType = String(card?.type || "unknown");
    const hasCostToken = /\b(?:M(?:C)+|Expend(?:\s+(?:Fire|Air|Earth|Water|all Disciplines(?:\s+\d+)?))?|Discard\s+\w+\s+Mugic\s+Cards?)\s*:/i.test(ability);
    if (!parsedEffects.length) {
      entries.push({
        reason: "sem_parse",
        cardType,
        cardName: String(card?.name || "").trim(),
        effectKind: "-",
        sourceText: ability,
      });
      if (hasCostToken) {
        entries.push({
          reason: "cost_parse_pendente",
          cardType,
          cardName: String(card?.name || "").trim(),
          effectKind: "-",
          sourceText: ability,
        });
      }
      return;
    }
    const needsTargetSpec = /(^|\W)target(\W|$)/i.test(ability);
    if (needsTargetSpec) {
      const hasTargetSpec = parsedEffects.some((effect) => effect?.targetSpec && effect.targetSpec.type);
      if (!hasTargetSpec) {
        entries.push({
          reason: "targetspec_insuficiente",
          cardType,
          cardName: String(card?.name || "").trim(),
          effectKind: "-",
          sourceText: ability,
        });
      }
    }
    const pendingKinds = [...new Set(parsedEffects
      .map((effect) => String(effect?.kind || "").trim())
      .filter((kind) => kind && !supportedKinds.has(kind)))];
    pendingKinds.forEach((kind) => {
      entries.push({
        reason: "kind_pendente",
        cardType,
        cardName: String(card?.name || "").trim(),
        effectKind: kind,
        sourceText: resolveSourceTextForEffectKind(card, kind),
      });
    });
  });
  return entries;
}

function formatPendingEffectEntry(entry, origin = "BASE") {
  return `[${origin}] ${entry.reason} | Tipo: ${entry.cardType} | Carta: ${entry.cardName} | Kind: ${entry.effectKind} | Trecho: ${entry.sourceText}`;
}

function writeBasePendingEffectsReport() {
  const supportedKinds = collectAttackSupportedKindsFromEngine();
  const entries = buildEffectPendingEntries(library, supportedKinds, "attacks");
  const header = [
    "Chaotic - Efeitos Pendentes",
    `generatedAt=${new Date().toISOString()}`,
    `total=${entries.length}`,
    "---",
  ];
  const lines = entries.map((entry) => formatPendingEffectEntry(entry, "BASE"));
  const content = `${header.concat(lines).join("\n")}\n`;
  fs.writeFileSync(ATTACK_PENDING_FILE, content, "utf8");

  attackPendingRuntimeKeys.clear();
  entries.forEach((entry) => {
    attackPendingRuntimeKeys.add(pendingAttackEntryKey(entry));
  });

  return {
    total: entries.length,
    semParse: entries.filter((entry) => entry.reason === "sem_parse").length,
    kindPendente: entries.filter((entry) => entry.reason === "kind_pendente").length,
    targetSpecInsuficiente: entries.filter((entry) => entry.reason === "targetspec_insuficiente").length,
    costParsePendente: entries.filter((entry) => entry.reason === "cost_parse_pendente").length,
  };
}

function writeBaseCreaturePendingEffectsReport() {
  const supportedKinds = collectCreatureSupportedKindsFromEngine();
  const entries = buildEffectPendingEntries(library, supportedKinds, "creatures");
  const header = [
    "Chaotic - Efeitos Pendentes (Creatures)",
    `generatedAt=${new Date().toISOString()}`,
    `total=${entries.length}`,
    "---",
  ];
  const lines = entries.map((entry) => formatPendingEffectEntry(entry, "BASE"));
  fs.mkdirSync(path.dirname(CREATURE_PENDING_FILE), { recursive: true });
  fs.writeFileSync(CREATURE_PENDING_FILE, `${header.concat(lines).join("\n")}\n`, "utf8");

  creaturePendingRuntimeKeys.clear();
  entries.forEach((entry) => {
    creaturePendingRuntimeKeys.add(pendingAttackEntryKey(entry));
  });

  return {
    total: entries.length,
    semParse: entries.filter((entry) => entry.reason === "sem_parse").length,
    kindPendente: entries.filter((entry) => entry.reason === "kind_pendente").length,
    targetSpecInsuficiente: entries.filter((entry) => entry.reason === "targetspec_insuficiente").length,
    costParsePendente: entries.filter((entry) => entry.reason === "cost_parse_pendente").length,
  };
}

function appendRuntimePendingEffect(payload = {}) {
  const cardType = String(payload.cardType || "").trim().toLowerCase();
  if (cardType && cardType !== "attacks" && cardType !== "creatures") {
    return { appended: false, reason: "unsupported_type" };
  }
  const pendingType = cardType === "creatures" ? "creatures" : "attacks";
  const cardName = String(payload.cardName || "").trim();
  const effectKind = String(payload.effectKind || "").trim();
  if (!cardName || !effectKind) {
    return { appended: false, reason: "missing_fields" };
  }

  const allCards = library?.cards || [];
  const normalizedName = normalizePendingToken(cardName);
  const card = allCards.find((entry) => {
    const nameMatch = normalizePendingToken(entry?.name || "") === normalizedName;
    if (!nameMatch) {
      return false;
    }
    return normalizePendingToken(entry?.type || "") === normalizePendingToken(pendingType);
  }) || null;
  const sourceText = String(payload.sourceText || "").trim() || resolveSourceTextForEffectKind(card, effectKind) || "Trecho nao identificado.";
  const entry = {
    reason: String(payload.reason || "kind_pendente").trim().toLowerCase(),
    cardType: String(card?.type || pendingType || "unknown"),
    cardName: card?.name || cardName,
    effectKind,
    sourceText,
  };
  const key = pendingAttackEntryKey(entry);
  const runtimeKeys = pendingType === "creatures" ? creaturePendingRuntimeKeys : attackPendingRuntimeKeys;
  const pendingFile = pendingType === "creatures" ? CREATURE_PENDING_FILE : ATTACK_PENDING_FILE;
  if (!key || runtimeKeys.has(key)) {
    return { appended: false, reason: "duplicate" };
  }
  if (!fs.existsSync(pendingFile)) {
    if (pendingType === "creatures") {
      writeBaseCreaturePendingEffectsReport();
    } else {
      writeBasePendingEffectsReport();
    }
  }
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.appendFileSync(pendingFile, `${formatPendingEffectEntry(entry, "RUNTIME")}\n`, "utf8");
  runtimeKeys.add(key);
  return { appended: true };
}

function createDebugSession(meta = {}) {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const stamp = formatLogTimestamp();
  const fileName = `debug-${stamp}-${sessionId}.txt`;
  const filePath = path.join(DEBUG_LOGS_DIR, fileName);
  const header = [
    "Chaotic Debug Session",
    `sessionId=${sessionId}`,
    `startedAt=${new Date().toISOString()}`,
    `url=${String(meta.url || "")}`,
    `userAgent=${String(meta.userAgent || "")}`,
    "---",
  ].join("\n");
  fs.writeFileSync(filePath, `${header}\n`, "utf8");
  debugSessions.set(sessionId, {
    filePath,
    createdAt: new Date().toISOString(),
  });
  return { sessionId, fileName, filePath };
}

function listDecks(username = "") {
  const ownerFilter = username ? normalizeUserKey(username) : "";
  if (isSqlV2Ready()) {
    if (ownerFilter) {
      const ownerlessRows = sqliteDb
        .prepare("SELECT deck_key FROM deck_headers WHERE owner_key = '' AND is_ownerless_legacy = 1")
        .all();
      ownerlessRows.forEach((row) => {
        claimOwnerlessDeckForUser(String(row?.deck_key || ""), ownerFilter);
      });
    }
    const rows = ownerFilter
      ? sqliteDb
          .prepare(`
            SELECT deck_key, owner_key, name, mode, updated_at
            FROM deck_headers
            WHERE owner_key = ?
            ORDER BY deck_key ASC
          `)
          .all(ownerFilter)
      : sqliteDb
          .prepare(`
            SELECT deck_key, owner_key, name, mode, updated_at
            FROM deck_headers
            ORDER BY deck_key ASC
          `)
          .all();
    return rows.map((row) => ({
      name: String(row?.deck_key || ""),
      updatedAt: String(row?.updated_at || nowIso()),
      owner: String(row?.owner_key || ""),
      mode: String(row?.mode || "competitive"),
    }));
  }
  const rows = sqlList("decks");

  const decks = rows
    .map((row) => {
      const payload = safeJsonParse(row.payload, null);
      if (!payload || typeof payload !== "object") {
        return null;
      }
      const owner = deckOwnerKey(payload);
      if (ownerFilter && owner && owner !== ownerFilter) {
        return null;
      }
      return {
        name: row.entity_key,
        updatedAt: row.updated_at,
        owner,
        mode: String(payload.mode || "competitive"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  return decks;
}

function listMusicTracks() {
  const musicDirs = [MUSIC_DIR, MUSIC_DIR_FALLBACK].filter((dir, index, arr) => arr.indexOf(dir) === index && fs.existsSync(dir));
  if (!musicDirs.length) {
    return [];
  }
  const allowedExt = new Set([".mp3", ".wav", ".ogg", ".m4a"]);
  const uniqueByName = new Map();
  musicDirs.forEach((dir) => {
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => allowedExt.has(path.extname(name).toLowerCase()))
      .forEach((name) => {
        if (!uniqueByName.has(name.toLowerCase())) {
          uniqueByName.set(name.toLowerCase(), name);
        }
      });
  });
  return [...uniqueByName.values()]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((name, index) => ({
      id: `track-${index + 1}`,
      name: name.replace(/\.[a-z0-9]+$/i, ""),
      fileName: name,
      url: `/music/${encodeURIComponent(name)}`,
    }));
}

function resolveMusicFilePath(relativeMusicPath) {
  const decodedName = String(relativeMusicPath || "").trim();
  if (!decodedName) {
    return "";
  }
  const candidates = [MUSIC_DIR, MUSIC_DIR_FALLBACK].filter((dir, index, arr) => arr.indexOf(dir) === index);
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const dir = candidates[idx];
    if (!fs.existsSync(dir)) {
      continue;
    }
    const target = path.resolve(dir, decodedName);
    if (!isPathInside(dir, target)) {
      continue;
    }
    if (fs.existsSync(target)) {
      return target;
    }
  }
  return "";
}

const PERIM_LOCATION_TRIBE_KEYS = new Set([
  "overworld",
  "underworld",
  "danian",
  "mipedian",
  "marrillian",
  "tribeless",
]);

function normalizePerimLocationTribeKey(rawValue) {
  const cleaned = String(rawValue || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!cleaned) {
    return "";
  }
  if (
    cleaned === "tribeless"
    || cleaned === "semtribo"
    || cleaned === "generic"
    || cleaned === "notribe"
    || cleaned === "neutral"
    || cleaned === "none"
    || cleaned === "?"
  ) {
    return "tribeless";
  }
  if (cleaned.includes("danian")) {
    return "danian";
  }
  if (cleaned.includes("underworld") || cleaned.includes("submundo")) {
    return "underworld";
  }
  if (cleaned.includes("overworld") || cleaned.includes("outromundo")) {
    return "overworld";
  }
  if (cleaned.includes("mipedian") || cleaned.includes("miprdian") || cleaned.includes("maipidian")) {
    return "mipedian";
  }
  if (cleaned.includes("marrillian") || cleaned.includes("marrilian")) {
    return "marrillian";
  }
  return "";
}

function getPerimLocationTribeOverrideKey(locationCardIdRaw) {
  if (!sqliteDb) {
    return "";
  }
  const locationCardId = String(locationCardIdRaw || "").trim();
  if (!locationCardId) {
    return "";
  }
  try {
    const row = sqliteDb
      .prepare("SELECT tribe_key FROM perim_location_tribes WHERE location_card_id = ? LIMIT 1")
      .get(locationCardId);
    return normalizePerimLocationTribeKey(row?.tribe_key || "");
  } catch (error) {
    console.warn(`[PERIM] Falha ao consultar override de tribo do local ${locationCardId}: ${error?.message || error}`);
    return "";
  }
}

function resolvePerimLocationEffectiveTribeKey(locationEntry) {
  const locationCardId = String(locationEntry?.cardId || locationEntry?.id || "").trim();
  const override = getPerimLocationTribeOverrideKey(locationCardId);
  if (override) {
    return override;
  }
  // No override means no restriction for this location.
  return "";
}

function isPerimTribeMatchForCard(card, expectedTribeKeyRaw) {
  const expectedTribeKey = normalizePerimLocationTribeKey(expectedTribeKeyRaw);
  if (!expectedTribeKey) {
    return true;
  }
  const rawTribe = String(card?.tribe || "").trim();
  if (expectedTribeKey === "tribeless") {
    const normalizedCardTribe = normalizePerimLocationTribeKey(rawTribe);
    if (normalizedCardTribe === "tribeless") {
      return true;
    }
    const fallbackToken = String(rawTribe || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9?]+/g, "");
    if (!fallbackToken || fallbackToken === "?" || fallbackToken === "unknown") {
      return true;
    }
    return false;
  }
  const normalizedCardTribe = normalizePerimLocationTribeKey(rawTribe);
  return normalizedCardTribe === expectedTribeKey;
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

let smtpTransporter = null;
let smtpValidated = false;

function getMissingSmtpConfigKeys() {
  const missing = [];
  if (!SMTP_HOST) missing.push("SMTP_HOST");
  if (!(SMTP_PORT > 0)) missing.push("SMTP_PORT");
  if (!SMTP_USER) missing.push("SMTP_USER");
  if (!SMTP_PASS) missing.push("SMTP_PASS");
  if (!SMTP_FROM) missing.push("SMTP_FROM");
  return missing;
}

function isSmtpConfigured() {
  return getMissingSmtpConfigKeys().length === 0;
}

async function getSmtpTransporter() {
  if (!isSmtpConfigured()) {
    return null;
  }
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  if (!smtpValidated) {
    await smtpTransporter.verify();
    smtpValidated = true;
  }
  return smtpTransporter;
}

async function sendVerificationCodeEmail({ username, email, code }) {
  const transporter = await getSmtpTransporter();
  if (!transporter) {
    throw new Error("smtp_not_configured");
  }
  const sanitize = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: "Chaotic Legacy - Codigo de verificacao",
    text: [
      `Ola, ${username}!`,
      "",
      "Seu codigo de verificacao do Chaotic Legacy:",
      code,
      "",
      "Esse codigo expira em 5 minutos.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#0b1320;color:#e8f3ff;padding:20px;border-radius:10px;">
        <h2 style="margin-top:0;color:#5ad7ff;">Chaotic Legacy</h2>
        <p>Ola, <strong>${sanitize(username)}</strong>!</p>
        <p>Seu codigo de verificacao:</p>
        <div style="font-size:30px;font-weight:700;letter-spacing:4px;padding:12px 14px;border:1px solid #2b6ca6;border-radius:8px;background:#06101d;display:inline-block;">
          ${sanitize(code)}
        </div>
        <p style="margin-top:16px;color:#b4cde3;">Esse codigo expira em 5 minutos.</p>
      </div>
    `,
  });
}

function serveStatic(requestPath, response) {
  if (requestPath === "/favicon.ico") {
    sendFile(response, path.join(ROOT_DIR, "favicon.ico"));
    return;
  }

  if (requestPath.startsWith("/downloads/")) {
    const decoded = decodeURIComponent(requestPath);
    const target = path.resolve(ROOT_DIR, `.${decoded}`);
    if (!isPathInside(DOWNLOADS_DIR, target)) {
      sendText(response, 403, "Forbidden");
      return;
    }
    sendFile(response, target);
    return;
  }

  if (requestPath.startsWith("/music/")) {
    const decoded = decodeURIComponent(requestPath);
    const relativeMusicPath = decoded.replace(/^\/music\//i, "");
    const target = resolveMusicFilePath(relativeMusicPath);
    if (!target) {
      console.warn(`[MUSIC] Arquivo nao encontrado no compartilhado: ${relativeMusicPath}`);
      sendText(response, 404, "Not found");
      return;
    }
    sendFile(response, target);
    return;
  }

  const basePath = requestPath === "/" ? "/auth.html" : requestPath;
  const decoded = decodeURIComponent(basePath);
  const target = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!isPathInside(PUBLIC_DIR, target)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    sendFile(response, target);
    return;
  }

  sendFile(response, path.join(PUBLIC_DIR, "index.html"));
}

async function handleRequest(request, response) {
  const parsedUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  applySecurityHeaders(request, response);
  applyCorsHeaders(request, response);
  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && pathname === "/health") {
    const dbOk = Boolean(sqliteDb);
    const healthPayload = {
      ok: true,
      timestamp: nowIso(),
      uptimeSeconds: Math.round(process.uptime()),
      version: getPackageVersion(),
      libraryStorage: String(library?.storage || "json_files"),
      catalogCardsTotal: Number(library?.stats?.totalCards || 0),
      db: {
        driver: dbOk ? "sqlite" : "json_fallback",
        ok: dbOk,
        dbSchemaVersion: Number(sqlSchemaVersion || 0),
        storageMode: String(sqlStorageMode || "unknown"),
      },
    };
    if (!IS_PRODUCTION_ENV) {
      healthPayload.smtpConfigured = isSmtpConfigured();
      healthPayload.turnstileConfigured = Boolean(TURNSTILE_SECRET_KEY);
      healthPayload.jobs = {
        perim: { ...runtimeMetrics.perimJobs },
        backup: { ...runtimeMetrics.backups },
      };
    }
    sendJson(response, 200, healthPayload);
    return;
  }

  if (request.method === "GET" && pathname === "/api/admin/metrics") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    if (applyRateLimitWithUser(request, response, "admin_metrics", adminUser.username, {
      windowMs: 10 * 1000,
      maxHits: 15,
    })) {
      return;
    }
    sendJson(response, 200, {
      ok: true,
      metrics: buildRuntimeMetricsSnapshot(),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/admin/perim-drop-tables") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    sendJson(response, 200, {
      ok: true,
      tables: getPerimDropTables(),
      file: PERIM_DROP_TABLES_FILE,
    });
    return;
  }

  if (request.method === "PUT" && pathname === "/api/admin/perim-drop-tables") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const normalized = normalizePerimDropTables(payload);
    try {
      persistPerimDropTables(normalized);
      perimDropTablesCache = normalized;
      writePerimActionsDropsReport();
      sendJson(response, 200, {
        ok: true,
        tables: normalized,
      });
      return;
    } catch (error) {
      sendJson(response, 500, { error: `Falha ao salvar tabela de drops: ${error?.message || error}` });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/admin/perim-drop-tables/reload") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    const tables = loadPerimDropTables(true);
    writePerimActionsDropsReport();
    sendJson(response, 200, {
      ok: true,
      tables,
      reloadedAt: nowIso(),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/admin/online-players") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Monitor online indisponivel sem banco SQL." });
      return;
    }
    const now = nowIso();
    const rows = sqliteDb
      .prepare(`
        SELECT username, email, tribe, session_ip, session_device, session_expires_at, last_login_at
        FROM users
        WHERE session_token IS NOT NULL
          AND session_token != ''
          AND session_expires_at IS NOT NULL
          AND session_expires_at > ?
        ORDER BY username ASC
      `)
      .all(now);
    const scoreStmt = sqliteDb.prepare(`
      SELECT
        COALESCE(rg.elo, p.score, 1200) AS score,
        COALESCE(p.wins, 0) AS wins,
        COALESCE(p.losses, 0) AS losses,
        COALESCE(p.updated_at, rg.updated_at, '') AS updated_at
      FROM users u
      LEFT JOIN player_profiles p ON p.owner_key = lower(u.username)
      LEFT JOIN ranked_global rg ON rg.owner_key = lower(u.username)
      WHERE lower(u.username) = ?
      LIMIT 1
    `);
    const scansStmt = sqliteDb.prepare("SELECT card_type, COUNT(*) AS total FROM scan_entries WHERE owner_key = ? GROUP BY card_type");
    const players = rows.map((row) => {
      const ownerKey = normalizeUserKey(row?.username);
      const scoreRow = scoreStmt.get(ownerKey) || {};
      const scanRows = scansStmt.all(ownerKey) || [];
      const scansByType = {
        creatures: 0,
        attacks: 0,
        battlegear: 0,
        locations: 0,
        mugic: 0,
      };
      let scansTotal = 0;
      scanRows.forEach((scanRow) => {
        const type = String(scanRow?.card_type || "").toLowerCase();
        const total = Math.max(0, Number(scanRow?.total || 0));
        scansByType[type] = total;
        scansTotal += total;
      });
      return {
        username: String(row?.username || ownerKey),
        ownerKey,
        email: String(row?.email || ""),
        tribe: String(row?.tribe || ""),
        ip: String(row?.session_ip || ""),
        device: String(row?.session_device || ""),
        sessionExpiresAt: String(row?.session_expires_at || ""),
        lastLoginAt: String(row?.last_login_at || ""),
        score: Math.max(0, Number(scoreRow?.score || 0)),
        wins: Math.max(0, Number(scoreRow?.wins || 0)),
        losses: Math.max(0, Number(scoreRow?.losses || 0)),
        scans: {
          total: scansTotal,
          byType: scansByType,
        },
      };
    });
    sendJson(response, 200, {
      ok: true,
      generatedAt: nowIso(),
      totalOnline: players.length,
      players,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/admin/audit-log") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Audit log indisponivel sem banco SQL." });
      return;
    }
    const limitRaw = Number(parsedUrl.searchParams.get("limit") || 100);
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
    const rows = sqliteDb
      .prepare(`
        SELECT id, event_type, severity, owner_key, ip_address, message, payload_json, created_at
        FROM audit_log
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit);
    sendJson(response, 200, {
      ok: true,
      entries: rows.map((row) => ({
        id: Number(row?.id || 0),
        eventType: String(row?.event_type || ""),
        severity: String(row?.severity || "info"),
        ownerKey: String(row?.owner_key || ""),
        ipAddress: String(row?.ip_address || ""),
        message: String(row?.message || ""),
        payload: safeJsonParse(row?.payload_json, null),
        createdAt: String(row?.created_at || ""),
      })),
    });
    return;
  }

  const isAuthWrite = request.method === "POST" && (
    pathname === "/api/auth/register"
    || pathname === "/api/auth/verify"
    || pathname === "/api/auth/resend"
    || pathname === "/api/auth/login"
    || pathname === "/api/auth/logout"
  );
  if (isAuthWrite && applyRateLimit(request, response, "auth", {
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    maxHits: AUTH_RATE_LIMIT_MAX,
  })) {
    return;
  }

  const isMultiplayerAction = request.method === "POST" && pathname.startsWith("/api/multiplayer/rooms/") && pathname.endsWith("/action");
  if (isMultiplayerAction && applyRateLimit(request, response, "multiplayer_action", {
    windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
    maxHits: ACTION_RATE_LIMIT_MAX,
  })) {
    return;
  }

  // ─── Auth API ───────────────────────────────────────────────────────
  if (pathname === "/api/auth/register" && request.method === "POST") {
    let payloadText;
    try { payloadText = await readBody(request); } catch (e) { sendJson(response, 413, { error: e.message }); return; }
    const payload = safeJsonParse(payloadText, null);
    if (!payload) { sendJson(response, 400, { error: "JSON invalido." }); return; }
    const usernameInput = String(payload.username || "").trim();
    const usernameResolution = resolveAuthUsernameInput(usernameInput, { strict: true });
    if (!usernameResolution.ok) {
      sendJson(response, 400, { error: usernameResolution.error || "Username invalido." });
      return;
    }
    const username = usernameResolution.username;
    const email = String(payload.email || "").trim();
    const passwordPlain = String(payload.password || "").trim();
    const legacyProvidedHash = String(payload.passwordHash || "").trim();
    const resolvedPassword = passwordPlain || decodeLegacyPasswordHash(legacyProvidedHash);
    const tribe = String(payload.tribe || "");
    const turnstileToken = String(payload.turnstileToken || "").trim();
    const requestIp = getClientIp(request);
    if (!username || !email || !resolvedPassword) {
      sendJson(response, 400, { error: "Campos obrigatorios ausentes." });
      return;
    }
    if (!passwordPlain && legacyProvidedHash) {
      appendAuditLog("auth_register_legacy_passwordhash_used", {
        severity: "warn",
        ownerKey: username,
        ipAddress: requestIp,
        message: "Cadastro recebido com passwordHash legado.",
      });
    }
    if (resolvedPassword.length < 6) {
      sendJson(response, 400, { error: "Senha deve ter no minimo 6 caracteres." });
      return;
    }
    if (applyRateLimitWithUser(request, response, "auth_register_user", username, {
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      maxHits: AUTH_RATE_LIMIT_MAX,
    })) {
      return;
    }
    if (!isSmtpConfigured()) {
      const missingSmtpKeys = getMissingSmtpConfigKeys();
      console.warn(
        `[AUTH][REGISTER] Cadastro bloqueado por SMTP ausente. missing=${missingSmtpKeys.length ? missingSmtpKeys.join(",") : "none"} user=${username || "(empty)"}`
      );
      sendJson(response, 503, { error: "Cadastro indisponivel: SMTP nao configurado no servidor." });
      return;
    }
    const turnstileResult = await validateTurnstileToken(turnstileToken, requestIp);
    if (!turnstileResult.ok) {
      appendAuditLog("auth_register_turnstile_reject", {
        severity: "warn",
        ownerKey: username,
        ipAddress: requestIp,
        message: "Cadastro bloqueado por captcha invalido.",
        payload: { reason: turnstileResult.error },
      });
      const captchaError = turnstileResult.error === "turnstile_not_configured"
        ? "Cadastro indisponivel: captcha nao configurado no servidor."
        : "Validacao anti-bot falhou. Tente novamente.";
      sendJson(response, 400, { error: captchaError });
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 500, { error: "Banco de dados indisponivel." });
      return;
    }
    const usernameOwnerKey = normalizeUserKey(username, "");
    const ownerKeyCollision = sqliteDb
      .prepare("SELECT username FROM users WHERE username <> ? COLLATE NOCASE")
      .all(username)
      .find((row) => normalizeUserKey(row?.username || "", "") === usernameOwnerKey);
    if (ownerKeyCollision) {
      sendJson(response, 409, { error: "Nome de acesso conflita com outro usuario existente. Escolha outro username." });
      return;
    }
    // Check existing and resume pending registrations when possible
    const existingUser = sqliteDb
      .prepare("SELECT id, username, email, verified FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
      .get(username);
    const existingEmail = sqliteDb
      .prepare("SELECT id, username, email, verified FROM users WHERE email = ? COLLATE NOCASE LIMIT 1")
      .get(email);
    const userVerified = Number(existingUser?.verified || 0) === 1;
    const emailVerified = Number(existingEmail?.verified || 0) === 1;
    if (existingUser && userVerified) {
      sendJson(response, 409, { error: "Nome de acesso ja existe." });
      return;
    }
    if (existingEmail && emailVerified) {
      sendJson(response, 409, { error: "Email ja cadastrado." });
      return;
    }
    let resumedPending = false;
    let targetUser = null;
    if (existingEmail && !emailVerified) {
      targetUser = existingEmail;
      resumedPending = true;
    } else if (existingUser && !userVerified) {
      targetUser = existingUser;
      resumedPending = true;
    }

    const now = nowIso();
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    let targetUsername = username;
    let targetEmail = email;

    if (!resumedPending) {
      const passwordHash = hashPasswordSecure(resolvedPassword);
      sqliteDb.prepare(`
        INSERT INTO users (username, email, password_hash, tribe, verified, session_token, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
      `).run(username, email, passwordHash, tribe, now, now);
    } else {
      targetUsername = String(targetUser?.username || username).trim();
      targetEmail = String(targetUser?.email || email).trim();
    }
    // Store verification code temporarily in kv_store
    sqlSet("verification", targetUsername.toLowerCase(), {
      code: verificationCode,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    try {
      await sendVerificationCodeEmail({ username: targetUsername, email: targetEmail, code: verificationCode });
    } catch (error) {
      if (!resumedPending) {
        sqliteDb.prepare("DELETE FROM users WHERE username = ? COLLATE NOCASE").run(targetUsername);
        sqlDelete("verification", targetUsername.toLowerCase());
      }
      console.error("[AUTH] Falha ao enviar email de verificacao:", error?.message || error);
      sendJson(response, 502, { error: "Nao foi possivel enviar o e-mail de verificacao. Tente novamente." });
      return;
    }
    appendAuditLog("auth_register_success", {
      severity: "info",
      ownerKey: targetUsername,
      ipAddress: requestIp,
      message: resumedPending
        ? "Cadastro pendente retomado com reenvio de codigo."
        : "Cadastro iniciado com envio de codigo.",
    });
    sendJson(response, 200, {
      ok: true,
      username: targetUsername,
      email: targetEmail,
      pendingResumed: resumedPending,
    });
    return;
  }

  if (pathname === "/api/auth/verify" && request.method === "POST") {
    let payloadText;
    try { payloadText = await readBody(request); } catch (e) { sendJson(response, 413, { error: e.message }); return; }
    const payload = safeJsonParse(payloadText, null);
    if (!payload) { sendJson(response, 400, { error: "JSON invalido." }); return; }
    const usernameInput = String(payload.username || "").trim();
    const usernameResolution = resolveAuthUsernameInput(usernameInput, { strict: false });
    if (!usernameResolution.ok) {
      sendJson(response, 400, { error: usernameResolution.error || "Username invalido." });
      return;
    }
    const username = usernameResolution.username;
    const code = String(payload.code || "").trim();
    if (!username || !code) {
      sendJson(response, 400, { error: "Campos obrigatorios ausentes." });
      return;
    }
    if (applyRateLimitWithUser(request, response, "auth_verify_user", username, {
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      maxHits: Math.max(6, Math.floor(AUTH_RATE_LIMIT_MAX / 2)),
    })) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 500, { error: "Banco de dados indisponivel." });
      return;
    }
    const storedVerification = sqlGet("verification", username.toLowerCase());
    if (!storedVerification) {
      sendJson(response, 400, { error: "Sessao de verificacao expirada. Tente cadastrar novamente." });
      return;
    }
    if (Date.now() > storedVerification.expiresAt) {
      sqlDelete("verification", username.toLowerCase());
      sendJson(response, 400, { error: "O codigo expirou. Solicite um novo." });
      return;
    }
    if (code !== storedVerification.code) {
      sendJson(response, 400, { error: "Codigo invalido." });
      return;
    }
    // Mark user as verified and generate session token
    sqliteDb.prepare("UPDATE users SET verified = 1, updated_at = ? WHERE username = ? COLLATE NOCASE")
      .run(nowIso(), username);
    sqlDelete("verification", username.toLowerCase());
    const user = sqliteDb.prepare("SELECT id, username, email, tribe FROM users WHERE username = ? COLLATE NOCASE").get(username);
    const session = issueSessionForUserId(user?.id, {
      clientIp: getClientIp(request),
      clientFingerprint: buildClientFingerprint(request),
    });
    if (!session) {
      sendJson(response, 500, { error: "Falha ao iniciar sessao." });
      return;
    }
    response.setHeader("Set-Cookie", buildSessionCookieHeader(request, session.sessionToken, session.expiresAt));
    sendJson(response, 200, {
      ok: true,
      sessionExpiresAt: session.expiresAt,
      username: user?.username || username,
      tribe: user?.tribe || "",
    });
    return;
  }

  if (pathname === "/api/auth/resend" && request.method === "POST") {
    let payloadText;
    try { payloadText = await readBody(request); } catch (e) { sendJson(response, 413, { error: e.message }); return; }
    const payload = safeJsonParse(payloadText, null);
    if (!payload) { sendJson(response, 400, { error: "JSON invalido." }); return; }
    const usernameInput = String(payload.username || "").trim();
    const usernameResolution = resolveAuthUsernameInput(usernameInput, { strict: false });
    if (!usernameResolution.ok) {
      sendJson(response, 400, { error: usernameResolution.error || "Username invalido." });
      return;
    }
    const username = usernameResolution.username;
    if (!username) {
      sendJson(response, 400, { error: "Username obrigatorio." });
      return;
    }
    if (applyRateLimitWithUser(request, response, "auth_resend_user", username, {
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      maxHits: Math.max(6, Math.floor(AUTH_RATE_LIMIT_MAX / 2)),
    })) {
      return;
    }
    if (!isSmtpConfigured()) {
      const missingSmtpKeys = getMissingSmtpConfigKeys();
      console.warn(
        `[AUTH][RESEND] Reenvio bloqueado por SMTP ausente. missing=${missingSmtpKeys.length ? missingSmtpKeys.join(",") : "none"} user=${username || "(empty)"}`
      );
      sendJson(response, 503, { error: "Reenvio indisponivel: SMTP nao configurado no servidor." });
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 500, { error: "Banco de dados indisponivel." });
      return;
    }
    const user = sqliteDb
      .prepare("SELECT username, email, verified FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
    if (!user) {
      sendJson(response, 404, { error: "Conta nao encontrada." });
      return;
    }
    if (Number(user.verified || 0) === 1) {
      sendJson(response, 409, { error: "Conta ja verificada." });
      return;
    }
    if (!user.email) {
      sendJson(response, 400, { error: "Conta sem e-mail cadastrado para reenvio." });
      return;
    }
    const newCode = String(Math.floor(100000 + Math.random() * 900000));
    sqlSet("verification", username.toLowerCase(), {
      code: newCode,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    try {
      await sendVerificationCodeEmail({ username: user.username || username, email: user.email, code: newCode });
    } catch (error) {
      console.error("[AUTH] Falha no reenvio de email de verificacao:", error?.message || error);
      sendJson(response, 502, { error: "Nao foi possivel reenviar o e-mail de verificacao." });
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    let payloadText;
    try { payloadText = await readBody(request); } catch (e) { sendJson(response, 413, { error: e.message }); return; }
    const payload = safeJsonParse(payloadText, null);
    if (!payload) { sendJson(response, 400, { error: "JSON invalido." }); return; }
    const usernameInput = String(payload.username || "").trim();
    const usernameResolution = resolveAuthUsernameInput(usernameInput, { strict: false });
    if (!usernameResolution.ok) {
      sendJson(response, 400, { error: usernameResolution.error || "Username invalido." });
      return;
    }
    const username = usernameResolution.username;
    const passwordPlain = String(payload.password || "").trim();
    const legacyProvidedHash = String(payload.passwordHash || "").trim();
    const resolvedPassword = passwordPlain || decodeLegacyPasswordHash(legacyProvidedHash);
    const requestIp = getClientIp(request);
    const fingerprint = buildClientFingerprint(request);
    if (!username || !resolvedPassword) {
      sendJson(response, 400, { error: "Campos obrigatorios ausentes." });
      return;
    }
    if (!passwordPlain && legacyProvidedHash) {
      appendAuditLog("auth_login_legacy_passwordhash_used", {
        severity: "warn",
        ownerKey: username,
        ipAddress: requestIp,
        message: "Login recebido com passwordHash legado.",
      });
    }
    const lockState = getLoginLockState(requestIp, username);
    if (lockState.blocked) {
      response.setHeader("Retry-After", String(lockState.retryAfterSeconds));
      sendJson(response, 429, {
        error: "Muitas tentativas de login. Aguarde e tente novamente.",
        retryAfterSeconds: lockState.retryAfterSeconds,
      });
      return;
    }
    if (applyRateLimitWithUser(request, response, "auth_login_user", username, {
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      maxHits: AUTH_RATE_LIMIT_MAX,
    })) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 500, { error: "Banco de dados indisponivel." });
      return;
    }
    const user = sqliteDb.prepare("SELECT id, username, email, password_hash, tribe, verified, session_ip, session_device, last_login_at FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (!user) {
      registerLoginFailure(requestIp, username);
      sendJson(response, 401, { error: "Nome de acesso nao encontrado." });
      return;
    }
    const passwordCheck = verifyPasswordAgainstStored(resolvedPassword, user.password_hash);
    if (!passwordCheck.ok) {
      const failure = registerLoginFailure(requestIp, username);
      appendAuditLog("auth_login_failure", {
        severity: "warn",
        ownerKey: username,
        ipAddress: requestIp,
        message: "Senha incorreta.",
        payload: { failures: failure.failures },
      });
      sendJson(response, 401, { error: "Senha incorreta." });
      return;
    }
    if (passwordCheck.needsUpgrade) {
      sqliteDb
        .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(hashPasswordSecure(resolvedPassword), nowIso(), Number(user.id));
    }
    if (!user.verified) {
      registerLoginFailure(requestIp, username);
      sendJson(response, 403, { error: "Conta nao verificada. Valide o codigo enviado por e-mail ou solicite reenvio." });
      return;
    }
    clearLoginFailure(requestIp, username);
    const isSuspiciousLogin = Boolean(user?.session_ip) && String(user.session_ip).trim() !== String(requestIp).trim();
    if (isSuspiciousLogin) {
      appendAuditLog("auth_login_suspicious_ip_change", {
        severity: "warn",
        ownerKey: user.username,
        ipAddress: requestIp,
        message: "Mudanca de IP detectada no login.",
        payload: {
          previousIp: String(user.session_ip || ""),
          currentIp: requestIp,
          previousDevice: String(user.session_device || ""),
          currentDevice: fingerprint,
          lastLoginAt: String(user.last_login_at || ""),
        },
      });
    }
    const session = issueSessionForUserId(user.id, {
      clientIp: requestIp,
      clientFingerprint: fingerprint,
    });
    if (!session) {
      sendJson(response, 500, { error: "Falha ao iniciar sessao." });
      return;
    }
    appendAuditLog("auth_login_success", {
      severity: "info",
      ownerKey: user.username,
      ipAddress: requestIp,
      message: "Login concluido com sucesso.",
    });
    response.setHeader("Set-Cookie", buildSessionCookieHeader(request, session.sessionToken, session.expiresAt));
    sendJson(response, 200, {
      ok: true,
      sessionExpiresAt: session.expiresAt,
      username: user.username,
      tribe: user.tribe,
    });
    return;
  }

  if (pathname === "/api/auth/session" && request.method === "GET") {
    if (!sqliteDb) {
      sendJson(response, 401, { error: "Sessao invalida." });
      return;
    }
    const token = getRequestSessionToken(request) || "";
    const user = loadUserByValidSessionToken(token);
    if (!user) {
      response.setHeader("Set-Cookie", clearSessionCookieHeader(request));
      sendJson(response, 401, { error: "Sessao expirada ou invalida." });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      username: user.username,
      email: user.email,
      tribe: user.tribe,
      role: user.role || "player",
      sessionExpiresAt: user.session_expires_at || null,
    });
    markUserPresenceActive(user.username || "");
    return;
  }

  if (pathname === "/api/presence/ping" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const entry = markUserPresenceActive(authUser.username || "");
    sendJson(response, 200, {
      ok: true,
      ownerKey: normalizeUserKey(authUser.username || "", ""),
      lastSeenAt: entry?.lastSeenAt || nowIso(),
      ttlMs: PRESENCE_HEARTBEAT_TTL_MS,
    });
    return;
  }

  if (pathname === "/api/presence/online" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Presenca online indisponivel sem banco SQL." });
      return;
    }
    markUserPresenceActive(authUser.username || "");
    const limitRaw = Number(parsedUrl.searchParams.get("limit") || 50);
    const players = listOnlinePresencePlayers(limitRaw);
    sendJson(response, 200, {
      ok: true,
      total: players.length,
      players,
      ttlMs: PRESENCE_HEARTBEAT_TTL_MS,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    const token = getRequestSessionToken(request) || "";
    const userBeforeLogout = token ? loadUserByValidSessionToken(token) : null;
    if (token && sqliteDb) {
      clearSessionToken(token);
    }
    if (userBeforeLogout?.username) {
      clearUserPresence(userBeforeLogout.username);
    }
    response.setHeader("Set-Cookie", clearSessionCookieHeader(request));
    sendJson(response, 200, { ok: true });
    return;
  }
  // ─── End Auth API ───────────────────────────────────────────────────

  if (request.method === "GET" && pathname === "/api/library") {
    sendJson(response, 200, library);
    return;
  }

  if (request.method === "GET" && pathname === "/api/scans") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const username = String(authUser.username || "local-player");
    const editingDeck =
      parsedUrl.searchParams.get("editingDeckAnchor")
      || parsedUrl.searchParams.get("editingDeck")
      || "";
    const cacheKey = `${normalizeUserKey(username)}:${normalizeDeckName(editingDeck) || "_"}`;
    const payload = cacheRead(userResponseCache.scans, cacheKey, () => {
      const { scans, available, userCards } = buildAvailableScansForDeck(editingDeck, username);
      const baseStats = countBucketCards(userCards);
      const availableStats = countBucketCards(available);
      return {
        cards: cloneCardBuckets(userCards),
        available,
        stats: {
          base: baseStats,
          available: availableStats,
        },
        updatedAt: scans.updatedAt || null,
      };
    });
    sendJson(response, 200, payload);
    return;
  }

  if (request.method === "GET" && pathname === "/api/scans/copies") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const username = String(authUser.username || "local-player");
    const editingDeck =
      parsedUrl.searchParams.get("editingDeckAnchor")
      || parsedUrl.searchParams.get("editingDeck")
      || "";
    const cardId = String(parsedUrl.searchParams.get("cardId") || "").trim();
    if (!cardId) {
      sendJson(response, 400, { error: "cardId e obrigatorio." });
      return;
    }
    const scans = loadScansData();
    const copies = listAvailableCreatureCopiesForCard(scans, username, cardId, editingDeck);
    sendJson(response, 200, {
      ok: true,
      cardId,
      copies,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/scans/rebuild-from-decks") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText = "";
    try {
      payloadText = await readBody(request);
    } catch {
      payloadText = "";
    }
    const payload = safeJsonParse(payloadText, {});
    const username = String(authUser.username || "local-player").trim() || "local-player";
    const scans = loadScansData();
    const ownerKey = normalizeUserKey(username);
    scans.players[ownerKey] = {
      cards: buildScansSeedFromDecks(ownerKey),
    };
    const saved = writeScansData(scans, "rebuild_from_decks");
    const stats = countBucketCards(saved.players?.[ownerKey]?.cards || createEmptyCardBuckets());
    sendJson(response, 200, {
      ok: true,
      username: ownerKey,
      cards: cloneCardBuckets(saved.players?.[ownerKey]?.cards || createEmptyCardBuckets()),
      stats,
      updatedAt: saved.updatedAt,
    });
    return;
  }

  if (pathname === "/api/perim/state" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const playerKey = String(authUser.username || "local-player");
    const cacheKey = normalizePerimPlayerKey(playerKey);
    const payload = cacheRead(userResponseCache.perim, cacheKey, () => ({ ok: true, ...buildPerimStatePayload(playerKey) }));
    sendJson(response, 200, payload);
    return;
  }

  if (pathname === "/api/perim/events" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const playerKey = String(authUser.username || "local-player");
    const locationEntries = collectPerimLocationEntriesForPlayer(playerKey);
    const locations = buildPerimLocationsFromScans(locationEntries).map((entry) => ({
      ...entry,
      contextPreview: buildPerimContextSnapshot(entry, "explore"),
    }));
    const climateEvents = buildPerimClimateEventCards(locations);
    const dropEvents = listPerimDropEventCards(locations, new Date());
    const legacyEvents = [
      ...climateEvents.map((entry) => ({
        id: String(entry.id || ""),
        name: String(entry.title || "Evento climatico"),
        description: String(entry.description || ""),
        startAt: "",
        endAt: "",
        source: "climate",
      })),
      ...dropEvents.map((entry) => ({
        id: String(entry.id || ""),
        name: String(entry.title || "Evento de drop"),
        description: String(entry.description || ""),
        startAt: String(entry.startAt || ""),
        endAt: String(entry.endAt || ""),
        source: "drop_admin",
      })),
    ];
    sendJson(response, 200, {
      ok: true,
      climateEvents,
      dropEvents,
      events: legacyEvents,
      updatedAt: nowIso(),
    });
    return;
  }

  if (pathname.startsWith("/api/perim/locations/")) {
    const parts = pathname.split("/");
    const locationId = decodeURIComponent(parts[4] || "").trim();
    const chatSegment = String(parts[5] || "").trim().toLowerCase();
    const chatSubsegment = String(parts[6] || "").trim().toLowerCase();
    if (!locationId || chatSegment !== "chat") {
      sendJson(response, 404, { error: "Rota de chat do Perim nao encontrada." });
      return;
    }
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "");
    if (!canAccessPerimLocationChat(ownerKey, locationId, Date.now())) {
      sendJson(response, 403, { error: "Somente jogadores em acao ativa neste local podem usar o chat." });
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Chat do local indisponivel sem banco SQL." });
      return;
    }
    cleanupPerimLocationChatHistory(todayDateKey());
    if (request.method === "GET" && !chatSubsegment) {
      const limitRaw = Number(parsedUrl.searchParams.get("limit") || 80);
      const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 80));
      const targetLang = normalizeChatLanguage(parsedUrl.searchParams.get("lang") || "pt");
      const rawMessages = listPerimLocationChatMessages(locationId, { limit, dayKey: todayDateKey() });
      const messages = await translateChatMessagesForViewer(rawMessages, ownerKey, targetLang, "perim_location_history");
      sendJson(response, 200, {
        ok: true,
        locationId,
        dayKey: todayDateKey(),
        language: targetLang,
        messages,
      });
      return;
    }
    if (request.method === "POST" && !chatSubsegment) {
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { error: error.message });
        return;
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        sendJson(response, 400, { error: "JSON invalido." });
        return;
      }
      const postResult = await postPerimLocationChatMessage(
        locationId,
        ownerKey,
        authUser.username || ownerKey,
        payload.message
      );
      if (!postResult.ok) {
        sendJson(response, 400, { error: postResult.error || "Nao foi possivel enviar a mensagem." });
        return;
      }
      sendJson(response, 200, { ok: true, locationId, message: postResult.message });
      return;
    }
    if (request.method === "GET" && chatSubsegment === "events") {
      const targetLang = normalizeChatLanguage(parsedUrl.searchParams.get("lang") || "pt");
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      if (!perimLocationChatClients.has(locationId)) {
        perimLocationChatClients.set(locationId, new Set());
      }
      const client = { res: response, ownerKey, lang: targetLang };
      perimLocationChatClients.get(locationId).add(client);
      const initialMessagesRaw = listPerimLocationChatMessages(locationId, { limit: 60, dayKey: todayDateKey() });
      const initialMessages = await translateChatMessagesForViewer(initialMessagesRaw, ownerKey, targetLang, "perim_location_events_snapshot");
      response.write(`data: ${JSON.stringify({ type: "perim_location_chat_snapshot", locationId, language: targetLang, messages: initialMessages })}\n\n`);
      const pingTimer = setInterval(() => {
        if (!canAccessPerimLocationChat(ownerKey, locationId, Date.now())) {
          try {
            response.write(`data: ${JSON.stringify({ type: "perim_location_chat_revoked", locationId })}\n\n`);
          } catch {}
          try {
            response.end();
          } catch {}
          return;
        }
        try {
          response.write(`data: ${JSON.stringify({ type: "ping", at: nowIso() })}\n\n`);
        } catch {}
      }, 25000);
      request.on("close", () => {
        clearInterval(pingTimer);
        const set = perimLocationChatClients.get(locationId);
        if (set) {
          set.delete(client);
          if (!set.size) {
            perimLocationChatClients.delete(locationId);
          }
        }
      });
      return;
    }
  }

  if (pathname === "/api/perim/missions/weekly" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Missoes semanais indisponiveis sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const mission = ensureWeeklyPerimMission(new Date());
    const progress = mission
      ? sqliteDb
        .prepare(`
          SELECT progress_value, completed_at, claimed_at, updated_at
          FROM weekly_mission_progress
          WHERE mission_key = ? AND owner_key = ?
        `)
        .get(String(mission.mission_key), ownerKey)
      : null;
    sendJson(response, 200, {
      ok: true,
      missions: mission
        ? [{
          missionKey: String(mission.mission_key),
          weekStart: String(mission.week_start),
          missionType: String(mission.mission_type),
          targetValue: Number(mission.target_value || 0),
          progressValue: Math.max(0, Number(progress?.progress_value || 0)),
          completedAt: progress?.completed_at || null,
          claimedAt: progress?.claimed_at || null,
          updatedAt: progress?.updated_at || null,
        }]
        : [],
    });
    return;
  }

  if (pathname === "/api/perim/missions/weekly/claim" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const missionKey = String(payload.missionKey || "").trim();
    const result = claimWeeklyMissionReward(authUser.username, missionKey);
    if (!result.ok) {
      sendJson(response, 400, { error: result.error || "Nao foi possivel coletar missao semanal." });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      claimedAt: result.claimedAt,
      rewards: result.rewards || [],
    });
    return;
  }

  if (pathname === "/api/perim/start" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const playerKeyRaw = String(authUser.username || "local-player");
    if (applyRateLimitWithUser(request, response, "perim_start_user", playerKeyRaw, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: ACTION_RATE_LIMIT_MAX,
    })) {
      return;
    }
    const locationCardId = String(payload.locationCardId || "").trim();
    const locationEntryId = String(payload.locationEntryId || "").trim();
    const actionId = String(payload.actionId || "").trim();
    if (!locationCardId && !locationEntryId) {
      sendJson(response, 400, { error: "Selecione um local." });
      return;
    }
    if (!PERIM_ACTION_LOOKUP.has(actionId)) {
      sendJson(response, 400, { error: "Acao PERIM invalida." });
      return;
    }

    const rootState = loadPerimStateFile();
    const { state: playerState } = getOrCreatePerimPlayerState(rootState, playerKeyRaw);
    promotePerimFinishedRuns(playerState, Date.now());
    if (playerState.activeRun) {
      sendJson(response, 409, { error: "Ja existe uma acao em andamento." });
      return;
    }

    const scans = loadScansData();
    const { cards, changed: scansChanged } = getScansCardsForUser(scans, playerKeyRaw, true);
    if (scansChanged) {
      writeScansData(scans, "perim_start_scans_bootstrap");
    }
    const locationEntries = collectPerimLocationEntriesForPlayer(playerKeyRaw, cards);
    const locations = buildPerimLocationsFromScans(locationEntries);
    let selectedLocation = locationCardId
      ? locations.find((entry) => entry.cardId === locationCardId) || null
      : null;
    if (!selectedLocation) {
      selectedLocation = locations.find((entry) => entry.entryId === locationEntryId) || null;
    }
    if (!selectedLocation) {
      const fallbackCardId = String(locationEntryId.split("#")[0] || "").trim();
      if (fallbackCardId) {
        selectedLocation = locations.find((entry) => entry.cardId === fallbackCardId) || null;
      }
    }
    if (!selectedLocation) {
      selectedLocation = locations[0] || null;
      console.warn(
        `[PERIM][START][LOCATION_FALLBACK] user=${normalizePerimPlayerKey(playerKeyRaw)} ` +
        `locationCardId=${locationCardId || "-"} locationEntryId=${locationEntryId || "-"} ` +
        `resolved=${selectedLocation?.cardId || "-"} eligibleCount=${locations.length}`
      );
    }
    if (!selectedLocation) {
      sendJson(response, 400, { error: "Nenhum local elegivel encontrado para iniciar acao." });
      return;
    }

    const locationCard = (library?.cardsByType?.locations || []).find((card) => card.id === selectedLocation.cardId) || null;
    if (!locationCard) {
      sendJson(response, 400, { error: "Carta de local nao encontrada na biblioteca." });
      return;
    }

    const action = PERIM_ACTION_LOOKUP.get(actionId);
    const profilesState = loadProfilesData();
    const { profile, changed: profileChanged } = getOrCreateProfile(profilesState, playerKeyRaw);
    if (profileChanged) {
      writeProfilesData(profilesState, "perim_start_profile_bootstrap");
    }
    const scannerState = resolveScannerStateForLocation(profile, selectedLocation);
    const instantPerim = isPerimInstantAdmin(playerKeyRaw);
    const startAt = new Date();
    const durationMs = instantPerim
      ? 0
      : computePerimDurationMs(locationCard.id, actionId, action.durationMs, {
        ...scannerState.effect,
        globalDurationMultiplier: scannerState.globalDurationMultiplier,
      });
    const endAt = new Date(startAt.getTime() + durationMs);
    const runId = crypto.randomBytes(12).toString("hex");
    const inventoryCounts = buildInventoryCountMap(cards);
    const locationOwnedTotalCounts = buildPlayerLocationOwnershipCountMap(playerKeyRaw, cards);
    const questExclusiveRewardCardKeys = getQuestLockedRewardKeySet(playerKeyRaw);
    const locationTribeKey = resolvePerimLocationEffectiveTribeKey(selectedLocation);
    const campWaitCount = actionId === "camp"
      ? getPerimCampWaitCount(playerState, locationCard.id)
      : 0;
    const campHasSuperRarePlusEligible = actionId === "camp"
      ? hasCampSuperRarePlusEligibleAtLocation(selectedLocation, {
          inventoryCounts,
          ignoreInventoryCap: instantPerim,
          locationTribeKey,
          excludedRewardCardKeys: questExclusiveRewardCardKeys,
        })
      : false;
    const baseContextSnapshot = buildPerimContextSnapshot(selectedLocation, actionId, scannerState.effect, startAt, []);
    const rewards = buildPerimRewards(selectedLocation, actionId, {
      inventoryCounts,
      locationOwnedTotalCounts,
      scannerEffect: scannerState.effect,
      tribeScannerRareBoosts: scannerState.tribeRareBoostMap,
      includeCreatureVariant: true,
      ignoreInventoryCap: instantPerim,
      campWaitCount,
      excludedRewardCardKeys: questExclusiveRewardCardKeys,
      contextSnapshot: baseContextSnapshot,
      startDate: startAt,
    });
    let droppedQuest = null;
    if (actionId === "anomaly") {
      droppedQuest = assignPerimQuestFromAnomaly(playerKeyRaw, locationCard.id, cards);
    }
    const reservedQuest = reserveQuestRewardForRun(
      playerKeyRaw,
      runId,
      locationCard.id,
      rewards,
      inventoryCounts,
      {
        cards,
        ignoreInventoryCap: instantPerim,
        questExclusiveRewardCardKeys,
      }
    );
    const clues = buildPerimCluesForRun(actionId, selectedLocation, rewards, {
      inventoryCounts,
      scannerEffect: scannerState.effect,
      ignoreInventoryCap: instantPerim,
      locationTribeKey,
    });
    const contextSnapshot = buildPerimContextSnapshot(selectedLocation, actionId, scannerState.effect, startAt, clues);
    if (actionId === "camp") {
      contextSnapshot.campHasSuperRarePlusEligible = Boolean(campHasSuperRarePlusEligible);
    }
    playerState.activeRun = {
      runId,
      locationEntryId,
      locationId: locationCard.id,
      locationName: locationCard.name,
      locationImage: locationCard.image || "",
      locationCard: locationCard,
      actionId,
      actionLabel: action.name,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      durationMs,
      scanner: {
        key: scannerState.scannerKey,
        level: scannerState.level,
      },
      contextSnapshot,
      rewards,
      createdAt: nowIso(),
    };

    if (instantPerim) {
      promotePerimFinishedRuns(playerState, Date.now() + 1);
    }

    playerState.updatedAt = nowIso();
    writePerimStateFile(rootState);
    invalidateUserCaches(playerKeyRaw);
    sendJson(response, 200, {
      ok: true,
      activeRun: playerState.activeRun,
      pendingRewards: playerState.pendingRewards,
      instant: instantPerim,
      questDrop: droppedQuest
        ? {
            questKey: droppedQuest.questKey,
            title: droppedQuest.title,
          }
        : null,
      questReserved: reservedQuest
        ? {
            questKey: reservedQuest.questKey,
          }
        : null,
    });
    return;
  }

  if (pathname === "/api/perim/claim" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const playerKeyRaw = String(authUser.username || "local-player");
    if (applyRateLimitWithUser(request, response, "perim_claim_user", playerKeyRaw, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: ACTION_RATE_LIMIT_MAX,
    })) {
      return;
    }
    const runId = String(payload.runId || "").trim();
    const rootState = loadPerimStateFile();
    const { state: playerState } = getOrCreatePerimPlayerState(rootState, playerKeyRaw);
    const changed = promotePerimFinishedRuns(playerState, Date.now());
    const claimResult = claimPerimRewardsForRun(playerState, runId, playerKeyRaw);
    if (!claimResult.ok) {
      if (changed) {
        writePerimStateFile(rootState);
      }
      sendJson(response, 400, {
        error: claimResult.error || "Falha ao coletar recompensas.",
        needsChoices: Boolean(claimResult.needsChoices),
        runId: claimResult.runId || runId || "",
        choiceGroups: Array.isArray(claimResult.choiceGroups) ? claimResult.choiceGroups : [],
        choiceSelections: claimResult.choiceSelections && typeof claimResult.choiceSelections === "object"
          ? claimResult.choiceSelections
          : {},
      });
      return;
    }
    writePerimStateFile(rootState);
    sendJson(response, 200, { ok: true, ...claimResult });
    return;
  }

  if (pathname === "/api/perim/debug/finish" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    let payloadText = "";
    try {
      payloadText = await readBody(request);
    } catch {
      payloadText = "";
    }
    const payload = safeJsonParse(payloadText, {});
    const playerKeyRaw = String(payload.playerKey || payload.username || "local-player");
    const rootState = loadPerimStateFile();
    const { state: playerState } = getOrCreatePerimPlayerState(rootState, playerKeyRaw);
    if (playerState.activeRun) {
      playerState.activeRun.endAt = new Date(Date.now() - 1000).toISOString();
      promotePerimFinishedRuns(playerState, Date.now());
      writePerimStateFile(rootState);
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/profile" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const username = String(authUser.username || "local-player");
    const cacheKey = normalizeUserKey(username);
    const payload = cacheRead(userResponseCache.profile, cacheKey, () => ({ ok: true, profile: buildProfilePayload(username) }));
    sendJson(response, 200, payload);
    return;
  }

  if (pathname === "/api/perim/claim/choices" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const playerKeyRaw = String(authUser.username || "local-player");
    if (applyRateLimitWithUser(request, response, "perim_claim_choice_user", playerKeyRaw, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: ACTION_RATE_LIMIT_MAX,
    })) {
      return;
    }
    const runId = String(payload.runId || "").trim();
    const choices = payload.choiceSelections && typeof payload.choiceSelections === "object"
      ? payload.choiceSelections
      : (payload.choices && typeof payload.choices === "object" ? payload.choices : {});
    const rootState = loadPerimStateFile();
    const { state: playerState } = getOrCreatePerimPlayerState(rootState, playerKeyRaw);
    promotePerimFinishedRuns(playerState, Date.now());
    const result = setPerimClaimChoiceSelections(playerState, runId, choices);
    if (!result.ok) {
      sendJson(response, 400, { error: result.error || "Falha ao salvar escolhas da recompensa." });
      return;
    }
    playerState.updatedAt = nowIso();
    writePerimStateFile(rootState);
    invalidateUserCaches(playerKeyRaw);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname === "/api/profile/quests" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Quests indisponiveis sem banco SQL." });
      return;
    }
    const payload = buildProfileQuestsPayload(authUser.username);
    sendJson(response, 200, {
      ok: true,
      ...payload,
    });
    return;
  }

  if (pathname === "/api/profile/friends" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const friends = listFriendSummaries(ownerKey);
    sendJson(response, 200, {
      ok: true,
      friends,
      total: friends.length,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname.startsWith("/api/profile/friends/") && pathname.endsWith("/summary") && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "");
    const parts = pathname.split("/");
    const friendUsername = decodeURIComponent(parts[4] || "").trim();
    if (!friendUsername) {
      sendJson(response, 400, { error: "Username do amigo invalido." });
      return;
    }
    const friendSummary = getProfileSummaryByUsername(friendUsername);
    const friendKey = normalizeUserKey(friendSummary?.ownerKey || friendSummary?.username || "", "");
    if (!friendSummary || !friendKey) {
      sendJson(response, 404, { error: "Amigo nao encontrado." });
      return;
    }
    const relation = sqliteDb
      .prepare("SELECT 1 AS ok FROM friends WHERE owner_key = ? AND friend_key = ? LIMIT 1")
      .get(ownerKey, friendKey);
    if (!relation?.ok) {
      sendJson(response, 403, { error: "Esse usuario nao esta na sua lista de amigos." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    const seasonKey = seasonKeyFromDate(new Date());
    const friendProfile = buildProfilePayload(friendKey);
    const presence = getFriendPresenceMap(ownerKey, [friendKey])[friendKey] || { status: "offline" };
    sendJson(response, 200, {
      ok: true,
      seasonKey,
      friend: {
        username: friendSummary.username || friendKey,
        ownerKey: friendKey,
        avatar: friendProfile.avatar || friendSummary.avatar || "",
        favoriteTribe: friendProfile.favoriteTribe || friendSummary.favoriteTribe || "",
        score: Number(friendProfile.score || friendSummary.score || 0),
        wins: Number(friendProfile.wins || friendSummary.wins || 0),
        losses: Number(friendProfile.losses || friendSummary.losses || 0),
        winRate: Number(friendProfile.winRate || friendSummary.winRate || 0),
        mostPlayedCreature: friendProfile.mostPlayedCreature || null,
        scans: friendProfile.scans || { total: 0, byType: {} },
        currentDrome: friendProfile.currentDrome || null,
        currentTagTitle: friendProfile.currentTagTitle || "",
        currentTag: friendProfile.currentTag || null,
        presence,
        updatedAt: friendProfile.updatedAt || friendSummary.updatedAt || nowIso(),
      },
    });
    return;
  }

  if (pathname === "/api/profile/friends/presence" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const friends = listFriendSummaries(ownerKey);
    const friendKeys = friends
      .map((entry) => normalizeUserKey(entry?.ownerKey || entry?.username || "", ""))
      .filter(Boolean);
    const presence = getFriendPresenceMap(ownerKey, friendKeys);
    sendJson(response, 200, {
      ok: true,
      presence,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/profile/friends/requests" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const requests = listFriendRequests(ownerKey);
    sendJson(response, 200, {
      ok: true,
      incoming: requests.incoming,
      outgoing: requests.outgoing,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/profile/friends/request" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const targetUsername = String(payload.username || "").trim();
    if (!targetUsername) {
      sendJson(response, 400, { error: "Username do amigo obrigatorio." });
      return;
    }
    if (applyRateLimitWithUser(request, response, "friends_request_user", ownerKey, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: Math.max(6, Math.floor(ACTION_RATE_LIMIT_MAX / 2)),
    })) {
      return;
    }
    const targetSummary = getProfileSummaryByUsername(targetUsername);
    const targetKey = normalizeUserKey(targetSummary?.username || targetUsername, "");
    if (!targetSummary || !targetKey) {
      sendJson(response, 404, { error: "Jogador nao encontrado." });
      return;
    }
    if (targetKey === ownerKey) {
      sendJson(response, 400, { error: "Nao e possivel adicionar a si mesmo." });
      return;
    }
    const alreadyFriends = sqliteDb
      .prepare("SELECT 1 FROM friends WHERE owner_key = ? AND friend_key = ? LIMIT 1")
      .get(ownerKey, targetKey);
    if (alreadyFriends) {
      sendJson(response, 409, { error: "Esse jogador ja esta na sua lista de amigos." });
      return;
    }
    const pendingAnyDirection = sqliteDb
      .prepare(`
        SELECT id, from_owner_key, to_owner_key
        FROM friend_requests
        WHERE status = 'pending'
          AND ((from_owner_key = ? AND to_owner_key = ?) OR (from_owner_key = ? AND to_owner_key = ?))
        LIMIT 1
      `)
      .get(ownerKey, targetKey, targetKey, ownerKey);
    if (pendingAnyDirection) {
      const fromOwner = String(pendingAnyDirection.from_owner_key || "");
      if (fromOwner === targetKey) {
        sendJson(response, 409, { error: "Esse jogador ja te enviou um convite pendente." });
        return;
      }
      sendJson(response, 409, { error: "Voce ja enviou um convite para esse jogador." });
      return;
    }
    const createdAt = nowIso();
    const insertResult = sqliteDb.prepare(`
      INSERT INTO friend_requests (from_owner_key, to_owner_key, status, created_at, updated_at, responded_at)
      VALUES (?, ?, 'pending', ?, ?, NULL)
    `).run(ownerKey, targetKey, createdAt, createdAt);
    createProfileNotification(
      targetKey,
      "friend_request_received",
      "Novo convite de amizade",
      `${authUser.username} enviou um convite de amizade.`,
      { from: ownerKey, fromUsername: String(authUser.username || ownerKey) }
    );
    appendAuditLog("friend_request_sent", {
      severity: "info",
      ownerKey,
      ipAddress: getClientIp(request),
      message: `Convite de amizade enviado para ${targetKey}.`,
      payload: { requestId: Number(insertResult?.lastInsertRowid || 0), targetKey },
    });
    sendJson(response, 200, {
      ok: true,
      requestId: Number(insertResult?.lastInsertRowid || 0),
      target: targetSummary,
    });
    return;
  }

  if (pathname === "/api/profile/friends/respond" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const requestId = Number(payload.requestId || 0);
    const decision = String(payload.decision || "").toLowerCase();
    if (!requestId || (decision !== "accept" && decision !== "reject")) {
      sendJson(response, 400, { error: "Dados de resposta invalidos." });
      return;
    }
    if (applyRateLimitWithUser(request, response, "friends_respond_user", ownerKey, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: Math.max(8, Math.floor(ACTION_RATE_LIMIT_MAX / 2)),
    })) {
      return;
    }
    const requestRow = sqliteDb
      .prepare(`
        SELECT id, from_owner_key, to_owner_key, status
        FROM friend_requests
        WHERE id = ? AND to_owner_key = ?
        LIMIT 1
      `)
      .get(requestId, ownerKey);
    if (!requestRow) {
      sendJson(response, 404, { error: "Convite nao encontrado." });
      return;
    }
    if (String(requestRow.status) !== "pending") {
      sendJson(response, 409, { error: "Esse convite ja foi respondido." });
      return;
    }
    const fromOwnerKey = normalizeUserKey(requestRow.from_owner_key, "");
    const respondedAt = nowIso();
    sqliteDb.prepare(`
      UPDATE friend_requests
      SET status = ?, updated_at = ?, responded_at = ?
      WHERE id = ?
    `).run(decision === "accept" ? "accepted" : "rejected", respondedAt, respondedAt, requestId);
    if (decision === "accept") {
      sqliteDb.prepare(`
        INSERT OR IGNORE INTO friends (owner_key, friend_key, created_at, source_request_id)
        VALUES (?, ?, ?, ?)
      `).run(ownerKey, fromOwnerKey, respondedAt, requestId);
      sqliteDb.prepare(`
        INSERT OR IGNORE INTO friends (owner_key, friend_key, created_at, source_request_id)
        VALUES (?, ?, ?, ?)
      `).run(fromOwnerKey, ownerKey, respondedAt, requestId);
      createProfileNotification(
        fromOwnerKey,
        "friend_request_accepted",
        "Convite aceito",
        `${authUser.username} aceitou seu convite de amizade.`,
        { by: ownerKey, byUsername: String(authUser.username || ownerKey) }
      );
    } else {
      createProfileNotification(
        fromOwnerKey,
        "friend_request_rejected",
        "Convite recusado",
        `${authUser.username} recusou seu convite de amizade.`,
        { by: ownerKey, byUsername: String(authUser.username || ownerKey) }
      );
    }
    appendAuditLog("friend_request_responded", {
      severity: "info",
      ownerKey,
      ipAddress: getClientIp(request),
      message: `Convite ${requestId} respondido com ${decision}.`,
      payload: { requestId, decision, fromOwnerKey },
    });
    sendJson(response, 200, {
      ok: true,
      decision,
      requestId,
      friends: listFriendSummaries(ownerKey),
      requests: listFriendRequests(ownerKey),
    });
    return;
  }

  if (pathname === "/api/profile/friends/remove" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Sistema de amigos indisponivel sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const targetUsername = String(payload.username || "").trim();
    const targetSummary = getProfileSummaryByUsername(targetUsername);
    const targetKey = normalizeUserKey(targetSummary?.username || targetUsername, "");
    if (!targetSummary || !targetKey) {
      sendJson(response, 404, { error: "Jogador nao encontrado." });
      return;
    }
    if (targetKey === ownerKey) {
      sendJson(response, 400, { error: "Operacao invalida para o proprio usuario." });
      return;
    }
    if (applyRateLimitWithUser(request, response, "friends_remove_user", ownerKey, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: Math.max(6, Math.floor(ACTION_RATE_LIMIT_MAX / 2)),
    })) {
      return;
    }
    const deleteForward = sqliteDb.prepare("DELETE FROM friends WHERE owner_key = ? AND friend_key = ?").run(ownerKey, targetKey);
    const deleteBackward = sqliteDb.prepare("DELETE FROM friends WHERE owner_key = ? AND friend_key = ?").run(targetKey, ownerKey);
    if (!Number(deleteForward?.changes || 0) && !Number(deleteBackward?.changes || 0)) {
      sendJson(response, 404, { error: "Esse jogador nao esta na sua lista de amigos." });
      return;
    }
    createProfileNotification(
      targetKey,
      "friend_removed",
      "Amizade removida",
      `${authUser.username} removeu voce da lista de amigos.`,
      { by: ownerKey, byUsername: String(authUser.username || ownerKey) }
    );
    appendAuditLog("friend_removed", {
      severity: "info",
      ownerKey,
      ipAddress: getClientIp(request),
      message: `Amizade removida com ${targetKey}.`,
      payload: { targetKey },
    });
    sendJson(response, 200, {
      ok: true,
      removed: targetKey,
      friends: listFriendSummaries(ownerKey),
    });
    return;
  }

  if (pathname === "/api/profile/notifications" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Notificacoes indisponiveis sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const limit = Number(parsedUrl.searchParams.get("limit") || 50);
    const result = listProfileNotifications(ownerKey, limit);
    sendJson(response, 200, {
      ok: true,
      notifications: result.entries,
      unreadCount: result.unreadCount,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/profile/notifications/read-one" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Notificacoes indisponiveis sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const id = Number(payload.id || 0);
    if (!id) {
      sendJson(response, 400, { error: "Id de notificacao invalido." });
      return;
    }
    sqliteDb.prepare(`
      UPDATE profile_notifications
      SET is_read = 1, read_at = COALESCE(read_at, ?)
      WHERE owner_key = ? AND id = ?
    `).run(nowIso(), ownerKey, id);
    const result = listProfileNotifications(ownerKey, 50);
    sendJson(response, 200, {
      ok: true,
      unreadCount: result.unreadCount,
    });
    return;
  }

  if (pathname === "/api/profile/notifications/read" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Notificacoes indisponiveis sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const now = nowIso();
    if (payload.all === true) {
      sqliteDb.prepare(`
        UPDATE profile_notifications
        SET is_read = 1, read_at = COALESCE(read_at, ?)
        WHERE owner_key = ? AND is_read = 0
      `).run(now, ownerKey);
    } else {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 300)
        : [];
      if (!ids.length) {
        sendJson(response, 400, { error: "Informe ids de notificacao validos ou all=true." });
        return;
      }
      const placeholders = ids.map(() => "?").join(", ");
      sqliteDb.prepare(`
        UPDATE profile_notifications
        SET is_read = 1, read_at = COALESCE(read_at, ?)
        WHERE owner_key = ? AND id IN (${placeholders})
      `).run(now, ownerKey, ...ids);
    }
    const result = listProfileNotifications(ownerKey, 50);
    sendJson(response, 200, {
      ok: true,
      unreadCount: result.unreadCount,
    });
    return;
  }

  if (pathname === "/api/profile/avatar" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const username = String(authUser.username || "local-player");
    const avatar = String(payload.avatar || "").trim();
    if (!avatar) {
      sendJson(response, 400, { error: "Avatar invalido." });
      return;
    }
    const profilesState = loadProfilesData();
    const { profile } = getOrCreateProfile(profilesState, username);
    profile.avatar = avatar;
    profile.updatedAt = nowIso();
    writeProfilesData(profilesState, "profile_avatar");
    invalidateUserCaches(username);
    sendJson(response, 200, { ok: true, profile: buildProfilePayload(username) });
    return;
  }

  if (pathname === "/api/profile/battle-result" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const username = String(authUser.username || "local-player");
    const result = String(payload.result || "").toLowerCase();
    if (result !== "win" && result !== "loss") {
      sendJson(response, 400, { error: "Resultado invalido." });
      return;
    }
    const matchType = normalizeMatchType(payload.matchType || "");
    const challengeMeta = payload?.challengeMeta && typeof payload.challengeMeta === "object" ? payload.challengeMeta : null;
    const challengeDromeId = normalizeDromeId(challengeMeta?.dromeId || payload?.dromeId || "");
    const challengeCodemasterKey = normalizeUserKey(challengeMeta?.codemasterKey || "", "");
    const challengeChallengerKey = normalizeUserKey(challengeMeta?.challengerKey || "", "");
    const challengeRoomId = String(payload?.roomId || "").trim();
    const isRankedMatch = matchType === MATCH_TYPE_RANKED_DROME || matchType === MATCH_TYPE_CODEMASTER_CHALLENGE;
    if (isRankedMatch && !sqliteDb) {
      sendJson(response, 503, { error: "Partida ranqueada indisponivel sem banco SQL ativo." });
      return;
    }
    if (matchType === MATCH_TYPE_RANKED_DROME) {
      const seasonKey = seasonKeyFromDate(new Date());
      const selection = getDromeSelectionForSeason(username, seasonKey);
      if (!selection?.dromeId) {
        sendJson(response, 400, { error: "Selecione um Dromo antes de contabilizar partidas ranqueadas." });
        return;
      }
      if (challengeDromeId && selection.dromeId !== challengeDromeId) {
        sendJson(response, 400, { error: "Partida ranqueada informada para Dromo diferente do selecionado neste mes." });
        return;
      }
    }
    if (matchType === MATCH_TYPE_CODEMASTER_CHALLENGE) {
      if (!challengeDromeId || !challengeCodemasterKey || !challengeChallengerKey || !challengeRoomId) {
        sendJson(response, 400, { error: "Dados do desafio CodeMaster incompletos." });
        return;
      }
      const callerKey = normalizeUserKey(username, "");
      if (callerKey !== challengeCodemasterKey && callerKey !== challengeChallengerKey) {
        sendJson(response, 400, { error: "Usuario desta sessao nao pertence ao desafio informado." });
        return;
      }
    }
    const profilesState = loadProfilesData();
    const { profile } = getOrCreateProfile(profilesState, username);
    applyBattleResultToProfile(profile, payload, {
      affectScore: isRankedMatch,
      scoreWin: 20,
      scoreLoss: 10,
    });
    writeProfilesData(profilesState, "profile_battle_result");
    let globalRankRow = null;
    if (isRankedMatch) {
      upsertSeasonPlayerDelta(username, {
        score: result === "win" ? 20 : -5,
        wins: result === "win" ? 1 : 0,
        losses: result === "loss" ? 1 : 0,
      });
      globalRankRow = upsertGlobalRankDelta(username, result);
      if (globalRankRow) {
        profile.score = Math.max(100, Number(globalRankRow?.elo || profile.score || 1200));
      }
    }
    if (matchType === MATCH_TYPE_RANKED_DROME) {
      upsertDromeRankDelta(username, result, new Date(), {
        forcedDromeId: challengeDromeId || "",
      });
    } else if (matchType === MATCH_TYPE_CODEMASTER_CHALLENGE) {
      const callerKey = normalizeUserKey(username, "");
      const codemasterWinScore = DROME_RANKED_WIN_SCORE + CODEMASTER_WIN_BONUS_SCORE;
      const isCallerCodemaster = callerKey === challengeCodemasterKey;
      upsertDromeRankDelta(username, result, new Date(), {
        forcedDromeId: challengeDromeId,
        winScore: isCallerCodemaster ? codemasterWinScore : DROME_RANKED_WIN_SCORE,
        lossScore: DROME_RANKED_LOSS_SCORE,
      });

      const winnerKey = result === "win"
        ? callerKey
        : (isCallerCodemaster ? challengeChallengerKey : challengeCodemasterKey);
      const loserKey = winnerKey === challengeCodemasterKey ? challengeChallengerKey : challengeCodemasterKey;
      sqliteDb
        .prepare(`
          INSERT INTO drome_challenge_outcomes
            (room_id, season_key, drome_id, codemaster_key, challenger_key, winner_key, loser_key, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(room_id) DO UPDATE SET
            winner_key = excluded.winner_key,
            loser_key = excluded.loser_key,
            updated_at = excluded.updated_at
        `)
        .run(
          challengeRoomId,
          seasonKeyFromDate(new Date()),
          challengeDromeId,
          challengeCodemasterKey,
          challengeChallengerKey,
          winnerKey,
          loserKey,
          nowIso()
        );
      if (winnerKey === challengeChallengerKey) {
        grantCodemasterUltraRareReward({
          codemasterKeyRaw: challengeCodemasterKey,
          challengerKeyRaw: challengeChallengerKey,
          dromeIdRaw: challengeDromeId,
          seasonKeyRaw: seasonKeyFromDate(new Date()),
          roomIdRaw: challengeRoomId,
        });
      }
    }
    if (isRankedMatch) {
      writeProfilesData(profilesState, "profile_battle_result_ranked_sync");
    }
    invalidateUserCaches(username);
    sendJson(response, 200, { ok: true, profile: buildProfilePayload(username) });
    return;
  }

  if (pathname === "/api/profile/creature-usage" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const username = String(authUser.username || "local-player");
    const profilesState = loadProfilesData();
    const { profile } = getOrCreateProfile(profilesState, username);
    const changed = applyCreatureUsageToProfile(profile, payload);
    if (!changed) {
      sendJson(response, 400, { error: "Carta de criatura invalida." });
      return;
    }
    writeProfilesData(profilesState, "profile_creature_usage");
    invalidateUserCaches(username);
    sendJson(response, 200, { ok: true, profile: buildProfilePayload(username) });
    return;
  }

  if (pathname === "/api/profile/bootstrap" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const username = String(authUser.username || "local-player");
    const favoriteTribe = String(payload.favoriteTribe || "").trim();
    const profilesState = loadProfilesData();
    const { key, profile } = getOrCreateProfile(profilesState, username);
    if (favoriteTribe) {
      profile.favoriteTribe = favoriteTribe;
    }
    const scans = loadScansData();
    const starterPackResult = applyStarterPackIfEligible(key, profile, scans, favoriteTribe);
    if (starterPackResult.scansChanged) {
      writeScansData(scans, "profile_bootstrap_starter_pack");
    }
    profile.updatedAt = nowIso();
    writeProfilesData(profilesState, "profile_bootstrap_tribe");
    invalidateUserCaches(username);
    sendJson(response, 200, {
      ok: true,
      profile: buildProfilePayload(username),
      starterPackApplied: starterPackResult.applied,
      starterPackReason: starterPackResult.reason,
      starterPackItems: starterPackResult.items,
    });
    return;
  }

  if (pathname === "/api/season/current" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Temporadas indisponiveis sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const season = ensureCurrentSeasonRow(new Date());
    const stats = sqliteDb
      .prepare(`
        SELECT score, wins, losses, perim_claims, updated_at
        FROM season_player_stats
        WHERE season_key = ? AND owner_key = ?
      `)
      .get(String(season?.seasonKey || ""), ownerKey);
    sendJson(response, 200, {
      ok: true,
      season: season || null,
      player: {
        username: ownerKey,
        score: Math.max(0, Number(stats?.score || 0)),
        wins: Math.max(0, Number(stats?.wins || 0)),
        losses: Math.max(0, Number(stats?.losses || 0)),
        perimClaims: Math.max(0, Number(stats?.perim_claims || 0)),
        updatedAt: String(stats?.updated_at || ""),
      },
      rewards: listSeasonRewards(ownerKey, season?.seasonKey || ""),
    });
    return;
  }

  if (pathname === "/api/season/leaderboard" && request.method === "GET") {
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Temporadas indisponiveis sem banco SQL." });
      return;
    }
    const season = ensureCurrentSeasonRow(new Date());
    const rows = sqliteDb
      .prepare(`
        SELECT owner_key, score, wins, losses, perim_claims
        FROM season_player_stats
        WHERE season_key = ?
        ORDER BY score DESC, wins DESC, perim_claims DESC
        LIMIT 100
      `)
      .all(String(season?.seasonKey || ""));
    sendJson(response, 200, {
      ok: true,
      season: season || null,
      leaderboard: rows.map((row, index) => ({
        rank: index + 1,
        username: normalizeUserKey(row?.owner_key),
        score: Math.max(0, Number(row?.score || 0)),
        wins: Math.max(0, Number(row?.wins || 0)),
        losses: Math.max(0, Number(row?.losses || 0)),
        perimClaims: Math.max(0, Number(row?.perim_claims || 0)),
      })),
    });
    return;
  }

  if (pathname === "/api/season/missions" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Missoes indisponiveis sem banco SQL." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username);
    const mission = ensureDailyPerimMission(new Date());
    const progress = mission
      ? sqliteDb
        .prepare(`
          SELECT progress_value, completed_at, claimed_at, updated_at
          FROM daily_mission_progress
          WHERE mission_key = ? AND owner_key = ?
        `)
        .get(String(mission.mission_key), ownerKey)
      : null;
    sendJson(response, 200, {
      ok: true,
      missions: mission
        ? [{
          missionKey: String(mission.mission_key),
          missionDate: String(mission.mission_date),
          missionType: String(mission.mission_type),
          targetValue: Number(mission.target_value || 0),
          progressValue: Math.max(0, Number(progress?.progress_value || 0)),
          completedAt: progress?.completed_at || null,
          claimedAt: progress?.claimed_at || null,
          updatedAt: progress?.updated_at || null,
        }]
        : [],
    });
    return;
  }

  if (pathname === "/api/season/missions/claim" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const username = String(authUser.username || "local-player");
    const missionKey = String(payload.missionKey || buildDailyPerimMissionKey(new Date()));
    if (applyRateLimitWithUser(request, response, "season_mission_claim", username, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: Math.max(6, Math.floor(ACTION_RATE_LIMIT_MAX / 2)),
    })) {
      return;
    }
    const claimResult = claimDailyMissionReward(username, missionKey);
    if (!claimResult.ok) {
      sendJson(response, 400, { error: claimResult.error || "Falha ao coletar recompensa da missao." });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      ...claimResult,
    });
    return;
  }

  if (pathname === "/api/ranked/global" && request.method === "GET") {
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Ranking global indisponivel sem banco SQL." });
      return;
    }
    const rows = sqliteDb
      .prepare(`
        SELECT owner_key, elo, wins, losses, updated_at
        FROM ranked_global
        ORDER BY elo DESC, wins DESC, losses ASC
        LIMIT 200
      `)
      .all();
    sendJson(response, 200, {
      ok: true,
      leaderboard: rows.map((row, index) => ({
        rank: index + 1,
        username: normalizeUserKey(row?.owner_key),
        elo: Math.max(100, Number(row?.elo || 1200)),
        wins: Math.max(0, Number(row?.wins || 0)),
        losses: Math.max(0, Number(row?.losses || 0)),
        updatedAt: String(row?.updated_at || ""),
      })),
    });
    return;
  }

  if (pathname === "/api/leaderboards/top50" && request.method === "GET") {
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Leaderboard indisponivel sem banco SQL." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    const metric = String(parsedUrl.searchParams.get("metric") || "score").trim().toLowerCase() === "scans"
      ? "scans"
      : "score";
    const players = listTopPlayers(metric, 50);
    sendJson(response, 200, {
      ok: true,
      metric,
      total: players.length,
      players,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/dromos/overview" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Dromos indisponivel sem banco SQL." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    cleanupExpiredDromeChallengeInvites();
    const seasonKey = seasonKeyFromDate(new Date());
    const ownerKey = normalizeUserKey(authUser.username || "");
    const selection = getDromeSelectionForSeason(ownerKey, seasonKey);
    const currentTag = getCurrentSeasonTagForOwner(ownerKey, seasonKey);
    const invites = listDromeChallengeInvitesForOwner(ownerKey);
    const myCodemasterDromes = DROME_CATALOG
      .map((entry) => ({ dromeId: entry.id, codemaster: getCurrentCodemasterByDrome(entry.id, seasonKey) }))
      .filter((entry) => normalizeUserKey(entry?.codemaster?.ownerKey || "", "") === ownerKey)
      .map((entry) => ({
        id: entry.dromeId,
        name: dromeNameById(entry.dromeId),
        deckLocked: Boolean(entry?.codemaster?.deckLocked),
      }));
    const dromes = DROME_CATALOG.map((entry) => {
      const codemaster = getCurrentCodemasterByDrome(entry.id, seasonKey);
      const topRow = sqliteDb
        .prepare(`
          SELECT owner_key, score, wins, losses, updated_at
          FROM ranked_drome_stats
          WHERE season_key = ? AND drome_id = ?
          ORDER BY score DESC, wins DESC, losses ASC
          LIMIT 1
        `)
        .get(seasonKey, entry.id);
      return {
        id: entry.id,
        name: entry.name,
        codemaster,
        liveTop: topRow
          ? {
              username: normalizeUserKey(topRow?.owner_key || ""),
              score: Math.max(0, Number(topRow?.score || 0)),
              wins: Math.max(0, Number(topRow?.wins || 0)),
              losses: Math.max(0, Number(topRow?.losses || 0)),
              updatedAt: String(topRow?.updated_at || ""),
            }
          : null,
      };
    });
    const selectedStats = selection?.dromeId
      ? sqliteDb
        .prepare(`
          SELECT score, wins, losses, updated_at
          FROM ranked_drome_stats
          WHERE season_key = ? AND drome_id = ? AND owner_key = ?
          LIMIT 1
        `)
        .get(seasonKey, selection.dromeId, ownerKey)
      : null;
    sendJson(response, 200, {
      ok: true,
      seasonKey,
      selection: selection || null,
      locked: Boolean(selection),
      showSelectDrome: !selection,
      showCodemasterActions: myCodemasterDromes.length > 0,
      myCodemasterDromes,
      myTag: currentTag || null,
      myFallbackTag: currentTag?.title ? "" : buildFallbackDromeTag(ownerKey, seasonKey),
      mySelectedStats: selectedStats
        ? {
            score: Math.max(0, Number(selectedStats?.score || DROME_BASE_SCORE)),
            wins: Math.max(0, Number(selectedStats?.wins || 0)),
            losses: Math.max(0, Number(selectedStats?.losses || 0)),
            updatedAt: String(selectedStats?.updated_at || ""),
          }
        : null,
      invites,
      dromes,
      generatedAt: nowIso(),
    });
    return;
  }

  if ((pathname === "/api/dromos/select" || pathname === "/api/ranked/drome/select") && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const dromeId = String(payload.dromeId || "").trim();
    const result = selectDromeForSeason(authUser.username, dromeId, new Date());
    if (!result.ok) {
      sendJson(response, 400, { error: result.error || "Nao foi possivel selecionar o Dromo.", selection: result.selection || null });
      return;
    }
    appendAuditLog("ranked_drome_selected", {
      severity: "info",
      ownerKey: authUser.username,
      ipAddress: getClientIp(request),
      message: `Dromo mensal selecionado: ${result.selection?.dromeId || dromeId}`,
    });
    sendJson(response, 200, { ok: true, selection: result.selection });
    return;
  }

  if (pathname === "/api/dromos/ranked/queue" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    if (!ownerKey) {
      sendJson(response, 400, { error: "Usuario invalido para fila ranked." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    const seasonKey = seasonKeyFromDate(new Date());
    const selection = getDromeSelectionForSeason(ownerKey, seasonKey);
    if (!selection?.dromeId) {
      sendJson(response, 400, { error: "Selecione um Dromo antes de buscar ranked." });
      return;
    }
    cleanupRankedQueue(Date.now());
    clearRankedQueueSession(ownerKey);
    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const entry = {
      ownerKey,
      playerName: String(authUser.username || ownerKey),
      dromeId: selection.dromeId,
      enqueuedAt: nowIso(),
      enqueuedAtMs: nowMs,
    };
    rankedQueueByOwner.set(ownerKey, entry);
    if (!rankedQueueByDrome.has(selection.dromeId)) {
      rankedQueueByDrome.set(selection.dromeId, []);
    }
    rankedQueueByDrome.get(selection.dromeId).push(entry);
    const match = await tryMatchRankedQueue(selection.dromeId, seasonKey, nowDate);
    if (match) {
      const myRoom = rankedQueueMatches.get(ownerKey) || null;
      sendJson(response, 200, {
        ok: true,
        queued: false,
        matched: true,
        room: myRoom,
      });
      return;
    }
    const state = getRankedQueueState(ownerKey, nowMs);
    sendJson(response, 200, {
      ok: true,
      queued: true,
      matched: false,
      queue: state.queue,
    });
    return;
  }

  if (pathname === "/api/dromos/ranked/queue/cancel" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    clearRankedQueueSession(ownerKey);
    sendJson(response, 200, { ok: true, queued: false });
    return;
  }

  if (pathname === "/api/dromos/ranked/session/clear" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    clearRankedQueueSession(ownerKey);
    sendJson(response, 200, { ok: true, cleared: true });
    return;
  }

  if (pathname === "/api/dromos/ranked/queue/state" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    const state = getRankedQueueState(ownerKey, Date.now());
    sendJson(response, 200, {
      ok: true,
      queued: Boolean(state.queued),
      queue: state.queue || null,
      matched: Boolean(state.matchedRoom),
      room: state.matchedRoom || null,
      generatedAt: nowIso(),
    });
    return;
  }

  if ((pathname.startsWith("/api/dromos/") || pathname.startsWith("/api/ranked/drome/")) && pathname.endsWith("/leaderboard") && request.method === "GET") {
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Ranking por Dromo indisponivel sem banco SQL." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    const parts = pathname.split("/");
    const dromeId = parts[2] === "dromos"
      ? normalizeDromeId(parts[3] || "")
      : normalizeDromeId(parts[4] || "");
    if (!dromeId) {
      sendJson(response, 400, { error: "Dromo invalido." });
      return;
    }
    const seasonKey = seasonKeyFromDate(new Date());
    const dromeName = dromeNameById(dromeId);
    const authUser = getAuthenticatedUserFromRequest(request);
    const requestedLimit = Number(parsedUrl.searchParams.get("limit") || 10);
    const maxLimit = normalizeUserKey(authUser?.username || "", "") === "admin" ? 100 : 10;
    const limit = Math.max(1, Math.min(maxLimit, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10));
    const rows = sqliteDb
      .prepare(`
        SELECT owner_key, score, wins, losses, updated_at
        FROM ranked_drome_stats
        WHERE season_key = ? AND drome_id = ?
        ORDER BY score DESC, wins DESC, losses ASC
        LIMIT ?
      `)
      .all(seasonKey, dromeId, limit);
    sendJson(response, 200, {
      ok: true,
      seasonKey,
      drome: { id: dromeId, name: dromeName },
      codemaster: getCurrentCodemasterByDrome(dromeId, seasonKey),
      leaderboard: rows.map((row, index) => dromeRankRowWithTitle(row, index + 1, dromeName)),
      generatedAt: nowIso(),
    });
    return;
  }

  if ((pathname === "/api/dromos/live" || pathname === "/api/ranked/dromes/live") && request.method === "GET") {
    const filterDromeId = normalizeDromeId(parsedUrl.searchParams.get("dromeId") || "");
    const rooms = Array.from(multiplayerRooms.values())
      .filter((room) => room?.phase === "in_game")
      .filter((room) => {
        const matchType = normalizeMatchType(room?.matchType || "");
        if (matchType !== MATCH_TYPE_RANKED_DROME && matchType !== MATCH_TYPE_CODEMASTER_CHALLENGE) {
          return false;
        }
        if (filterDromeId) {
          return normalizeDromeId(room?.dromeId || room?.challengeMeta?.dromeId || "") === filterDromeId;
        }
        return true;
      })
      .map((room) => {
        const summary = buildRoomSummary(room);
        const seasonKey = seasonKeyFromDate(new Date());
        const hostOwner = normalizeUserKey(room?.players?.host?.username || summary.hostUsername || "", "");
        const guestOwner = normalizeUserKey(room?.players?.guest?.username || "", "");
        const dromeId = summary.dromeId || normalizeDromeId(room?.challengeMeta?.dromeId || "");
        const hostScore = hostOwner ? getCurrentDromeScore(hostOwner, seasonKey, dromeId) : DROME_BASE_SCORE;
        const guestScore = guestOwner ? getCurrentDromeScore(guestOwner, seasonKey, dromeId) : DROME_BASE_SCORE;
        const hostDeckName = String(room?.players?.host?.deckName || "Deck Host");
        const guestDeckName = String(room?.players?.guest?.deckName || "Deck Guest");
        const hostName = String(room?.players?.host?.name || "Host");
        const guestName = String(room?.players?.guest?.name || "Guest");
        return {
          roomId: String(room.id || ""),
          phase: String(room.phase || "in_game"),
          matchType: summary.matchType,
          dromeId,
          dromeName: summary.dromeName,
          highlight: summary.highlight,
          hostName,
          hostUsername: String(room?.players?.host?.username || summary.hostUsername),
          hostAvatar: String(room?.players?.host?.avatar || ""),
          hostDeckName,
          hostScore,
          hostMessage: `${hostName} esta jogando de ${hostDeckName}`,
          guestName,
          guestUsername: String(room?.players?.guest?.username || ""),
          guestAvatar: String(room?.players?.guest?.avatar || ""),
          guestDeckName,
          guestScore,
          guestMessage: `${guestName} esta jogando de ${guestDeckName}`,
          updatedAt: String(room?.updatedAt || nowIso()),
        };
      });
    sendJson(response, 200, {
      ok: true,
      total: rooms.length,
      rooms,
      generatedAt: nowIso(),
    });
    return;
  }

  if ((pathname === "/api/dromos/challenges/invites") && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Desafios indisponiveis sem banco SQL." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    const ownerKey = normalizeUserKey(authUser.username || "");
    const invites = listDromeChallengeInvitesForOwner(ownerKey);
    sendJson(response, 200, {
      ok: true,
      incoming: invites.incoming,
      outgoing: invites.outgoing,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/dromos/codemaster/deck-lock" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "CodeMaster indisponivel sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    const ownerKey = normalizeUserKey(authUser.username || "");
    const seasonKey = seasonKeyFromDate(new Date());
    const dromeId = normalizeDromeId(payload.dromeId || "");
    const deckKey = normalizeDeckName(payload.deckName || payload.deckKey || "");
    if (!dromeId || !deckKey) {
      sendJson(response, 400, { error: "dromeId e deckName sao obrigatorios." });
      return;
    }
    const codemaster = sqliteDb
      .prepare(`
        SELECT season_key, drome_id, owner_key
        FROM drome_codemasters
        WHERE season_key = ? AND drome_id = ? AND owner_key = ?
        LIMIT 1
      `)
      .get(seasonKey, dromeId, ownerKey);
    if (!codemaster) {
      sendJson(response, 403, { error: "Apenas o CodeMaster atual deste Dromo pode definir deck de desafio." });
      return;
    }
    const deckData = readDeckFileByName(`${deckKey}.json`);
    if (!deckData) {
      sendJson(response, 404, { error: "Deck nao encontrado." });
      return;
    }
    const deckOwner = normalizeUserKey(deckOwnerKey(deckData), "");
    if (deckOwner && deckOwner !== ownerKey) {
      sendJson(response, 403, { error: "O deck selecionado pertence a outro jogador." });
      return;
    }
    const activeBanlist = getActiveRankedBanlistSnapshot();
    const banlistValidation = validateDeckAgainstRankedBanlist(deckData, activeBanlist);
    if (!banlistValidation.ok) {
      const blocked = banlistValidation.bannedCards
        .slice(0, 6)
        .map((entry) => String(entry?.cardName || entry?.cardId || ""))
        .filter(Boolean);
      sendJson(response, 400, {
        error: `Deck contem carta(s) banida(s) no ranked: ${blocked.join(", ")}.`,
        details: {
          banlist: activeBanlist
            ? { banlistId: activeBanlist.banlistId, name: activeBanlist.name }
            : null,
          blockedCards: banlistValidation.bannedCards,
        },
      });
      return;
    }
    sqliteDb
      .prepare(`
        UPDATE drome_codemasters
        SET deck_key = ?, deck_locked_at = ?
        WHERE season_key = ? AND drome_id = ? AND owner_key = ?
      `)
      .run(deckKey, nowIso(), seasonKey, dromeId, ownerKey);
    sendJson(response, 200, {
      ok: true,
      codemaster: getCurrentCodemasterByDrome(dromeId, seasonKey),
    });
    return;
  }

  if (pathname === "/api/dromos/challenges/invite" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Desafios indisponiveis sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    cleanupExpiredDromeChallengeInvites();
    const seasonKey = seasonKeyFromDate(new Date());
    const codemasterKey = normalizeUserKey(authUser.username || "");
    const dromeId = normalizeDromeId(payload.dromeId || "");
    const challengerSummary = getProfileSummaryByUsername(String(payload.challengerUsername || "").trim());
    const challengerKey = normalizeUserKey(challengerSummary?.ownerKey || challengerSummary?.username || "", "");
    if (!dromeId || !challengerKey) {
      sendJson(response, 400, { error: "dromeId e challengerUsername sao obrigatorios." });
      return;
    }
    const codemasterRow = sqliteDb
      .prepare(`
        SELECT owner_key, deck_key
        FROM drome_codemasters
        WHERE season_key = ? AND drome_id = ?
        LIMIT 1
      `)
      .get(seasonKey, dromeId);
    if (!codemasterRow || normalizeUserKey(codemasterRow?.owner_key || "", "") !== codemasterKey) {
      sendJson(response, 403, { error: "Voce nao e o CodeMaster atual deste Dromo." });
      return;
    }
    if (!String(codemasterRow?.deck_key || "").trim()) {
      sendJson(response, 400, { error: "Defina seu deck de CodeMaster antes de iniciar desafios." });
      return;
    }
    const challengerSelection = getDromeSelectionForSeason(challengerKey, seasonKey);
    if (!challengerSelection?.dromeId || challengerSelection.dromeId !== dromeId) {
      sendJson(response, 400, { error: "O desafiante precisa estar no mesmo Dromo nesta temporada." });
      return;
    }
    const streak = getDromeStreak(challengerKey, dromeId, seasonKey);
    if (streak.current < 7) {
      sendJson(response, 400, { error: "O desafiante precisa de 7 vitorias seguidas no Dromo para ser elegivel." });
      return;
    }
    if (!isUserSessionOnline(challengerKey)) {
      sendJson(response, 400, { error: "O desafiante precisa estar online para receber o convite." });
      return;
    }
    const existingPending = sqliteDb
      .prepare(`
        SELECT invite_id
        FROM drome_challenge_invites
        WHERE season_key = ? AND drome_id = ? AND codemaster_key = ? AND challenger_key = ? AND status = 'pending'
        LIMIT 1
      `)
      .get(seasonKey, dromeId, codemasterKey, challengerKey);
    if (existingPending) {
      sendJson(response, 409, { error: "Ja existe um convite pendente para este jogador neste Dromo." });
      return;
    }
    const inviteId = `cm_${crypto.randomBytes(9).toString("hex")}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + DROME_CHALLENGE_INVITE_TTL_MS).toISOString();
    sqliteDb
      .prepare(`
        INSERT INTO drome_challenge_invites
          (invite_id, season_key, drome_id, codemaster_key, challenger_key, status, room_id, created_at, updated_at, expires_at, responded_at)
        VALUES (?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, NULL)
      `)
      .run(inviteId, seasonKey, dromeId, codemasterKey, challengerKey, createdAt, createdAt, expiresAt);
    createProfileNotification(
      challengerKey,
      "codemaster_challenge_invite",
      "Convite de desafio CodeMaster",
      `${authUser.username} desafiou voce no ${dromeNameById(dromeId)}.`,
      { inviteId, dromeId, codemasterKey, codemasterUsername: String(authUser.username || codemasterKey) }
    );
    const invites = listDromeChallengeInvitesForOwner(codemasterKey);
    sendJson(response, 200, {
      ok: true,
      inviteId,
      outgoing: invites.outgoing,
    });
    return;
  }

  if (pathname === "/api/dromos/challenges/respond" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Desafios indisponiveis sem banco SQL." });
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    ensureDromeSeasonCycle(new Date());
    cleanupExpiredDromeChallengeInvites();
    const ownerKey = normalizeUserKey(authUser.username || "");
    const inviteId = String(payload.inviteId || "").trim();
    const decision = String(payload.decision || "").toLowerCase();
    if (!inviteId || (decision !== "accept" && decision !== "reject")) {
      sendJson(response, 400, { error: "inviteId e decision validos sao obrigatorios." });
      return;
    }
    const invite = sqliteDb
      .prepare(`
        SELECT invite_id, season_key, drome_id, codemaster_key, challenger_key, status, room_id, expires_at
        FROM drome_challenge_invites
        WHERE invite_id = ? AND challenger_key = ?
        LIMIT 1
      `)
      .get(inviteId, ownerKey);
    if (!invite) {
      sendJson(response, 404, { error: "Convite nao encontrado." });
      return;
    }
    if (String(invite.status || "") !== "pending") {
      sendJson(response, 409, { error: "Esse convite ja foi respondido." });
      return;
    }
    if (Date.parse(String(invite.expires_at || "")) <= Date.now()) {
      sqliteDb
        .prepare("UPDATE drome_challenge_invites SET status = 'expired', updated_at = ? WHERE invite_id = ?")
        .run(nowIso(), inviteId);
      sendJson(response, 409, { error: "Convite expirado." });
      return;
    }
    if (decision === "reject") {
      sqliteDb
        .prepare(`
          UPDATE drome_challenge_invites
          SET status = 'rejected', updated_at = ?, responded_at = ?
          WHERE invite_id = ?
        `)
        .run(nowIso(), nowIso(), inviteId);
      createProfileNotification(
        String(invite.codemaster_key || ""),
        "codemaster_challenge_rejected",
        "Desafio recusado",
        `${authUser.username} recusou seu desafio de CodeMaster.`,
        { inviteId, challengerKey: ownerKey }
      );
      sendJson(response, 200, { ok: true, decision: "reject", inviteId });
      return;
    }

    const codemasterKey = normalizeUserKey(invite.codemaster_key || "", "");
    const dromeId = normalizeDromeId(invite.drome_id || "");
    const seasonKey = String(invite.season_key || seasonKeyFromDate(new Date()));
    const codemaster = sqliteDb
      .prepare(`
        SELECT owner_key, deck_key
        FROM drome_codemasters
        WHERE season_key = ? AND drome_id = ? AND owner_key = ?
        LIMIT 1
      `)
      .get(seasonKey, dromeId, codemasterKey);
    if (!codemaster || !String(codemaster?.deck_key || "").trim()) {
      sendJson(response, 409, { error: "CodeMaster atual ainda nao definiu deck de desafio." });
      return;
    }
    const challengerDeckName = normalizeDeckName(payload.deckName || "");
    if (!challengerDeckName) {
      sendJson(response, 400, { error: "Informe deckName para aceitar o desafio." });
      return;
    }
    const hostDeck = readDeckFileByName(`${normalizeDeckName(codemaster.deck_key)}.json`);
    if (!hostDeck) {
      sendJson(response, 409, { error: "Deck travado do CodeMaster nao foi encontrado." });
      return;
    }
    const guestDeck = readDeckFileByName(`${challengerDeckName}.json`);
    if (!guestDeck) {
      sendJson(response, 404, { error: "Deck do desafiante nao encontrado." });
      return;
    }
    const guestDeckOwner = normalizeUserKey(deckOwnerKey(guestDeck), "");
    if (guestDeckOwner && guestDeckOwner !== ownerKey) {
      sendJson(response, 403, { error: "O deck informado pertence a outro jogador." });
      return;
    }
    const hostDeckValidation = validateDeckForRulesMode(hostDeck, "competitive");
    const guestDeckValidation = validateDeckForRulesMode(guestDeck, "competitive");
    const activeBanlist = getActiveRankedBanlistSnapshot();
    const hostBanlistValidation = validateDeckAgainstRankedBanlist(hostDeck, activeBanlist);
    const guestBanlistValidation = validateDeckAgainstRankedBanlist(guestDeck, activeBanlist);
    if (!hostDeckValidation.ok || !guestDeckValidation.ok || !hostBanlistValidation.ok || !guestBanlistValidation.ok) {
      sendJson(response, 400, {
        error: "Deck invalido para desafio competitivo.",
        details: {
          codemaster: hostDeckValidation.errors || [],
          challenger: guestDeckValidation.errors || [],
          codemasterBanlist: hostBanlistValidation.bannedCards || [],
          challengerBanlist: guestBanlistValidation.bannedCards || [],
        },
      });
      return;
    }
    const hostAvatar = resolveAvatarForUsername(codemasterKey);
    const hostName = String(getProfileSummaryByOwnerKey(codemasterKey)?.username || codemasterKey || "CodeMaster");
    const { room, roomId, hostToken } = createMultiplayerRoomRecord({
      hostUsername: codemasterKey,
      hostName,
      hostAvatar,
      hostDeck,
      hostDeckName: String(codemaster.deck_key || "Deck CodeMaster"),
      rulesMode: "competitive",
      matchType: MATCH_TYPE_CODEMASTER_CHALLENGE,
      dromeId,
      challengeMeta: {
        inviteId,
        codemasterKey,
        challengerKey: ownerKey,
        dromeId,
      },
      reservedGuestKey: ownerKey,
    });
    const guestToken = generateSeatToken();
    room.players.guest = {
      name: String(authUser.username || ownerKey),
      username: ownerKey,
      avatar: resolveAvatarForUsername(ownerKey),
      deck: guestDeck,
      deckName: String(challengerDeckName || guestDeck?.name || "Deck Challenger"),
      seatToken: guestToken,
    };
    room.updatedAt = nowIso();
    await startRoomBattle(room);
    sqliteDb
      .prepare(`
        UPDATE drome_challenge_invites
        SET status = 'accepted', room_id = ?, updated_at = ?, responded_at = ?
        WHERE invite_id = ?
      `)
      .run(roomId, nowIso(), nowIso(), inviteId);
    createProfileNotification(
      codemasterKey,
      "codemaster_challenge_started",
      "Desafio CodeMaster iniciado",
      `${authUser.username} aceitou o desafio no ${dromeNameById(dromeId)}.`,
      {
        inviteId,
        roomId,
        seat: "host",
        seatToken: hostToken,
        dromeId,
      }
    );
    sendJson(response, 200, {
      ok: true,
      decision: "accept",
      inviteId,
      room: {
        roomId,
        seat: "guest",
        seatToken: guestToken,
        matchType: MATCH_TYPE_CODEMASTER_CHALLENGE,
        dromeId,
      },
    });
    return;
  }

  if (pathname === "/api/ranked/dromes" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const seasonKey = seasonKeyFromDate(new Date());
    const selection = getDromeSelectionForSeason(authUser.username, seasonKey);
    sendJson(response, 200, {
      ok: true,
      seasonKey,
      dromes: DROME_CATALOG.map((entry) => ({ ...entry })),
      selection: selection || null,
      locked: Boolean(selection),
    });
    return;
  }

  if (pathname === "/api/admin/reset-card-data" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    if (applyRateLimitWithUser(request, response, "admin_reset_card_data", adminUser.username, {
      windowMs: 60 * 1000,
      maxHits: 3,
    })) {
      return;
    }
    // Reset all scans inventories
    const scans = loadScansData();
    const playerKeys = Object.keys(scans.players || {});
    playerKeys.forEach((pk) => {
      scans.players[pk] = { cards: createEmptyCardBuckets() };
    });
    writeScansData(scans, "admin_reset_card_data");

    // Clear all deck card lists from SQL
    let decksCleared = 0;
    const deckKeys = sqlList("decks");
    for (const key of deckKeys) {
      const deck = sqlGet("decks", key);
      if (!deck || typeof deck !== "object") {
        continue;
      }
      deck.cards = createEmptyCardBuckets();
      deck.updatedAt = nowIso();
      writeDeckStored(key, deck);
      decksCleared += 1;
    }

    sendJson(response, 200, {
      ok: true,
      playersReset: playerKeys.length,
      decksCleared,
      resetAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/admin/cards/purge-disallowed-sets" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    if (applyRateLimitWithUser(request, response, "admin_purge_disallowed_sets", adminUser.username, {
      windowMs: 60 * 1000,
      maxHits: 3,
    })) {
      return;
    }
    let report = null;
    try {
      report = purgeDisallowedPlayerCardSets();
    } catch (error) {
      console.error(`[ADMIN][PURGE_SETS] Falha ao higienizar sets permitidos: ${error?.message || error}`);
      return sendJson(response, 500, { error: "Falha ao higienizar cartas fora dos sets permitidos." });
    }
    appendAuditLog("admin_purge_disallowed_sets", {
      severity: "warn",
      ownerKey: adminUser.username,
      ipAddress: getClientIp(request),
      message: "Purge de cartas fora dos sets permitidos executado.",
      payload: report,
    });
    sendJson(response, 200, report);
    return;
  }

  if (pathname === "/api/admin/decks/generate-mechanics" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    if (applyRateLimitWithUser(request, response, "admin_generate_mechanics_decks", adminUser.username, {
      windowMs: 60 * 1000,
      maxHits: 2,
    })) {
      return;
    }
    let payloadText = "";
    try {
      payloadText = await readBody(request);
    } catch {
      payloadText = "";
    }
    const payload = safeJsonParse(payloadText, {});
    const owner = normalizeUserKey(payload?.owner || "admin", "admin");
    if (owner !== "admin") {
      return sendJson(response, 400, { error: "Geracao permitida somente para a conta admin nesta etapa." });
    }
    let generationReport = null;
    try {
      generationReport = runMechanicsDeckGeneration({ ownerKey: owner });
    } catch (error) {
      console.error(`[ADMIN][MECH_DECKS] Falha ao gerar decks de mecanicas: ${error?.message || error}`);
      return sendJson(response, 500, { error: "Falha ao gerar decks de mecanicas." });
    }
    appendAuditLog("admin_generate_mechanics_decks", {
      severity: generationReport?.ok ? "info" : "warn",
      ownerKey: adminUser.username,
      ipAddress: getClientIp(request),
      message: "Geracao de decks de mecanicas executada para admin.",
      payload: {
        runId: generationReport?.runId || "",
        totalCreated: Number(generationReport?.totalCreated || 0),
        failedFamilies: Number(generationReport?.failedFamilies?.length || 0),
      },
    });
    sendJson(response, 200, generationReport);
    return;
  }

  if (pathname.startsWith("/api/admin/decks/generate-mechanics/report/") && request.method === "GET") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    const runId = String(pathname.replace("/api/admin/decks/generate-mechanics/report/", "") || "").trim();
    if (!runId) {
      return sendJson(response, 400, { error: "runId obrigatorio." });
    }
    const report = mechanicsDeckGenerationReports.get(runId);
    if (!report) {
      return sendJson(response, 404, { error: "Relatorio nao encontrado para esse runId." });
    }
    sendJson(response, 200, { ok: true, report });
    return;
  }

  if (pathname.startsWith("/api/trades")) {
    cleanupExpiredTradeRooms();
    cleanupExpiredTradeInvites();

    if (request.method === "GET" && pathname === "/api/trades/online") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      const players = listTradeOnlinePlayersForRequester(authUser.username);
      return sendJson(response, 200, {
        ok: true,
        generatedAt: nowIso(),
        total: players.length,
        players,
      });
    }

    if (request.method === "GET" && pathname === "/api/trades/invites") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      const ownerKey = normalizeUserKey(authUser.username || "");
      const invites = listTradeInvitesForOwner(ownerKey);
      const usage = buildTradeMonthlyUsage(ownerKey, new Date());
      return sendJson(response, 200, {
        ok: true,
        incoming: invites.incoming,
        outgoing: invites.outgoing,
        monthlyUsage: usage,
        generatedAt: nowIso(),
      });
    }

    if (request.method === "GET" && pathname === "/api/trades/usage") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      const usage = buildTradeMonthlyUsage(authUser.username, new Date());
      return sendJson(response, 200, { ok: true, monthlyUsage: usage });
    }

    if (request.method === "POST" && pathname === "/api/trades/invites/create") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      if (!isSqlV2Ready()) {
        return sendJson(response, 503, { error: "Trocas indisponiveis: banco SQL ainda nao inicializado." });
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const hostKey = normalizeUserKey(authUser.username || "");
      if (applyRateLimitWithUser(request, response, "trade_invite_create_user", hostKey, {
        windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
        maxHits: Math.max(8, Math.floor(ACTION_RATE_LIMIT_MAX / 2)),
      })) {
        return;
      }
      if (isPlayerInActiveTrade(hostKey)) {
        return sendJson(response, 409, { error: "Voce ja esta em uma troca ativa." });
      }
      const hostQuota = assertMonthlyTradeQuota(hostKey);
      if (!hostQuota.ok) {
        return sendJson(response, 409, { error: hostQuota.error, monthlyUsage: hostQuota.usage });
      }
      const targetUsername = String(payload.friendUsername || payload.username || "").trim();
      if (!targetUsername) {
        return sendJson(response, 400, { error: "Username do amigo obrigatorio." });
      }
      const targetSummary = getProfileSummaryByUsername(targetUsername);
      const guestKey = normalizeUserKey(targetSummary?.username || targetUsername, "");
      if (!targetSummary || !guestKey) {
        return sendJson(response, 404, { error: "Amigo nao encontrado." });
      }
      if (guestKey === hostKey) {
        return sendJson(response, 400, { error: "Nao e possivel convidar a si mesmo para troca." });
      }
      const alreadyFriends = sqliteDb
        .prepare("SELECT 1 FROM friends WHERE owner_key = ? AND friend_key = ? LIMIT 1")
        .get(hostKey, guestKey);
      if (!alreadyFriends) {
        return sendJson(response, 403, { error: "A troca direta sem codigo exige amizade confirmada." });
      }
      if (!isUserOnlineForTrades(guestKey)) {
        return sendJson(response, 409, { error: "Esse amigo nao esta online no momento." });
      }
      if (isPlayerInActiveTrade(guestKey)) {
        return sendJson(response, 409, { error: "Esse amigo ja esta em outra troca ativa." });
      }
      const guestQuota = assertMonthlyTradeQuota(guestKey);
      if (!guestQuota.ok) {
        return sendJson(response, 409, { error: `Esse amigo atingiu o limite mensal de trocas (${guestQuota.usage.used}/${guestQuota.usage.limit}).` });
      }
      if (hasPendingTradeInviteBetweenPlayers(hostKey, guestKey)) {
        return sendJson(response, 409, { error: "Ja existe um convite pendente para esse amigo." });
      }
      const hostDisplayName = String(payload.playerName || authUser.username || hostKey || "Host").trim() || hostKey;
      const room = createTradeRoomForHost(hostKey, hostDisplayName, { visibility: "hidden" });
      const inviteId = `tinv_${crypto.randomBytes(8).toString("hex")}`;
      const createdAt = nowIso();
      const expiresAtMs = Date.now() + TRADE_INVITE_TTL_MS;
      tradeInvites.set(inviteId, {
        id: inviteId,
        roomCode: room.code,
        hostKey,
        hostUsername: String(authUser.username || hostKey),
        guestKey,
        guestUsername: String(targetSummary?.username || guestKey),
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAtMs,
      });
      createProfileNotification(
        guestKey,
        "trade_invite_received",
        "Convite de troca",
        `${authUser.username} convidou voce para uma troca direta.`,
        { inviteId, from: hostKey, fromUsername: String(authUser.username || hostKey) }
      );
      appendAuditLog("trade_invite_created", {
        severity: "info",
        ownerKey: hostKey,
        ipAddress: getClientIp(request),
        message: `Convite de troca criado para ${guestKey}.`,
        payload: { inviteId, roomCode: room.code, guestKey },
      });
      return sendJson(response, 200, {
        ok: true,
        invite: normalizeTradeInvitePayload(tradeInvites.get(inviteId)),
        monthlyUsage: hostQuota.usage,
        room: {
          roomCode: room.code,
          seat: "host",
          seatToken: room.host.seatToken,
        },
      });
    }

    if (request.method === "POST" && pathname === "/api/trades/invites/respond") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const ownerKey = normalizeUserKey(authUser.username || "");
      const inviteId = String(payload.inviteId || "").trim();
      const decision = String(payload.decision || "").trim().toLowerCase();
      if (!inviteId || (decision !== "accept" && decision !== "reject")) {
        return sendJson(response, 400, { error: "Dados de resposta invalidos." });
      }
      if (applyRateLimitWithUser(request, response, "trade_invite_respond_user", ownerKey, {
        windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
        maxHits: Math.max(8, Math.floor(ACTION_RATE_LIMIT_MAX / 2)),
      })) {
        return;
      }
      cleanupExpiredTradeInvites();
      const invite = tradeInvites.get(inviteId);
      if (!invite || String(invite.status || "") !== "pending") {
        return sendJson(response, 404, { error: "Convite de troca nao encontrado." });
      }
      const guestKey = normalizeUserKey(invite.guestKey || "", "");
      if (guestKey !== ownerKey) {
        return sendJson(response, 403, { error: "Convite de troca invalido para este usuario." });
      }
      if (decision === "reject") {
        tradeInvites.delete(inviteId);
        createProfileNotification(
          normalizeUserKey(invite.hostKey || "", ""),
          "trade_invite_rejected",
          "Convite de troca recusado",
          `${authUser.username} recusou seu convite de troca.`,
          { inviteId, by: ownerKey, byUsername: String(authUser.username || ownerKey) }
        );
        return sendJson(response, 200, { ok: true, decision: "reject", inviteId });
      }
      if (!isSqlV2Ready()) {
        return sendJson(response, 503, { error: "Trocas indisponiveis: banco SQL ainda nao inicializado." });
      }
      if (isPlayerInActiveTrade(ownerKey, { ignoreRoomCode: invite.roomCode })) {
        return sendJson(response, 409, { error: "Voce ja esta em uma troca ativa." });
      }
      const guestQuota = assertMonthlyTradeQuota(ownerKey);
      if (!guestQuota.ok) {
        return sendJson(response, 409, { error: guestQuota.error, monthlyUsage: guestQuota.usage });
      }
      const hostQuota = assertMonthlyTradeQuota(invite.hostKey || "");
      if (!hostQuota.ok) {
        tradeInvites.delete(inviteId);
        return sendJson(response, 409, { error: "Quem enviou o convite atingiu o limite mensal de trocas." });
      }
      const roomCode = normalizeTradeCode(invite.roomCode);
      const room = requireTradeRoomOr404(response, roomCode);
      if (!room) {
        tradeInvites.delete(inviteId);
        return;
      }
      try {
        const joinResult = joinTradeRoomAsGuest(room, ownerKey, String(payload.playerName || authUser.username || ownerKey));
        tradeInvites.delete(inviteId);
        console.log(`[TRADES] Jogador entrou: code=${roomCode} guest=${joinResult.guestKey}`);
        sendTradeRoomEvent(room, { type: "trade_room_event", event: "guest_joined", roomCode });
        broadcastTradeRoomSnapshot(room, "guest_joined");
        createProfileNotification(
          normalizeUserKey(invite.hostKey || "", ""),
          "trade_invite_accepted",
          "Convite de troca aceito",
          `${authUser.username} aceitou seu convite de troca.`,
          { inviteId, by: ownerKey, byUsername: String(authUser.username || ownerKey), roomCode }
        );
        appendAuditLog("trade_invite_accepted", {
          severity: "info",
          ownerKey,
          ipAddress: getClientIp(request),
          message: `Convite ${inviteId} aceito.`,
          payload: { inviteId, roomCode },
        });
        return sendJson(response, 200, {
          ok: true,
          decision: "accept",
          inviteId,
          monthlyUsage: guestQuota.usage,
          room: {
            roomCode: joinResult.roomCode,
            seat: joinResult.seat,
            seatToken: joinResult.seatToken,
          },
        });
      } catch (error) {
        return sendJson(response, 400, { error: error?.message || "Falha ao aceitar convite de troca." });
      }
    }

    if (request.method === "POST" && pathname === "/api/trades/invites/cancel") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const ownerKey = normalizeUserKey(authUser.username || "");
      const inviteId = String(payload.inviteId || "").trim();
      if (!inviteId) {
        return sendJson(response, 400, { error: "inviteId obrigatorio." });
      }
      cleanupExpiredTradeInvites();
      const invite = tradeInvites.get(inviteId);
      if (!invite || String(invite.status || "") !== "pending") {
        return sendJson(response, 404, { error: "Convite de troca nao encontrado." });
      }
      if (normalizeUserKey(invite.hostKey || "", "") !== ownerKey) {
        return sendJson(response, 403, { error: "Somente quem convidou pode cancelar o convite." });
      }
      const roomCode = normalizeTradeCode(invite.roomCode);
      const room = roomCode ? tradeRooms.get(roomCode) : null;
      if (room && room.status === "waiting" && !room.guest) {
        room.status = "cancelled";
        room.updatedAt = nowIso();
        room.lastActivityAt = Date.now();
        releaseTradeRoomLocks(room);
        sendTradeRoomEvent(room, {
          type: "trade_room_event",
          event: "trade_cancelled",
          roomCode: room.code,
          by: "host",
        });
        broadcastTradeRoomSnapshot(room, "cancel");
      }
      tradeInvites.delete(inviteId);
      createProfileNotification(
        normalizeUserKey(invite.guestKey || "", ""),
        "trade_invite_cancelled",
        "Convite de troca cancelado",
        `${authUser.username} cancelou o convite de troca.`,
        { inviteId, by: ownerKey, byUsername: String(authUser.username || ownerKey) }
      );
      return sendJson(response, 200, { ok: true, inviteId, cancelled: true });
    }

    if (request.method === "GET" && pathname === "/api/trades/wishlist") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      const entries = readTradeWishlist(authUser.username);
      return sendJson(response, 200, { ok: true, entries });
    }

    if (request.method === "POST" && pathname === "/api/trades/wishlist") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const result = writeTradeWishlist(authUser.username, entries);
      if (!result.ok) {
        return sendJson(response, 503, { error: result.error || "Wishlist indisponivel no momento." });
      }
      appendAuditLog("trade_wishlist_updated", {
        severity: "info",
        ownerKey: authUser.username,
        ipAddress: getClientIp(request),
        message: "Wishlist de trocas atualizada.",
        payload: { totalEntries: result.entries.length },
      });
      return sendJson(response, 200, { ok: true, entries: result.entries });
    }

    if (request.method === "POST" && pathname === "/api/trades/rooms") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const username = normalizeUserKey(authUser.username || "local-player");
      const displayName = String(payload.playerName || authUser.username || username || "Host").trim() || username;
      if (!isSqlV2Ready()) {
        return sendJson(response, 503, { error: "Trocas indisponiveis: banco SQL ainda nao inicializado." });
      }
      const quota = assertMonthlyTradeQuota(username);
      if (!quota.ok) {
        return sendJson(response, 409, { error: quota.error, monthlyUsage: quota.usage });
      }
      const room = createTradeRoomForHost(username, displayName, { visibility: "public" });
      console.log(`[TRADES] Sala criada: code=${room.code} host=${username}`);
      return sendJson(response, 200, {
        ok: true,
        monthlyUsage: quota.usage,
        roomCode: room.code,
        seat: "host",
        seatToken: room.host.seatToken,
      });
    }

    if (request.method === "POST" && pathname === "/api/trades/rooms/join") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const roomCode = normalizeTradeCode(payload.roomCode);
      const room = requireTradeRoomOr404(response, roomCode);
      if (!room) {
        return;
      }
      const guestQuota = assertMonthlyTradeQuota(authUser.username || "guest");
      if (!guestQuota.ok) {
        return sendJson(response, 409, { error: guestQuota.error, monthlyUsage: guestQuota.usage });
      }
      const hostQuota = assertMonthlyTradeQuota(room?.host?.username || "");
      if (!hostQuota.ok) {
        return sendJson(response, 409, { error: "Host atingiu o limite mensal de trocas deste ciclo." });
      }
      try {
        const joinResult = joinTradeRoomAsGuest(
          room,
          authUser.username || "guest",
          String(payload.playerName || authUser.username || "Guest")
        );
        console.log(`[TRADES] Jogador entrou: code=${roomCode} guest=${joinResult.guestKey}`);
        sendTradeRoomEvent(room, { type: "trade_room_event", event: "guest_joined", roomCode });
        broadcastTradeRoomSnapshot(room, "guest_joined");
        return sendJson(response, 200, {
          ok: true,
          monthlyUsage: guestQuota.usage,
          roomCode: joinResult.roomCode,
          seat: joinResult.seat,
          seatToken: joinResult.seatToken,
        });
      } catch (error) {
        return sendJson(response, 400, { error: error?.message || "Erro ao entrar na sala de troca." });
      }
    }

    if (request.method === "GET" && pathname === "/api/trades/history") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      if (!isSqlV2Ready()) {
        return sendJson(response, 503, { error: "Historico indisponivel: banco SQL ainda nao inicializado." });
      }
      const ownerKey = normalizeUserKey(authUser.username || "");
      const limitRaw = Number(parsedUrl.searchParams.get("limit") || 30);
      const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 30));
      const rows = sqliteDb.prepare(`
        SELECT id, room_code, host_key, guest_key, completed_at
        FROM trade_history
        WHERE host_key = ? OR guest_key = ?
        ORDER BY datetime(completed_at) DESC, id DESC
        LIMIT ?
      `).all(ownerKey, ownerKey, limit);
      const history = rows.map((row) => {
        const tradeId = Number(row?.id || 0);
        const items = sqliteDb.prepare(`
          SELECT side, from_owner_key, to_owner_key, scan_entry_id, card_type, card_id, variant_json
          FROM trade_history_items
          WHERE trade_id = ?
          ORDER BY id ASC
        `).all(tradeId).map((item) => ({
          side: String(item?.side || ""),
          fromOwnerKey: String(item?.from_owner_key || ""),
          toOwnerKey: String(item?.to_owner_key || ""),
          scanEntryId: String(item?.scan_entry_id || ""),
          cardType: String(item?.card_type || ""),
          cardId: String(item?.card_id || ""),
          variant: safeJsonParse(item?.variant_json, null),
        }));
        return {
          id: tradeId,
          roomCode: String(row?.room_code || ""),
          hostKey: String(row?.host_key || ""),
          guestKey: String(row?.guest_key || ""),
          completedAt: String(row?.completed_at || ""),
          items,
        };
      });
      return sendJson(response, 200, { ok: true, history });
    }

    if (request.method === "GET" && pathname.startsWith("/api/trades/rooms/") && pathname.endsWith("/state")) {
      const roomCode = pathname.split("/")[4];
      const room = requireTradeRoomOr404(response, roomCode);
      if (!room) {
        return;
      }
      const seatToken = parsedUrl.searchParams.get("seatToken") || "";
      room.lastActivityAt = Date.now();
      let monthlyUsage = null;
      const seatInfo = getTradeSeatByToken(room, seatToken);
      if (seatInfo?.playerKey) {
        monthlyUsage = buildTradeMonthlyUsage(seatInfo.playerKey, new Date());
      }
      return sendJson(response, 200, {
        ok: true,
        monthlyUsage,
        snapshot: buildTradeRoomStatePayload(room, seatToken),
      });
    }

    if (request.method === "GET" && pathname.startsWith("/api/trades/events/")) {
      const roomCode = pathname.split("/")[4];
      const room = tradeRooms.get(normalizeTradeCode(roomCode));
      if (!room) {
        return sendText(response, 404, "Sala de troca nao encontrada.");
      }
      const seatToken = parsedUrl.searchParams.get("seatToken") || "";
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      const client = { res: response, seatToken };
      room.clients.add(client);
      room.lastActivityAt = Date.now();
      const snapshot = buildTradeRoomStatePayload(room, seatToken);
      response.write(`data: ${JSON.stringify({ type: "trade_room_snapshot", reason: "initial", snapshot })}\n\n`);
      request.on("close", () => {
        room.clients.delete(client);
      });
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/trades/rooms/") && pathname.endsWith("/action")) {
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        return sendJson(response, 413, { error: error.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido." });
      }
      const roomCode = pathname.split("/")[4];
      const room = requireTradeRoomOr404(response, roomCode);
      if (!room) {
        return;
      }
      const seatToken = String(payload.seatToken || "");
      const seatInfo = getTradeSeatByToken(room, seatToken);
      if (seatInfo.seat !== "host" && seatInfo.seat !== "guest") {
        return sendJson(response, 403, { error: "Seat token invalido para esta sala de troca." });
      }
      if (applyRateLimitWithUser(request, response, "trade_action_user", seatInfo.playerKey || seatInfo.seat, {
        windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
        maxHits: ACTION_RATE_LIMIT_MAX,
      })) {
        return;
      }
      const action = decodeRichValue(payload.action || {});
      try {
        const result = applyTradeRoomAction(room, action, seatInfo.seat);
        room.updatedAt = nowIso();
        room.lastActivityAt = Date.now();
        const reason = String(result?.reason || "action");
        console.log(
          `[TRADES][ACTION] room=${room.code} seat=${seatInfo.seat} action=${String(action?.type || "")} result=${reason}`
        );
        if (reason === "finalize") {
          sendTradeRoomEvent(room, {
            type: "trade_room_event",
            event: "trade_completed",
            roomCode: room.code,
            summary: result?.summary || null,
          });
        }
        if (reason === "cancel") {
          sendTradeRoomEvent(room, {
            type: "trade_room_event",
            event: "trade_cancelled",
            roomCode: room.code,
            by: seatInfo.seat,
          });
        }
        broadcastTradeRoomSnapshot(room, reason);
        return sendJson(response, 200, {
          ok: true,
          reason,
          monthlyUsage: seatInfo.playerKey ? buildTradeMonthlyUsage(seatInfo.playerKey, new Date()) : null,
          snapshot: buildTradeRoomStatePayload(room, seatToken),
        });
      } catch (error) {
        console.warn(
          `[TRADES][ACTION][ERROR] room=${normalizeTradeCode(roomCode)} seat=${seatInfo.seat} action=${String(action?.type || "")} error=${error?.message || error}`
        );
        return sendJson(response, 400, { error: error?.message || "Falha ao aplicar acao de troca." });
      }
    }
  }

  if (pathname === "/api/chat/global" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    if (!sqliteDb) {
      sendJson(response, 503, { error: "Chat global indisponivel sem banco SQL." });
      return;
    }
    const limit = normalizeGlobalChatLimit(parsedUrl.searchParams.get("limit"), 80);
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    const targetLang = normalizeChatLanguage(parsedUrl.searchParams.get("lang") || "pt");
    const rawMessages = listGlobalChatMessages(limit);
    const messages = await translateChatMessagesForViewer(rawMessages, ownerKey, targetLang, "global_chat_history");
    sendJson(response, 200, {
      ok: true,
      language: targetLang,
      messages,
      total: messages.length,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/chat/global" && request.method === "POST") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    const payload = safeJsonParse(payloadText, null);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    if (applyRateLimitWithUser(request, response, "global_chat_post", ownerKey, {
      windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
      maxHits: ACTION_RATE_LIMIT_MAX,
    })) {
      return;
    }
    const result = await postGlobalChatMessage(
      ownerKey,
      authUser.username || ownerKey,
      resolveAvatarForUsername(ownerKey),
      payload.message
    );
    if (!result.ok) {
      sendJson(response, 400, { error: result.error || "Nao foi possivel enviar mensagem." });
      return;
    }
    sendJson(response, 200, { ok: true, message: result.message });
    return;
  }

  if (pathname === "/api/chat/global/events" && request.method === "GET") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write("retry: 3000\n\n");
    const targetLang = normalizeChatLanguage(parsedUrl.searchParams.get("lang") || "pt");
    const ownerKey = normalizeUserKey(authUser.username || "", "");
    const client = {
      ownerKey,
      lang: targetLang,
      res: response,
    };
    globalChatClients.add(client);
    const snapshotRaw = listGlobalChatMessages(80);
    const snapshot = await translateChatMessagesForViewer(snapshotRaw, ownerKey, targetLang, "global_chat_events_snapshot");
    writeGlobalChatSsePayload(client, { type: "global_chat_snapshot", language: targetLang, messages: snapshot });
    const heartbeat = setInterval(() => {
      try {
        response.write(": ping\n\n");
      } catch {}
    }, 25000);
    request.on("close", () => {
      clearInterval(heartbeat);
      globalChatClients.delete(client);
      try {
        response.end();
      } catch {}
    });
    return;
  }

  if (pathname.startsWith("/api/multiplayer")) {
    if (request.method === "GET" && pathname === "/api/multiplayer/invites") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      if (!sqliteDb) {
        sendJson(response, 503, { error: "Convites multiplayer indisponiveis sem banco SQL." });
        return;
      }
      const ownerKey = normalizeUserKey(authUser.username || "", "");
      const invites = listCasualInvitesForOwner(ownerKey, Date.now());
      sendJson(response, 200, {
        ok: true,
        incoming: invites.incoming,
        outgoing: invites.outgoing,
        generatedAt: nowIso(),
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/multiplayer/invites") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      if (!sqliteDb) {
        sendJson(response, 503, { error: "Convites multiplayer indisponiveis sem banco SQL." });
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { error: error.message });
        return;
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        sendJson(response, 400, { error: "JSON invalido." });
        return;
      }
      const ownerKey = normalizeUserKey(authUser.username || "", "");
      const targetUsername = String(payload.friendUsername || payload.username || "").trim();
      const targetUser = sqliteDb
        .prepare("SELECT username FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
        .get(targetUsername);
      const targetKey = normalizeUserKey(targetUser?.username || "", "");
      if (!ownerKey || !targetKey || ownerKey === targetKey) {
        sendJson(response, 400, { error: "Amigo invalido para convite." });
        return;
      }
      const relation = sqliteDb
        .prepare("SELECT 1 AS ok FROM friends WHERE owner_key = ? AND friend_key = ? LIMIT 1")
        .get(ownerKey, targetKey);
      if (!relation?.ok) {
        sendJson(response, 403, { error: "Convite de batalha exige amizade confirmada." });
        return;
      }
      if (!isUserSessionOnline(targetKey)) {
        sendJson(response, 400, { error: "Esse amigo esta offline no momento." });
        return;
      }
      if (hasPendingCasualInvite(ownerKey, targetKey)) {
        sendJson(response, 400, { error: "Ja existe convite pendente entre voces." });
        return;
      }
      const rulesMode = isValidRulesMode(payload.rulesMode) ? payload.rulesMode : "competitive";
      const inviteId = `mpi_${crypto.randomBytes(6).toString("hex")}`;
      const nowMs = Date.now();
      casualBattleInvites.set(inviteId, {
        inviteId,
        hostKey: ownerKey,
        hostUsername: String(authUser.username || ownerKey),
        hostAvatar: resolveAvatarForUsername(ownerKey),
        targetKey,
        targetUsername: String(targetUser.username || targetKey),
        rulesMode,
        hostDeck: null,
        hostDeckName: "",
        status: "pending",
        room: null,
        createdAt: nowIso(),
        createdAtMs: nowMs,
        updatedAt: nowIso(),
        updatedAtMs: nowMs,
        expiresAtMs: nowMs + CASUAL_INVITE_TTL_MS,
      });
      const invites = listCasualInvitesForOwner(ownerKey, nowMs);
      sendJson(response, 200, {
        ok: true,
        inviteId,
        outgoing: invites.outgoing,
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/multiplayer/invites/respond") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { error: error.message });
        return;
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        sendJson(response, 400, { error: "JSON invalido." });
        return;
      }
      const ownerKey = normalizeUserKey(authUser.username || "", "");
      const inviteId = String(payload.inviteId || "").trim();
      const decision = String(payload.decision || "").trim().toLowerCase();
      cleanupExpiredCasualInvites(Date.now());
      const invite = casualBattleInvites.get(inviteId);
      if (!invite) {
        sendJson(response, 404, { error: "Convite nao encontrado ou expirado." });
        return;
      }
      if (String(invite.status || "pending") !== "pending" && decision !== "cancel") {
        sendJson(response, 400, { error: "Convite ja foi respondido." });
        return;
      }
      const hostKey = normalizeUserKey(invite.hostKey || "", "");
      const targetKey = normalizeUserKey(invite.targetKey || "", "");
      if (decision === "cancel") {
        if (ownerKey !== hostKey) {
          sendJson(response, 403, { error: "Apenas quem enviou pode cancelar o convite." });
          return;
        }
        invite.status = "cancelled";
        invite.updatedAt = nowIso();
        invite.updatedAtMs = Date.now();
        const invites = listCasualInvitesForOwner(ownerKey, Date.now());
        sendJson(response, 200, { ok: true, decision: "cancel", outgoing: invites.outgoing });
        return;
      }
      if (ownerKey !== targetKey) {
        sendJson(response, 403, { error: "Apenas o amigo convidado pode responder." });
        return;
      }
      if (decision === "reject") {
        invite.status = "rejected";
        invite.updatedAt = nowIso();
        invite.updatedAtMs = Date.now();
        const invites = listCasualInvitesForOwner(ownerKey, Date.now());
        sendJson(response, 200, { ok: true, decision: "reject", incoming: invites.incoming });
        return;
      }
      if (decision !== "accept") {
        sendJson(response, 400, { error: "Decisao invalida para convite." });
        return;
      }
      const hostAvatar = resolveAvatarForUsername(hostKey);
      const guestAvatar = resolveAvatarForUsername(targetKey);
      const { room, roomId, hostToken } = createMultiplayerRoomRecord({
        hostUsername: hostKey,
        hostName: String(invite.hostUsername || hostKey),
        hostAvatar,
        hostDeck: null,
        hostDeckName: "",
        rulesMode: String(invite.rulesMode || "competitive"),
        matchType: MATCH_TYPE_CASUAL_MULTIPLAYER,
      });
      const guestToken = generateSeatToken();
      room.players.guest = {
        name: String(authUser.username || targetKey),
        username: targetKey,
        avatar: guestAvatar,
        deck: null,
        deckName: "",
        seatToken: guestToken,
      };
      room.phase = "deck_select";
      resetRoomDeckSelectState(room);
      room.updatedAt = nowIso();
      sendRoomEvent(room, { type: "player_joined", roomId: room.id });
      broadcastRoomSnapshot(room, "casual_invite_accept");
      invite.status = "accepted";
      invite.room = {
        roomId,
        hostSeatToken: hostToken,
        guestSeatToken: guestToken,
        matchType: MATCH_TYPE_CASUAL_MULTIPLAYER,
      };
      invite.updatedAt = nowIso();
      invite.updatedAtMs = Date.now();
      sendJson(response, 200, {
        ok: true,
        decision: "accept",
        room: {
          roomId,
          seat: "guest",
          seatToken: guestToken,
          matchType: MATCH_TYPE_CASUAL_MULTIPLAYER,
        },
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/multiplayer/rooms") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      cleanupFinishedMultiplayerRooms(Date.now());
      const activeRooms = Array.from(multiplayerRooms.values())
        .filter((room) => {
          const phase = String(room?.phase || "lobby");
          return phase === "lobby" || phase === "deck_select" || phase === "in_game";
        })
        .map((room) => buildRoomSummary(room));
      sendJson(response, 200, { rooms: activeRooms });
      return;
    }

  if (request.method === "POST" && pathname === "/api/multiplayer/rooms") {
      const authUser = requireAuthenticatedUser(request, response);
      if (!authUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (e) {
        return sendJson(response, 413, { error: e.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload) {
        return sendJson(response, 400, { error: "JSON invalido" });
      }

      const requestedMatchType = normalizeMatchType(payload.matchType || "");
      const matchType = requestedMatchType || MATCH_TYPE_CASUAL_MULTIPLAYER;
      if (matchType === MATCH_TYPE_CODEMASTER_CHALLENGE) {
        return sendJson(response, 400, {
          error: "Partidas CodeMaster sao criadas apenas pelo fluxo de convite de desafio.",
        });
      }
      const rankedMatch = matchType === MATCH_TYPE_RANKED_DROME;

      const rulesMode = isValidRulesMode(payload.rulesMode) ? payload.rulesMode : "competitive";
      const hostUsername = normalizeUserKey(authUser.username || "host");
      if (applyRateLimitWithUser(request, response, "multiplayer_create_user", hostUsername, {
        windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
        maxHits: ACTION_RATE_LIMIT_MAX,
      })) {
        return;
      }
      let dromeId = "";
      if (rankedMatch) {
        ensureDromeSeasonCycle(new Date());
        const seasonKey = seasonKeyFromDate(new Date());
        const selection = getDromeSelectionForSeason(hostUsername, seasonKey);
        if (!selection?.dromeId) {
          return sendJson(response, 400, { error: "Selecione um Dromo antes de criar partida ranked." });
        }
        const requestedDromeId = normalizeDromeId(payload.dromeId || "");
        dromeId = requestedDromeId || selection.dromeId;
        if (dromeId !== selection.dromeId) {
          return sendJson(response, 400, { error: "Partida ranked deve usar o Dromo selecionado para esta temporada." });
        }
      }
      const hostAvatar = resolveAvatarForUsername(hostUsername);
      const { room, roomId, hostToken } = createMultiplayerRoomRecord({
        hostUsername,
        hostName: String(payload.playerName || authUser.username || "Host"),
        hostAvatar,
        hostDeck: null,
        hostDeckName: "",
        rulesMode,
        matchType,
        dromeId,
      });
      sendJson(response, 200, {
        roomId,
        seat: "host",
        seatToken: hostToken,
        rulesMode: room.rulesMode,
        matchType: normalizeMatchType(room.matchType || ""),
        dromeId: normalizeDromeId(room.dromeId || ""),
      });
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/multiplayer/rooms/") && pathname.endsWith("/join")) {
      const roomId = pathname.split("/")[4];
      const room = requireRoomOr404(response, roomId);
      if (!room) {
        return;
      }
      const joinAuth = requireAuthenticatedUser(request, response);
      if (!joinAuth) {
        return;
      }

      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (e) {
        return sendJson(response, 413, { error: e.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload) {
        return sendJson(response, 400, { error: "JSON invalido" });
      }

      if (room.players?.guest && !payload.spectator) {
        return sendJson(response, 400, { error: "Room is full" });
      }

      if (payload.spectator) {
        return sendJson(response, 200, {
          ok: true,
          seat: "spectator",
          roomId,
          matchType: normalizeMatchType(room?.matchType || ""),
          dromeId: normalizeDromeId(room?.dromeId || room?.challengeMeta?.dromeId || ""),
        });
      }

      const roomMatchType = normalizeMatchType(room?.matchType || "");
      const roomDromeId = normalizeDromeId(room?.dromeId || room?.challengeMeta?.dromeId || "");

      let guestUsername = normalizeUserKey(joinAuth.username || "", "");
      if (!guestUsername) {
        return sendJson(response, 403, { error: "Sessao invalida para entrar na sala." });
      }
      if (roomMatchType === MATCH_TYPE_RANKED_DROME) {
        ensureDromeSeasonCycle(new Date());
        const seasonKey = seasonKeyFromDate(new Date());
        const selection = getDromeSelectionForSeason(guestUsername, seasonKey);
        if (!selection?.dromeId) {
          return sendJson(response, 400, { error: "Selecione um Dromo antes de entrar em partida ranked." });
        }
        if (selection.dromeId !== roomDromeId) {
          return sendJson(response, 400, { error: "Este ranked pertence a outro Dromo." });
        }
      }
      if (roomMatchType === MATCH_TYPE_CODEMASTER_CHALLENGE) {
        if (!room?.reservedGuestKey || normalizeUserKey(room.reservedGuestKey, "") !== guestUsername) {
          return sendJson(response, 403, { error: "Esta sala de desafio CodeMaster e reservada para outro jogador." });
        }
      }
      if (applyRateLimitWithUser(request, response, "multiplayer_join_user", guestUsername, {
        windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
        maxHits: ACTION_RATE_LIMIT_MAX,
      })) {
        return;
      }
      const guestToken = generateSeatToken();
      const guestAvatar = resolveAvatarForUsername(guestUsername);
      room.players.guest = {
        name: String(payload.playerName || "Guest"),
        username: guestUsername,
        avatar: guestAvatar,
        deck: null,
        deckName: "",
        seatToken: guestToken,
      };
      room.phase = "deck_select";
      resetRoomDeckSelectState(room);
      room.updatedAt = nowIso();
      sendRoomEvent(room, { type: "player_joined", roomId: room.id });
      broadcastRoomSnapshot(room, "player_joined");
      sendJson(response, 200, {
        ok: true,
        roomId,
        seat: "guest",
        seatToken: guestToken,
        rulesMode: room.rulesMode,
        matchType: roomMatchType,
        dromeId: roomDromeId,
      });
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/multiplayer/rooms/") && pathname.endsWith("/state")) {
      const roomId = pathname.split("/")[4];
      const room = requireRoomOr404(response, roomId);
      if (!room) {
        return;
      }
      const seatToken = parsedUrl.searchParams.get("seatToken") || "";
      const access = requireAuthenticatedRoomAccess(request, response, room, {
        seatToken,
        allowSpectator: true,
      });
      if (!access) {
        return;
      }
      sendJson(response, 200, buildRoomStatePayload(room, seatToken));
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/multiplayer/rooms/") && pathname.endsWith("/deck/select")) {
      const roomId = pathname.split("/")[4];
      const room = requireRoomOr404(response, roomId);
      if (!room) {
        return;
      }
      if (room.phase !== "deck_select") {
        return sendJson(response, 400, { error: "A selecao de deck nao esta ativa para esta sala." });
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (e) {
        return sendJson(response, 413, { error: e.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido" });
      }
      const seatToken = String(payload.seatToken || "");
      const access = requireAuthenticatedRoomAccess(request, response, room, {
        seatToken,
        allowSpectator: false,
      });
      if (!access) {
        return;
      }
      const seatInfo = access.seatInfo;
      const ownerKey = normalizeUserKey(room.players?.[seatInfo.seat]?.username || "", "");
      const deckName = String(payload.deckName || "").trim();
      let deckSnapshot = payload.deckSnapshot && typeof payload.deckSnapshot === "object"
        ? payload.deckSnapshot
        : (payload.deck && typeof payload.deck === "object" ? payload.deck : null);
      if (!deckSnapshot && deckName) {
        const normalizedDeckName = normalizeDeckName(deckName);
        const loadedDeck = normalizedDeckName ? readDeckFileByName(`${normalizedDeckName}.json`) : null;
        if (!loadedDeck) {
          return sendJson(response, 404, { error: "Deck nao encontrado." });
        }
        const loadedOwner = normalizeUserKey(deckOwnerKey(loadedDeck || {}), "");
        if (loadedOwner && ownerKey && loadedOwner !== ownerKey) {
          return sendJson(response, 403, { error: "O deck selecionado pertence a outro jogador." });
        }
        deckSnapshot = loadedDeck;
      }
      if (!deckSnapshot) {
        return sendJson(response, 400, { error: "Deck da partida obrigatorio." });
      }
      const result = setRoomDeckForSeat(
        room,
        seatInfo.seat,
        deckName || String(deckSnapshot?.name || ""),
        deckSnapshot,
        room.rulesMode || "competitive"
      );
      room.updatedAt = nowIso();
      if (!result.ok) {
        broadcastRoomSnapshot(room, "deck_select_update");
        return sendJson(response, 400, { error: result.error || "Deck invalido.", snapshot: buildRoomStatePayload(room, seatToken) });
      }
      broadcastRoomSnapshot(room, "deck_select_update");
      return sendJson(response, 200, { ok: true, snapshot: buildRoomStatePayload(room, seatToken) });
    }

    if (request.method === "POST" && pathname.startsWith("/api/multiplayer/rooms/") && pathname.endsWith("/ready")) {
      const roomId = pathname.split("/")[4];
      const room = requireRoomOr404(response, roomId);
      if (!room) {
        return;
      }
      if (room.phase !== "deck_select") {
        return sendJson(response, 400, { error: "Esta sala nao esta em fase de pre-combate." });
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (e) {
        return sendJson(response, 413, { error: e.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido" });
      }
      const seatToken = String(payload.seatToken || "");
      const access = requireAuthenticatedRoomAccess(request, response, room, {
        seatToken,
        allowSpectator: false,
      });
      if (!access) {
        return;
      }
      const seatInfo = access.seatInfo;
      const ready = Boolean(payload.ready);
      if (!room.deckSelect || typeof room.deckSelect !== "object") {
        resetRoomDeckSelectState(room);
      }
      if (ready) {
        const ownDeck = room.players?.[seatInfo.seat]?.deck || null;
        if (!ownDeck) {
          return sendJson(response, 400, { error: "Selecione seu deck antes de marcar pronto." });
        }
        const validation = validateDeckForRulesMode(ownDeck, room.rulesMode || "competitive");
        const enforceBanlist = normalizeMatchType(room?.matchType || "") === MATCH_TYPE_RANKED_DROME
          || normalizeMatchType(room?.matchType || "") === MATCH_TYPE_CODEMASTER_CHALLENGE;
        const banlistValidation = enforceBanlist
          ? validateDeckAgainstRankedBanlist(ownDeck, room?.rankedBanlistSnapshot || null)
          : { ok: true, bannedCards: [] };
        const extraErrors = [];
        if (!banlistValidation.ok) {
          const bannedLabels = banlistValidation.bannedCards
            .slice(0, 5)
            .map((entry) => String(entry?.cardName || entry?.cardId || ""))
            .filter(Boolean);
          extraErrors.push(`Banlist: ${bannedLabels.join(", ")}`);
        }
        const combinedErrors = [...(Array.isArray(validation.errors) ? validation.errors : []), ...extraErrors];
        const isValid = Boolean(validation.ok) && Boolean(banlistValidation.ok);
        room.deckSelect[seatInfo.seat] = {
          ...(room.deckSelect[seatInfo.seat] || {}),
          deckName: String(room.players?.[seatInfo.seat]?.deckName || ""),
          valid: isValid,
          errors: combinedErrors.slice(0, 3),
          ready: isValid,
        };
        if (!isValid) {
          room.updatedAt = nowIso();
          broadcastRoomSnapshot(room, "deck_select_update");
          return sendJson(response, 400, { error: `Deck invalido para modo ${room.rulesMode}: ${combinedErrors.slice(0, 3).join(" | ")}` });
        }
      } else {
        room.deckSelect[seatInfo.seat] = {
          ...(room.deckSelect[seatInfo.seat] || {}),
          ready: false,
        };
      }
      room.updatedAt = nowIso();
      const startResult = await tryStartRoomBattleFromDeckSelect(room);
      if (startResult?.error) {
        broadcastRoomSnapshot(room, "deck_select_update");
        return sendJson(response, 400, { error: startResult.error, snapshot: buildRoomStatePayload(room, seatToken) });
      }
      broadcastRoomSnapshot(room, startResult?.started ? "deck_select_start" : "deck_select_update");
      return sendJson(response, 200, { ok: true, started: Boolean(startResult?.started), snapshot: buildRoomStatePayload(room, seatToken) });
    }

    if (request.method === "POST" && pathname.startsWith("/api/multiplayer/rooms/") && pathname.endsWith("/action")) {
      const roomId = pathname.split("/")[4];
      const room = requireRoomOr404(response, roomId);
      if (!room) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (e) {
        return sendJson(response, 413, { error: e.message });
      }
      const payload = safeJsonParse(payloadText, null);
      if (!payload || typeof payload !== "object") {
        return sendJson(response, 400, { error: "JSON invalido" });
      }
      const seatToken = String(payload.seatToken || "");
      const access = requireAuthenticatedRoomAccess(request, response, room, {
        seatToken,
        allowSpectator: false,
      });
      if (!access) {
        return;
      }
      const seatInfo = access.seatInfo;
      if (seatInfo.playerIndex === null) {
        return sendJson(response, 403, { error: "Seat token invalido." });
      }
      const actionUserKey = seatInfo.seat === "host"
        ? normalizeUserKey(room.players?.host?.username || "host")
        : normalizeUserKey(room.players?.guest?.username || "guest");
      if (applyRateLimitWithUser(request, response, "multiplayer_action_user", actionUserKey, {
        windowMs: ACTION_RATE_LIMIT_WINDOW_MS,
        maxHits: ACTION_RATE_LIMIT_MAX,
      })) {
        return;
      }
      const decodedAction = decodeRichValue(payload.action || {});
      const decodedIntent = decodeRichValue(payload.intent ?? null);
      let resolvedAction = decodedAction;
      if (decodedIntent !== null && decodedIntent !== undefined) {
        const normalizedIntent = normalizeBattleIntent(decodedIntent, decodedAction);
        if (!normalizedIntent) {
          return sendJson(response, 400, { error: "Intent de batalha invalido." });
        }
        const mappedAction = mapProtocolIntentToLegacyAction(normalizedIntent, room.battleState, seatInfo.playerIndex);
        if (!mappedAction) {
          return sendJson(response, 400, { error: "Intent nao permitido para a fase atual." });
        }
        resolvedAction = mappedAction;
      }
      const actionType = String(resolvedAction?.type || "");
      const bypassTurnValidation = actionType === "forfeit" || actionType === "request_rematch" || actionType === "respond_rematch";
      const allowsFinishedPhase = actionType === "request_rematch" || actionType === "respond_rematch";
      if (!room.battleState || (room.phase !== "in_game" && !(allowsFinishedPhase && room.phase === "finished"))) {
        return sendJson(response, 400, { error: "Partida ainda nao iniciou." });
      }
      const pending = room.battleState.pendingAction;
      if (!bypassTurnValidation) {
        if (pending && Number(pending.playerIndex) !== Number(seatInfo.playerIndex)) {
          return sendJson(response, 409, { error: "Nao e a sua vez de agir nesta janela." });
        }
        if (!pending && Number(room.battleState.board?.activePlayerIndex) !== Number(seatInfo.playerIndex)) {
          return sendJson(response, 409, { error: "Nao e o seu turno." });
        }
      }
      const stateBefore = createBattleTelemetrySnapshot(room.battleState);
      const actorKey = seatInfo.seat === "host"
        ? normalizeUserKey(room.players?.host?.username || room.players?.host?.name || "host")
        : normalizeUserKey(room.players?.guest?.username || room.players?.guest?.name || "guest");
      try {
        await applyRoomAction(room, resolvedAction, seatInfo.playerIndex, seatInfo.seat);
      } catch (error) {
        return sendJson(response, 400, { error: error?.message || "Falha ao aplicar acao." });
      }
      if (!bypassTurnValidation) {
        room.lastActionSeq = Number(room.lastActionSeq || 0) + 1;
      }
      if (room.battleState?.finished) {
        markRoomAsFinished(room, "battle_finished");
        clearAllDisconnectTimers(room);
      }
      room.updatedAt = nowIso();
      const stateAfter = createBattleTelemetrySnapshot(room.battleState);
      appendBattleActionTelemetry(room, {
        actorKey,
        actorSeat: seatInfo.seat,
        playerIndex: Number(seatInfo.playerIndex),
        intent: normalizeBattleIntent(decodedIntent, resolvedAction),
        action: resolvedAction,
        actionFamily: classifyActionFamily(resolvedAction),
        state_before: stateBefore,
        state_after: stateAfter,
        effects_resolved: Array.isArray(room.battleState?.effectLog)
          ? room.battleState.effectLog.slice(-5).map((entry) => ({
              type: entry?.type || null,
              effectKind: entry?.effectKind || null,
              source: entry?.source || null,
              result: entry?.result || null,
            }))
          : [],
      });
      if (!bypassTurnValidation) {
        broadcastRoomSnapshot(room, "action_applied");
      }
      sendJson(response, 200, {
        ok: true,
        seq: room.lastActionSeq,
        snapshot: buildRoomStatePayload(room, seatToken),
      });
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/multiplayer/events/")) {
      const roomId = pathname.split("/")[4];
      const room = multiplayerRooms.get(roomId);
      if (!room) {
        sendText(response, 404, "Room not found");
        return;
      }
      const seatToken = parsedUrl.searchParams.get("seatToken") || "";
      const access = requireAuthenticatedRoomAccess(request, response, room, {
        seatToken,
        allowSpectator: true,
      });
      if (!access) {
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      const client = { res: response, seatToken };
      room.clients.add(client);
      const seat = access.seatInfo.seat;
      if (seat === "host" || seat === "guest") {
        markSeatConnected(room, seat);
      }
      const snapshot = buildRoomStatePayload(room, seatToken);
      response.write(`data: ${JSON.stringify({ type: "room_snapshot", reason: "initial", snapshot })}\n\n`);
      if (snapshot?.battleState) {
        const battleDecoded = decodeRichValue(snapshot.battleState);
        response.write(`data: ${JSON.stringify({
          type: "game_state_update",
          reason: "initial",
          seq: Number(room.lastActionSeq || 0),
          phase: snapshot?.phase || room.phase || "lobby",
          battleStateView: buildBattleStateView(battleDecoded),
          snapshot,
        })}\n\n`);
      }

      request.on("close", () => {
        room.clients.delete(client);
        if (seat === "host" || seat === "guest") {
          markSeatDisconnected(room, seat);
        }
      });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/reload") {
      const adminUser = requireAdminUser(request, response);
      if (!adminUser) {
        return;
      }
      refreshLibraryCatalog(true);
      ensurePerimQuestTemplatesSeed();
      loadPerimDropTables(true);
      effectPendingStats = writeBasePendingEffectsReport();
      creaturePendingStats = writeBaseCreaturePendingEffectsReport();
      writePerimActionsDropsReport();
      sendJson(response, 200, {
        ok: true,
        stats: library.stats,
        generatedAt: library.generatedAt,
        libraryStorage: String(library?.storage || "json_files"),
        pendingAttacks: effectPendingStats,
        pendingEffects: effectPendingStats,
        pendingCreatures: creaturePendingStats,
      });
      return;
    }

  if (pathname === "/api/settings") {
    if (request.method === "GET") {
      const settings = readSettingsFromDisk();
      const payload = settings?.settings && typeof settings.settings === "object"
        ? settings.settings
        : (settings && typeof settings === "object" ? settings : {});
      sendJson(response, 200, {
        ok: true,
        settings: payload,
        updatedAt: settings?.updatedAt || null,
        schemaVersion: settings?.schemaVersion || 1,
      });
      return;
    }
    if (request.method === "POST") {
      const adminUser = requireAdminUser(request, response);
      if (!adminUser) {
        return;
      }
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { error: error.message });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(payloadText || "{}");
      } catch {
        sendJson(response, 400, { error: "JSON invalido." });
        return;
      }
      const saved = writeSettingsToDisk(payload);
      sendJson(response, 200, { ok: true, settings: saved.settings, updatedAt: saved.updatedAt });
      return;
    }
  }

    if (
      (pathname === "/api/attacks/pending/append"
        || pathname === "/api/effects/pending/append"
        || pathname === "/api/creatures/pending/append")
      && request.method === "POST"
    ) {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
      const payloadWithType =
        pathname === "/api/creatures/pending/append"
          ? { ...payload, cardType: "creatures" }
          : payload;
      const result = appendRuntimePendingEffect(payloadWithType);
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

  if (pathname === "/api/debug/session/start" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      payload = {};
    }
    const session = createDebugSession(payload);
    appendDebugLines(session.filePath, [{ type: "session_start", payload }]);
    sendJson(response, 200, {
      ok: true,
      sessionId: session.sessionId,
      file: session.fileName,
    });
    return;
  }

  if (pathname === "/api/debug/session/append" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    let payloadText;
    try {
      payloadText = await readBody(request);
    } catch (error) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      sendJson(response, 400, { error: "JSON invalido." });
      return;
    }
    const sessionId = String(payload.sessionId || "");
    const session = debugSessions.get(sessionId);
    if (!session) {
      sendJson(response, 404, { error: "Sessao debug nao encontrada." });
      return;
    }
    const added = appendDebugLines(session.filePath, payload.entries || []);
    sendJson(response, 200, { ok: true, appended: added });
    return;
  }

  if (pathname === "/api/debug/session/end" && request.method === "POST") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    let payloadText = "";
    try {
      payloadText = await readBody(request);
    } catch {
      payloadText = "";
    }
    let payload;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      payload = {};
    }
    const sessionId = String(payload.sessionId || "");
    const session = debugSessions.get(sessionId);
    if (!session) {
      sendJson(response, 200, { ok: true, ended: false });
      return;
    }
    appendDebugLines(session.filePath, payload.entries || []);
    appendDebugLines(session.filePath, [
      {
        type: "session_end",
        at: new Date().toISOString(),
        reason: String(payload.reason || "manual"),
      },
    ]);
    debugSessions.delete(sessionId);
    sendJson(response, 200, { ok: true, ended: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/decks") {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const username = String(authUser.username || "local-player");
    sendJson(response, 200, { decks: listDecks(username) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/music") {
    const tracks = listMusicTracks();
    if (!tracks.length) {
      console.warn(`[MUSIC] Nenhuma trilha encontrada. Pastas verificadas: ${MUSIC_DIR} | ${MUSIC_DIR_FALLBACK}`);
    }
    sendJson(response, 200, { tracks });
    return;
  }

  if (request.method === "POST" && pathname === "/api/shutdown") {
    const adminUser = requireAdminUser(request, response);
    if (!adminUser) {
      return;
    }
    sendJson(response, 200, { ok: true });
    // Kill the process shortly after responding
    setTimeout(() => {
      console.log("Shutting down via API...");
      process.exit(0);
    }, 200);
    return;
  }

  if (pathname.startsWith("/api/decks/")) {
    const authUser = requireAuthenticatedUser(request, response);
    if (!authUser) {
      return;
    }
    const requesterKey = normalizeUserKey(authUser.username || "local-player");
    const rawName = decodeURIComponent(pathname.replace("/api/decks/", ""));
    const normalizedName = normalizeDeckName(rawName);
    if (!normalizedName) {
      sendJson(response, 400, { error: "Nome de deck invalido." });
      return;
    }

    if (request.method === "GET") {
      if (requesterKey) {
        claimOwnerlessDeckForUser(normalizedName, requesterKey);
      }
      const parsed = readDeckFileByName(`${normalizeDeckName(rawName)}.json`);
      if (!parsed) {
        sendJson(response, 404, { error: "Deck nao encontrado." });
        return;
      }
      const parsedOwner = deckOwnerKey(parsed);
      if (requesterKey && parsedOwner && parsedOwner !== requesterKey) {
        sendJson(response, 403, { error: "Deck pertence a outro usuario." });
        return;
      }
      sendJson(response, 200, parsed);
      return;
    }

    if (request.method === "POST") {
      let payloadText;
      try {
        payloadText = await readBody(request);
      } catch (error) {
        sendJson(response, 413, { error: error.message });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(payloadText || "{}");
      } catch {
        sendJson(response, 400, { error: "JSON invalido." });
        return;
      }

      const requestedDeckName = normalizeDeckName(rawName);
      const editingDeckAnchor = normalizeDeckName(payload?.editingDeckAnchor || rawName);
      if (requesterKey && editingDeckAnchor) {
        claimOwnerlessDeckForUser(editingDeckAnchor, requesterKey);
      }
      const existingDeck = readDeckFileByName(`${editingDeckAnchor}.json`);
      if (requesterKey && existingDeck) {
        const existingOwner = deckOwnerKey(existingDeck);
        if (existingOwner && existingOwner !== requesterKey) {
          sendJson(response, 403, { error: "Deck pertence a outro usuario." });
          return;
        }
      }
      const owner = requesterKey || deckOwnerKey(existingDeck || {}) || "local-player";
      const deckData = {
        name: String(payload.name || requestedDeckName),
        owner,
        createdAt: payload.createdAt || existingDeck?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mode: String(payload.mode || "competitive"),
        cards: {
          creatures: Array.isArray(payload.cards?.creatures) ? payload.cards.creatures : [],
          attacks: Array.isArray(payload.cards?.attacks) ? payload.cards.attacks : [],
          battlegear: Array.isArray(payload.cards?.battlegear) ? payload.cards.battlegear : [],
          mugic: Array.isArray(payload.cards?.mugic) ? payload.cards.mugic : [],
          locations: Array.isArray(payload.cards?.locations) ? payload.cards.locations : [],
        },
      };

      const scansValidation = validateDeckAgainstScans(deckData, editingDeckAnchor, owner);
      if (!scansValidation.ok) {
        sendJson(response, 400, {
          error: `Deck excede inventario de scans: ${scansValidation.errors.slice(0, 4).join(" | ")}`,
        });
        return;
      }

      writeDeckStored(requestedDeckName, deckData);
      if (editingDeckAnchor && editingDeckAnchor !== requestedDeckName && existingDeck) {
        deleteDeckStored(editingDeckAnchor);
      }
      invalidateUserCaches(owner);
      sendJson(response, 200, { ok: true, deck: deckData });
      return;
    }

    if (request.method === "DELETE") {
      if (requesterKey) {
        claimOwnerlessDeckForUser(normalizedName, requesterKey);
      }
      const existingDeck = readDeckFileByName(`${normalizeDeckName(rawName)}.json`);
      if (!existingDeck) {
        sendJson(response, 404, { error: "Deck nao encontrado." });
        return;
      }
      if (requesterKey) {
        const existingOwner = deckOwnerKey(existingDeck || {});
        if (existingOwner && existingOwner !== requesterKey) {
          sendJson(response, 403, { error: "Deck pertence a outro usuario." });
          return;
        }
      }
      const owner = requesterKey || deckOwnerKey(existingDeck || {}) || "local-player";
      deleteDeckStored(normalizeDeckName(rawName));
      invalidateUserCaches(owner);
      sendJson(response, 200, {
        ok: true,
        returnedCount: 0,
        skippedByCapCount: 0,
        breakdown: {},
      });
      return;
    }
  }

    // ===== ENDPOINTS DE DROPS DE CRIATURAS =====

  // GET /api/creature-drops/location/:locationName
  // Obtem criaturas disponiveis em um local especifico hoje.
  if (request.method === "GET" && pathname.startsWith("/api/creature-drops/location/")) {
    const locationName = decodeURIComponent(pathname.replace("/api/creature-drops/location/", ""));
    const creatures = getCreaturesAtLocation(locationName);
    sendJson(response, 200, { location: locationName, creatures });
    return;
  }

  // GET /api/creature-drops/world-type/:worldType
  // Obtem criaturas disponiveis em um tipo de mundo hoje.
  if (request.method === "GET" && pathname.startsWith("/api/creature-drops/world-type/")) {
    const worldType = decodeURIComponent(pathname.replace("/api/creature-drops/world-type/", ""));
    const creatures = getCreaturesForWorldType(worldType);
    sendJson(response, 200, { worldType, creatures, date: new Date().toISOString().split("T")[0] });
    return;
  }

  // GET /api/creature-drops/news-ticker/:locationName
  // Obtem dados formatados para news ticker (types + flavortexts).
  if (request.method === "GET" && pathname.startsWith("/api/creature-drops/news-ticker/")) {
    const locationName = decodeURIComponent(pathname.replace("/api/creature-drops/news-ticker/", ""));
    const globalCreatures = getGlobalDailyCreatures();
    const newsItems = buildTickerNewsItems(globalCreatures, 32);
    sendJson(response, 200, {
      location: locationName,
      scope: "global_daily_pool",
      newsItems,
      date: new Date().toISOString().split("T")[0],
    });
    return;
  }

  if (request.method === "GET") {
    serveStatic(pathname, response);
    return;
  }

  sendText(response, 405, "Method not allowed");
}

try {
  migrateKvToSqlV2IfNeeded();
} catch (error) {
  sqlStorageMode = "sql_v2_cutover_failed";
  console.error(`[DB] Cutover SQL v${SQL_V2_SCHEMA_VERSION} falhou; servidor segue sem escrita nesses dominios. ${error?.message || error}`);
}

refreshLibraryCatalog(false);
ensurePerimLocationAdjacencySeedFromMatrix();
ensurePerimQuestTemplatesSeed();
loadPerimDropTables(true);
hydrateCreatureDropSqlMetadata();
writePerimActionsDropsReport();
migrateExistingUsernamesToStrictPolicy();
seedAdminAccount();
getPerimRuntimeConfig(true);
ensureDailyCreatureLocations(todayDateKey());
queuePerimDailyGeneration("startup", todayDateKey());
startDailyCreatureLocationScheduler();
startPerimBattlegearDailySpawnScheduler();
startPerimClimateDailyEffectScheduler();
cleanupOldDbBackups(DB_BACKUP_RETENTION_DAYS);
startDbBackupScheduler();
startMultiplayerRoomGcScheduler();

const server = http.createServer((request, response) => {
  const requestStartedAt = Date.now();
  const requestPath = (() => {
    try {
      return new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
    } catch {
      return String(request.url || "/");
    }
  })();
  response.on("finish", () => {
    trackRequestMetric(
      requestPath,
      String(request.method || "GET"),
      Number(response.statusCode || 0),
      Math.max(0, Date.now() - requestStartedAt)
    );
  });
  handleRequest(request, response).catch((error) => {
    console.error("[HTTP] Erro interno ao processar requisicao:", error?.message || error);
    sendJson(response, 500, { error: "Erro interno do servidor." });
  });
});

server.listen(PORT, () => {
  const stats = library.stats;
  const missingSmtpKeys = getMissingSmtpConfigKeys();
  // eslint-disable-next-line no-console
  console.log(
    `Chaotic data-driven server online at http://localhost:${PORT} | cards: ${stats.totalCards} (${stats.creatures} creatures, ${stats.attacks} attacks)`
  );
  if (missingSmtpKeys.length) {
    console.warn(`[SMTP] Nao configurado. host=${SMTP_HOST || "(empty)"} port=${SMTP_PORT || 0} secure=${SMTP_SECURE ? "true" : "false"} missing=${missingSmtpKeys.join(",")}`);
  } else {
    console.log(`[SMTP] Configurado. host=${SMTP_HOST} port=${SMTP_PORT} secure=${SMTP_SECURE ? "true" : "false"} user=ok pass=ok from=ok`);
  }
});

