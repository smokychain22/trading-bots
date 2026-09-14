"""Tests for bots/theta/quant/research/volatility_surface_research.py. Synthetic fixtures only."""

import math
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.volatility_surface_research import (  # noqa: E402
    ArbitrageStatus,
    FitQuality,
    RawSviParameters,
    SurfacePoint,
    check_butterfly_arbitrage_sufficient,
    check_calendar_arbitrage,
    compute_surface_residual,
    fit_raw_svi,
    raw_svi_total_variance,
)

_M_GRID = [x / 100 for x in range(-30, 31, 5)]  # -0.30 .. 0.30 step 0.05
_SIGMA_GRID = [x / 100 for x in range(5, 60, 5)]  # 0.05 .. 0.55 step 0.05


def _synthetic_points(true_params: RawSviParameters, strikes_k: list, noise: float = 0.0) -> list:
    points = []
    for i, k in enumerate(strikes_k):
        w = raw_svi_total_variance(k, true_params)
        jitter = noise * ((-1) ** i) * (i % 3) / 10
        points.append(SurfacePoint(log_moneyness=k, total_variance=w + jitter, liquid=True))
    return points


class RawSviFormulaTests(unittest.TestCase):
    def test_at_k_equals_m_total_variance_is_a_plus_b_sigma(self):
        params = RawSviParameters(a=0.04, b=0.4, rho=-0.3, m=0.0, sigma=0.2)
        # y = k - m = 0 -> w = a + b*(rho*0 + sqrt(0+sigma^2)) = a + b*sigma
        expected = params.a + params.b * params.sigma
        self.assertAlmostEqual(raw_svi_total_variance(params.m, params), expected)


class QuasiExplicitCalibrationTests(unittest.TestCase):
    """The core correctness test: fitting exact (noiseless) SVI-generated
    points must recover the total-variance CURVE (not necessarily the
    exact same parameter tuple, since (m, sigma) is grid-searched) with
    near-zero residual."""

    def test_noiseless_exact_svi_data_fits_with_near_zero_residual(self):
        true_params = RawSviParameters(a=0.04, b=0.35, rho=-0.25, m=0.0, sigma=0.25)
        strikes_k = [x / 100 for x in range(-40, 45, 5)]
        points = _synthetic_points(true_params, strikes_k)
        result = fit_raw_svi("2026-10-17", points, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertEqual(result.evidence_state, "FITTED")
        self.assertIsNotNone(result.parameters)
        self.assertIsNotNone(result.diagnostics.fit_residual_rms)
        self.assertLess(result.diagnostics.fit_residual_rms, 1e-6)

    def test_fitted_curve_matches_true_curve_at_held_out_points(self):
        true_params = RawSviParameters(a=0.05, b=0.3, rho=0.1, m=-0.05, sigma=0.3)
        fit_strikes = [x / 100 for x in range(-50, 55, 5)]
        points = _synthetic_points(true_params, fit_strikes)
        result = fit_raw_svi("2026-10-17", points, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertIsNotNone(result.parameters)
        for held_out_k in (-0.42, -0.08, 0.17, 0.36):
            true_w = raw_svi_total_variance(held_out_k, true_params)
            fitted_w = raw_svi_total_variance(held_out_k, result.parameters)
            self.assertAlmostEqual(true_w, fitted_w, places=3)

    def test_insufficient_liquid_points_refuses_to_fit(self):
        points = [SurfacePoint(log_moneyness=k / 10, total_variance=0.05, liquid=(k < 2)) for k in range(10)]
        result = fit_raw_svi("2026-10-17", points, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertEqual(result.evidence_state, "INSUFFICIENT_DATA")
        self.assertIsNone(result.parameters)
        self.assertEqual(result.arbitrage_status, ArbitrageStatus.NOT_CHECKED)

    def test_illiquid_points_are_excluded_from_the_fit(self):
        true_params = RawSviParameters(a=0.04, b=0.3, rho=-0.2, m=0.0, sigma=0.25)
        strikes_k = [x / 100 for x in range(-40, 45, 5)]
        points = _synthetic_points(true_params, strikes_k)
        # Corrupt a few points but mark them illiquid -- they must not pollute the fit.
        corrupted = [
            SurfacePoint(log_moneyness=p.log_moneyness, total_variance=p.total_variance + 5.0, liquid=False)
            if i % 4 == 0 else p
            for i, p in enumerate(points)
        ]
        result = fit_raw_svi("2026-10-17", corrupted, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertIsNotNone(result.parameters)
        self.assertLess(result.diagnostics.fit_residual_rms, 1e-6)


class ArbitrageDiagnosticTests(unittest.TestCase):
    def test_a_well_behaved_slice_passes_the_sufficient_butterfly_condition(self):
        self.assertTrue(check_butterfly_arbitrage_sufficient(b=0.3, rho=-0.2, sigma=0.25))

    def test_an_extreme_slice_fails_the_sufficient_butterfly_condition(self):
        self.assertFalse(check_butterfly_arbitrage_sufficient(b=5.0, rho=0.9, sigma=2.0))

    def test_calendar_arbitrage_passes_when_far_variance_dominates(self):
        near = RawSviParameters(a=0.02, b=0.2, rho=0.0, m=0.0, sigma=0.2)
        far = RawSviParameters(a=0.05, b=0.2, rho=0.0, m=0.0, sigma=0.2)
        self.assertTrue(check_calendar_arbitrage(near, far, k_samples=[-0.2, 0.0, 0.2]))

    def test_calendar_arbitrage_fails_when_near_variance_exceeds_far(self):
        near = RawSviParameters(a=0.08, b=0.2, rho=0.0, m=0.0, sigma=0.2)
        far = RawSviParameters(a=0.02, b=0.2, rho=0.0, m=0.0, sigma=0.2)
        self.assertFalse(check_calendar_arbitrage(near, far, k_samples=[-0.2, 0.0, 0.2]))


class SurfaceResidualTests(unittest.TestCase):
    def test_residual_is_none_when_market_iv_is_unknown(self):
        true_params = RawSviParameters(a=0.04, b=0.3, rho=-0.2, m=0.0, sigma=0.25)
        points = _synthetic_points(true_params, [x / 100 for x in range(-40, 45, 5)])
        fit = fit_raw_svi("2026-10-17", points, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertIsNone(compute_surface_residual(None, fit, 0.0, 0.1))

    def test_residual_is_none_when_the_fit_did_not_converge(self):
        points = [SurfacePoint(log_moneyness=0.0, total_variance=0.04, liquid=True)] * 3
        fit = fit_raw_svi("2026-10-17", points, min_strike_count=2, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        self.assertIsNone(compute_surface_residual(0.2, fit, 0.0, 0.1))

    def test_residual_is_near_zero_for_a_point_generated_from_the_true_surface(self):
        true_params = RawSviParameters(a=0.04, b=0.3, rho=-0.2, m=0.0, sigma=0.25)
        strikes_k = [x / 100 for x in range(-40, 45, 5)]
        points = _synthetic_points(true_params, strikes_k)
        fit = fit_raw_svi("2026-10-17", points, min_strike_count=5, m_grid=_M_GRID, sigma_grid=_SIGMA_GRID)
        t = 30 / 365
        k = 0.1
        market_iv = math.sqrt(raw_svi_total_variance(k, true_params) / t)
        residual = compute_surface_residual(market_iv, fit, k, t)
        self.assertIsNotNone(residual)
        self.assertAlmostEqual(residual, 0.0, places=3)


if __name__ == "__main__":
    unittest.main()
