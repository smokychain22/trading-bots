#!/usr/bin/env python3
"""Compact verified local THETA research batches into immutable Parquet.

This tool never reads credentials and never changes PostgreSQL. SQLite rows are
marked archived only after DuckDB reads the new Parquet and every batch hash and
row count agrees with the source WAL.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import sys

import duckdb


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", default=".theta-local-worker/research-spool/theta-research.sqlite")
    parser.add_argument("--destination", default=r"C:\ProjectBackups\trading-bots\research-archives")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--simulate-interruption-after-parquet", action="store_true",
                        help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.limit < 1 or args.limit > 10000:
        raise ValueError("limit must be between 1 and 10000")

    sqlite_path = pathlib.Path(args.sqlite).resolve()
    destination = pathlib.Path(args.destination).resolve()
    if not sqlite_path.exists():
        print(json.dumps({"state": "NO_SQLITE_SPOOL", "path": str(sqlite_path)}))
        return 0

    source = sqlite3.connect(str(sqlite_path))
    source.row_factory = sqlite3.Row
    backlog_start = source.execute(
        "SELECT count(*) FROM research_batch WHERE storage_state='PENDING_PARQUET'"
    ).fetchone()[0]
    rows = source.execute(
        """SELECT batch_id,family,source_sha,decision_cycle_id,snapshot_id,observed_at,
                  row_count,payload_json,payload_hash
           FROM research_batch WHERE storage_state='PENDING_PARQUET'
           ORDER BY observed_at,batch_id LIMIT ?""",
        (args.limit,),
    ).fetchall()
    if not rows:
        source.close()
        print(json.dumps({"state": "NO_PENDING_BATCHES", "path": str(sqlite_path)}))
        return 0


    for row in rows:
        payload_bytes = row["payload_json"].encode("utf-8")
        payload = json.loads(row["payload_json"])
        if not isinstance(payload, list) or len(payload) != row["row_count"]:
            raise RuntimeError(f"ROW_COUNT_MISMATCH:{row['batch_id']}")
        if sha256_bytes(payload_bytes) != row["payload_hash"]:
            raise RuntimeError(f"PAYLOAD_HASH_MISMATCH:{row['batch_id']}")

    now = dt.datetime.now(dt.timezone.utc)
    source_shas = sorted({str(row["source_sha"]) for row in rows})
    identity_json = json.dumps([
        {"batchId": row["batch_id"], "payloadHash": row["payload_hash"], "rowCount": row["row_count"]}
        for row in sorted(rows, key=lambda value: value["batch_id"])
    ], sort_keys=True, separators=(",", ":"))
    archive_identity_hash = sha256_bytes(identity_json.encode("utf-8"))
    archive_id = f"batch_{archive_identity_hash[:24]}_{len(rows)}b"
    archive_dir = destination / archive_id
    partial_dir = destination / f".{archive_id}.partial-{os.getpid()}"
    destination.mkdir(parents=True, exist_ok=True)
    if partial_dir.exists():
        shutil.rmtree(partial_dir)
    partial_dir.mkdir(parents=True, exist_ok=False)
    parquet_path = partial_dir / "theta-research-batches.parquet"
    manifest_path = partial_dir / "manifest.json"

    db = duckdb.connect(":memory:")
    db.execute("""CREATE TABLE research_batch(
        batch_id VARCHAR, family VARCHAR, source_sha VARCHAR, decision_cycle_id VARCHAR,
        snapshot_id VARCHAR, observed_at TIMESTAMPTZ, row_count BIGINT,
        payload_json JSON, payload_hash VARCHAR)""")
    db.executemany("INSERT INTO research_batch VALUES (?,?,?,?,?,?,?,?,?)", [tuple(row) for row in rows])
    escaped = str(parquet_path).replace("'", "''")
    db.execute(f"COPY research_batch TO '{escaped}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    verified = db.execute(
        f"SELECT count(*)::BIGINT,sum(row_count)::BIGINT,count(DISTINCT batch_id)::BIGINT "
        f"FROM read_parquet('{escaped}')"
    ).fetchone()
    parquet_hash_rows = db.execute(
        f"SELECT batch_id,payload_hash,row_count FROM read_parquet('{escaped}') ORDER BY batch_id"
    ).fetchall()
    db.close()

    expected_hash_rows = sorted((row["batch_id"], row["payload_hash"], row["row_count"]) for row in rows)
    if verified != (len(rows), sum(row["row_count"] for row in rows), len(rows)):
        raise RuntimeError("PARQUET_ROW_COUNT_VERIFICATION_FAILED")
    if parquet_hash_rows != expected_hash_rows:
        raise RuntimeError("PARQUET_BATCH_HASH_VERIFICATION_FAILED")
    if args.simulate_interruption_after_parquet:
        source.close()
        raise RuntimeError("SIMULATED_INTERRUPTION_AFTER_PARQUET")

    parquet_sha = sha256_bytes(parquet_path.read_bytes())
    manifest = {
        "contractVersion": "theta-local-research-parquet-manifest-v1",
        "archiveId": archive_id,
        "archiveIdentityHash": archive_identity_hash,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "sourceSqlite": str(sqlite_path),
        "families": sorted({str(row["family"]) for row in rows}),
        "sourceShas": source_shas,
        "batchCount": len(rows),
        "researchRowCount": sum(row["row_count"] for row in rows),
        "batchPayloadHashes": [
            {"batchId": row["batch_id"], "payloadHash": row["payload_hash"], "rowCount": row["row_count"]}
            for row in sorted(rows, key=lambda value: value["batch_id"])
        ],
        "parquetFile": parquet_path.name,
        "parquetSha256": parquet_sha,
        "duckdbReadback": "PASS",
        "brokerAuthority": False,
    }
    manifest_json = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    manifest_path.write_text(manifest_json + "\n", encoding="utf-8")
    manifest_hash = sha256_bytes(manifest_json.encode("utf-8"))

    if archive_dir.exists():
        existing_manifest_path = archive_dir / "manifest.json"
        if not existing_manifest_path.exists():
            raise RuntimeError("EXISTING_ARCHIVE_MANIFEST_MISSING")
        existing_manifest = json.loads(existing_manifest_path.read_text(encoding="utf-8"))
        if existing_manifest.get("archiveIdentityHash") != archive_identity_hash:
            raise RuntimeError("EXISTING_ARCHIVE_IDENTITY_CONFLICT")
        if existing_manifest.get("batchPayloadHashes") != manifest["batchPayloadHashes"]:
            raise RuntimeError("EXISTING_ARCHIVE_BATCH_IDENTITY_CONFLICT")
        existing_parquet = archive_dir / str(existing_manifest.get("parquetFile", ""))
        if not existing_parquet.exists() or sha256_bytes(existing_parquet.read_bytes()) != existing_manifest.get("parquetSha256"):
            raise RuntimeError("EXISTING_ARCHIVE_PARQUET_HASH_INVALID")
        verify_db = duckdb.connect(":memory:")
        existing_escaped = str(existing_parquet).replace("'", "''")
        existing_rows = verify_db.execute(
            f"SELECT batch_id,payload_hash,row_count FROM read_parquet('{existing_escaped}') ORDER BY batch_id"
        ).fetchall()
        verify_db.close()
        if existing_rows != expected_hash_rows:
            raise RuntimeError("EXISTING_ARCHIVE_DUCKDB_READBACK_FAILED")
        manifest_json = json.dumps(existing_manifest, sort_keys=True, separators=(",", ":"))
        manifest_hash = sha256_bytes(manifest_json.encode("utf-8"))
        parquet_sha = str(existing_manifest["parquetSha256"])
        shutil.rmtree(partial_dir)
    else:
        partial_dir.rename(archive_dir)
    parquet_path = archive_dir / str(manifest.get("parquetFile", "theta-research-batches.parquet"))

    with source:
        for row in rows:
            changed = source.execute(
                """UPDATE research_batch SET storage_state='ARCHIVED_PARQUET',archived_manifest_hash=?
                   WHERE batch_id=? AND payload_hash=? AND storage_state='PENDING_PARQUET'""",
                (manifest_hash, row["batch_id"], row["payload_hash"]),
            ).rowcount
            if changed != 1:
                raise RuntimeError(f"SQLITE_ARCHIVE_STATE_RACE:{row['batch_id']}")
    backlog_end = source.execute(
        "SELECT count(*) FROM research_batch WHERE storage_state='PENDING_PARQUET'"
    ).fetchone()[0]
    source.close()
    for stale_partial in destination.glob(f".{archive_id}.partial-*"):
        if stale_partial.is_dir():
            shutil.rmtree(stale_partial)
    print(json.dumps({
        "state": "VERIFIED_PARQUET_ARCHIVE", "archiveId": archive_id,
        "batchCount": len(rows), "researchRowCount": manifest["researchRowCount"],
        "parquetSha256": parquet_sha, "manifestSha256": manifest_hash,
        "archiveIdentityHash": archive_identity_hash,
        "backlogStart": backlog_start, "backlogEnd": backlog_end,
        "backlogMonotonic": backlog_end <= backlog_start,
        "archiveDirectory": str(archive_dir),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "FAILED", "error": type(error).__name__, "detail": str(error)}), file=sys.stderr)
        raise
