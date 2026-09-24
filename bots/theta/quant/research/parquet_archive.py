"""Verified portable JSON to Parquet archive for THETA research evidence.

PostgreSQL remains the transactional authority. This module moves bulky,
immutable research rows into compressed Parquet while preserving enough
canonical identity to reconstruct and revalidate the original JSON exactly.
It never deletes source evidence and never grants trading authority.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

try:
    import duckdb
except ImportError as error:  # pragma: no cover - exercised by deployment preflight
    raise RuntimeError("DUCKDB_DEPENDENCY_REQUIRED_FOR_PARQUET_ARCHIVE") from error


ARCHIVE_FORMAT_VERSION = "theta-parquet-archive-v1"


class ArchiveVerificationError(Exception):
    """The archive cannot prove parity with its declared source."""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _decompose(source: Any) -> Tuple[str, Dict[str, Any], List[Tuple[str, int, str, str]]]:
    if isinstance(source, dict) and isinstance(source.get("rows"), dict):
        metadata = {key: value for key, value in source.items() if key != "rows"}
        records: List[Tuple[str, int, str, str]] = []
        for family in sorted(source["rows"]):
            rows = source["rows"][family]
            if not isinstance(rows, list):
                raise ArchiveVerificationError(f"ROW_FAMILY_NOT_ARRAY:{family}")
            for index, row in enumerate(rows):
                payload = _canonical_json(row)
                records.append((family, index, payload, _sha256_text(payload)))
        return "DATASET_EXPORT", metadata, records
    payload = _canonical_json(source)
    return "JSON_DOCUMENT", {}, [("__DOCUMENT__", 0, payload, _sha256_text(payload))]


def _reconstruct(
    source_kind: str,
    metadata: Dict[str, Any],
    records: Iterable[Tuple[str, int, str, str]],
    row_family_names: Iterable[str] = (),
) -> Any:
    ordered = list(records)
    if source_kind == "JSON_DOCUMENT":
        if len(ordered) != 1 or ordered[0][0] != "__DOCUMENT__" or ordered[0][1] != 0:
            raise ArchiveVerificationError("DOCUMENT_ARCHIVE_SHAPE_INVALID")
        return json.loads(ordered[0][2])
    if source_kind != "DATASET_EXPORT":
        raise ArchiveVerificationError("ARCHIVE_SOURCE_KIND_UNSUPPORTED")
    families: Dict[str, List[Any]] = {family: [] for family in row_family_names}
    for family, index, payload, payload_hash in ordered:
        if _sha256_text(payload) != payload_hash:
            raise ArchiveVerificationError(f"ARCHIVE_ROW_HASH_MISMATCH:{family}:{index}")
        family_rows = families.setdefault(family, [])
        if index != len(family_rows):
            raise ArchiveVerificationError(f"ARCHIVE_ROW_ORDER_INVALID:{family}:{index}")
        family_rows.append(json.loads(payload))
    return {**metadata, "rows": families}


def create_parquet_archive(source_path: Path, archive_directory: Path, archive_producer_sha: str) -> Path:
    if len(archive_producer_sha) != 40 or any(character not in "0123456789abcdef" for character in archive_producer_sha):
        raise ArchiveVerificationError("ARCHIVE_PRODUCER_SHA_INVALID")
    source = json.loads(source_path.read_text(encoding="utf-8"))
    source_kind, metadata, records = _decompose(source)
    archive_directory.mkdir(parents=True, exist_ok=True)
    parquet_path = archive_directory / "evidence.parquet"
    manifest_path = archive_directory / "manifest.json"
    if parquet_path.exists() or manifest_path.exists():
        raise ArchiveVerificationError("ARCHIVE_DESTINATION_ALREADY_EXISTS")

    connection = duckdb.connect(database=":memory:")
    try:
        connection.execute("CREATE TABLE evidence(row_family VARCHAR,row_index BIGINT,payload_json VARCHAR,payload_sha256 VARCHAR)")
        connection.executemany("INSERT INTO evidence VALUES (?,?,?,?)", records)
        escaped = str(parquet_path).replace("'", "''")
        connection.execute(
            f"COPY (SELECT * FROM evidence ORDER BY row_family,row_index) TO '{escaped}' "
            "(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    finally:
        connection.close()

    manifest: Dict[str, Any] = {
        "formatVersion": ARCHIVE_FORMAT_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "archiveProducerSourceSha": archive_producer_sha,
        "sourceReleaseSha": source.get("canonicalSourceSha") if isinstance(source, dict) else None,
        "sourceReleaseIdentityState": "PRESENT" if isinstance(source, dict) and source.get("canonicalSourceSha") else "UNAVAILABLE_IN_SOURCE",
        "sourceKind": source_kind,
        "sourceFileName": source_path.name,
        "sourceCanonicalSha256": _sha256_text(_canonical_json(source)),
        "sourceByteSha256": _sha256_file(source_path),
        "parquetFile": parquet_path.name,
        "parquetSha256": _sha256_file(parquet_path),
        "compression": "ZSTD",
        "rowCount": len(records),
        "rowFamilyCounts": {
            family: sum(1 for record in records if record[0] == family)
            for family in sorted({record[0] for record in records})
        },
        "rowFamilyNames": sorted(source.get("rows", {}).keys()) if source_kind == "DATASET_EXPORT" else [],
        "topLevelMetadata": metadata,
        "tradingAuthority": False,
        "researchAuthority": True,
    }
    manifest["manifestSha256"] = _sha256_text(_canonical_json(manifest))
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    load_verified_archive(manifest_path)
    return manifest_path


def load_verified_archive(manifest_path: Path) -> Any:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    declared_manifest_hash = manifest.pop("manifestSha256", None)
    if declared_manifest_hash != _sha256_text(_canonical_json(manifest)):
        raise ArchiveVerificationError("ARCHIVE_MANIFEST_HASH_MISMATCH")
    if manifest.get("formatVersion") != ARCHIVE_FORMAT_VERSION:
        raise ArchiveVerificationError("ARCHIVE_FORMAT_VERSION_MISMATCH")
    if manifest.get("tradingAuthority") is not False or manifest.get("researchAuthority") is not True:
        raise ArchiveVerificationError("ARCHIVE_AUTHORITY_INVALID")
    parquet_path = manifest_path.parent / str(manifest.get("parquetFile", ""))
    if not parquet_path.is_file() or _sha256_file(parquet_path) != manifest.get("parquetSha256"):
        raise ArchiveVerificationError("ARCHIVE_PARQUET_HASH_MISMATCH")

    connection = duckdb.connect(database=":memory:")
    try:
        escaped = str(parquet_path).replace("'", "''")
        rows = connection.execute(
            f"SELECT row_family,row_index,payload_json,payload_sha256 FROM read_parquet('{escaped}') "
            "ORDER BY row_family,row_index"
        ).fetchall()
    finally:
        connection.close()
    if len(rows) != manifest.get("rowCount"):
        raise ArchiveVerificationError("ARCHIVE_ROW_COUNT_MISMATCH")
    reconstructed = _reconstruct(
        str(manifest.get("sourceKind")), manifest.get("topLevelMetadata", {}), rows,
        manifest.get("rowFamilyNames", []),
    )
    if _sha256_text(_canonical_json(reconstructed)) != manifest.get("sourceCanonicalSha256"):
        raise ArchiveVerificationError("ARCHIVE_SOURCE_DIGEST_MISMATCH")
    return reconstructed
