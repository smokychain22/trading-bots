#!/usr/bin/env python
"""Converts a verified storage archive (gzip NDJSON chunks + manifest.json written by tools/theta-storage-archive.ts) into the date-partitioned ZSTD Parquet long-term
archive and verifies exact row parity. Local files only; no database access; never deletes anything.

usage: python tools/theta-platform-parquet.py --archive-dir=<population dir> --output=<parquet root> --dataset=<id> --time-column=<col> --key-column=<col> --producer-sha=<40 hex>
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bots' / 'theta' / 'quant'))
from research.platform_parquet import convert_archive, load_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--time-column', required=True)
    parser.add_argument('--key-column', required=True)
    parser.add_argument('--producer-sha', required=True)
    args = parser.parse_args()
    archive = Path(args.archive_dir)
    manifest = json.loads((archive / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('completed') is not True:
        print(json.dumps({'state': 'FAILED', 'code': 'ARCHIVE_NOT_COMPLETE'}))
        return 1
    chunks = [archive / chunk['file'] for chunk in manifest['chunks']]
    started = time.time()
    path = convert_archive(chunks, Path(args.output), dataset=args.dataset, time_column=args.time_column, key_column=args.key_column,
                           source_population_digest=manifest['populationDigest'], producer_sha=args.producer_sha)
    parquet = load_manifest(path)
    source_bytes = sum(chunk['fileBytes'] for chunk in manifest['chunks'])
    print(json.dumps({
        'state': 'PASS', 'dataset': args.dataset, 'rows': parquet['rowCount'], 'sourceRows': manifest['rows'], 'files': parquet['fileCount'], 'smallFiles': parquet['smallFileCount'],
        'parquetBytes': parquet['totalBytes'], 'sourceJsonGzipBytes': source_bytes, 'sourceUncompressedBytes': manifest['uncompressedBytes'], 'textColumns': parquet['textColumns'],
        'ratioVsUncompressed': round(manifest['uncompressedBytes'] / max(1, parquet['totalBytes']), 2), 'ratioVsJsonGzip': round(source_bytes / max(1, parquet['totalBytes']), 2),
        'seconds': round(time.time() - started, 1), 'manifest': str(path),
    }))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
