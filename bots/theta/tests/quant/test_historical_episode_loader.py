"""Tests for bots/theta/quant/research/historical_episode_loader.py (work
package 24). Uses a real, temporary SQLite file matching the exact real
schema Phase 1 discovered (envelope table) -- SYNTHETIC_FIXTURE_MATCHING_REAL_SCHEMA,
never claimed as the real Sep24 spool file itself.
"""

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.historical_episode_loader import (  # noqa: E402
    SqliteEvidenceSpoolEpisodeLoader, blocked_data_episode,
)


def _build_fixture_spool(path: str) -> None:
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE envelope(decision_cycle_id TEXT, snapshot_id TEXT, decision_as_of TEXT, "
        "source_sha TEXT, sequence_number INTEGER, payload_type TEXT, payload_json TEXT)"
    )
    rows = [
        ("cycle-1", "snap-1", "2026-09-24T17:34:59Z", "7373b482ff81723d18c367ed3c9bf048b67b1db6", 0, "Q_READY",
         json.dumps({"symbol": "SPY", "qCandidateCount": 4, "qDecision": "PASS"})),
        ("cycle-1", "snap-1", "2026-09-24T17:34:59Z", "7373b482ff81723d18c367ed3c9bf048b67b1db6", 1, "AEGIS_READY",
         json.dumps({"symbol": "SPY", "aegisState": "HARD_VETO"})),
        ("cycle-1", "snap-1", "2026-09-24T17:34:59Z", "7373b482ff81723d18c367ed3c9bf048b67b1db6", 2, "DECISION_READY",
         json.dumps({"symbol": "SPY", "canonicalAction": "GLOBAL_WAIT", "selectedCandidateId": None})),
    ]
    connection.executemany(
        "INSERT INTO envelope VALUES(?, ?, ?, ?, ?, ?, ?)", rows,
    )
    connection.commit()
    connection.close()


class TestSqliteEvidenceSpoolEpisodeLoader(unittest.TestCase):
    def test_loads_real_shaped_episode_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "fixture-spool.sqlite")
            _build_fixture_spool(path)
            loader = SqliteEvidenceSpoolEpisodeLoader(path)
            rows = loader.load_episode("cycle-1")
            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[0].episode_id, "cycle-1")
            self.assertEqual(rows[0].source_sha, "7373b482ff81723d18c367ed3c9bf048b67b1db6")
            self.assertEqual(rows[0].truth_class, "REAL_HISTORICAL")

    def test_available_and_missing_fields_are_computed_per_payload_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "fixture-spool.sqlite")
            _build_fixture_spool(path)
            loader = SqliteEvidenceSpoolEpisodeLoader(path)
            rows = loader.load_episode("cycle-1")
            q_ready = next(row for row in rows if row.payload_type == "Q_READY")
            self.assertIn("qDecision", q_ready.available_fields)
            self.assertIn("frontierCandidates", q_ready.missing_fields)  # not in this fixture's real payload

    def test_unknown_episode_id_returns_empty_never_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "fixture-spool.sqlite")
            _build_fixture_spool(path)
            loader = SqliteEvidenceSpoolEpisodeLoader(path)
            rows = loader.load_episode("cycle-does-not-exist")
            self.assertEqual(rows, [])

    def test_candidate_identity_extracted_from_decision_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "fixture-spool.sqlite")
            connection = sqlite3.connect(path)
            connection.execute(
                "CREATE TABLE envelope(decision_cycle_id TEXT, snapshot_id TEXT, decision_as_of TEXT, "
                "source_sha TEXT, sequence_number INTEGER, payload_type TEXT, payload_json TEXT)"
            )
            connection.execute(
                "INSERT INTO envelope VALUES(?,?,?,?,?,?,?)",
                ("cycle-2", "snap-2", "t", "sha", 0, "DECISION_READY",
                 json.dumps({"symbol": "SPY", "canonicalAction": "OPEN", "selectedCandidateId": "c1",
                             "selectedOptionSymbol": "SPY261016P00650000"})),
            )
            connection.commit()
            connection.close()
            loader = SqliteEvidenceSpoolEpisodeLoader(path)
            rows = loader.load_episode("cycle-2")
            self.assertEqual(rows[0].candidate_identity, "SPY261016P00650000")


class TestBlockedDataEpisode(unittest.TestCase):
    def test_sep16_sep18_sep21_are_explicit_blocked_data_never_silently_omitted(self):
        for label in ("SEP16", "SEP18", "SEP21"):
            row = blocked_data_episode(label, "no such evidence found anywhere in this repo or the worker checkout")
            self.assertEqual(row.truth_class, "BLOCKED_DATA")
            self.assertEqual(row.episode_id, label)
            self.assertIn("blockedReason", row.raw_payload)


if __name__ == "__main__":
    unittest.main()
