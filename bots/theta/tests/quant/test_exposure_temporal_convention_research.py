"""Tests for research/exposure_temporal_convention_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.exposure_temporal_convention_research import (  # noqa: E402
    ExposureGreek,
    ExposureObservation,
    ExposureProvenance,
    ExposureSignConvention,
    ExposureTemporalState,
    derive_exposure_temporal_change,
)

CONVENTION_A = ExposureSignConvention(convention_id="CUSTOMER_LONG_CALLS_DEALER_SHORT", verified=False)
CONVENTION_B = ExposureSignConvention(convention_id="ALTERNATE_CONVENTION", verified=False)


def _obs(greek, ts, value, provenance=ExposureProvenance.PROVIDER_FACT, convention=CONVENTION_A, underlying="SPY", scope="PORTFOLIO"):
    return ExposureObservation(greek=greek, underlying=underlying, observed_at=ts, value=value, provenance=provenance, sign_convention=convention, scope_key=scope)


class DeriveExposureTemporalChangeTests(unittest.TestCase):
    def test_known_change_computed_for_matching_observations(self):
        earlier = _obs(ExposureGreek.VANNA, "2026-09-15T10:00:00Z", 100.0)
        current = _obs(ExposureGreek.VANNA, "2026-09-15T10:30:00Z", 150.0)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.KNOWN)
        self.assertAlmostEqual(result.absolute_change, 50.0)
        self.assertAlmostEqual(result.rate_per_hour, 100.0)

    def test_greek_mismatch_is_invalid(self):
        earlier = _obs(ExposureGreek.DEX, "2026-09-15T10:00:00Z", 100.0)
        current = _obs(ExposureGreek.CHARM, "2026-09-15T10:30:00Z", 150.0)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.INVALID)
        self.assertEqual(result.reason, "GREEK_MISMATCH")

    def test_underlying_mismatch_is_invalid(self):
        earlier = _obs(ExposureGreek.DEX, "2026-09-15T10:00:00Z", 100.0, underlying="SPY")
        current = _obs(ExposureGreek.DEX, "2026-09-15T10:30:00Z", 150.0, underlying="QQQ")
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.INVALID)
        self.assertEqual(result.reason, "UNDERLYING_MISMATCH")

    def test_scope_mismatch_is_unknown_not_invalid(self):
        earlier = _obs(ExposureGreek.DEX, "2026-09-15T10:00:00Z", 100.0, scope="STRIKE:100")
        current = _obs(ExposureGreek.DEX, "2026-09-15T10:30:00Z", 150.0, scope="STRIKE:105")
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.UNKNOWN)
        self.assertEqual(result.reason, "SCOPE_MISMATCH")

    def test_provenance_mismatch_provider_vs_theta_derived_is_invalid(self):
        earlier = _obs(ExposureGreek.DEX, "2026-09-15T10:00:00Z", 100.0, provenance=ExposureProvenance.PROVIDER_FACT)
        current = _obs(ExposureGreek.DEX, "2026-09-15T10:30:00Z", 150.0, provenance=ExposureProvenance.THETA_DERIVED)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.INVALID)
        self.assertEqual(result.reason, "PROVENANCE_MISMATCH_PROVIDER_VS_THETA_DERIVED")

    def test_incompatible_sign_convention_is_invalid_never_silently_diffed(self):
        earlier = _obs(ExposureGreek.VANNA, "2026-09-15T10:00:00Z", 100.0, convention=CONVENTION_A)
        current = _obs(ExposureGreek.VANNA, "2026-09-15T10:30:00Z", -80.0, convention=CONVENTION_B)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.INVALID)
        self.assertEqual(result.reason, "INCOMPATIBLE_SIGN_CONVENTION")

    def test_missing_value_is_unknown_not_zero(self):
        earlier = _obs(ExposureGreek.CHARM, "2026-09-15T10:00:00Z", None)
        current = _obs(ExposureGreek.CHARM, "2026-09-15T10:30:00Z", 10.0)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.UNKNOWN)
        self.assertEqual(result.reason, "MISSING_VALUE")
        self.assertIsNone(result.absolute_change)

    def test_gap_beyond_maximum_is_unknown(self):
        earlier = _obs(ExposureGreek.DEX, "2026-09-15T09:00:00Z", 100.0)
        current = _obs(ExposureGreek.DEX, "2026-09-15T12:00:00Z", 150.0)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.UNKNOWN)
        self.assertEqual(result.reason, "GAP_EXCEEDS_MAXIMUM")

    def test_non_causal_ordering_is_invalid(self):
        earlier = _obs(ExposureGreek.DEX, "2026-09-15T10:30:00Z", 100.0)
        current = _obs(ExposureGreek.DEX, "2026-09-15T10:00:00Z", 150.0)
        result = derive_exposure_temporal_change(earlier, current, maximum_gap_seconds=3600.0)
        self.assertEqual(result.state, ExposureTemporalState.INVALID)
        self.assertEqual(result.reason, "NON_CAUSAL_ORDERING")


if __name__ == "__main__":
    unittest.main()
