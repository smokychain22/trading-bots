import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_REPOSITORY = Path(__file__).resolve().parents[4]
_QUANT = _REPOSITORY / "bots" / "theta" / "quant"
sys.path.insert(0, str(_QUANT))

from research.parquet_archive import create_parquet_archive  # noqa: E402


class LocalResearchParquetVerifierTests(unittest.TestCase):
    def run_verifier(self, root: Path, cache: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(_REPOSITORY / "tools" / "verify-local-research-parquet.py"),
             f"--root={root}", f"--cache={cache}"],
            check=False, capture_output=True, text=True,
        )

    def test_verifies_legacy_archive_and_uses_content_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            source.write_text(json.dumps({"schemaVersion": "test-v1", "rows": {"a": [{"x": 1}]}}), encoding="utf-8")
            create_parquet_archive(source, root / "archives" / "one", "a" * 40)
            cache = root / "cache.json"
            first = self.run_verifier(root / "archives", cache)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(json.loads(first.stdout)["state"], "PASS")
            self.assertFalse(json.loads(first.stdout)["cacheHit"])
            second = self.run_verifier(root / "archives", cache)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertTrue(json.loads(second.stdout)["cacheHit"])

    def test_tampered_parquet_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            source.write_text('{"value":1}', encoding="utf-8")
            manifest = create_parquet_archive(source, root / "archives" / "one", "b" * 40)
            (manifest.parent / "evidence.parquet").write_bytes(b"tampered")
            result = self.run_verifier(root / "archives", root / "cache.json")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)["state"], "FAILED")


if __name__ == "__main__":
    unittest.main()
