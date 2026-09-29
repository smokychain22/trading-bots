import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export
from test_whole_chain_dataset import entry_link, outcome
from research.production_export_loader import load_dataset_export
from research.management_dataset import build_management_dataset


def policy():
    return {'version': 'theta-management-dataset-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'evidenceClass': 'DETERMINISTIC_TEST'}


def management_snapshot(snapshot_id='m1', chain_id='chain1', observed_at='2026-01-01T15:00:00Z', feasible=True):
    return {'managementInputSnapshotId': snapshot_id, 'fusionSnapshotId': 'f1', 'chainId': chain_id,
        'observedAt': observed_at, 'lifecycleState': 'CSP_OPEN', 'inputFields': {'positionQty': -1},
        'unknownFields': [], 'changeFields': {}, 'contentHash': 'a' * 64,
        'actions': [{'action': 'HOLD', 'feasibility': 'FEASIBLE' if feasible else 'INFEASIBLE',
                     'certainEconomicPnl': None, 'expectedFutureValue': 1.0, 'downsideTailEstimate': None,
                     'incrementalCapitalDays': None, 'executionCostRisk': None, 'utility': 1.0}],
        'selectedAction': 'HOLD' if feasible else None, 'secondBestAction': None,
        'decisionState': 'DECIDED', 'reasonCodes': []}


def fixture(pnl=-20, feasible=True):
    label = {**outcome(), 'wholeChainNetPnl': pnl, 'labelVersion': 'theta-whole-chain-outcome-resolver-v2',
        'outcomes': {'resolution': 'CLOSED_LEDGER_CHAIN', 'closedAt': '2026-01-01T19:00:00Z'},
        'provenance': {'source': 'THETA_ECONOMIC_LEDGER', 'evidenceAvailableAt': '2026-01-01T20:00:00Z'}}
    return _build_export(entryChainLinks=[entry_link()], wholeChainOutcomes=[label],
                          managementSnapshots=[management_snapshot(feasible=feasible)])


class ManagementDatasetTests(unittest.TestCase):
    def test_row_carries_t0_fields_and_future_outcome_separately(self):
        result = build_management_dataset(load_dataset_export(fixture()), policy())
        row = result['rows'][0]
        self.assertEqual(row['observationId'], 'm1')
        self.assertEqual(row['selectedAction'], 'HOLD')
        self.assertEqual(row['futureOutcome']['wholeChainAfterCostPnl'], -20)
        self.assertEqual(row['futureOutcome']['state'], 'RESOLVED_EXPORTED_LABEL')

    def test_unresolved_chain_still_yields_row_with_no_future_pnl(self):
        raw = fixture(); rows = raw['rows']; rows['wholeChainOutcomes'] = []
        result = build_management_dataset(load_dataset_export(_build_export(**rows)), policy())
        row = result['rows'][0]
        self.assertIsNone(row['futureOutcome']['wholeChainAfterCostPnl'])
        self.assertEqual(row['futureOutcome']['state'], 'RIGHT_CENSORED_NO_LABEL')

    def test_no_feasible_actions_is_excluded_not_silently_dropped(self):
        raw = fixture(feasible=False)
        result = build_management_dataset(load_dataset_export(raw), policy())
        self.assertEqual(result['rowCount'], 0)
        self.assertIn('MANAGEMENT_SNAPSHOT_NO_FEASIBLE_ACTIONS', result['excluded'][0]['reasons'])

    def test_deterministic_hash_and_roundtrip(self):
        data = load_dataset_export(fixture())
        first = build_management_dataset(data, policy())
        second = build_management_dataset(data, policy())
        self.assertEqual(first, second)
        self.assertFalse(first['brokerAuthority'])

    def test_missing_policy_version_rejected(self):
        with self.assertRaisesRegex(ValueError, 'POLICY_REQUIRED'):
            build_management_dataset(load_dataset_export(fixture()), {'policyId': 'x', 'evidenceClass': 'DETERMINISTIC_TEST'})


if __name__ == '__main__':
    unittest.main()
