import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export, _candidate_raw
from test_whole_chain_dataset import entry_link, outcome
from research.production_export_loader import load_dataset_export
from research.entry_episode_training import build_entry_episode_training_dataset
from research.benchmark_runner import (
    classify_all_benchmarks, classify_benchmark_readiness, coverage_report, execute_b0_cash_wait, execute_benchmark,
)


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

    def test_mechanical_benchmark_dispatches_real_runner(self):
        result = execute_benchmark('B5', {'policyVersion': 'benchmark-test-v1', 'candidates': [
            {'candidateId': 'c1', 'hardStatus': 'FEASIBLE'},
            {'candidateId': 'c2', 'hardStatus': 'FEASIBLE'},
        ], 'seed': 42})
        self.assertEqual(result['state'], 'EXECUTED')
        self.assertIn(result['result']['candidateId'], ('c1', 'c2'))
        self.assertFalse(result['brokerAuthority'])

    def test_all_mechanic_implemented_ids_have_dispatch(self):
        inputs = {
            'B3': {'entryCredit': 1.0, 'pricePath': [['t1', .4]], 'captureFraction': .5},
            'B4': {'entryCredit': 1.0, 'pricePath': [['t1', .4]], 'holdBars': 1},
            'B5': {'candidates': [], 'seed': 1},
            'B6': {'entryPrice': 100.0, 'exitPrice': 110.0},
            'BQ-1': {'candidates': [], 'metricKey': 'entryPremium', 'higherIsBetter': True},
            'BQ-2': {'candidates': [], 'targetDelta': .2},
            'BR-1': {'entryCredit': 1.0, 'underlyingPriceAtExpiration': 110.0, 'strike': 100.0},
            'BR-2': {'entryCredit': 1.0, 'pricePath': [['t1', .4]]},
            'BA-1': {'assigned': True}, 'BA-2': {'originalBasis': 100.0, 'currentPrice': 90.0},
            'BA-3': {'assigned': True}, 'BC-1': {'candidates': []}, 'BC-2': {'assigned': True},
        }
        for benchmark_id, benchmark_input in inputs.items():
            with self.subTest(benchmark_id=benchmark_id):
                self.assertEqual(execute_benchmark(benchmark_id,
                    {'policyVersion': 'benchmark-test-v1', **benchmark_input})['state'], 'EXECUTED')

    def test_policy_blocked_benchmark_rejects_execution(self):
        with self.assertRaisesRegex(ValueError, 'BLOCKED_MISSING_POLICY:B1'):
            execute_benchmark('B1', {})

    def test_mechanical_execution_requires_versioned_policy(self):
        with self.assertRaisesRegex(ValueError, 'POLICY_VERSION_REQUIRED'):
            execute_benchmark('B6', {'entryPrice': 100.0, 'exitPrice': 110.0})

    def test_unregistered_benchmark_id_rejected(self):
        with self.assertRaisesRegex(ValueError, 'NOT_REGISTERED'):
            execute_benchmark('NOT_A_REAL_ID', entry_dataset())

    def test_coverage_report_lists_gaps_honestly(self):
        report = coverage_report()
        self.assertIn('B0', report['implementedRunnerIds'])
        self.assertIn('B5', report['byState']['RUNNER_IMPLEMENTED_DATA_UNAVAILABLE'])

    def test_deterministic_hash_and_roundtrip(self):
        dataset = entry_dataset()
        self.assertEqual(execute_b0_cash_wait(dataset), execute_b0_cash_wait(dataset))

    def test_classify_b0_always_data_available(self):
        self.assertEqual(classify_benchmark_readiness('B0')['state'], 'RUNNER_IMPLEMENTED_DATA_AVAILABLE')

    def test_classify_mechanic_benchmark_reflects_real_capability_evidence(self):
        unavailable = classify_benchmark_readiness('B5', {'has_feasible_candidates': False})
        available = classify_benchmark_readiness('B5', {'has_feasible_candidates': True})
        self.assertEqual(unavailable['state'], 'RUNNER_IMPLEMENTED_DATA_UNAVAILABLE')
        self.assertEqual(available['state'], 'RUNNER_IMPLEMENTED_DATA_AVAILABLE')

    def test_classify_missing_policy_ids(self):
        for benchmark_id in ('B1', 'B2', 'BH-1', 'BQ-3'):
            self.assertEqual(classify_benchmark_readiness(benchmark_id)['state'], 'BLOCKED_MISSING_POLICY')

    def test_classify_ablation_ladder_ids_not_applicable(self):
        for benchmark_id in ('A1', 'A2', 'A3', 'A4', 'A5', 'A6'):
            result = classify_benchmark_readiness(benchmark_id)
            self.assertEqual(result['state'], 'NOT_APPLICABLE')

    def test_classify_unregistered_id_rejected(self):
        with self.assertRaisesRegex(ValueError, 'NOT_REGISTERED'):
            classify_benchmark_readiness('NOT_A_REAL_ID')

    def test_classify_all_benchmarks_covers_every_registered_id_with_no_leftover_not_implemented(self):
        classifications = classify_all_benchmarks({})
        states = {c['state'] for c in classifications.values()}
        self.assertTrue(states.issubset({
            'RUNNER_IMPLEMENTED_DATA_AVAILABLE', 'RUNNER_IMPLEMENTED_DATA_UNAVAILABLE',
            'NOT_APPLICABLE', 'BLOCKED_MISSING_POLICY',
        }))
        self.assertGreater(len(classifications), 20)


if __name__ == '__main__':
    unittest.main()
