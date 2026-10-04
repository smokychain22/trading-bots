"""DuckDB helpers that present ONE logical dataset over two physical tiers (spec 54): recent PostgreSQL data (hot) plus the historical Parquet archive (cold), so research
never hunts for files. Cold datasets are attached only after their manifest and file hashes verify. On a key present in both tiers the HOT row wins (a partition is
hot AND archived for a while before it is retired), so no row is ever counted twice."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

from research.platform_parquet import PlatformParquetError, load_manifest, verify_files

_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")


def _escape(path: Path) -> str:
    return str(path).replace("\\", "/").replace("'", "''")


def attach_logical_datasets(connection, parquet_root: Path, key_columns: Dict[str, str], hot_relations: Optional[Dict[str, str]] = None, verify: bool = True) -> List[str]:
    """Creates one view per dataset directory under `parquet_root`. `hot_relations` maps a dataset to a relation or table function evaluable in `connection`
    (for example a table, a parquet path, or `postgres_query('theta', 'select ...')`). Returns the created view names."""
    created: List[str] = []
    hot_relations = hot_relations or {}
    for dataset_directory in sorted(path for path in parquet_root.iterdir() if path.is_dir()):
        manifest_path = dataset_directory / "parquet-manifest.json"
        if not manifest_path.is_file():
            continue
        manifest = load_manifest(manifest_path)
        dataset = manifest["dataset"]
        view = re.sub(r"[^a-z0-9_]", "_", dataset.lower())
        key = key_columns.get(dataset) or manifest["keyColumn"]
        if not _IDENTIFIER.match(view) or not _IDENTIFIER.match(key):
            raise PlatformParquetError(f"INVALID_IDENTIFIER:{dataset}")
        if verify:
            _, problems = verify_files(manifest_path, parquet_root)
            if problems:
                raise PlatformParquetError(f"COLD_ARCHIVE_UNVERIFIED:{dataset}:{problems[:3]}")
        glob = _escape(dataset_directory / "dp_session_date=*" / "*.parquet")
        cold = f"SELECT * EXCLUDE (dp_session_date, __row), 'COLD' AS tier FROM read_parquet('{glob}', hive_partitioning=true)"
        hot = hot_relations.get(dataset)
        if hot is None:
            connection.execute(f"CREATE OR REPLACE VIEW {view} AS {cold}")
        else:
            connection.execute(
                f"CREATE OR REPLACE VIEW {view} AS SELECT *, 'HOT' AS tier FROM {hot} "
                f"UNION ALL BY NAME SELECT * FROM ({cold}) c WHERE c.{key} NOT IN (SELECT {key} FROM {hot})"
            )
        created.append(view)
    return created
