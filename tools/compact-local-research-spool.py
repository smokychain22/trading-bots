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
import pathlib
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
    archive_id = f"{now.strftime('%Y-%m-%dT%H%M%SZ')}_{source_shas[0][:12]}_{len(rows)}b"
    archive_dir = destination / archive_id
    archive_dir.mkdir(parents=True, exist_ok=False)
    parquet_path = archive_dir / "canonical-strategy-candidate-evidence.parquet"
    manifest_path = archive_dir / "manifest.json"

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

    parquet_sha = sha256_bytes(parquet_path.read_bytes())
    manifest = {
        "contractVersion": "theta-local-research-parquet-manifest-v1",
        "archiveId": archive_id,
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

    with source:
        for row in rows:
            changed = source.execute(
                """UPDATE research_batch SET storage_state='ARCHIVED_PARQUET',archived_manifest_hash=?
                   WHERE batch_id=? AND payload_hash=? AND storage_state='PENDING_PARQUET'""",
                (manifest_hash, row["batch_id"], row["payload_hash"]),
            ).rowcount
            if changed != 1:
                raise RuntimeError(f"SQLITE_ARCHIVE_STATE_RACE:{row['batch_id']}")
    source.close()
    print(json.dumps({
        "state": "VERIFIED_PARQUET_ARCHIVE", "archiveId": archive_id,
        "batchCount": len(rows), "researchRowCount": manifest["researchRowCount"],
        "parquetSha256": parquet_sha, "manifestSha256": manifest_hash,
        "archiveDirectory": str(archive_dir),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "FAILED", "error": type(error).__name__, "detail": str(error)}), file=sys.stderr)
        raise
