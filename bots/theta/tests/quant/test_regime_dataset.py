import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export, _candidate_raw
from test_whole_chain_dataset import entry_link, outcome
from research.production_export_loader import load_dataset_export
from research.regime_dataset import build_regime_dataset


def regime_policy():
    return {'policy_version': 'regime-v0-test-1', 'bull_ma_slope_floor': 0.01, 'bear_ma_slope_ceiling': -0.01,
        'rv_low_ceiling': 0.10, 'rv_high_floor': 0.30, 'rv_shock_floor': 0.60,
        'max_adverse_gap_shock_threshold': 0.15, 'liquidity_thin_spread_pct_floor': 0.05,
        'liquidity_dislocated_spread_pct_floor': 0.15, 'correction_drawdown_ceiling': -0.10,
        'crisis_drawdown_ceiling': -0.20}


def policy(mapping=None):
    return {'version': 'theta-regime-dataset-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'evidenceClass': 'DETERMINISTIC_TEST', 'regimePolicy': regime_policy(),
        'fieldMapping': mapping if mapping is not None else {'rv20': 'volatility.rv20', 'ma_slope': 'technical.maSlope'}}


def candidate_with_regime_fields(rv20=0.05, ma_slope=0.02):
    c = _candidate_raw()
    c['volatility'] = {'rv20': rv20}
    c['technical'] = {'maSlope': ma_slope}
    return c


class RegimeDatasetTests(unittest.TestCase):
    def test_baseline_regime_uses_only_mapped_fields(self):
        export = _build_export(candidates=[candidate_with_regime_fields()])
        result = build_regime_dataset(load_dataset_export(export), policy())
        row = result['rows'][0]
        self.assertEqual(row['observedInputs']['rv20'], 0.05)
        self.assertIsNone(row['observedInputs']['macro_risk_flag'])
        self.assertEqual(row['baselineRegime']['trend_state'], 'BULL')
        self.assertEqual(row['baselineRegime']['volatility_state'], 'LOW')
        self.assertEqual(row['challengerRegime'], None)
        self.assertEqual(row['challengerState'], 'NOT_IMPLEMENTED')

    def test_unmapped_field_never_read_from_export(self):
        export = _build_export(candidates=[candidate_with_regime_fields()])
        result = build_regime_dataset(load_dataset_export(export), policy(mapping={'ma_slope': 'technical.maSlope'}))
        row = result['rows'][0]
        self.assertIsNone(row['observedInputs']['rv20'])

    def test_future_outcome_kept_separate_and_chain_linked(self):
        c = candidate_with_regime_fields()
        label = {**outcome(), 'wholeChainNetPnl': -20, 'labelVersion': 'theta-whole-chain-outcome-resolver-v2',
            'outcomes': {'resolution': 'CLOSED_LEDGER_CHAIN', 'closedAt': '2026-01-01T19:00:00Z'},
            'provenance': {'source': 'THETA_ECONOMIC_LEDGER', 'evidenceAvailableAt': '2026-01-01T20:00:00Z'}}
        export = _build_export(candidates=[c], entryChainLinks=[entry_link()], wholeChainOutcomes=[label])
        result = build_regime_dataset(load_dataset_export(export), policy())
        row = result['rows'][0]
        self.assertEqual(row['futureOutcome']['wholeChainAfterCostPnl'], -20)

    def test_unlinked_candidate_future_outcome_is_no_chain_linkage(self):
        export = _build_export(candidates=[candidate_with_regime_fields()])
        result = build_regime_dataset(load_dataset_export(export), policy())
        self.assertEqual(result['rows'][0]['futureOutcome']['state'], 'NO_CHAIN_LINKAGE')

    def test_missing_field_mapping_rejected(self):
        with self.assertRaisesRegex(ValueError, 'FIELD_MAPPING_REQUIRED'):
            build_regime_dataset(load_dataset_export(_build_export()), policy(mapping={}))

    def test_deterministic_hash_and_roundtrip(self):
        export = load_dataset_export(_build_export(candidates=[candidate_with_regime_fields()]))
        self.assertEqual(build_regime_dataset(export, policy()), build_regime_dataset(export, policy()))


if __name__ == '__main__':
    unittest.main()
