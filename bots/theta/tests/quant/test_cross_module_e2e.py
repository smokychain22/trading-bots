"""Cross-module end-to-end test (work package 95): chains real,
independently-tested modules from a synthetic decision through risk,
sizing, dataset construction, baseline fitting, calibration, and a
reproducibility bundle -- proving the pipeline holds together, not
re-testing any module's own internal correctness (each already has its
own dedicated suite).
"""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export, _candidate_raw
from test_whole_chain_dataset import entry_link, outcome
from test_aegis import _clean_inputs, _policy as _aegis_policy
from models.aegis import assess_aegis
from models.sizing import SizingInputs, SizingPolicy, compute_sizing
from research.production_export_loader import load_dataset_export
from research.entry_episode_training import build_entry_episode_training_dataset
from research.entry_baseline_experiment import execute_entry_baseline
from research.reproducibility_bundle import build_reproducibility_bundle, verify_reproducibility_bundle


def _sizing_policy():
    return SizingPolicy(policy_version='e2e-test-1', risk_budget_qty_cap=10, collateral_qty_cap=10,
        concentration_qty_cap=10, assignment_capacity_qty_cap=10, tail_risk_qty_cap=10, correlation_qty_cap=10,
        liquidity_qty_cap=10, reduced_state_multiplier=0.5)


def _entry_training_policy():
    return {'version': 'theta-entry-training-policy-v1', 'policyId': 'E2E_TEST_ONLY',
        'frozenAt': '2025-12-01T00:00:00Z', 'featureNames': ['strike', 'dte', 'bid', 'relativeSpread'],
        'maxQuoteAgeSeconds': 30, 'evidenceClass': 'DETERMINISTIC_TEST'}


def _entry_dataset():
    c = _candidate_raw()
    c['contract']['dte'] = 16
    c['market'] = {'bid': 1., 'ask': 1.1, 'quoteTimestamp': '2026-01-01T14:29:55Z', 'quoteReceivedAt': '2026-01-01T14:29:56Z'}
    label = {**outcome(), 'wholeChainNetPnl': -20, 'labelVersion': 'theta-whole-chain-outcome-resolver-v2',
        'outcomes': {'resolution': 'CLOSED_LEDGER_CHAIN', 'closedAt': '2026-01-01T19:00:00Z'},
        'provenance': {'source': 'THETA_ECONOMIC_LEDGER', 'evidenceAvailableAt': '2026-01-01T20:00:00Z'}}
    quote = {'quoteObservationId': 'quote1', 'candidateId': 'c1', 'managementInputSnapshotId': None,
        'observationRole': 'DECISION', 'observedAt': '2026-01-01T14:29:56Z', 'providerTimestamp': '2026-01-01T14:29:55Z',
        'ingestionTimestamp': '2026-01-01T14:29:56Z', 'source': 'ALPACA', 'operationAlias': 'options.snapshots',
        'feed': 'indicative', 'contractVersion': 'test-only', 'bid': 1., 'ask': 1.1,
        'bidSize': 1, 'askSize': 1, 'proposedLimit': None, 'dataQuality': 'GOOD', 'contentHash': 'b' * 64}
    export = _build_export(candidates=[c], entryChainLinks=[entry_link()], wholeChainOutcomes=[label], executionEvidence=[quote])
    return build_entry_episode_training_dataset(load_dataset_export(export), _entry_training_policy())


class CrossModuleE2ETests(unittest.TestCase):
    def test_full_chain_risk_to_sizing_to_dataset_to_baseline_to_reproducibility(self):
        # Stage 1: AEGIS risk assessment on a clean book.
        risk_assessment = assess_aegis(_aegis_policy(), _clean_inputs())
        self.assertEqual(risk_assessment.new_risk_state.value, 'ALLOW_FULL')

        # Stage 2: sizing gated by that same risk state.
        sizing_result = compute_sizing(_sizing_policy(), SizingInputs(
            equity=100000.0, cash=50000.0, buying_power=50000.0, required_collateral_per_contract=9200.0,
            broker_allowed_qty=5, risk_state=risk_assessment.new_risk_state,
        ))
        self.assertGreaterEqual(sizing_result.quantity, 0)

        # Stage 3: entry dataset construction (WP47, real, unchanged).
        dataset = _entry_dataset()
        self.assertEqual(dataset['rowCount'], 1)

        # Stage 4: baseline fit + calibration (WP53/55, real, unchanged) --
        # a single-row dataset correctly reports no eligible fold rather
        # than fabricating a model from one observation.
        policy = {'version': 'theta-entry-baseline-policy-v1', 'policyId': 'E2E_TEST_ONLY',
            'frozenAt': '2025-12-01T00:00:00Z',
            'splitConfig': {'train_groups': 1, 'validation_groups': 1, 'forward_groups': 1, 'step_groups': 1,
                            'embargo_groups': 0, 'final_oos_groups': 1},
            'embargoSeconds': 0, 'minimumTrainingRows': 5, 'minimumClassRows': 2, 'minimumCalibrationRows': 2,
            'calibrationBins': 2, 'optimizer': {'l2_penalty': 1.0, 'learning_rate': 0.1, 'max_iterations': 100}}
        baseline_result = execute_entry_baseline(dataset, policy, generated_at='2026-01-02T00:00:00Z')
        self.assertEqual(baseline_result['state'], 'INSUFFICIENT_ELIGIBLE_EVIDENCE')  # one row, correctly insufficient
        self.assertFalse(baseline_result['modelPromoted'])

        # Stage 5: reproducibility bundle over the whole chain's identity.
        bundle = build_reproducibility_bundle(
            sourceSha='a' * 40, datasetHash=dataset['contentHash'], configHash=baseline_result['policyHash'],
            featureVersion='fv-1', labelVersion='theta-whole-chain-outcome-resolver-v2', modelVersion='e2e-test-1',
            splitHash='b' * 64, seed=42, experimentId='E2E-TEST-1', metricHash='c' * 64,
        )
        self.assertTrue(verify_reproducibility_bundle(bundle))

    def test_hard_veto_risk_state_zeros_sizing_downstream(self):
        risk_assessment = assess_aegis(_aegis_policy(), _clean_inputs(provider_state='INVALID'))
        self.assertEqual(risk_assessment.new_risk_state.value, 'HARD_VETO')
        sizing_result = compute_sizing(_sizing_policy(), SizingInputs(
            equity=100000.0, cash=50000.0, buying_power=50000.0, required_collateral_per_contract=9200.0,
            broker_allowed_qty=5, risk_state=risk_assessment.new_risk_state,
        ))
        self.assertEqual(sizing_result.quantity, 0)  # the risk state actually propagates through to zero size


if __name__ == '__main__':
    unittest.main()
