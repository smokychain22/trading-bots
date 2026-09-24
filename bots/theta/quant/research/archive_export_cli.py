"""CLI for immutable THETA JSON to verified Parquet archives."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research.parquet_archive import create_parquet_archive, load_verified_archive


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("archive", "verify"))
    parser.add_argument("--source")
    parser.add_argument("--archive-directory")
    parser.add_argument("--manifest")
    parser.add_argument("--archive-producer-sha")
    arguments = parser.parse_args()
    if arguments.command == "archive":
        if not arguments.source or not arguments.archive_directory or not arguments.archive_producer_sha:
            parser.error("archive requires --source, --archive-directory, and --archive-producer-sha")
        manifest = create_parquet_archive(
            Path(arguments.source), Path(arguments.archive_directory), arguments.archive_producer_sha,
        )
        print(json.dumps({"state": "PASS", "manifest": str(manifest)}))
        return 0
    if not arguments.manifest:
        parser.error("verify requires --manifest")
    restored = load_verified_archive(Path(arguments.manifest))
    row_count = sum(len(rows) for rows in restored.get("rows", {}).values()) if isinstance(restored, dict) else 1
    print(json.dumps({"state": "PASS", "rowCount": row_count}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
