"""Tests for bots/theta/quant/research/opportunity_capture.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.opportunity_capture import OpportunityCaptureInputs, compute_opportunity_capture  # noqa: E402


class OpportunityCaptureTests(unittest.TestCase):
    def test_unknown_when_no_empirical_ev_model_exists(self):
        result = compute_opportunity_capture(OpportunityCaptureInputs(selected_positive_ev_count=2, detected_positive_ev_count=None))
        self.assertIsNone(result.opportunity_capture)

    def test_unknown_when_zero_detected(self):
        result = compute_opportunity_capture(OpportunityCaptureInputs(selected_positive_ev_count=0, detected_positive_ev_count=0))
        self.assertIsNone(result.opportunity_capture)

    def test_computes_normally_when_both_are_known(self):
        result = compute_opportunity_capture(OpportunityCaptureInputs(selected_positive_ev_count=3, detected_positive_ev_count=10))
        self.assertAlmostEqual(result.opportunity_capture, 0.3)

    def test_selected_exceeding_detected_is_unknown_never_clipped(self):
        result = compute_opportunity_capture(OpportunityCaptureInputs(selected_positive_ev_count=5, detected_positive_ev_count=3))
        self.assertIsNone(result.opportunity_capture)


if __name__ == "__main__":
    unittest.main()
