"""Tests for bots/theta/quant/models/theta_q_lattice.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.theta_q_lattice import (  # noqa: E402
    ChainContract,
    LatticeConfig,
    build_candidate_grid,
)


def _config(**overrides) -> LatticeConfig:
    defaults = dict(
        config_version="TEST-LATTICE-1",
        min_dte=30,
        max_dte=60,
        delta_bands=((0.10, 0.15), (0.15, 0.20), (0.20, 0.25), (0.25, 0.30)),
        min_open_interest=50,
        min_volume=10,
        max_spread_pct=0.08,
        earnings_exclusion_days=5,
    )
    defaults.update(overrides)
    return LatticeConfig(**defaults)


def _contract(**overrides) -> ChainContract:
    defaults = dict(
        underlying_symbol="SYN",
        expiration_dte=45,
        strike=50.0,
        put_delta_magnitude=0.22,
        spread_pct=0.03,
        open_interest=200,
        volume=50,
        earnings_distance_days=30,
    )
    defaults.update(overrides)
    return ChainContract(**defaults)


class SingleBandRejectionTests(unittest.TestCase):
    def test_single_delta_band_is_rejected_at_construction(self):
        with self.assertRaises(ValueError):
            _config(delta_bands=((0.20, 0.25),))

    def test_min_dte_greater_than_max_dte_is_rejected(self):
        with self.assertRaises(ValueError):
            _config(min_dte=60, max_dte=30)


class CandidateGridTests(unittest.TestCase):
    def test_clean_contract_is_eligible(self):
        result = build_candidate_grid([_contract()], _config())
        self.assertEqual(len(result.eligible), 1)
        self.assertEqual(len(result.rejected), 0)

    def test_wait_is_always_present(self):
        result = build_candidate_grid([], _config())
        self.assertTrue(result.includes_wait)

    def test_dte_outside_window_is_rejected(self):
        result = build_candidate_grid([_contract(expiration_dte=10)], _config())
        self.assertEqual(len(result.rejected), 1)
        self.assertIn("DTE_OUTSIDE_LATTICE", [r.code for r in result.rejected[0].reasons])

    def test_delta_outside_all_bands_is_rejected(self):
        result = build_candidate_grid([_contract(put_delta_magnitude=0.05)], _config())
        self.assertEqual(len(result.rejected), 1)
        self.assertIn("DELTA_OUTSIDE_ALL_BANDS", [r.code for r in result.rejected[0].reasons])

    def test_multiple_bands_all_accepted(self):
        contracts = [
            _contract(put_delta_magnitude=0.12),
            _contract(put_delta_magnitude=0.17),
            _contract(put_delta_magnitude=0.22),
            _contract(put_delta_magnitude=0.27),
        ]
        result = build_candidate_grid(contracts, _config())
        self.assertEqual(len(result.eligible), 4)
        bands = {c.delta_band for c in result.eligible}
        self.assertEqual(len(bands), 4)  # each candidate landed in a distinct band

    def test_rejected_candidates_are_retained_not_dropped(self):
        result = build_candidate_grid([_contract(expiration_dte=10), _contract()], _config())
        self.assertEqual(len(result.eligible), 1)
        self.assertEqual(len(result.rejected), 1)

    def test_earnings_too_near_is_rejected(self):
        result = build_candidate_grid([_contract(earnings_distance_days=2)], _config())
        self.assertIn("EARNINGS_TOO_NEAR", [r.code for r in result.rejected[0].reasons])

    def test_unknown_open_interest_is_distinguished_from_known_below_floor(self):
        unknown = build_candidate_grid([_contract(open_interest=None)], _config())
        below_floor = build_candidate_grid([_contract(open_interest=1)], _config())
        self.assertIn("OPEN_INTEREST_UNKNOWN", [r.code for r in unknown.rejected[0].reasons])
        self.assertIn("OPEN_INTEREST_BELOW_FLOOR", [r.code for r in below_floor.rejected[0].reasons])

    def test_unknown_volume_is_distinguished_from_known_below_floor(self):
        unknown = build_candidate_grid([_contract(volume=None)], _config())
        below_floor = build_candidate_grid([_contract(volume=1)], _config())
        self.assertIn("VOLUME_UNKNOWN", [r.code for r in unknown.rejected[0].reasons])
        self.assertIn("VOLUME_BELOW_FLOOR", [r.code for r in below_floor.rejected[0].reasons])

    def test_unknown_spread_is_distinguished_from_known_too_wide(self):
        unknown = build_candidate_grid([_contract(spread_pct=None)], _config())
        too_wide = build_candidate_grid([_contract(spread_pct=0.5)], _config())
        self.assertIn("SPREAD_UNKNOWN", [r.code for r in unknown.rejected[0].reasons])
        self.assertIn("SPREAD_TOO_WIDE", [r.code for r in too_wide.rejected[0].reasons])


if __name__ == "__main__":
    unittest.main()
