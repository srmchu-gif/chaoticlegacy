const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const {
  safeDecodeURIComponent,
  createSqliteVacuumSnapshot,
} = require("../lib/reliability");

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chaotic-reliability-"));
  try {
    return run(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

test("safeDecodeURIComponent retorna erro sem throw para entrada invalida", () => {
  const valid = safeDecodeURIComponent("abc%20def");
  assert.equal(valid.ok, true);
  assert.equal(valid.value, "abc def");

  const invalid = safeDecodeURIComponent("%E0%A4%A");
  assert.equal(invalid.ok, false);
  assert.equal(typeof invalid.error, "string");
  assert.ok(invalid.error.length > 0);
});

test("createSqliteVacuumSnapshot cria backup consistente e remove .tmp", () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, "main.db");
    const backupPath = path.join(dir, "chaotic-20260101-000000.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT);");
    db.exec("INSERT INTO sample (value) VALUES ('a'), ('b'), ('c');");

    const result = createSqliteVacuumSnapshot(db, backupPath);
    db.close();

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(backupPath), true);
    assert.equal(fs.existsSync(`${backupPath}.tmp`), false);

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    const row = backupDb.prepare("SELECT COUNT(*) AS total FROM sample").get();
    backupDb.close();
    assert.equal(Number(row?.total || 0), 3);
  });
});

test("createSqliteVacuumSnapshot falha com ok=false sem corromper backup anterior", () => {
  withTempDir((dir) => {
    const backupPath = path.join(dir, "chaotic-existing.db");
    fs.writeFileSync(backupPath, "backup-valido-anterior", "utf8");
    const before = fs.readFileSync(backupPath, "utf8");

    const result = createSqliteVacuumSnapshot(null, backupPath);

    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(backupPath), true);
    const after = fs.readFileSync(backupPath, "utf8");
    assert.equal(after, before);
    assert.equal(fs.existsSync(`${backupPath}.tmp`), false);
  });
});
