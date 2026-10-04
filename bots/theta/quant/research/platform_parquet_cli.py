"""Command line entry point of the Parquet long-term memory, used by the data platform automation (a subprocess; every command prints exactly one JSON line and exits non-zero on failure).

    python -m research.platform_parquet_cli convert --chunks a.ndjson.gz,b.ndjson.gz --out DIR --dataset NAME --time-column COL --key-column COL --digest SHA256 --producer-sha SHA40
    python -m research.platform_parquet_cli verify --manifest DIR/NAME/parquet-manifest.json
    python -m research.platform_parquet_cli compact --dataset-dir DIR/NAME --producer-sha SHA40
    python -m research.platform_parquet_cli open-check --manifest DIR/NAME/parquet-manifest.json

`verify` re-hashes every file against its manifest and opens the dataset through DuckDB (row count must equal the manifest). `open-check` additionally reads one row from every file.
No command touches PostgreSQL, a broker or a provider.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from research.platform_parquet import PlatformParquetError, _escape, convert_archive, load_manifest, verify_files


def _emit(payload: dict, ok: bool) -> int:
    sys.stdout.write(json.dumps(payload, sort_keys=True) + "\n")
    return 0 if ok else 1


def _convert(args: argparse.Namespace) -> int:
    chunks = [Path(item) for item in args.chunks.split(",") if item]
    manifest_path = convert_archive(
        chunks, Path(args.out), dataset=args.dataset, time_column=args.time_column, key_column=args.key_column,
        source_population_digest=args.digest, producer_sha=args.producer_sha,
    )
    manifest = load_manifest(manifest_path)
    return _emit({"command": "convert", "manifest": str(manifest_path), "rowCount": manifest["rowCount"], "fileCount": manifest["fileCount"], "totalBytes": manifest["totalBytes"], "ok": True}, True)


def _verify(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    rows, problems = verify_files(manifest_path)
    return _emit({"command": "verify", "manifest": str(manifest_path), "rows": rows, "problems": problems, "ok": not problems}, not problems)


def _compact(args: argparse.Namespace) -> int:
    from research.platform_parquet_compaction import compact_small_files

    path = compact_small_files(Path(args.dataset_dir), producer_sha=args.producer_sha)
    return _emit({"command": "compact", "manifest": str(path), "ok": True}, True)


def _open_check(args: argparse.Namespace) -> int:
    import duckdb

    manifest_path = Path(args.manifest)
    manifest = load_manifest(manifest_path)
    base = manifest_path.parent.parent
    problems = []
    connection = duckdb.connect(database=":memory:")
    try:
        for entry in manifest["files"]:
            file = base / entry["file"]
            try:
                # one row is decoded inside DuckDB (no conversion of timestamp columns into Python objects, which would need optional host modules)
                connection.execute(f"SELECT count(*) FROM (SELECT * FROM read_parquet('{_escape(file)}') LIMIT 1)").fetchone()
            except Exception as error:  # noqa: BLE001 - any read failure is a verification failure, reported not raised
                problems.append(f"UNREADABLE:{entry['file']}:{type(error).__name__}:{str(error)[:80]}")
    finally:
        connection.close()
    return _emit({"command": "open-check", "files": len(manifest["files"]), "problems": problems, "ok": not problems}, not problems)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="platform_parquet_cli")
    sub = parser.add_subparsers(dest="command", required=True)
    convert = sub.add_parser("convert")
    for name in ("chunks", "out", "dataset", "time-column", "key-column", "digest", "producer-sha"):
        convert.add_argument(f"--{name}", required=True)
    convert.set_defaults(func=_convert)
    verify = sub.add_parser("verify"); verify.add_argument("--manifest", required=True); verify.set_defaults(func=_verify)
    compact = sub.add_parser("compact"); compact.add_argument("--dataset-dir", required=True); compact.add_argument("--producer-sha", required=True); compact.set_defaults(func=_compact)
    check = sub.add_parser("open-check"); check.add_argument("--manifest", required=True); check.set_defaults(func=_open_check)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except PlatformParquetError as error:
        return _emit({"command": args.command, "ok": False, "error": str(error)}, False)
    except Exception as error:  # noqa: BLE001
        return _emit({"command": args.command, "ok": False, "error": f"{type(error).__name__}:{error}"}, False)


if __name__ == "__main__":
    raise SystemExit(main())
