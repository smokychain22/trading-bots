import json
import sys
import tempfile
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.parquet_archive import (  # noqa: E402
    ArchiveVerificationError,
    create_parquet_archive,
    load_verified_archive,
)


class ParquetArchiveTests(unittest.TestCase):
    def test_round_trip_preserves_row_families_and_detects_tampering(self):
        source = {"schemaVersion": "test-v1", "rows": {"a": [{"x": 1}, {"x": 2}], "b": []}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            manifest = create_parquet_archive(source_path, root / "archive", "a" * 40)
            self.assertEqual(load_verified_archive(manifest), source)

            raw_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            raw_manifest["rowCount"] = 99
            manifest.write_text(json.dumps(raw_manifest), encoding="utf-8")
            with self.assertRaisesRegex(ArchiveVerificationError, "ARCHIVE_MANIFEST_HASH_MISMATCH"):
                load_verified_archive(manifest)

    def test_existing_destination_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.json"
            source_path.write_text('{"value":1}', encoding="utf-8")
            create_parquet_archive(source_path, root / "archive", "b" * 40)
            with self.assertRaisesRegex(ArchiveVerificationError, "ARCHIVE_DESTINATION_ALREADY_EXISTS"):
                create_parquet_archive(source_path, root / "archive", "b" * 40)


if __name__ == "__main__":
    unittest.main()
