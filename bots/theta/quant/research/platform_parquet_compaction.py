"""Compaction of the small per-date Parquet files of ONE dataset into month-partitioned files, without changing a single row.

Writes `<dataset_directory>/compacted/dp_session_month=YYYY-MM/*.parquet` plus `compaction-manifest.json` (lineage: every source file with its sha256 and size, the source
manifest hash, row count, schema), verifies EXACT row parity in both directions (EXCEPT over all columns) and only then publishes. Atomic: it builds in a temporary directory
and renames, so a crash leaves the sources untouched and no partial compacted dataset. Source files are never modified or deleted here; the caller retires them only after the
compaction manifest is verified and recorded.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import duckdb

from research.platform_parquet import (
    FORMAT_VERSION, ROW_GROUP_SIZE, SMALL_FILE_BYTES, PlatformParquetError, _escape, _quote, _sha256_file, load_manifest, verify_files,
)


def compact_small_files(dataset_directory: Path, *, producer_sha: str) -> Path:
    if len(producer_sha) != 40 or any(character not in "0123456789abcdef" for character in producer_sha):
        raise PlatformParquetError("PRODUCER_SHA_INVALID")
    manifest_path = dataset_directory / "parquet-manifest.json"
    manifest = load_manifest(manifest_path)
    _, problems = verify_files(manifest_path, dataset_directory.parent)
    if problems:
        raise PlatformParquetError(f"SOURCE_UNVERIFIED:{problems[:3]}")
    target = dataset_directory / "compacted"
    if target.exists():
        raise PlatformParquetError("COMPACTED_DESTINATION_ALREADY_EXISTS")
    scratch = Path(tempfile.mkdtemp(prefix="theta-pq-compact-", dir=str(dataset_directory)))
    connection = duckdb.connect(database=":memory:")
    try:
        glob = _escape(dataset_directory / "dp_session_date=*" / "*.parquet")
        out_directory = scratch / "out"
        connection.execute(
            f"COPY (SELECT *, strftime(dp_session_date, '%Y-%m') AS dp_session_month FROM read_parquet('{glob}', hive_partitioning=true) ORDER BY __row) "
            f"TO '{_escape(out_directory)}' (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE {ROW_GROUP_SIZE}, PARTITION_BY (dp_session_month))"
        )
        merged_glob = _escape(out_directory / "dp_session_month=*" / "*.parquet")
        merged_rows = connection.execute(f"SELECT count(*) FROM read_parquet('{merged_glob}', hive_partitioning=true)").fetchone()[0]
        if merged_rows != manifest["rowCount"]:
            raise PlatformParquetError(f"COMPACTION_ROW_COUNT_MISMATCH:{merged_rows}/{manifest['rowCount']}")
        columns: List[str] = [row[0] for row in connection.execute(f"DESCRIBE SELECT * FROM read_parquet('{glob}', hive_partitioning=true)").fetchall()]
        listing = ", ".join(_quote(column) for column in columns)
        left_only = connection.execute(
            f"SELECT count(*) FROM (SELECT {listing} FROM read_parquet('{glob}', hive_partitioning=true) EXCEPT SELECT {listing} FROM read_parquet('{merged_glob}', hive_partitioning=true))"
        ).fetchone()[0]
        right_only = connection.execute(
            f"SELECT count(*) FROM (SELECT {listing} FROM read_parquet('{merged_glob}', hive_partitioning=true) EXCEPT SELECT {listing} FROM read_parquet('{glob}', hive_partitioning=true))"
        ).fetchone()[0]
        if left_only or right_only:
            raise PlatformParquetError(f"COMPACTION_PARITY_FAILED:{left_only}/{right_only}")
        entries = [
            {"file": str(file.relative_to(out_directory)).replace("\\", "/"), "bytes": file.stat().st_size, "sha256": _sha256_file(file)}
            for file in sorted(out_directory.glob("dp_session_month=*/*.parquet"))
        ]
        compaction: Dict[str, Any] = {
            "formatVersion": FORMAT_VERSION + "-compaction",
            "dataset": manifest["dataset"],
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "producerSha": producer_sha,
            "sourceManifestSha256": hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest(),
            "sourcePopulationDigest": manifest["sourcePopulationDigest"],
            "rowCount": merged_rows,
            "schemaColumns": columns,
            "partitioning": "HIVE:dp_session_month",
            "sourceFiles": [{"file": entry["file"], "sha256": entry["sha256"], "bytes": entry["bytes"]} for entry in manifest["files"]],
            "files": entries,
            "fileCount": len(entries),
            "smallFileCount": sum(1 for entry in entries if entry["bytes"] < SMALL_FILE_BYTES),
            "totalBytes": sum(entry["bytes"] for entry in entries),
            "parity": {"rowCount": "EXACT", "rowContent": "EXCEPT_BOTH_DIRECTIONS_ZERO"},
        }
        compaction["manifestSha256"] = hashlib.sha256(json.dumps(compaction, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        (out_directory / "compaction-manifest.json").write_text(json.dumps(compaction, indent=2) + "\n", encoding="utf-8")
    except BaseException:
        connection.close()
        shutil.rmtree(scratch, ignore_errors=True)
        raise
    connection.close()
    (scratch / "out").rename(target)
    shutil.rmtree(scratch, ignore_errors=True)
    return target / "compaction-manifest.json"


def verify_compaction(compaction_manifest_path: Path) -> Tuple[int, List[str]]:
    """Re-reads the compacted files: hashes, row count and manifest self-hash. Returns (rows, problems)."""
    manifest = json.loads(compaction_manifest_path.read_text(encoding="utf-8"))
    declared = manifest.pop("manifestSha256", None)
    problems: List[str] = []
    if declared != hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest():
        problems.append("COMPACTION_MANIFEST_HASH_MISMATCH")
    base = compaction_manifest_path.parent
    for entry in manifest["files"]:
        file = base / entry["file"]
        if not file.is_file():
            problems.append(f"MISSING:{entry['file']}")
        elif _sha256_file(file) != entry["sha256"]:
            problems.append(f"HASH_MISMATCH:{entry['file']}")
    rows = 0
    if not problems:
        connection = duckdb.connect(database=":memory:")
        try:
            rows = connection.execute(f"SELECT count(*) FROM read_parquet('{_escape(base / 'dp_session_month=*' / '*.parquet')}', hive_partitioning=true)").fetchone()[0]
        finally:
            connection.close()
        if rows != manifest["rowCount"]:
            problems.append(f"ROW_COUNT:{rows}/{manifest['rowCount']}")
    return rows, problems
