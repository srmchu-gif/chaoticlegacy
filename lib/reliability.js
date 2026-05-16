const fs = require("fs");

function safeDecodeURIComponent(value) {
  const source = String(value || "");
  try {
    return { ok: true, value: decodeURIComponent(source), error: "" };
  } catch (error) {
    return { ok: false, value: source, error: String(error?.message || error || "decode_failed") };
  }
}

function createSqliteVacuumSnapshot(sqliteDb, backupPath) {
  const resolvedBackupPath = String(backupPath || "").trim();
  if (!sqliteDb || typeof sqliteDb.prepare !== "function") {
    return { ok: false, error: "sqlite_db_unavailable", backupPath: resolvedBackupPath, tempPath: "" };
  }
  if (!resolvedBackupPath) {
    return { ok: false, error: "backup_path_required", backupPath: "", tempPath: "" };
  }
  const tempPath = `${resolvedBackupPath}.tmp`;
  try {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {}
    sqliteDb.prepare("VACUUM main INTO ?").run(tempPath);
    if (!fs.existsSync(tempPath)) {
      throw new Error("vacuum_snapshot_not_created");
    }
    fs.renameSync(tempPath, resolvedBackupPath);
    return { ok: true, backupPath: resolvedBackupPath, tempPath };
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {}
    return {
      ok: false,
      error: String(error?.message || error || "snapshot_failed"),
      backupPath: resolvedBackupPath,
      tempPath,
    };
  }
}

module.exports = {
  safeDecodeURIComponent,
  createSqliteVacuumSnapshot,
};

