"""Tests for bots/theta/quant/research/production_export_loader.py. Synthetic fixtures only."""

import copy
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.production_export_loader import (  # noqa: E402
    DATASET_SCHEMA_VERSION,
    DatasetLoadError,
    assert_no_future_labels,
    canonical_json,
    load_dataset_export,
    sha256_hex,
)


def _provenance():
    return {
        "source": "ALPACA", "operationAlias": "options.snapshots", "providerTimestamp": "2026-01-01T00:00:00+00:00",
        "ingestionTimestamp": "2026-01-01T00:00:01+00:00", "asOf": "2026-01-01T00:00:00+00:00",
        "version": "v1", "state": "GOOD",
    }


def _candidate_raw(candidate_id="c1", selected=True):
    return {
        "candidateId": candidate_id, "decisionId": "d1", "fusionSnapshotId": "fs1",
        "decisionTime": "2026-01-01T00:00:00+00:00", "branch": "THETA_CONVENTIONAL",
        "rankAtDecision": 1, "selected": selected, "hardStatus": "FEASIBLE", "softStatus": "RANKED",
        "rejectionReason": None, "contract": {}, "market": {}, "volatility": {}, "technical": {},
        "event": {}, "flow": {}, "ownership": {}, "account": {}, "portfolio": {}, "aegis": {},
        "execution": {}, "knownEconomics": {}, "unknownEconomics": [], "hardBlockers": [],
        "softEvidence": [], "providerProvenance": [_provenance()],
        "lineage": {
            "strategyVersion": "sv-1", "riskVersion": "rv-1", "featureVersion": "fv-1",
            "costModelVersion": "cm-1", "regimeVersion": "rg-1", "executionModelVersion": "em-1",
        },
        "contentHash": "a" * 64,
    }


def _candidate_set_raw():
    return {
        "candidateSetId": "cs1", "decisionTime": "2026-01-01T00:00:00+00:00",
        "universeEvaluated": ["AAPL"], "branchesConsidered": ["THETA_CONVENTIONAL"],
        "counts": {"enumerated": 1}, "bestCandidateId": "c1", "secondBestCandidateId": None,
        "bestRejectedCandidateId": None, "completenessState": "COMPLETE", "missingScope": [],
        "contentHash": "b" * 64,
    }


def _minimal_rows():
    return {
        "candidateSets": [_candidate_set_raw()],
        "candidates": [_candidate_raw()],
        "shadowCandidates": [],
        "managementSnapshots": [],
        "lifecycleOutcomes": [],
        "wholeChainOutcomes": [],
        "executionEvidence": [],
    }


def _build_valid_export():
    rows = _minimal_rows()
    identity = {
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "sourceWindow": {"start": "2026-01-01T00:00:00+00:00", "end": "2026-01-02T00:00:00+00:00"},
        "featureSetVersion": "fv-1",
        "strategyVersions": ["sv-1"],
        "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
        "rowCounts": {k: len(v) for k, v in rows.items()},
    }
    dataset_hash = sha256_hex(canonical_json(identity))
    export = dict(identity)
    export["exportedAt"] = "2026-01-02T00:00:00+00:00"
    export["rows"] = rows
    export["datasetHash"] = dataset_hash
    return export


class HappyPathTests(unittest.TestCase):
    def test_a_valid_export_loads_successfully_with_hash_verified(self):
        loaded = load_dataset_export(_build_valid_export())
        self.assertTrue(loaded.hash_verified)
        self.assertEqual(len(loaded.candidates), 1)
        self.assertEqual(len(loaded.candidate_sets), 1)


class SchemaVersionTests(unittest.TestCase):
    def test_wrong_schema_version_fails_loudly(self):
        export = _build_valid_export()
        export["schemaVersion"] = "theta-r6-dataset-v0"
        with self.assertRaises(DatasetLoadError):
            load_dataset_export(export)


class HashMismatchTests(unittest.TestCase):
    def test_a_tampered_row_after_hashing_fails_the_hash_check(self):
        export = _build_valid_export()
        export["rows"]["candidates"][0]["rankAtDecision"] = 999  # tamper AFTER the hash was computed
        with self.assertRaises(DatasetLoadError):
            load_dataset_export(export)


class DuplicateIdentityTests(unittest.TestCase):
    def test_duplicate_candidate_id_fails_loudly(self):
        export = _build_valid_export()
        export["rows"]["candidates"].append(_candidate_raw(candidate_id="c1"))
        export["rowCounts"]["candidates"] = 2
        # Recompute a hash consistent with the tampered rows so this test
        # isolates the duplicate-identity check, not the hash check.
        rows = export["rows"]
        unsigned = {
            "schemaVersion": export["schemaVersion"], "sourceWindow": export["sourceWindow"],
            "featureSetVersion": export["featureSetVersion"],
            "strategyVersions": export["strategyVersions"],
            "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
            "rowCounts": export["rowCounts"],
        }
        export["datasetHash"] = sha256_hex(canonical_json(unsigned))
        with self.assertRaises(DatasetLoadError) as ctx:
            load_dataset_export(export)
        self.assertIn("DUPLICATE_IDENTITY", str(ctx.exception))


class CandidateSetReferentialIntegrityTests(unittest.TestCase):
    def test_candidate_set_referencing_an_unknown_candidate_fails(self):
        export = _build_valid_export()
        export["rows"]["candidateSets"][0]["bestCandidateId"] = "does-not-exist"
        rows = export["rows"]
        unsigned = {
            "schemaVersion": export["schemaVersion"], "sourceWindow": export["sourceWindow"],
            "featureSetVersion": export["featureSetVersion"],
            "strategyVersions": export["strategyVersions"],
            "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
            "rowCounts": export["rowCounts"],
        }
        export["datasetHash"] = sha256_hex(canonical_json(unsigned))
        with self.assertRaises(DatasetLoadError) as ctx:
            load_dataset_export(export)
        self.assertIn("CANDIDATE_SET_REFERENCES_UNKNOWN_CANDIDATE", str(ctx.exception))


class FutureLabelFirewallTests(unittest.TestCase):
    def test_top_level_forbidden_key_is_rejected(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"realized_pnl": 5.0})

    def test_a_nested_forbidden_key_is_rejected_not_only_top_level(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"context": {"deeper": {"whole_chain_net_pnl": 5.0}}})

    def test_a_forbidden_key_inside_a_list_is_rejected(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"items": [{"future_pnl": 1.0}]})

    def test_a_key_variant_spacing_and_case_is_still_caught(self):
        with self.assertRaises(DatasetLoadError):
            assert_no_future_labels({"Realized PnL": 5.0})

    def test_an_innocuous_payload_passes(self):
        assert_no_future_labels({"iv_rank": 0.5, "delta": -0.2, "nested": {"dte": 30}})

    def test_a_candidate_with_a_forbidden_key_in_its_feature_blob_fails_to_load(self):
        export = _build_valid_export()
        export["rows"]["candidates"][0]["market"] = {"realized_pnl": 100.0}
        rows = export["rows"]
        unsigned = {
            "schemaVersion": export["schemaVersion"], "sourceWindow": export["sourceWindow"],
            "featureSetVersion": export["featureSetVersion"],
            "strategyVersions": export["strategyVersions"],
            "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
            "rowCounts": export["rowCounts"],
        }
        export["datasetHash"] = sha256_hex(canonical_json(unsigned))
        with self.assertRaises(DatasetLoadError) as ctx:
            load_dataset_export(export)
        self.assertIn("FUTURE_LABEL_IN_FEATURE_PAYLOAD", str(ctx.exception))


class PitTimestampTests(unittest.TestCase):
    def test_provider_timestamp_after_as_of_fails(self):
        export = _build_valid_export()
        export["rows"]["candidates"][0]["providerProvenance"][0]["providerTimestamp"] = "2026-01-01T00:00:05+00:00"
        rows = export["rows"]
        unsigned = {
            "schemaVersion": export["schemaVersion"], "sourceWindow": export["sourceWindow"],
            "featureSetVersion": export["featureSetVersion"],
            "strategyVersions": export["strategyVersions"],
            "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
            "rowCounts": export["rowCounts"],
        }
        export["datasetHash"] = sha256_hex(canonical_json(unsigned))
        with self.assertRaises(DatasetLoadError) as ctx:
            load_dataset_export(export)
        self.assertIn("PROVIDER_TIMESTAMP_AFTER", str(ctx.exception))


class CrossedBboTests(unittest.TestCase):
    def test_a_crossed_quote_fails_loudly(self):
        export = _build_valid_export()
        quote = {
            "quoteObservationId": "q1", "candidateId": "c1", "managementInputSnapshotId": None,
            "observationRole": "DECISION", "observedAt": "2026-01-01T00:00:00+00:00",
            "providerTimestamp": "2026-01-01T00:00:00+00:00", "ingestionTimestamp": "2026-01-01T00:00:01+00:00",
            "source": "ALPACA", "operationAlias": "options.snapshots", "feed": "opra",
            "contractVersion": "v1", "bid": 1.10, "ask": 1.00, "bidSize": 1.0, "askSize": 1.0,
            "proposedLimit": None, "dataQuality": "GOOD", "contentHash": "e" * 64,
        }
        export["rows"]["executionEvidence"] = [quote]
        export["rowCounts"]["executionEvidence"] = 1
        rows = export["rows"]
        unsigned = {
            "schemaVersion": export["schemaVersion"], "sourceWindow": export["sourceWindow"],
            "featureSetVersion": export["featureSetVersion"],
            "strategyVersions": export["strategyVersions"],
            "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
            "rowCounts": export["rowCounts"],
        }
        export["datasetHash"] = sha256_hex(canonical_json(unsigned))
        with self.assertRaises(DatasetLoadError) as ctx:
            load_dataset_export(export)
        self.assertIn("CROSSED_BBO_INVALID", str(ctx.exception))


class DeterministicFingerprintTests(unittest.TestCase):
    def test_reloading_an_identical_export_produces_the_identical_recomputed_hash(self):
        export = _build_valid_export()
        first = load_dataset_export(copy.deepcopy(export))
        second = load_dataset_export(copy.deepcopy(export))
        self.assertEqual(first.recomputed_hash, second.recomputed_hash)

    def test_export_timestamp_is_provenance_not_dataset_identity(self):
        export = _build_valid_export()
        original_hash = export["datasetHash"]
        export["exportedAt"] = "2026-01-03T00:00:00+00:00"
        loaded = load_dataset_export(export)
        self.assertEqual(loaded.dataset_hash, original_hash)
        self.assertTrue(loaded.hash_verified)


if __name__ == "__main__":
    unittest.main()
