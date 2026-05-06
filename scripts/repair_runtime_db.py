#!/usr/bin/env python3
"""
One-shot repair utility for runtime/chaotic.db corruption.

Flow:
1) Attempts to stop docker service "app" (best-effort).
2) Creates a timestamped backup of runtime/chaotic.db.
3) Rebuilds a recovered database from runtime schema/data.
4) Replaces kv_store('profiles','state') with healthy payload from root chaotic.db.
5) Merges missing profiles for usernames found in runtime users table.
6) Validates integrity_check == ok.
7) Performs atomic swap of recovered DB into runtime path.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def log(message: str) -> None:
    print(f"[repair-runtime-db] {message}")


def q_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def is_profiles_state_row(namespace: str, entity_key: str) -> bool:
    return str(namespace or "") == "profiles" and str(entity_key or "") == "state"


def stop_docker_app(project_root: Path) -> None:
    docker = shutil.which("docker")
    if not docker:
        log("docker nao encontrado no PATH; seguindo sem stop automatico.")
        return
    try:
        result = subprocess.run(
            [docker, "compose", "stop", "app"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception as exc:
        log(f"falha ao tentar parar docker compose app: {exc}")
        return
    if result.returncode == 0:
        output = (result.stdout or "").strip()
        if output:
            log(output)
        else:
            log("docker compose stop app executado.")
        return
    stderr = (result.stderr or "").strip() or (result.stdout or "").strip() or "erro desconhecido"
    log(f"nao foi possivel confirmar stop do app (continuando): {stderr}")


def fetch_schema(source: sqlite3.Connection) -> Tuple[List[Tuple[str, str]], List[Tuple[str, str]], List[Tuple[str, str]], List[Tuple[str, str]]]:
    rows = source.execute(
        """
        SELECT type, name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
          AND type IN ('table','index','trigger','view')
        ORDER BY
          CASE type
            WHEN 'table' THEN 0
            WHEN 'view' THEN 1
            WHEN 'index' THEN 2
            WHEN 'trigger' THEN 3
            ELSE 9
          END,
          name
        """
    ).fetchall()
    tables: List[Tuple[str, str]] = []
    views: List[Tuple[str, str]] = []
    indexes: List[Tuple[str, str]] = []
    triggers: List[Tuple[str, str]] = []
    for obj_type, name, sql in rows:
        obj_type = str(obj_type or "")
        name = str(name or "")
        sql = str(sql or "").strip()
        if not sql:
            continue
        if name.lower().startswith("sqlite_"):
            # Internal sqlite_* objects are recreated automatically as needed.
            continue
        item = (name, sql)
        if obj_type == "table":
            tables.append(item)
        elif obj_type == "view":
            views.append(item)
        elif obj_type == "index":
            indexes.append(item)
        elif obj_type == "trigger":
            triggers.append(item)
    return tables, views, indexes, triggers


def copy_regular_table(source: sqlite3.Connection, dest: sqlite3.Connection, table_name: str, batch_size: int = 1000) -> None:
    select_sql = f"SELECT * FROM {q_ident(table_name)}"
    cursor = source.execute(select_sql)
    insert_sql: Optional[str] = None
    while True:
        rows = cursor.fetchmany(batch_size)
        if not rows:
            break
        if insert_sql is None:
            column_count = len(cursor.description or [])
            if column_count <= 0:
                return
            placeholders = ",".join(["?"] * column_count)
            insert_sql = f"INSERT INTO {q_ident(table_name)} VALUES ({placeholders})"
        dest.executemany(insert_sql, rows)


def copy_kv_store_row_by_row(source: sqlite3.Connection, dest: sqlite3.Connection) -> Dict[str, int]:
    stats = {
        "inserted": 0,
        "skipped_profiles_state": 0,
        "skipped_corrupt_rows": 0,
    }
    rowids = source.execute("SELECT rowid FROM kv_store ORDER BY rowid").fetchall()
    insert_sql = """
      INSERT INTO kv_store (namespace, entity_key, payload, updated_at)
      VALUES (?, ?, ?, ?)
    """
    for (rowid,) in rowids:
        try:
            row = source.execute(
                "SELECT namespace, entity_key, payload, updated_at FROM kv_store WHERE rowid = ?",
                (rowid,),
            ).fetchone()
        except sqlite3.DatabaseError:
            stats["skipped_corrupt_rows"] += 1
            continue
        if not row:
            continue
        namespace, entity_key, payload, updated_at = row
        if is_profiles_state_row(namespace, entity_key):
            stats["skipped_profiles_state"] += 1
            continue
        dest.execute(insert_sql, (namespace, entity_key, payload, updated_at))
        stats["inserted"] += 1
    return stats


def load_profiles_state_from_root(root_db_path: Path) -> Dict:
    if not root_db_path.exists():
        raise RuntimeError(f"Banco raiz saudavel nao encontrado: {root_db_path}")
    conn = sqlite3.connect(str(root_db_path))
    try:
        row = conn.execute(
            "SELECT payload FROM kv_store WHERE namespace = 'profiles' AND entity_key = 'state'"
        ).fetchone()
        if not row or not row[0]:
            raise RuntimeError("profiles/state nao encontrado em chaotic.db raiz.")
        payload = json.loads(row[0])
        if not isinstance(payload, dict):
            raise RuntimeError("profiles/state do banco raiz nao e um objeto JSON valido.")
        return payload
    finally:
        conn.close()


def normalize_user_key(value: str) -> str:
    key = str(value or "").strip().lower()
    return key or "guest"


def create_default_profile(username: str, tribe: str = "") -> Dict:
    now = now_iso()
    return {
        "username": username,
        "favoriteTribe": str(tribe or ""),
        "starterPackGrantedAt": "",
        "starterPackTribe": "",
        "adminScannerMaxedAt": "",
        "avatar": "",
        "score": 1200,
        "wins": 0,
        "losses": 0,
        "winRate": 0,
        "battleHistory": [],
        "creatureUsage": {},
        "discoveredCards": {},
        "scanners": {
            "danian": {"level": 1, "xp": 0},
            "overworld": {"level": 1, "xp": 0},
            "underworld": {"level": 1, "xp": 0},
            "mipedian": {"level": 1, "xp": 0},
            "marrillian": {"level": 1, "xp": 0},
        },
        "mostPlayedCreature": None,
        "createdAt": now,
        "updatedAt": now,
    }


def merge_profiles_with_runtime_users(
    profiles_state: Dict,
    runtime_source: sqlite3.Connection,
) -> Tuple[Dict, int]:
    payload = profiles_state if isinstance(profiles_state, dict) else {}
    source_profiles = payload.get("profiles") if isinstance(payload.get("profiles"), dict) else {}
    merged_profiles: Dict[str, Dict] = {}

    for username, profile in source_profiles.items():
        key = normalize_user_key(username)
        if not isinstance(profile, dict):
            profile = create_default_profile(key)
        if not profile.get("username"):
            profile["username"] = key
        if not profile.get("updatedAt"):
            profile["updatedAt"] = now_iso()
        merged_profiles[key] = profile

    added = 0
    users_rows = runtime_source.execute("SELECT username, tribe FROM users").fetchall()
    for username, tribe in users_rows:
        key = normalize_user_key(username)
        if key not in merged_profiles:
            merged_profiles[key] = create_default_profile(key, str(tribe or ""))
            added += 1

    return {
        "createdAt": payload.get("createdAt") or now_iso(),
        "updatedAt": now_iso(),
        "profiles": merged_profiles,
    }, added


def replace_profiles_state(dest: sqlite3.Connection, payload: Dict) -> None:
    dest.execute(
        """
        INSERT INTO kv_store (namespace, entity_key, payload, updated_at)
        VALUES ('profiles', 'state', ?, ?)
        ON CONFLICT(namespace, entity_key)
        DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        """,
        (json.dumps(payload, ensure_ascii=False), now_iso()),
    )


def integrity_check_ok(conn: sqlite3.Connection) -> Tuple[bool, List[str]]:
    rows = conn.execute("PRAGMA integrity_check").fetchall()
    if not rows:
        return False, ["integrity_check sem retorno"]
    messages = [str(row[0]) for row in rows]
    ok = len(messages) == 1 and messages[0].strip().lower() == "ok"
    return ok, messages


def run_repair(project_root: Path, skip_stop: bool = False) -> int:
    runtime_db = project_root / "runtime" / "chaotic.db"
    root_db = project_root / "chaotic.db"
    if not runtime_db.exists():
        raise RuntimeError(f"Runtime DB nao encontrado: {runtime_db}")
    if not root_db.exists():
        raise RuntimeError(f"Banco raiz nao encontrado: {root_db}")

    if not skip_stop:
        log("Parando app/container (best-effort) antes do reparo...")
        stop_docker_app(project_root)

    ts = stamp()
    runtime_backup = runtime_db.with_name(f"{runtime_db.name}.bak.{ts}")
    runtime_corrupt = runtime_db.with_name(f"{runtime_db.name}.corrupt.{ts}")
    recovered_db = runtime_db.with_name("chaotic.recovered.db")

    if recovered_db.exists():
        recovered_db.unlink()

    shutil.copy2(runtime_db, runtime_backup)
    log(f"Backup criado: {runtime_backup}")

    source = sqlite3.connect(f"file:{runtime_db.as_posix()}?mode=ro", uri=True)
    dest = sqlite3.connect(str(recovered_db))

    try:
        source.execute("PRAGMA query_only = ON")
        dest.execute("PRAGMA foreign_keys = OFF")
        dest.execute("PRAGMA journal_mode = DELETE")

        tables, views, indexes, triggers = fetch_schema(source)
        if not tables:
            raise RuntimeError("Nao foi possivel ler schema de tabelas do runtime DB.")

        for _, create_sql in tables:
            dest.execute(create_sql)

        # Bulk copy for every table except kv_store (corruption hotspot).
        copied_tables = 0
        for table_name, _ in tables:
            if table_name == "kv_store":
                continue
            copy_regular_table(source, dest, table_name)
            copied_tables += 1

        kv_stats = copy_kv_store_row_by_row(source, dest)

        # Rebuild profiles/state from healthy root db + runtime users merge.
        root_profiles_state = load_profiles_state_from_root(root_db)
        merged_profiles_state, added_profiles = merge_profiles_with_runtime_users(root_profiles_state, source)
        replace_profiles_state(dest, merged_profiles_state)

        for _, create_sql in views:
            dest.execute(create_sql)
        for _, create_sql in indexes:
            dest.execute(create_sql)
        for _, create_sql in triggers:
            dest.execute(create_sql)

        dest.commit()

        ok, messages = integrity_check_ok(dest)
        if not ok:
            joined = " | ".join(messages[:8])
            raise RuntimeError(f"integrity_check falhou no recovered DB: {joined}")

        log(f"Tabelas copiadas (bulk): {copied_tables}")
        log(
            "kv_store copiado (row-by-row): "
            f"inserted={kv_stats['inserted']} "
            f"skipped_profiles_state={kv_stats['skipped_profiles_state']} "
            f"skipped_corrupt_rows={kv_stats['skipped_corrupt_rows']}"
        )
        log(f"Perfis adicionados por merge com users runtime: {added_profiles}")
        log("integrity_check do recovered DB: ok")

    finally:
        try:
            source.close()
        except Exception:
            pass
        try:
            dest.close()
        except Exception:
            pass

    # Atomic swap after successful recovery.
    runtime_db.replace(runtime_corrupt)
    recovered_db.replace(runtime_db)
    log(f"Swap concluido: runtime corrompido -> {runtime_corrupt}")
    log(f"Novo runtime ativo: {runtime_db}")
    return 0


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair runtime/chaotic.db corruption safely.")
    parser.add_argument(
        "--project-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Project root path (default: parent of scripts/).",
    )
    parser.add_argument(
        "--skip-stop",
        action="store_true",
        help="Skip best-effort docker compose stop app.",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    project_root = Path(args.project_root).resolve()
    try:
        return run_repair(project_root, skip_stop=bool(args.skip_stop))
    except Exception as exc:
        log(f"ERRO: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
