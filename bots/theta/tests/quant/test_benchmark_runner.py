import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export, _candidate_raw
from test_whole_chain_dataset import entry_link, outcome
from research.production_export_loader import load_dataset_export
from research.entry_episode_training import build_entry_episode_training_dataset
from research.benchmark_runner import coverage_report, execute_b0_cash_wait, execute_benchmark


def policy():
    return {'version': 'theta-entry-training-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'frozenAt': '2025-12-01T00:00:00Z', 'featureNames': ['strike', 'dte', 'bid', 'relativeSpread'],
        'maxQuoteAgeSeconds': 30, 'evidenceClass': 'DETERMINISTIC_TEST'}


def entry_dataset(pnl=-20):
    c = _candidate_raw()
    c['contract']['dte'] = 16
    c['market'] = {'bid': 1., 'ask': 1.1, 'quoteTimestamp': '2026-01-01T14:29:55Z', 'quoteReceivedAt': '2026-01-01T14:29:56Z'}
    label = {**outcome(), 'wholeChainNetPnl': pnl, 'labelVersion': 'theta-whole-chain-outcome-resolver-v2',
        'outcomes': {'resolution': 'CLOSED_LEDGER_CHAIN', 'closedAt': '2026-01-01T19:00:00Z'},
        'provenance': {'source': 'THETA_ECONOMIC_LEDGER', 'evidenceAvailableAt': '2026-01-01T20:00:00Z'}}
    quote = {'quoteObservationId': 'quote1', 'candidateId': 'c1', 'managementInputSnapshotId': None,
        'observationRole': 'DECISION', 'observedAt': '2026-01-01T14:29:56Z', 'providerTimestamp': '2026-01-01T14:29:55Z',
        'ingestionTimestamp': '2026-01-01T14:29:56Z', 'source': 'ALPACA', 'operationAlias': 'options.snapshots',
        'feed': 'indicative', 'contractVersion': 'test-only', 'bid': 1., 'ask': 1.1,
        'bidSize': 1, 'askSize': 1, 'proposedLimit': None, 'dataQuality': 'GOOD', 'contentHash': 'b' * 64}
    export = _build_export(candidates=[c], entryChainLinks=[entry_link()], wholeChainOutcomes=[label], executionEvidence=[quote])
    return build_entry_episode_training_dataset(load_dataset_export(export), policy())


class BenchmarkRunnerTests(unittest.TestCase):
    def test_b0_zero_capital_zero_pnl_by_construction(self):
        result = execute_b0_cash_wait(entry_dataset())
        self.assertEqual(result['state'], 'EXECUTED')
        self.assertEqual(result['metrics']['meanAfterCostPnl'], 0.0)
        self.assertEqual(result['metrics']['capitalDaysDeployed'], 0.0)

    def test_b0_empty_dataset_is_insufficient_data(self):
        result = execute_b0_cash_wait({'version': 'theta-entry-episode-training-dataset-v1', 'rows': [], 'contentHash': 'x'})
        self.assertEqual(result['state'], 'INSUFFICIENT_DATA')

    def test_execute_benchmark_dispatches_registered_implemented_id(self):
        result = execute_benchmark('B0', entry_dataset())
        self.assertEqual(result['benchmarkId'], 'B0')

    def test_unimplemented_registered_benchmark_raises_named_error(self):
        with self.assertRaisesRegex(ValueError, 'RUNNER_NOT_IMPLEMENTED:B5'):
            execute_benchmark('B5', entry_dataset())

    def test_unregistered_benchmark_id_rejected(self):
        with self.assertRaisesRegex(ValueError, 'NOT_REGISTERED'):
            execute_benchmark('NOT_A_REAL_ID', entry_dataset())

    def test_coverage_report_lists_gaps_honestly(self):
        report = coverage_report()
        self.assertIn('B0', report['implementedRunnerIds'])
        self.assertIn('B5', report['unimplementedRunnerIds'])
        self.assertGreater(len(report['unimplementedRunnerIds']), 0)

    def test_deterministic_hash_and_roundtrip(self):
        dataset = entry_dataset()
        self.assertEqual(execute_b0_cash_wait(dataset), execute_b0_cash_wait(dataset))


if __name__ == '__main__':
    unittest.main()
