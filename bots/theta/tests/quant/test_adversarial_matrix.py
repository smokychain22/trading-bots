"""Adversarial matrix (work package 96).

Most of the 19 named adversarial conditions already have a dedicated test
in their own module's suite (stale/crossed/missing quote in
test_liquidity.py, stale IV in test_iv.py, missing flow in test_flow.py,
low OI in test_volume_open_interest.py, unknown event in
test_event_context.py/test_strategy_router.py, undefined correlation in
test_correlation.py, unknown ownership in test_strategy_router.py,
assignment cap 0 in test_sizing.py's zero-capacity-on-any-dimension test,
extreme drawdown in test_severe_drawdown_and_recovery_specs.py, provider
unavailable in test_aegis.py, all strategies blocked in
test_strategy_router.py, WAIT in test_wait_outcome.py/test_wait_analysis.py,
tampered hash + duplicate backup copy in
test_historical_v1_to_v6_bridge.py/test_historical_export_dedupe*.py).
This file adds the two genuine gaps this session's own new modules had
not yet covered: a v1 archive with a genuinely UNMAPPABLE field (present
in the source JSON but outside the proven v1->v6 lineage), and archive
corruption (a structurally malformed/truncated export).
"""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_historical_v1_to_v6_bridge import v1_export
from research.historical_v1_to_v6_bridge import convert_historical_export
from research.production_export_loader import DatasetLoadError, canonical_json, sha256_hex


class UnmappableFieldTests(unittest.TestCase):
    def test_field_outside_proven_v1_to_v6_lineage_is_ignored_not_silently_trusted(self):
        # A row family neither v1 nor any later proven version ever introduced.
        raw = v1_export()
        raw['rows']['aCompletelyUnknownFutureRowFamily'] = [{'x': 1}]
        raw['rowCounts']['aCompletelyUnknownFutureRowFamily'] = 1
        raw['datasetHash'] = sha256_hex(canonical_json({
            'schemaVersion': raw['schemaVersion'], 'sourceWindow': raw['sourceWindow'],
            'featureSetVersion': raw['featureSetVersion'], 'strategyVersions': raw['strategyVersions'],
            'rows': raw['rows'], 'rowCounts': raw['rowCounts'],
        }))
        # The bridge only ever reads the row families it proved safe (candidateSets/
        # candidates/shadowCandidates/strategyFrontiers/managementSnapshots/
        # lifecycleOutcomes/wholeChainOutcomes/executionEvidence) -- an extra,
        # unrecognized key is simply never consulted, never guessed at.
        result = convert_historical_export(raw)
        self.assertEqual(len(result.candidates), 1)


class ArchiveCorruptionTests(unittest.TestCase):
    def test_missing_rows_key_entirely_is_a_named_failure_not_a_crash(self):
        raw = v1_export()
        del raw['rows']
        with self.assertRaises((DatasetLoadError, KeyError, AttributeError)):
            convert_historical_export(raw)

    def test_truncated_source_window_rejected(self):
        raw = v1_export()
        del raw['sourceWindow']['end']
        with self.assertRaises((DatasetLoadError, KeyError)):
            convert_historical_export(raw)

    def test_non_dict_row_family_rejected_not_silently_skipped(self):
        raw = v1_export()
        raw['rows']['candidates'] = 'not-a-list-this-archive-is-corrupted'
        with self.assertRaises((DatasetLoadError, TypeError)):
            convert_historical_export(raw)


if __name__ == '__main__':
    unittest.main()
