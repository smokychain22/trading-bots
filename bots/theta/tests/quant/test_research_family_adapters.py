"""Tests for bots/theta/quant/research/research_family_adapters.py. Synthetic fixtures only."""

import math
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.dataset_contracts import Candidate, HardStatus, SoftStatus, StrategyLineage, ThetaStrategyBranch  # noqa: E402
from research.iv_realized_vol_research import OhlcBar  # noqa: E402
from research.paper_baseline_dte_bias import BaselineReceiptCandidateRecord  # noqa: E402
from research.research_family_adapters import (  # noqa: E402
    AdapterState,
    FeatureFieldMap,
    extract_surface_points,
    extract_term_points,
    run_dte_bias_adapter,
    run_iv_rv_adapter,
    run_surface_adapter,
    run_term_adapter,
)
from research.term_structure_research import TermMethod  # noqa: E402
from research.volatility_surface_research import RawSviParameters, raw_svi_total_variance  # noqa: E402

_M_GRID = [x / 100 for x in range(-30, 31, 5)]
_SIGMA_GRID = [x / 100 for x in range(5, 60, 5)]

_LINEAGE = StrategyLineage("sv1", "rv1", "fv1", "cm1", "rg1", "em1")


def _candidate(candidate_id, contract, market, volatility):
    return Candidate(
        candidate_id=candidate_id, decision_id="d1", fusion_snapshot_id="fs1",
        decision_time="2026-01-01T00:00:00+00:00", branch=ThetaStrategyBranch.THETA_CONVENTIONAL,
        rank_at_decision=1, selected=False, hard_status=HardStatus.FEASIBLE, soft_status=SoftStatus.RANKED,
        rejection_reason=None, contract=contract, market=market, volatility=volatility,
        technical={}, event={}, flow={}, ownership={}, account={}, portfolio={}, aegis={}, execution={},
        known_economics={}, unknown_economics=(), hard_blockers=(), soft_evidence=(),
        provider_provenance=(), lineage=_LINEAGE, content_hash="a" * 64,
    )


class SurfaceExtractionTests(unittest.TestCase):
    def test_no_field_map_is_not_applicable(self):
        result = run_surface_adapter([], "2026-10-17", FeatureFieldMap(), 5, _M_GRID, _SIGMA_GRID)
        self.assertEqual(result.state, AdapterState.NOT_APPLICABLE)
        self.assertIn("FEATURE_FIELD_MAP_MISSING", result.blocker)

    def test_thin_chain_is_insufficient_data(self):
        field_map = FeatureFieldMap(log_moneyness_key="k", implied_volatility_key="iv", dte_key="dte")
        candidates = [
            _candidate(f"c{i}", {"dte": 30}, {}, {"k": k, "iv": 0.3})
            for i, k in enumerate([-0.1, 0.0, 0.1])
        ]
        result = run_surface_adapter(candidates, "2026-10-17", field_map, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertEqual(result.state, AdapterState.INSUFFICIENT_DATA)

    def test_enough_synthetic_svi_generated_candidates_are_ready(self):
        true_params = RawSviParameters(a=0.04, b=0.3, rho=-0.2, m=0.0, sigma=0.25)
        field_map = FeatureFieldMap(log_moneyness_key="k", implied_volatility_key="iv", dte_key="dte", quote_quality_key="quality")
        candidates = []
        for i, k in enumerate(x / 100 for x in range(-40, 45, 5)):
            w = raw_svi_total_variance(k, true_params)
            iv = math.sqrt(w / (30 / 365.0))
            candidates.append(_candidate(f"c{i}", {"dte": 30}, {"quality": "GOOD"}, {"k": k, "iv": iv}))
        result = run_surface_adapter(candidates, "2026-10-17", field_map, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertEqual(result.state, AdapterState.READY)
        self.assertIsNotNone(result.result)
        self.assertEqual(result.result.evidence_state, "FITTED")

    def test_rows_missing_required_fields_are_skipped_not_guessed(self):
        field_map = FeatureFieldMap(log_moneyness_key="k", implied_volatility_key="iv", dte_key="dte")
        candidates = [
            _candidate("c1", {"dte": 30}, {}, {"k": 0.0, "iv": 0.3}),
            _candidate("c2", {"dte": 30}, {}, {"k": 0.1}),  # missing iv
            _candidate("c3", {}, {}, {"k": 0.2, "iv": 0.3}),  # missing dte
        ]
        points, blocker = extract_surface_points(candidates, field_map)
        self.assertEqual(blocker, "")
        self.assertEqual(len(points), 1)


class TermAdapterTests(unittest.TestCase):
    def test_single_expiration_is_insufficient_data(self):
        field_map = FeatureFieldMap(expiration_key="exp", log_moneyness_key="k", implied_volatility_key="iv")
        candidates = [_candidate("c1", {"exp": "2026-10-17"}, {}, {"k": 0.0, "iv": 0.25})]
        result = run_term_adapter(candidates, 17, 48, field_map, target_log_moneyness=0.0, max_moneyness_distance=0.05)
        self.assertEqual(result.state, AdapterState.INSUFFICIENT_DATA)

    def test_two_expirations_produce_a_ready_comparison(self):
        field_map = FeatureFieldMap(expiration_key="exp", log_moneyness_key="k", implied_volatility_key="iv")
        candidates = [
            _candidate("c1", {"exp": "2026-10-17"}, {}, {"k": 0.0, "iv": 0.30}),
            _candidate("c2", {"exp": "2026-11-14"}, {}, {"k": 0.0, "iv": 0.22}),
        ]
        result = run_term_adapter(candidates, 17, 48, field_map, target_log_moneyness=0.0, max_moneyness_distance=0.05)
        self.assertEqual(result.state, AdapterState.READY)
        comparison = result.result
        self.assertIn(TermMethod.ALL_STRIKE_MEAN, comparison.results_by_method)
        self.assertIn(TermMethod.MATCHED_LOG_MONEYNESS, comparison.results_by_method)


class IvRvAdapterTests(unittest.TestCase):
    def test_no_historical_bars_is_not_applicable_for_every_method(self):
        results = run_iv_rv_adapter(None, 0.25, 30 / 365, 30 / 365, minimum_sample_size=5, horizon_tolerance_years=1 / 365)
        self.assertEqual(len(results), 4)
        for result in results.values():
            self.assertEqual(result.state, AdapterState.NOT_APPLICABLE)
            self.assertIn("NOT_SUPPLIED", result.blocker)

    def test_sufficient_bars_produce_ready_results(self):
        bars = [OhlcBar(f"d{i}", 100, 101, 99, 100) for i in range(10)]
        results = run_iv_rv_adapter(bars, 0.25, 30 / 365, 30 / 365, minimum_sample_size=5, horizon_tolerance_years=1 / 365)
        for result in results.values():
            self.assertEqual(result.state, AdapterState.READY)


class DteBiasAdapterTests(unittest.TestCase):
    def test_no_receipts_supplied_is_not_applicable(self):
        result = run_dte_bias_adapter(None, None, minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertEqual(result.state, AdapterState.NOT_APPLICABLE)
        self.assertIn("NOT_IN_CURRENT_DATASET_EXPORT_SCHEMA", result.blocker)

    def test_insufficient_receipts_reported_honestly(self):
        receipts = [[BaselineReceiptCandidateRecord("c1", 30, True, True, True, 0.01)]]
        result = run_dte_bias_adapter(receipts, [[]], minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertEqual(result.state, AdapterState.INSUFFICIENT_DATA)

    def test_sufficient_receipts_are_ready(self):
        receipts = [[BaselineReceiptCandidateRecord(f"c{i}", 30, True, True, True, 0.01)] for i in range(10)]
        result = run_dte_bias_adapter(receipts, [[] for _ in receipts], minimum_receipts_required=10, skew_share_difference_threshold=0.2)
        self.assertEqual(result.state, AdapterState.READY)
        self.assertTrue(result.result.sufficient_receipts)


class RunAllFamilyAdaptersTests(unittest.TestCase):
    def test_returns_one_entry_per_family_all_not_applicable_or_insufficient_with_no_inputs(self):
        from research.research_family_adapters import run_all_family_adapters

        results = run_all_family_adapters(
            candidates=[], surface_field_map=FeatureFieldMap(), term_field_map=FeatureFieldMap(),
            near_dte=None, far_dte=None, target_expiry="2026-10-17",
            min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID,
            target_log_moneyness=0.0, max_moneyness_distance=0.05,
            historical_bars=None, iv_annualized=None, iv_horizon_years=30 / 365, rv_horizon_years=30 / 365,
            rv_minimum_sample_size=5, horizon_tolerance_years=1 / 365,
            baseline_receipts=None, near_misses=None,
            dte_bias_minimum_receipts=10, dte_bias_skew_threshold=0.2,
        )
        self.assertIn("VOLATILITY_SURFACE", results)
        self.assertIn("TERM_STRUCTURE", results)
        self.assertIn("PAPER_BASELINE_DTE_BIAS", results)
        self.assertIn("IV_RV_CLOSE_TO_CLOSE", results)
        for result in results.values():
            self.assertIn(result.state, (AdapterState.NOT_APPLICABLE, AdapterState.INSUFFICIENT_DATA))


if __name__ == "__main__":
    unittest.main()
