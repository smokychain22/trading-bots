#!/usr/bin/env python3
"""Verify local THETA research Parquet through DuckDB with a content cache."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from typing import Any

import duckdb


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_dataset_archive(manifest_path: pathlib.Path) -> None:
    quant_root = pathlib.Path(__file__).resolve().parents[1] / "bots" / "theta" / "quant"
    sys.path.insert(0, str(quant_root))
    from research.parquet_archive import load_verified_archive  # pylint: disable=import-outside-toplevel

    load_verified_archive(manifest_path)


def verify_spool_archive(manifest_path: pathlib.Path, manifest: dict[str, Any]) -> None:
    parquet_path = manifest_path.parent / str(manifest.get("parquetFile", ""))
    if not parquet_path.is_file() or sha256_file(parquet_path) != manifest.get("parquetSha256"):
        raise RuntimeError("ARCHIVE_PARQUET_HASH_MISMATCH")
    escaped = str(parquet_path).replace("'", "''")
    connection = duckdb.connect(":memory:")
    try:
        summary = connection.execute(
            f"SELECT count(*)::BIGINT,sum(row_count)::BIGINT,count(DISTINCT batch_id)::BIGINT "
            f"FROM read_parquet('{escaped}')"
        ).fetchone()
        rows = connection.execute(
            f"SELECT batch_id,payload_hash,row_count FROM read_parquet('{escaped}') ORDER BY batch_id"
        ).fetchall()
    finally:
        connection.close()
    expected = sorted(
        (row["batchId"], row["payloadHash"], row["rowCount"])
        for row in manifest.get("batchPayloadHashes", [])
    )
    expected_summary = (manifest.get("batchCount"), manifest.get("researchRowCount"), manifest.get("batchCount"))
    if summary != expected_summary:
        raise RuntimeError("PARQUET_ROW_COUNT_VERIFICATION_FAILED")
    if rows != expected:
        raise RuntimeError("PARQUET_BATCH_HASH_VERIFICATION_FAILED")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--cache", required=True)
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve()
    cache_path = pathlib.Path(args.cache).resolve()
    manifests = sorted(root.rglob("manifest.json")) if root.exists() else []
    if not manifests:
        print(json.dumps({"state": "NOT_AVAILABLE", "manifestCount": 0, "cacheHit": False}))
        return 0
    manifest_bytes = [(path, path.read_bytes()) for path in manifests]
    inventory_hash = sha256_bytes(b"".join(
        str(path.relative_to(root)).encode("utf-8") + b"\0" + raw for path, raw in manifest_bytes
    ))
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("inventoryHash") == inventory_hash and cached.get("state") == "PASS":
                print(json.dumps({**cached, "cacheHit": True}, sort_keys=True))
                return 0
        except (json.JSONDecodeError, OSError):
            pass
    formats: set[str] = set()
    for path, raw in manifest_bytes:
        manifest = json.loads(raw)
        format_version = manifest.get("formatVersion") or manifest.get("contractVersion")
        formats.add(str(format_version))
        if format_version == "theta-parquet-archive-v1":
            verify_dataset_archive(path)
        elif format_version == "theta-local-research-parquet-manifest-v1":
            verify_spool_archive(path, manifest)
        else:
            raise RuntimeError(f"ARCHIVE_FORMAT_UNSUPPORTED:{format_version}")
    receipt = {
        "state": "PASS",
        "manifestCount": len(manifests),
        "inventoryHash": inventory_hash,
        "formats": sorted(formats),
        "cacheHit": False,
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(receipt, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "FAILED", "error": type(error).__name__, "detail": str(error)}))
        raise SystemExit(1)
