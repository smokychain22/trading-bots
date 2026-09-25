"""Tests for bots/theta/quant/research/selection_bias_runner.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.selection_bias_runner import (  # noqa: E402
    SelectionBiasRunnerError,
    run_selection_bias_campaign,
)


def _campaign(**overrides):
    defaults = dict(
        researchCampaignId="campaign-1",
        returnNormalizationVersion="capital-day-return-v1",
        trialIdentities=["subject", "trial-2", "trial-3"],
        trialReturnSeries={
            "subject": [0.01, 0.02, -0.01, 0.015, 0.03, -0.005, 0.02, 0.01],
            "trial-2": [0.005, -0.01, 0.02, -0.005, 0.01, 0.0, 0.015, -0.02],
            "trial-3": [-0.01, 0.0, 0.01, -0.02, 0.005, 0.01, -0.015, 0.02],
        },
        inputDatasetHash="a" * 64,
        dependencyGroupingVersion="theta-dependence-grouping-v1",
        codeSha="b" * 40,
    )
    defaults.update(overrides)
    return defaults


class SelectionBiasRunnerTests(unittest.TestCase):
    def test_core_claim_rejects_unregistered_return_normalization(self):
        with self.assertRaisesRegex(SelectionBiasRunnerError, "RETURN_NORMALIZATION_INVALID"):
            run_selection_bias_campaign(_campaign(returnNormalizationVersion="raw-dollar-pnl"))

    def test_rejects_missing_normalization(self):
        campaign = _campaign()
        del campaign["returnNormalizationVersion"]
        with self.assertRaises(SelectionBiasRunnerError):
            run_selection_bias_campaign(campaign)

    def test_rejects_duplicate_trial_identity(self):
        with self.assertRaisesRegex(SelectionBiasRunnerError, "DUPLICATE_TRIAL_IDENTITY"):
            run_selection_bias_campaign(_campaign(trialIdentities=["subject", "subject"]))

    def test_rejects_trial_identity_with_no_series(self):
        campaign = _campaign(trialIdentities=["subject", "trial-2", "trial-3", "ghost-trial"])
        with self.assertRaisesRegex(SelectionBiasRunnerError, "MISSING_SERIES_FOR_TRIAL"):
            run_selection_bias_campaign(campaign)

    def test_real_campaign_produces_a_contract_matching_receipt_shape(self):
        receipt = run_selection_bias_campaign(_campaign())
        self.assertEqual(receipt["contractVersion"], "theta-selection-bias-receipt-v1")
        self.assertEqual(receipt["numberOfTrials"], 3)
        self.assertEqual(receipt["trialIdentities"], ["subject", "trial-2", "trial-3"])
        self.assertIsNotNone(receipt["dsr"])
        self.assertIn("deflatedSharpeRatio", receipt["dsr"])
        self.assertEqual(receipt["inputDatasetHash"], "a" * 64)
        self.assertEqual(receipt["returnNormalizationVersion"], "capital-day-return-v1")

    def test_single_trial_campaign_still_produces_a_dsr_with_no_deflation(self):
        campaign = _campaign(
            trialIdentities=["subject"],
            trialReturnSeries={"subject": [0.01, 0.02, -0.01, 0.015, 0.03, -0.005, 0.02, 0.01]},
        )
        receipt = run_selection_bias_campaign(campaign)
        self.assertEqual(receipt["numberOfTrials"], 1)
        self.assertIsNotNone(receipt["dsr"])
        self.assertEqual(receipt["dsr"]["expectedMaxSharpeUnderNull"], 0.0)

    def test_uneven_series_lengths_yield_unknown_pbo_not_a_fabricated_number(self):
        campaign = _campaign(
            trialReturnSeries={
                "subject": [0.01, 0.02, -0.01, 0.015],
                "trial-2": [0.005, -0.01, 0.02, -0.005, 0.01, 0.0],
                "trial-3": [-0.01, 0.0, 0.01, -0.02, 0.005, 0.01],
            }
        )
        receipt = run_selection_bias_campaign(campaign)
        self.assertIsNone(receipt["pbo"])

    def test_deterministic_on_the_same_fixture(self):
        receipt_a = run_selection_bias_campaign(_campaign())
        receipt_b = run_selection_bias_campaign(_campaign())
        self.assertEqual(receipt_a["dsr"], receipt_b["dsr"])
        self.assertEqual(receipt_a["pbo"], receipt_b["pbo"])


if __name__ == "__main__":
    unittest.main()
