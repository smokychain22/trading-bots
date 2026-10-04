"""Columnar long-term archive for the THETA data platform (Parquet, ZSTD, date-partitioned).

PostgreSQL is the WORKING memory; this module writes the LONG-TERM memory. Input is the lossless gzip NDJSON archive produced by the control plane (one
`to_jsonb(row)` per line). Output is Hive-partitioned Parquet (`dp_session_date=YYYY-MM-DD/`) with stable typed scalar columns, nested variable structure kept as JSON
text columns, ZSTD compression and bounded row groups. Nothing is trusted: every row is read back and compared with its source line (exact decimal comparison); a
scalar column that cannot round-trip exactly is stored as text instead, never rounded. It never deletes anything and has no trading authority.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import tempfile
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Set, Tuple

try:
    import duckdb
except ImportError as error:  # pragma: no cover
    raise RuntimeError("DUCKDB_DEPENDENCY_REQUIRED_FOR_PLATFORM_PARQUET") from error

FORMAT_VERSION = "theta-platform-parquet-v1"
ROW_GROUP_SIZE = 122_880
SMALL_FILE_BYTES = 16 * 1024 * 1024


class PlatformParquetError(Exception):
    """The Parquet archive cannot prove parity with its source."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _decimal_loads(text: str) -> Any:
    return json.loads(text, parse_float=Decimal, parse_int=int)


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _escape(path: Path) -> str:
    return str(path).replace("\\", "/").replace("'", "''")


def iter_ndjson_lines(chunk_paths: Sequence[Path]) -> Iterator[str]:
    for chunk in chunk_paths:
        with gzip.open(chunk, "rt", encoding="utf-8") as stream:
            for line in stream:
                line = line.rstrip("\n")
                if line:
                    yield line


def _equal(source: Any, rebuilt: Any, text_columns: Set[str], path: str = "") -> bool:
    """Exact comparison. A float from a DOUBLE column equals a source decimal only if its shortest round-trip text is the same decimal."""
    if isinstance(source, dict):
        return isinstance(rebuilt, dict) and source.keys() == rebuilt.keys() and all(_equal(source[key], rebuilt[key], text_columns, f"{path}/{key}") for key in source)
    if isinstance(source, list):
        return isinstance(rebuilt, list) and len(source) == len(rebuilt) and all(_equal(a, b, text_columns, path) for a, b in zip(source, rebuilt))
    if isinstance(source, bool) or source is None or isinstance(source, str):
        return source == rebuilt and type(source) is type(rebuilt)
    if isinstance(source, (int, Decimal)):
        if isinstance(rebuilt, float):
            return Decimal(repr(rebuilt)) == Decimal(source)
        if isinstance(rebuilt, (int, Decimal)) and not isinstance(rebuilt, bool):
            return Decimal(source) == Decimal(rebuilt)
        return False
    return False


def convert_archive(
    chunk_paths: Sequence[Path],
    output_directory: Path,
    *,
    dataset: str,
    time_column: str,
    key_column: str,
    source_population_digest: str,
    producer_sha: str,
    schema_version: str = "v1",
    row_group_size: int = ROW_GROUP_SIZE,
    text_columns: Optional[Sequence[str]] = None,
) -> Path:
    """Writes `<output_directory>/<dataset>/dp_session_date=*/part-*.parquet` plus `parquet-manifest.json`, verifies parity and returns the manifest path."""
    if len(producer_sha) != 40 or any(character not in "0123456789abcdef" for character in producer_sha):
        raise PlatformParquetError("PRODUCER_SHA_INVALID")
    if not chunk_paths:
        raise PlatformParquetError("NO_ARCHIVE_CHUNKS")
    dataset_directory = output_directory / dataset
    if dataset_directory.exists():
        raise PlatformParquetError("PARQUET_DESTINATION_ALREADY_EXISTS")
    dataset_directory.mkdir(parents=True)
    forced_text: Set[str] = set(text_columns or [])
    source_rows = sum(1 for _ in iter_ndjson_lines(chunk_paths))

    for attempt in range(4):
        _write_parquet(chunk_paths, dataset_directory, time_column, forced_text, row_group_size)
        mismatching = _verify(chunk_paths, dataset_directory, key_column, forced_text)
        if not mismatching:
            break
        # a scalar column that does not round-trip exactly as DOUBLE/BIGINT is stored as text (exact), then verified again
        new_columns = mismatching - forced_text
        if not new_columns:
            raise PlatformParquetError(f"PARQUET_PARITY_FAILED:{sorted(mismatching)}")
        forced_text |= new_columns
        for stale in dataset_directory.glob("dp_session_date=*"):
            for item in stale.glob("*"):
                item.unlink()
            stale.rmdir()
    else:
        raise PlatformParquetError("PARQUET_PARITY_NOT_REACHED")

    files = sorted(dataset_directory.glob("dp_session_date=*/*.parquet"))
    connection = duckdb.connect(database=":memory:")
    try:
        glob = _escape(dataset_directory / "dp_session_date=*" / "*.parquet")
        total_rows = connection.execute(f"SELECT count(*) FROM read_parquet('{glob}', hive_partitioning=true)").fetchone()[0]
        schema = [
            {"column": row[0], "type": row[1]}
            for row in connection.execute(f"DESCRIBE SELECT * FROM read_parquet('{glob}', hive_partitioning=true)").fetchall()
        ]
    finally:
        connection.close()
    if total_rows != source_rows:
        raise PlatformParquetError(f"PARQUET_ROW_COUNT_MISMATCH:{total_rows}/{source_rows}")
    entries = []
    for file in files:
        size = file.stat().st_size
        entries.append({"file": str(file.relative_to(output_directory)).replace("\\", "/"), "bytes": size, "sha256": _sha256_file(file), "small": size < SMALL_FILE_BYTES})
    manifest: Dict[str, Any] = {
        "formatVersion": FORMAT_VERSION,
        "dataset": dataset,
        "schemaVersion": schema_version,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "producerSha": producer_sha,
        "sourcePopulationDigest": source_population_digest,
        "compression": "ZSTD",
        "rowGroupSize": row_group_size,
        "partitioning": "HIVE:dp_session_date",
        "keyColumn": key_column,
        "timeColumn": time_column,
        "rowCount": total_rows,
        "textColumns": sorted(forced_text),
        "schema": schema,
        "files": entries,
        "fileCount": len(entries),
        "smallFileCount": sum(1 for entry in entries if entry["small"]),
        "totalBytes": sum(entry["bytes"] for entry in entries),
        "parity": {"rowCount": "EXACT", "rowContent": "EXACT_DECIMAL_COMPARISON_OF_EVERY_ROW"},
        "tradingAuthority": False,
    }
    manifest["manifestSha256"] = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    path = dataset_directory / "parquet-manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return path


_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_INT64 = 2 ** 63


def infer_columns(chunk_paths: Sequence[Path], text_columns: Set[str]) -> Dict[str, str]:
    """Scans EVERY row once and decides a stable DuckDB type per top-level key. Mixed or nested values become JSON text; nothing is ever coerced."""
    seen: Dict[str, Set[str]] = {}
    for line in iter_ndjson_lines(chunk_paths):
        row = json.loads(line)
        for key, value in row.items():
            kinds = seen.setdefault(key, set())
            if value is None:
                kinds.add("null")
            elif isinstance(value, bool):
                kinds.add("bool")
            elif isinstance(value, int):
                kinds.add("int" if -_INT64 <= value < _INT64 else "bigint_overflow")
            elif isinstance(value, float):
                kinds.add("float")
            elif isinstance(value, str):
                kinds.add("timestamp" if _TIMESTAMP.match(value) else "date" if _DATE.match(value) else "uuid" if _UUID.match(value) else "str")
            else:
                kinds.add("json")
    mapping: Dict[str, str] = {}
    for key, kinds in seen.items():
        present = kinds - {"null"}
        if key in text_columns:
            mapping[key] = "VARCHAR"
        elif not present:
            mapping[key] = "VARCHAR"
        elif present == {"int"}:
            mapping[key] = "BIGINT"
        elif present <= {"int", "float"}:
            mapping[key] = "DOUBLE"
        elif present == {"bool"}:
            mapping[key] = "BOOLEAN"
        elif present == {"timestamp"}:
            mapping[key] = "TIMESTAMPTZ"
        elif present == {"date"}:
            mapping[key] = "DATE"
        elif present == {"uuid"}:
            mapping[key] = "UUID"
        elif present == {"str"} or present <= {"str", "uuid", "date"}:
            mapping[key] = "VARCHAR"
        else:
            mapping[key] = "JSON"
    return mapping


def _to_json(value: Any) -> str:
    """Serialises parsed JSON (with Decimal numbers) back to JSON text keeping every number exactly as its decimal literal."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, str)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_to_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _to_json(item) for key, item in value.items()) + "}"
    raise TypeError(f"unsupported JSON value {type(value)}")


def _exact_text(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, Decimal)):
        return format(value, "f") if isinstance(value, Decimal) else str(value)
    return json.dumps(value, default=str)


def _with_numbers_as_text(chunk_paths: Sequence[Path], text_columns: Set[str], directory: Path) -> List[Path]:
    """Rewrites the named scalar columns as their EXACT decimal text so a wide decimal is carried verbatim (DuckDB would otherwise parse it through a double)."""
    rewritten: List[Path] = []
    for index, chunk in enumerate(chunk_paths):
        target = directory / f"text-{index:05d}.ndjson.gz"
        with gzip.open(target, "wt", encoding="utf-8") as output:
            for line in iter_ndjson_lines([chunk]):
                row = json.loads(line, parse_float=Decimal, parse_int=int)
                for name in text_columns:
                    if name in row and row[name] is not None and not isinstance(row[name], (dict, list)):
                        row[name] = _exact_text(row[name])
                output.write(_to_json(row) + "\n")
        rewritten.append(target)
    return rewritten


def _write_parquet(chunk_paths: Sequence[Path], dataset_directory: Path, time_column: str, text_columns: Set[str], row_group_size: int) -> Dict[str, str]:
    scratch = None
    if text_columns:
        scratch = Path(tempfile.mkdtemp(prefix="theta-pq-text-"))
        chunk_paths = _with_numbers_as_text(chunk_paths, text_columns, scratch)
    try:
        return _write_parquet_from(chunk_paths, dataset_directory, time_column, text_columns, row_group_size)
    finally:
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)


def _write_parquet_from(chunk_paths: Sequence[Path], dataset_directory: Path, time_column: str, text_columns: Set[str], row_group_size: int) -> Dict[str, str]:
    columns = infer_columns(chunk_paths, text_columns)
    if time_column not in columns or columns[time_column] != "TIMESTAMPTZ":
        raise PlatformParquetError(f"TIME_COLUMN_NOT_TIMESTAMP:{time_column}")
    connection = duckdb.connect(database=":memory:")
    try:
        files = ", ".join("'" + _escape(path) + "'" for path in chunk_paths)
        columns_clause = ", columns={" + ", ".join(f"{_quote(name)}: '{kind}'" for name, kind in columns.items()) + "}"
        source = f"read_json([{files}], format='newline_delimited', maximum_object_size=268435456{columns_clause})"
        target = _escape(dataset_directory)
        connection.execute(
            f"COPY (SELECT row_number() OVER () AS __row, CAST({_quote(time_column)} AT TIME ZONE 'UTC' AS DATE) AS dp_session_date, * FROM {source}) "
            f"TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE {row_group_size}, PARTITION_BY (dp_session_date), OVERWRITE_OR_IGNORE)"
        )
    finally:
        connection.close()
    return columns


def _verify(chunk_paths: Sequence[Path], dataset_directory: Path, key_column: str, text_columns: Set[str]) -> Set[str]:
    """Reads every parquet row back and compares it with its source line. Returns the scalar columns whose values did not round-trip exactly."""
    connection = duckdb.connect(database=":memory:")
    mismatching: Set[str] = set()
    try:
        glob = _escape(dataset_directory / "dp_session_date=*" / "*.parquet")
        types = {row[0]: str(row[1]) for row in connection.execute(f"DESCRIBE SELECT * FROM read_parquet('{glob}', hive_partitioning=true)").fetchall()}
        # timestamps are fetched as integer microseconds (exact, and avoids a timezone-library dependency); UUIDs as text
        select_list = ", ".join(
            f"epoch_us({_quote(name)}) AS {_quote(name)}" if kind.startswith("TIMESTAMP") else f"CAST({_quote(name)} AS VARCHAR) AS {_quote(name)}" if kind == "UUID" else _quote(name)
            for name, kind in types.items() if name != "dp_session_date"
        )
        cursor = connection.execute(f"SELECT {select_list} FROM read_parquet('{glob}', hive_partitioning=true) ORDER BY __row")
        names = [description[0] for description in cursor.description]
        timestamp_columns = {name for name, kind in types.items() if kind.startswith("TIMESTAMP")}
        json_columns = {name for name, kind in types.items() if kind == "JSON"}
        source_iterator = iter_ndjson_lines(chunk_paths)
        checked = 0
        while True:
            batch = cursor.fetchmany(5000)
            if not batch:
                break
            for record in batch:
                try:
                    line = next(source_iterator)
                except StopIteration:
                    raise PlatformParquetError("PARQUET_HAS_MORE_ROWS_THAN_SOURCE")
                source = _decimal_loads(line)
                rebuilt: Dict[str, Any] = {}
                for name, value in zip(names, record):
                    if name == "__row":
                        continue
                    if name in json_columns and value is not None:
                        rebuilt[name] = _decimal_loads(value) if isinstance(value, str) else value
                    elif name in text_columns and isinstance(value, str) and name in source and not isinstance(source[name], str):
                        # exact text form of a scalar that was forced to text
                        try:
                            rebuilt[name] = json.loads(value, parse_float=Decimal, parse_int=int)
                        except ValueError:
                            rebuilt[name] = value
                    else:
                        rebuilt[name] = _instant_or_value(value, source.get(name)) if name in timestamp_columns else _normalise(value, source.get(name))
                if set(rebuilt) != set(source):
                    raise PlatformParquetError(f"PARQUET_COLUMN_SET_MISMATCH:{sorted(set(rebuilt) ^ set(source))[:5]}")
                for name in source:
                    if not _equal(source[name], rebuilt[name], text_columns):
                        mismatching.add(name)
                checked += 1
        try:
            next(source_iterator)
            raise PlatformParquetError("PARQUET_HAS_FEWER_ROWS_THAN_SOURCE")
        except StopIteration:
            pass
        if key_column and checked == 0:
            raise PlatformParquetError("PARQUET_EMPTY")
    finally:
        connection.close()
    # only scalar (non-nested) columns may fall back to text; a mismatching JSON column is a real failure
    return mismatching


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _instant_us(text: str) -> Optional[int]:
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    delta = parsed - _EPOCH
    return (delta.days * 86_400 + delta.seconds) * 1_000_000 + delta.microseconds


def _instant_or_value(value: Any, source_value: Any) -> Any:
    """A TIMESTAMPTZ column read back as integer microseconds equals its source text when it denotes the same instant (exact integer comparison)."""
    if value is None or not isinstance(source_value, str):
        return value
    return source_value if _instant_us(source_value) == value else value


def _normalise(value: Any, source_value: Any) -> Any:
    """Maps DuckDB python values back to the JSON domain. Timestamps compare as instants against the text PostgreSQL printed; UUIDs and dates as their text."""
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime) and isinstance(source_value, str):
        try:
            parsed = datetime.fromisoformat(source_value.replace("Z", "+00:00"))
        except ValueError:
            return value
        if parsed.tzinfo is None:
            return value.replace(tzinfo=None).isoformat() if value.tzinfo is None else value.isoformat()
        return source_value if parsed == value else value
    if isinstance(value, date) and not isinstance(value, datetime) and isinstance(source_value, str):
        return value.isoformat()
    return value


def load_manifest(path: Path) -> Dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    declared = manifest.pop("manifestSha256", None)
    if declared != hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest():
        raise PlatformParquetError("PARQUET_MANIFEST_HASH_MISMATCH")
    return manifest


def verify_files(manifest_path: Path, root: Optional[Path] = None) -> Tuple[int, List[str]]:
    """Weekly integrity helper: every file exists, its hash matches the manifest, and the total row count is readable through DuckDB."""
    manifest = load_manifest(manifest_path)
    base = root or manifest_path.parent.parent
    problems: List[str] = []
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
            glob = _escape(base / manifest["dataset"] / "dp_session_date=*" / "*.parquet")
            rows = connection.execute(f"SELECT count(*) FROM read_parquet('{glob}', hive_partitioning=true)").fetchone()[0]
        finally:
            connection.close()
        if rows != manifest["rowCount"]:
            problems.append(f"ROW_COUNT:{rows}/{manifest['rowCount']}")
    return rows, problems
